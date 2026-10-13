"""The trading loop, reconciler and daily summary.

All broker writes happen here. Ordering guarantees:

* the whole tick holds a Postgres advisory lock (single runner);
* the kill switch is read at the start of the tick and again right before each submit;
* an ``OrderIntent`` row is committed as PENDING before the broker is called, and its id
  is the broker ``client_order_id`` (see ``submit_idempotent``).
"""

from __future__ import annotations

import datetime as dt
import logging
import uuid
from collections.abc import Callable
from dataclasses import dataclass, field
from enum import StrEnum

from sqlalchemy import Engine, select
from sqlalchemy.orm import Session, sessionmaker

from dipbuyer import engine as rule_engine
from dipbuyer import indicators, risk
from dipbuyer.alerts import Notifier
from dipbuyer.broker import (
    BrokerClient,
    BrokerError,
    BrokerRejectedError,
    SubmitFailedError,
    submit_idempotent,
)
from dipbuyer.data.bars import BarService
from dipbuyer.data.calendar import (
    MarketState,
    is_trading_day,
    market_state,
    ny_date,
    ny_day_bounds,
    ny_week_bounds,
    previous_session,
    sessions_since,
)
from dipbuyer.domain.enums import (
    TERMINAL_UNFILLED_STATUSES,
    CycleAction,
    CycleEndReason,
    CycleState,
    Decision,
    OrderStatus,
    TradingMode,
)
from dipbuyer.domain.models import (
    Account,
    AssetInfo,
    CycleView,
    GlobalSettingsModel,
    OrderIntent,
    Position,
    Rule,
)
from dipbuyer.domain.money import ZERO
from dipbuyer.persistence import repo
from dipbuyer.persistence.db import notify, session_scope
from dipbuyer.persistence.lock import try_advisory_lock
from dipbuyer.persistence.models import (
    AccountSnapshotRow,
    DipCycleRow,
    EvaluationRow,
    GlobalSettingsRow,
    OrderIntentRow,
    PositionSnapshotRow,
)

log = logging.getLogger(__name__)

PENDING_ORPHAN_AFTER = dt.timedelta(minutes=2)


class TickOutcome(StrEnum):
    LOCKED = "LOCKED"
    NOT_DUE = "NOT_DUE"
    KILL_SWITCH = "KILL_SWITCH"
    MARKET_CLOSED = "MARKET_CLOSED"
    RAN = "RAN"


def intent_payload(row: OrderIntentRow) -> dict[str, object]:
    return {
        "id": str(row.id),
        "rule_id": str(row.rule_id),
        "symbol": row.symbol,
        "status": row.status,
        "tier_index": row.tier_index,
        "notional_usd": str(row.notional_usd),
    }


@dataclass
class TickContext:
    now: dt.datetime
    today: dt.date
    settings: GlobalSettingsModel
    market: MarketState
    broker: BrokerClient
    broker_clock_open: bool
    account: Account
    positions: dict[str, Position]
    assets: dict[str, AssetInfo | None] = field(default_factory=dict[str, AssetInfo | None])


class TradingLoop:
    def __init__(
        self,
        *,
        session_factory: sessionmaker[Session],
        db_engine: Engine,
        broker_factory: Callable[[TradingMode], BrokerClient],
        bar_service_factory: Callable[[TradingMode], BarService],
        notifier: Notifier,
        heartbeat: Callable[[], None] = lambda: None,
        now: Callable[[], dt.datetime] = lambda: dt.datetime.now(dt.UTC),
        dry_run: bool = False,
    ) -> None:
        self.sf = session_factory
        self.db_engine = db_engine
        self.broker_factory = broker_factory
        self.bar_service_factory = bar_service_factory
        self.notifier = notifier
        self.heartbeat = heartbeat
        self.now = now
        self.dry_run = dry_run
        self._cap_alerted: set[tuple[str, dt.date]] = set()
        self._logged_today: set[tuple[str, dt.date]] = set()

    # --- entry points -----------------------------------------------------------------
    def tick(self, *, force: bool = False) -> TickOutcome:
        with try_advisory_lock(self.db_engine) as got:
            if not got:
                log.info("trading loop lock held elsewhere; skipping tick")
                return TickOutcome.LOCKED
            return self._tick_locked(force=force)

    def _tick_locked(self, *, force: bool) -> TickOutcome:
        now = self.now()
        with session_scope(self.sf) as s:
            srow = repo.get_settings_row(s)
            settings = repo.settings_model(srow)
            status = repo.get_worker_status(s)
            interval = dt.timedelta(minutes=settings.evaluation_interval_minutes)
            if (
                not force
                and status.last_tick_at is not None
                and now - status.last_tick_at < interval - dt.timedelta(seconds=5)
            ):
                return TickOutcome.NOT_DUE
            status.last_tick_at = now
            market = market_state(
                now, settings.open_exclusion_minutes, settings.close_exclusion_minutes
            )
            if market.is_open:
                self.heartbeat()
                status.last_heartbeat_at = now
            cancel_pending = srow.kill_switch_cancel_pending

        if settings.kill_switch:
            if cancel_pending:
                self._cancel_all_for_kill_switch(settings.trading_mode)
            if market.is_open:
                self._log_once(now, "kill_switch", "kill switch is on: not evaluating rules")
            return TickOutcome.KILL_SWITCH
        if not market.is_open or market.in_exclusion_window:
            return TickOutcome.MARKET_CLOSED

        broker = self.broker_factory(settings.trading_mode)
        clock = broker.get_clock()
        self.reconcile_open_orders(broker, settings.trading_mode)
        account, positions = self._snapshot(broker, settings.trading_mode, now)
        ctx = TickContext(
            now=now,
            today=ny_date(now),
            settings=settings,
            market=market,
            broker=broker,
            broker_clock_open=clock.is_open,
            account=account,
            positions={p.symbol: p for p in positions},
        )
        with session_scope(self.sf) as s:
            rules = [repo.rule_from_row(r) for r in repo.list_rules(s, enabled_only=True)]
        if not rules:
            self._log_once(now, "no_rules", "no enabled rules: enable a rule to get evaluations")
        else:
            log.info(
                "tick",
                extra={"rules": len(rules), "mode": settings.trading_mode.value},
            )
        for rule in rules:
            try:
                self._evaluate_rule(rule, ctx)
            except Exception as exc:
                log.exception("rule evaluation failed", extra={"rule_id": str(rule.id)})
                self.notifier.send(
                    "Worker exception", f"{rule.symbol} ({rule.id}): {exc}", priority="high"
                )
        return TickOutcome.RAN

    def _log_once(self, now: dt.datetime, key: str, message: str) -> None:
        """Log ``message`` at most once per NY trading day (avoids a line every tick)."""
        day_key = (key, ny_date(now))
        if day_key not in self._logged_today:
            self._logged_today.add(day_key)
            log.info(message)

    # --- kill switch ------------------------------------------------------------------
    def _cancel_all_for_kill_switch(self, mode: TradingMode) -> None:
        try:
            self.broker_factory(mode).cancel_all_open()
        except BrokerError as exc:
            log.error("cancel_all_open failed", extra={"error": str(exc)})
            self.notifier.send("Kill switch: cancel failed", str(exc), priority="urgent")
            return
        with session_scope(self.sf) as s:
            srow = repo.get_settings_row(s, for_update=True)
            srow.kill_switch_cancel_pending = False
        self.notifier.send("Kill switch active", "All open orders canceled.", priority="high")

    # --- snapshots --------------------------------------------------------------------
    def _snapshot(
        self, broker: BrokerClient, mode: TradingMode, now: dt.datetime
    ) -> tuple[Account, list[Position]]:
        account = broker.get_account()
        positions = broker.get_positions()
        with session_scope(self.sf) as s:
            snap = AccountSnapshotRow(
                ts=now,
                mode=mode.value,
                equity=account.equity,
                cash=account.cash,
                buying_power=account.buying_power,
            )
            s.add(snap)
            s.flush()
            for p in positions:
                s.add(
                    PositionSnapshotRow(
                        account_snapshot_id=snap.id,
                        ts=now,
                        symbol=p.symbol,
                        qty=p.qty,
                        avg_entry_price=p.avg_entry_price,
                        market_value=p.market_value,
                        unrealized_pl=p.unrealized_pl,
                    )
                )
        return account, positions

    # --- reconciler -------------------------------------------------------------------
    def reconcile_open_orders(self, broker: BrokerClient, mode: TradingMode) -> int:
        """Sync open intents (of ``mode``) with the broker. Returns intents changed."""
        now = self.now()
        changed = 0
        with session_scope(self.sf) as s:
            ids = [r.id for r in repo.open_intents(s) if r.mode == mode.value]
        for intent_id in ids:
            try:
                bo = broker.get_order_by_client_id(str(intent_id))
            except BrokerError as exc:
                log.warning(
                    "reconcile lookup failed",
                    extra={"intent_id": str(intent_id), "error": str(exc)},
                )
                continue
            with session_scope(self.sf) as s:
                row = s.get(OrderIntentRow, intent_id, with_for_update=True)
                if row is None or row.status not in {
                    OrderStatus.PENDING,
                    OrderStatus.SUBMITTED,
                    OrderStatus.PARTIALLY_FILLED,
                }:
                    continue
                if bo is None:
                    if (
                        row.status == OrderStatus.PENDING
                        and now - row.created_at > PENDING_ORPHAN_AFTER
                    ):
                        row.status = OrderStatus.FAILED.value
                        row.error = "never reached broker"
                        notify(s, "order", intent_payload(row))
                        changed += 1
                    continue
                if row.status == OrderStatus.PENDING:
                    row.broker_order_id = bo.broker_order_id
                    row.submitted_at = now
                    self._mark_tier(s, row, now)
                new_status = bo.status
                if new_status in TERMINAL_UNFILLED_STATUSES and bo.filled_qty > 0:
                    # Partially filled then canceled/expired: keep what we got.
                    new_status = OrderStatus.FILLED
                if new_status.value == row.status and bo.filled_qty == (row.filled_qty or ZERO):
                    continue
                row.status = new_status.value
                row.filled_qty = bo.filled_qty
                row.filled_avg_price = bo.filled_avg_price
                changed += 1
                notify(s, "order", intent_payload(row))
                if new_status is OrderStatus.FILLED:
                    self.notifier.send(
                        f"Filled {row.symbol}",
                        f"{bo.filled_qty} @ {bo.filled_avg_price} (tier {row.tier_index + 1})",
                    )
                elif new_status in TERMINAL_UNFILLED_STATUSES:
                    self._unmark_tier(s, row)
                    prio = "high" if new_status is OrderStatus.REJECTED else "default"
                    self.notifier.send(
                        f"Order {new_status.value.lower()} {row.symbol}",
                        f"tier {row.tier_index + 1}, ${row.notional_usd}",
                        priority=prio,
                    )
        return changed

    @staticmethod
    def _mark_tier(s: Session, row: OrderIntentRow, now: dt.datetime) -> None:
        if row.cycle_id is None:
            return
        cycle = s.get(DipCycleRow, row.cycle_id, with_for_update=True)
        if cycle is not None and row.tier_index not in cycle.tiers_filled:
            cycle.tiers_filled = sorted([*cycle.tiers_filled, row.tier_index])
            cycle.last_fill_at = now

    @staticmethod
    def _unmark_tier(s: Session, row: OrderIntentRow) -> None:
        if row.cycle_id is None:
            return
        cycle = s.get(DipCycleRow, row.cycle_id, with_for_update=True)
        if cycle is not None and row.tier_index in cycle.tiers_filled:
            cycle.tiers_filled = [t for t in cycle.tiers_filled if t != row.tier_index]

    # --- per-rule evaluation ----------------------------------------------------------
    def _asset(self, ctx: TickContext, symbol: str) -> AssetInfo | None:
        if symbol not in ctx.assets:
            ctx.assets[symbol] = ctx.broker.get_asset(symbol)
        return ctx.assets[symbol]

    def _evaluate_rule(self, rule: Rule, ctx: TickContext) -> None:
        mode = ctx.settings.trading_mode
        bar_service = self.bar_service_factory(mode)
        with session_scope(self.sf) as s:
            try:
                bars, last = bar_service.load(s, rule.symbol, ctx.today)
            except BrokerError as exc:
                self._record_eval_no_data(s, rule, ctx, str(exc))
                return
            if not bars:
                self._record_eval_no_data(s, rule, ctx, "no daily bars")
                return
            ind = indicators.compute(
                bars, last, lookback_days=rule.lookback_days, ma_period=rule.ma_period
            )
            cycle_row = repo.get_active_cycle(s, rule.id, for_update=True)
            cycle_view = (
                CycleView(
                    id=cycle_row.id,
                    ref_high=cycle_row.ref_high,
                    tiers_filled=tuple(cycle_row.tiers_filled),
                    sessions_since_last_fill=sessions_since(
                        cycle_row.last_fill_at or cycle_row.started_at, ctx.now
                    ),
                )
                if cycle_row is not None
                else None
            )
            flags = repo.session_condition_flags(s, rule.id, ctx.today)
            result = rule_engine.evaluate(rule, ind, cycle_view, flags)

            if result.cycle_action is CycleAction.CLOSE and cycle_row is not None:
                cycle_row.state = CycleState.CLOSED.value
                cycle_row.ended_at = ctx.now
                cycle_row.end_reason = (result.close_reason or CycleEndReason.MANUAL).value
                cycle_row = None

            prev = repo.get_last_closed_cycle(s, rule.id)
            prev_fill = prev.last_fill_at if prev is not None else None
            day_start, day_end = ny_day_bounds(ctx.now)
            week_start, week_end = ny_week_bounds(ctx.now)
            pos = ctx.positions.get(rule.symbol)
            cost_basis = pos.qty * pos.avg_entry_price if pos is not None else ZERO
            asset = self._asset(ctx, rule.symbol) if result.tier_to_fill is not None else None
            rctx = risk.RiskContext(
                settings=ctx.settings,
                mode=mode,
                calendar_open=ctx.market.is_open,
                broker_clock_open=ctx.broker_clock_open,
                in_exclusion_window=ctx.market.in_exclusion_window,
                expected_prev_session=previous_session(ctx.today),
                has_open_order=repo.has_open_intent(s, rule.id, mode),
                tiers_filled=tuple(cycle_row.tiers_filled) if cycle_row is not None else (),
                sessions_since_prev_cycle_fill=(
                    sessions_since(prev_fill, ctx.now) if prev_fill is not None else None
                ),
                spend_today=repo.spend_between(s, day_start, day_end, mode),
                spend_week=repo.spend_between(s, week_start, week_end, mode),
                position_value=cost_basis + repo.open_notional_for_symbol(s, rule.symbol, mode),
                buying_power=ctx.account.buying_power,
                fractionable=asset.fractionable if asset is not None else False,
            )
            decision = risk.check(rule, result, rctx)
            if decision.place_order and (asset is None or not asset.tradable):
                decision = risk.RiskDecision(
                    decision=Decision.SKIP_QTY_ZERO, reason=f"{rule.symbol} is not tradable"
                )
            if decision.place_order and self.dry_run:
                decision = risk.RiskDecision(
                    decision=Decision.SKIP_DRY_RUN,
                    reason=f"[dry run] {decision.reason}",
                    qty=decision.qty,
                )
            self._record_eval(s, rule, ctx, result, decision)
            if decision.decision in {Decision.SKIP_DAILY_CAP, Decision.SKIP_WEEKLY_CAP}:
                self._alert_cap_once(rule, decision)

            if not decision.place_order:
                return
            tier = result.tier_to_fill
            notional, limit_price, qty = result.notional, result.limit_price, decision.qty
            if tier is None or notional is None or limit_price is None or qty is None:
                raise RuntimeError("ORDER decision without sizing")
            if result.cycle_action is CycleAction.OPEN:
                if result.cycle_ref_high is None:
                    raise RuntimeError("OPEN without ref_high")
                cycle_row = DipCycleRow(
                    id=uuid.uuid4(),
                    rule_id=rule.id,
                    state=CycleState.ACTIVE.value,
                    ref_high=result.cycle_ref_high,
                    tiers_filled=[],
                    started_at=ctx.now,
                )
                s.add(cycle_row)
                s.flush()

            # Re-check the kill switch immediately before submission.
            fresh = s.execute(
                select(GlobalSettingsRow.kill_switch, GlobalSettingsRow.trading_mode).where(
                    GlobalSettingsRow.id == 1
                )
            ).one()
            if fresh.kill_switch or fresh.trading_mode != mode.value:
                log.warning(
                    "kill switch or mode changed before submit", extra={"rule_id": str(rule.id)}
                )
                return
            intent_row = OrderIntentRow(
                id=uuid.uuid4(),
                rule_id=rule.id,
                cycle_id=cycle_row.id if cycle_row is not None else None,
                symbol=rule.symbol,
                tier_index=tier,
                mode=mode.value,
                notional_usd=notional,
                qty=qty,
                limit_price=limit_price,
                status=OrderStatus.PENDING.value,
                created_at=ctx.now,
                updated_at=ctx.now,
            )
            s.add(intent_row)
            notify(s, "order", intent_payload(intent_row))
        # PENDING intent (and new cycle, evaluation) committed above, before the broker call.
        self._submit(intent_row.id, ctx)

    def _submit(self, intent_id: uuid.UUID, ctx: TickContext) -> None:
        with session_scope(self.sf) as s:
            row = s.get_one(OrderIntentRow, intent_id)
            intent: OrderIntent = repo.intent_from_row(row)
        error: str | None = None
        status = OrderStatus.FAILED
        bo = None
        try:
            bo = submit_idempotent(ctx.broker, intent)
        except BrokerRejectedError as exc:
            status, error = OrderStatus.REJECTED, str(exc)
        except (SubmitFailedError, BrokerError) as exc:
            status, error = OrderStatus.FAILED, str(exc)
        with session_scope(self.sf) as s:
            row = s.get_one(OrderIntentRow, intent_id, with_for_update=True)
            if bo is not None:
                row.broker_order_id = bo.broker_order_id
                row.submitted_at = ctx.now
                row.status = bo.status.value
                row.filled_qty = bo.filled_qty
                row.filled_avg_price = bo.filled_avg_price
                self._mark_tier(s, row, ctx.now)
            else:
                row.status = status.value
                row.error = error
            notify(s, "order", intent_payload(row))
        extra = {"intent_id": str(intent_id), "rule_id": str(intent.rule_id)}
        if bo is not None:
            log.info("order submitted", extra=extra)
            self.notifier.send(
                f"Order submitted {intent.symbol}",
                f"[{intent.mode.value}] tier {intent.tier_index + 1}: buy {intent.qty} @ "
                f"{intent.limit_price} (${intent.notional_usd})",
            )
        else:
            log.error("order submit failed", extra={**extra, "error": error})
            self.notifier.send(
                f"Order {status.value.lower()} {intent.symbol}", error or "", priority="high"
            )

    def _alert_cap_once(self, rule: Rule, decision: risk.RiskDecision) -> None:
        key = (decision.decision.value, ny_date(self.now()))
        if key in self._cap_alerted:
            return
        self._cap_alerted.add(key)
        self.notifier.send("Spend cap reached", f"{rule.symbol}: {decision.reason}")

    def _record_eval(
        self,
        s: Session,
        rule: Rule,
        ctx: TickContext,
        result: rule_engine.EngineResult,
        decision: risk.RiskDecision,
    ) -> None:
        ind = result.indicators
        row = EvaluationRow(
            rule_id=rule.id,
            ts=ctx.now,
            session_date=ctx.today,
            last_price=ind.last_price,
            ref_high=result.cycle_ref_high or ind.ref_high,
            sma50=ind.sma50,
            sma200=ind.sma200,
            rsi14=ind.rsi14,
            pullback_pct=ind.pullback_pct,
            condition_met=result.condition_met,
            consecutive_met=result.consecutive_met,
            tier_hit=result.tier_to_fill,
            decision=decision.decision.value,
            reason=decision.reason
            if decision.decision is not Decision.NO_TRIGGER
            else result.reason,
        )
        s.add(row)
        log.info(
            "evaluation",
            extra={"rule_id": str(rule.id), "symbol": rule.symbol, "decision": row.decision},
        )
        notify(
            s,
            "evaluation",
            {"rule_id": str(rule.id), "symbol": rule.symbol, "decision": row.decision},
        )

    def _record_eval_no_data(self, s: Session, rule: Rule, ctx: TickContext, why: str) -> None:
        s.add(
            EvaluationRow(
                rule_id=rule.id,
                ts=ctx.now,
                session_date=ctx.today,
                last_price=None,
                ref_high=None,
                sma50=None,
                sma200=None,
                rsi14=None,
                pullback_pct=None,
                condition_met=False,
                consecutive_met=0,
                tier_hit=None,
                decision=Decision.SKIP_NO_DATA.value,
                reason=why,
            )
        )
        notify(
            s,
            "evaluation",
            {"rule_id": str(rule.id), "symbol": rule.symbol, "decision": "SKIP_NO_DATA"},
        )

    # --- daily summary ----------------------------------------------------------------
    def daily_summary(self) -> str | None:
        now = self.now()
        today = ny_date(now)
        if not is_trading_day(today):
            return None
        with session_scope(self.sf) as s:
            settings = repo.settings_model(repo.get_settings_row(s))
            status = repo.get_worker_status(s)
            if status.last_summary_date == today:
                return None
        mode = settings.trading_mode
        broker = self.broker_factory(mode)
        try:
            self.reconcile_open_orders(broker, mode)
            positions = broker.get_positions()
        except BrokerError as exc:
            positions = []
            log.warning("summary broker error", extra={"error": str(exc)})
        start, end = ny_day_bounds(now)
        with session_scope(self.sf) as s:
            rows = list(
                s.scalars(
                    select(OrderIntentRow).where(
                        OrderIntentRow.created_at >= start, OrderIntentRow.created_at < end
                    )
                )
            )
            spend = repo.spend_between(s, start, end, mode)
            repo.get_worker_status(s).last_summary_date = today
        fills = [r for r in rows if r.status == OrderStatus.FILLED]
        lines = [
            f"Mode {mode.value}. Orders today: {len(rows)}, filled: {len(fills)}.",
            f"Spend today: ${spend:.2f} of ${settings.max_daily_spend_usd:.2f}.",
        ]
        lines += [
            f"  {r.symbol} tier {r.tier_index + 1}: {r.status} "
            f"{r.filled_qty or 0} @ {r.filled_avg_price or '-'}"
            for r in rows
        ]
        if positions:
            lines.append("Positions:")
            lines += [
                f"  {p.symbol}: {p.qty} @ {p.avg_entry_price:.2f}, MV ${p.market_value:.2f}, "
                f"P/L ${p.unrealized_pl:.2f}"
                for p in positions
            ]
        body = "\n".join(lines)
        self.notifier.send(f"Dip Buyer daily summary {today}", body)
        return body
