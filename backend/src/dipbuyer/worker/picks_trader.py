"""Daily picks: calibration runner and the intraday trader.

Timeline on each NYSE session (times from the exchange calendar, early closes respected):

* open - 40 min: prefetch completed daily bars for the universe (batch requests);
* open + 5 min (entry time): pick the day's 5 setups from today's opens and publish them;
  if auto-trade is on (PAPER mode only, kill switch off) submit one bracket order per
  tradeable pick: limit buy + take-profit limit + stop-loss stop, all DAY orders;
* every minute: reconcile fills;
* close - 5 min (exit time): cancel unfilled entries and remaining exit legs, sell what is
  left at market;
* close + 15 min: record what following the plan returned (from the day's OHLC) and the
  realized return of traded picks.

``client_order_id`` of the entry is the pick id; the forced exit uses ``<id>-exit``.
"""

from __future__ import annotations

import datetime as dt
import logging
import uuid
from collections.abc import Callable
from decimal import Decimal
from enum import StrEnum

from sqlalchemy import Engine, select
from sqlalchemy.orm import Session, sessionmaker

from dipbuyer.alerts import Notifier
from dipbuyer.broker import BrokerClient, BrokerError, BrokerRejectedError, BrokerTransientError
from dipbuyer.data.bars import BarService
from dipbuyer.data.calendar import ny_date, previous_session, session_for
from dipbuyer.data.market_data import MarketData
from dipbuyer.domain.constants import HISTORY_CALENDAR_DAYS
from dipbuyer.domain.enums import BacktestStatus, OrderStatus, TradingMode
from dipbuyer.domain.money import ZERO, floor_whole
from dipbuyer.persistence import repo
from dipbuyer.persistence.db import notify, session_scope
from dipbuyer.persistence.lock import try_advisory_lock
from dipbuyer.persistence.models import (
    DailyPickRow,
    EngineReviewRow,
    EngineVersionRow,
    PickCandidateRow,
    PickModelRow,
)
from dipbuyer.picks import calibrate as cal
from dipbuyer.picks.engine import EngineParams
from dipbuyer.picks.review import Outcome, review
from dipbuyer.picks.select import (
    CANDIDATES_KEPT,
    PICKS_PER_DAY,
    Opening,
    best_per_symbol,
    candidates_for_symbol,
    entry_exit_times,
)
from dipbuyer.picks.strategies import FAMILY_LABELS, Family, simulate_one
from dipbuyer.picks.universe import load_universe, members_by_symbol

log = logging.getLogger(__name__)

PICKS_LOCK_KEY = 0x0D1B_B0E6
CALIBRATION_YEARS = 5
RECALIBRATE_AFTER = dt.timedelta(days=7)
LATE_ENTRY = dt.timedelta(minutes=30)
"""No new entries later than this after the planned entry time."""
EVALUATE_AFTER_CLOSE = dt.timedelta(minutes=15)
PREFETCH_BEFORE_OPEN = dt.timedelta(minutes=40)
SUBMIT_ORPHAN_AFTER = dt.timedelta(minutes=2)


class PickStatus(StrEnum):
    PLANNED = "PLANNED"  # tradeable; waiting for submission (or auto-trade is off)
    WATCH = "WATCH"  # shown but not tradeable (see skip_reason)
    SUBMITTING = "SUBMITTING"  # intent committed, broker call in progress
    SUBMITTED = "SUBMITTED"
    ENTERED = "ENTERED"
    EXITING = "EXITING"
    EXITED = "EXITED"
    NOT_FILLED = "NOT_FILLED"
    NOT_TRADED = "NOT_TRADED"
    FAILED = "FAILED"


ACTIVE = {PickStatus.SUBMITTING, PickStatus.SUBMITTED, PickStatus.ENTERED, PickStatus.EXITING}


def latest_model(s: Session) -> PickModelRow | None:
    return s.scalars(
        select(PickModelRow)
        .where(PickModelRow.status == BacktestStatus.DONE.value)
        .order_by(PickModelRow.finished_at.desc())
        .limit(1)
    ).one_or_none()


def queue_calibration(s: Session) -> PickModelRow:
    pending = s.scalars(
        select(PickModelRow).where(
            PickModelRow.status.in_([BacktestStatus.QUEUED.value, BacktestStatus.RUNNING.value])
        )
    ).first()
    if pending is not None:
        return pending
    row = PickModelRow(id=uuid.uuid4(), status=BacktestStatus.QUEUED.value, progress=0, symbols=0)
    s.add(row)
    s.flush()
    return row


def active_engine(s: Session) -> EngineParams:
    row = s.scalars(
        select(EngineVersionRow).order_by(EngineVersionRow.version.desc()).limit(1)
    ).one_or_none()
    if row is None:
        return EngineParams()
    params = EngineParams.from_json(row.params)
    params.version = row.version
    return params


def run_engine_review(s: Session, today: dt.date) -> EngineReviewRow:
    """Compare predictions with outcomes and store the review (and a new version if changed)."""
    params = active_engine(s)
    since = today - dt.timedelta(days=90)
    rows = s.scalars(
        select(PickCandidateRow).where(
            PickCandidateRow.session_date >= since, PickCandidateRow.plan_return.is_not(None)
        )
    ).all()
    outcomes = [
        Outcome(
            session_date=r.session_date,
            family=r.family,
            chosen=r.chosen,
            projected=float(r.projected_return),
            multiplier=float(r.multiplier),
            certainty=float(r.certainty),
            raw_certainty=float(r.raw_certainty),
            realized=float(r.plan_return or 0),
        )
        for r in rows
    ]
    new, report = review(outcomes, params, today)
    rev = EngineReviewRow(
        id=uuid.uuid4(),
        reviewed_on=today,
        version_before=params.version,
        version_after=new.version,
        report=report,
    )
    s.add(rev)
    s.flush()
    if new.version != params.version:
        s.add(EngineVersionRow(version=new.version, params=new.to_json(), review_id=rev.id))
    notify(s, "picks", {"review": str(rev.id), "version": new.version})
    return rev


def last_completed_session(now: dt.datetime) -> dt.date:
    today = ny_date(now)
    sess = session_for(today)
    if sess is not None and now >= sess.close:
        return today
    return previous_session(today)


def _d(x: float) -> Decimal:
    return Decimal(repr(float(x))).quantize(Decimal("0.000001"))


class PicksTrader:
    def __init__(
        self,
        *,
        session_factory: sessionmaker[Session],
        db_engine: Engine,
        broker_factory: Callable[[TradingMode], BrokerClient],
        market_data_factory: Callable[[TradingMode], MarketData],
        bar_service_factory: Callable[[TradingMode], BarService],
        notifier: Notifier,
        now: Callable[[], dt.datetime] = lambda: dt.datetime.now(dt.UTC),
    ) -> None:
        self.sf = session_factory
        self.db_engine = db_engine
        self.broker_factory = broker_factory
        self.md_factory = market_data_factory
        self.bars_factory = bar_service_factory
        self.notifier = notifier
        self.now = now
        self._done: set[tuple[str, dt.date]] = set()

    # --- calibration ------------------------------------------------------------------
    def run_calibrations(self) -> int:
        """Run queued calibrations; queue one when the latest is a week old (off-hours)."""
        now = self.now()
        with session_scope(self.sf) as s:
            mode = repo.settings_model(repo.get_settings_row(s)).trading_mode
            model = latest_model(s)
            sess = session_for(ny_date(now))
            in_session = sess is not None and (
                sess.open - PREFETCH_BEFORE_OPEN <= now <= sess.close + EVALUATE_AFTER_CLOSE
            )
            if (model is None or now - (model.finished_at or now) > RECALIBRATE_AFTER) and (
                model is None or not in_session
            ):
                queue_calibration(s)
            row = s.scalars(
                select(PickModelRow)
                .where(PickModelRow.status == BacktestStatus.QUEUED.value)
                .order_by(PickModelRow.created_at)
                .with_for_update(skip_locked=True)
                .limit(1)
            ).one_or_none()
            if row is None:
                return 0
            row.status = BacktestStatus.RUNNING.value
            model_id = row.id
        try:
            self._calibrate(model_id, mode, now)
        except Exception as exc:
            log.exception("calibration failed")
            with session_scope(self.sf) as s:
                row = s.get_one(PickModelRow, model_id)
                row.status = BacktestStatus.FAILED.value
                row.error = str(exc)[:2000]
                row.finished_at = self.now()
                notify(s, "picks", {"model": str(model_id), "status": row.status})
            self.notifier.send("Picks calibration failed", str(exc)[:500], priority="high")
        return 1

    def _calibrate(self, model_id: uuid.UUID, mode: TradingMode, now: dt.datetime) -> None:
        symbols = [m.symbol for m in load_universe()]
        end = last_completed_session(now)
        start = end - dt.timedelta(days=365 * CALIBRATION_YEARS + 30)
        svc = self.bars_factory(mode)
        with session_scope(self.sf) as s:
            svc.ensure_cached_many(s, symbols, start, end)
        with session_scope(self.sf) as s:
            universe = repo.get_bars_many(s, symbols, start, end)

        def progress(done: int, total: int) -> None:
            with session_scope(self.sf) as s2:
                s2.get_one(PickModelRow, model_id).progress = int(done * 100 / total)
                notify(s2, "picks", {"model": str(model_id), "progress": int(done * 100 / total)})

        result = cal.calibrate(universe, progress=progress)
        with session_scope(self.sf) as s:
            row = s.get_one(PickModelRow, model_id)
            row.status = BacktestStatus.DONE.value
            row.progress = 100
            row.data_start, row.data_end = result.start, result.end
            row.symbols = result.symbols
            row.summary = result.summary_json()
            row.stock_stats = result.stock_stats
            row.finished_at = self.now()
            notify(s, "picks", {"model": str(model_id), "status": row.status})
        accepted = [k for k, v in result.families.items() if v.accepted]
        self.notifier.send(
            "Picks calibration done",
            f"{result.symbols} stocks, {result.start} to {result.end}. "
            f"Setups with a validated edge: {', '.join(accepted) or 'none'}.",
        )

    # --- weekly engine review ------------------------------------------------------------
    def run_weekly_review(self) -> bool:
        """On weekends (or Friday after the close), review once per week."""
        now = self.now()
        today = ny_date(now)
        sess = session_for(today)
        weekend = today.weekday() >= 5
        friday_after = (
            today.weekday() == 4 and sess is not None and now >= sess.close + EVALUATE_AFTER_CLOSE
        )
        if not (weekend or friday_after):
            return False
        with session_scope(self.sf) as s:
            last = s.scalars(
                select(EngineReviewRow).order_by(EngineReviewRow.reviewed_on.desc()).limit(1)
            ).one_or_none()
            if last is not None and (today - last.reviewed_on).days < 6:
                return False
            has_data = (
                s.scalar(
                    select(PickCandidateRow.id)
                    .where(PickCandidateRow.plan_return.is_not(None))
                    .limit(1)
                )
                is not None
            )
            if not has_data:
                return False
            rev = run_engine_review(s, today)
            report = rev.report
        lines = [report["summary"]] + [c["reason"] for c in report["changes"]]
        wk = report["week"]["all"]
        if wk.get("n"):
            lines.append(
                f"This week: projected {wk['projected_mean_pct']:+.2f}% vs realized "
                f"{wk['realized_mean_pct']:+.2f}% avg, certainty {wk['avg_certainty']:.0%} vs "
                f"{wk['win_rate']:.0%} winners ({wk['n']} candidates)."
            )
        self.notifier.send(f"Engine review v{report['version_after']}", "\n".join(lines))
        return True

    # --- daily cycle --------------------------------------------------------------------
    def tick(self) -> str:
        with try_advisory_lock(self.db_engine, PICKS_LOCK_KEY) as got:
            if not got:
                return "locked"
            return self._tick()

    def _once(self, key: str, day: dt.date) -> bool:
        k = (key, day)
        if k in self._done:
            return False
        self._done.add(k)
        return True

    def _tick(self) -> str:
        now = self.now()
        today = ny_date(now)
        sess = session_for(today)
        if sess is None:
            return "closed"
        entry_at, exit_at = entry_exit_times(sess.open, sess.close)
        with session_scope(self.sf) as s:
            settings_row = repo.get_settings_row(s)
            mode = repo.settings_model(settings_row).trading_mode
            model = latest_model(s)
            model_id = model.id if model is not None else None
            have_picks = (
                s.scalar(select(DailyPickRow.id).where(DailyPickRow.session_date == today).limit(1))
                is not None
            )
        if model_id is None:
            if self._once("no_model", today):
                log.info("no picks model yet: calibration has not finished")
            return "no_model"
        if sess.open - PREFETCH_BEFORE_OPEN <= now < exit_at and self._once("prefetch", today):
            self._prefetch(mode, today)
        if entry_at <= now < exit_at - LATE_ENTRY and not have_picks:
            self.generate(today, entry_at, exit_at, now)
        if entry_at <= now < exit_at:
            self.submit_planned(today, now, entry_at)
            self.reconcile(today)
        if exit_at <= now:
            self.flatten(today)
            self.reconcile(today)
        if now >= sess.close + EVALUATE_AFTER_CLOSE:
            self.evaluate(today)
        return "ran"

    def _prefetch(self, mode: TradingMode, today: dt.date) -> None:
        end = previous_session(today)
        start = end - dt.timedelta(days=HISTORY_CALENDAR_DAYS)
        with session_scope(self.sf) as s:
            self.bars_factory(mode).ensure_cached_many(
                s, [m.symbol for m in load_universe()], start, end
            )

    def generate(
        self, today: dt.date, entry_at: dt.datetime, exit_at: dt.datetime, now: dt.datetime
    ) -> int:
        """Rank today's setups and store the top picks."""
        members = members_by_symbol()
        symbols = list(members)
        with session_scope(self.sf) as s:
            srow = repo.get_settings_row(s)
            settings = repo.settings_model(srow)
            notional, min_expected = srow.picks_notional_usd, srow.picks_min_expected_pct
            model = latest_model(s)
            if model is None or model.summary is None:
                return 0
            families = model.summary["families"]
            stock_stats = model.stock_stats or {}
            model_id = model.id
            params = active_engine(s)
        mode = settings.trading_mode
        md = self.md_factory(mode)
        prev = previous_session(today)
        with session_scope(self.sf) as s:
            self.bars_factory(mode).ensure_cached_many(
                s, symbols, prev - dt.timedelta(days=HISTORY_CALENDAR_DAYS), prev
            )
            history = repo.get_bars_many(
                s, symbols, prev - dt.timedelta(days=HISTORY_CALENDAR_DAYS), prev
            )
        snaps = md.get_snapshots(symbols)
        cands = []
        for sym in symbols:
            snap, bars = snaps.get(sym), history.get(sym)
            if snap is None or not bars or snap.session_date != today:
                continue
            if bars[-1].session_date != prev:
                continue  # stale history
            cands.extend(
                candidates_for_symbol(
                    sym,
                    bars,
                    Opening(open=snap.open, last=snap.last),
                    families,
                    stock_stats,
                    params,
                )
            )
        scored = best_per_symbol(cands)[:CANDIDATES_KEPT]
        top = scored[:PICKS_PER_DAY]
        with session_scope(self.sf) as s:
            for i, c in enumerate(scored, start=1):
                s.add(
                    PickCandidateRow(
                        id=uuid.uuid4(),
                        session_date=today,
                        score_rank=i,
                        symbol=c.symbol,
                        family=c.family.value,
                        chosen=i <= PICKS_PER_DAY,
                        eligible=c.eligible,
                        engine_version=params.version,
                        open_price=c.open,
                        target_price=c.target,
                        stop_price=c.stop,
                        projected_return=_d(c.projected_return),
                        projected_low=_d(c.projected_low),
                        projected_high=_d(c.projected_high),
                        certainty=_d(c.certainty),
                        raw_certainty=_d(c.raw_certainty),
                        multiplier=_d(c.multiplier),
                        features=c.features,
                        reasons=c.reasons,
                        created_at=now,
                    )
                )
            for i, c in enumerate(top, start=1):
                qty = int(floor_whole(notional / c.entry_limit)) if c.entry_limit > 0 else 0
                skip = None
                if not c.accepted:
                    skip = "setup has no validated edge in calibration"
                elif c.suspended:
                    skip = "setup suspended by the weekly review after poor live results"
                elif Decimal(repr(c.projected_return * 100)) < min_expected:
                    skip = f"projected move below the {min_expected}% minimum"
                elif qty < 1:
                    skip = f"one share costs more than the ${notional} per-pick budget"
                m = members[c.symbol]
                s.add(
                    DailyPickRow(
                        id=uuid.uuid4(),
                        session_date=today,
                        rank=i,
                        model_id=model_id,
                        symbol=c.symbol,
                        name=m.name,
                        sector=m.sector,
                        family=c.family.value,
                        exit_key=c.exit.key,
                        accepted=c.accepted,
                        features=c.features,
                        open_price=c.open,
                        entry_limit=c.entry_limit,
                        target_price=c.target,
                        stop_price=c.stop,
                        entry_time=entry_at,
                        exit_time=exit_at,
                        expected_return=_d(c.projected_return),
                        win_rate=_d(c.certainty),
                        samples=c.samples,
                        family_mean=_d(c.family_mean),
                        projected_low=_d(c.projected_low),
                        projected_high=_d(c.projected_high),
                        certainty=_d(c.certainty),
                        raw_certainty=_d(c.raw_certainty),
                        base_return=_d(c.base_return),
                        model_adjustment=_d(c.model_adjustment),
                        multiplier=_d(c.multiplier),
                        engine_version=params.version,
                        reasons=c.reasons,
                        contributions=[
                            {
                                "feature": k.feature,
                                "value": k.value,
                                "impact_pct": round(k.impact * 100, 4),
                            }
                            for k in c.contributions
                        ],
                        status=(PickStatus.WATCH if skip else PickStatus.PLANNED).value,
                        skip_reason=skip,
                        qty=qty if not skip else None,
                        created_at=now,
                        updated_at=now,
                    )
                )
            notify(s, "picks", {"session_date": today.isoformat(), "count": len(top)})
        if top:
            lines = [
                f"{i}. {c.symbol} ({FAMILY_LABELS[c.family]}): buy <= {c.entry_limit}, "
                f"target {c.target or '-'}, stop {c.stop or '-'}, "
                f"projected {c.projected_return * 100:+.2f}%, certainty {c.certainty:.0%}"
                for i, c in enumerate(top, start=1)
            ]
            self.notifier.send(f"Daily picks {today}", "\n".join(lines))
        log.info("picks generated", extra={"count": len(top), "candidates": len(cands)})
        return len(top)

    # --- trading ------------------------------------------------------------------------
    def submit_planned(self, today: dt.date, now: dt.datetime, entry_at: dt.datetime) -> int:
        with session_scope(self.sf) as s:
            srow = repo.get_settings_row(s)
            settings = repo.settings_model(srow)
            autotrade = srow.picks_autotrade
            planned = list(
                s.scalars(
                    select(DailyPickRow).where(
                        DailyPickRow.session_date == today,
                        DailyPickRow.status == PickStatus.PLANNED.value,
                    )
                )
            )
        if not planned or not autotrade:
            return 0
        if settings.trading_mode is not TradingMode.PAPER:
            if self._once("live_block", today):
                log.warning("picks auto-trade only runs in PAPER mode; not trading")
            return 0
        if settings.kill_switch:
            return 0
        if now > entry_at + LATE_ENTRY:
            with session_scope(self.sf) as s:
                for p in planned:
                    row = s.get_one(DailyPickRow, p.id)
                    row.status, row.skip_reason = PickStatus.NOT_TRADED.value, "too late to enter"
            return 0
        broker = self.broker_factory(TradingMode.PAPER)
        n = 0
        for p in planned:
            with session_scope(self.sf) as s:
                row = s.get_one(DailyPickRow, p.id, with_for_update=True)
                if row.status != PickStatus.PLANNED.value or repo.get_settings_row(s).kill_switch:
                    continue
                row.status = PickStatus.SUBMITTING.value
                row.mode = TradingMode.PAPER.value
            self._submit_one(broker, p)
            n += 1
        return n

    def _submit_one(self, broker: BrokerClient, p: DailyPickRow) -> None:
        cid = str(p.id)
        limit = p.entry_limit
        tp = p.target_price if p.target_price is not None and p.target_price > limit else None
        sl = p.stop_price if p.stop_price is not None and p.stop_price < limit else None
        error = None
        bo = None
        for attempt in range(2):
            try:
                bo = broker.submit_bracket_buy(cid, p.symbol, int(p.qty or 0), limit, tp, sl)
                break
            except BrokerTransientError as exc:
                error = str(exc)
                if broker.get_bracket(cid) is not None:
                    error = None
                    break
                if attempt == 1:
                    break
            except (BrokerRejectedError, BrokerError) as exc:
                error = str(exc)
                break
        with session_scope(self.sf) as s:
            row = s.get_one(DailyPickRow, p.id)
            if error is None:
                row.status = PickStatus.SUBMITTED.value
                row.entry_order_id = bo.broker_order_id if bo else row.entry_order_id
            else:
                row.status, row.error = PickStatus.FAILED.value, error[:1000]
            notify(s, "picks", {"id": cid, "status": row.status})
        if error is None:
            self.notifier.send(
                f"Pick submitted {p.symbol}",
                f"buy {p.qty} <= {limit}, target {tp or '-'}, stop {sl or '-'}",
            )
        else:
            self.notifier.send(f"Pick order failed {p.symbol}", error, priority="high")

    def reconcile(self, today: dt.date) -> int:
        with session_scope(self.sf) as s:
            rows = list(
                s.scalars(
                    select(DailyPickRow).where(
                        DailyPickRow.session_date == today,
                        DailyPickRow.status.in_([x.value for x in ACTIVE]),
                    )
                )
            )
        if not rows:
            return 0
        broker = self.broker_factory(TradingMode.PAPER)
        changed = 0
        for p in rows:
            try:
                bs = broker.get_bracket(str(p.id))
                exit_order = (
                    broker.get_order_by_client_id(f"{p.id}-exit")
                    if p.status == PickStatus.EXITING.value
                    else None
                )
            except BrokerError as exc:
                log.warning("pick reconcile failed", extra={"pick": str(p.id), "error": str(exc)})
                continue
            with session_scope(self.sf) as s:
                row = s.get_one(DailyPickRow, p.id, with_for_update=True)
                before = row.status
                if bs is None:
                    if (
                        row.status == PickStatus.SUBMITTING.value
                        and self.now() - row.updated_at > SUBMIT_ORPHAN_AFTER
                    ):
                        row.status, row.error = PickStatus.FAILED.value, "never reached broker"
                else:
                    row.entry_order_id = bs.entry_broker_id
                    if bs.entry_filled_qty > 0:
                        row.entry_filled_qty = bs.entry_filled_qty
                        row.entry_fill_price = bs.entry_avg_price
                        if row.status in (PickStatus.SUBMITTING.value, PickStatus.SUBMITTED.value):
                            row.status = PickStatus.ENTERED.value
                        if bs.exit_reason and bs.exit_filled_qty >= bs.entry_filled_qty:
                            self._mark_exited(
                                row, bs.exit_avg_price, bs.exit_filled_qty, bs.exit_reason
                            )
                    elif bs.entry_status in (
                        OrderStatus.CANCELED,
                        OrderStatus.EXPIRED,
                        OrderStatus.REJECTED,
                    ):
                        row.status = PickStatus.NOT_FILLED.value
                    elif row.status == PickStatus.SUBMITTING.value:
                        row.status = PickStatus.SUBMITTED.value
                if exit_order is not None and exit_order.status is OrderStatus.FILLED:
                    self._mark_exited(
                        row, exit_order.filled_avg_price, exit_order.filled_qty, "TIME", extra=True
                    )
                if row.status != before:
                    changed += 1
                    notify(s, "picks", {"id": str(row.id), "status": row.status})
                    if row.status == PickStatus.EXITED.value:
                        self.notifier.send(
                            f"Pick closed {row.symbol} ({row.exit_reason})",
                            f"{(row.realized_return or ZERO) * 100:.2f}% "
                            f"(${row.realized_pnl_usd or ZERO:.2f})",
                        )
        return changed

    @staticmethod
    def _mark_exited(
        row: DailyPickRow,
        price: Decimal | None,
        qty: Decimal,
        reason: str,
        *,
        extra: bool = False,
    ) -> None:
        if price is None or row.entry_fill_price is None or row.entry_filled_qty is None:
            return
        if extra and row.exit_filled_qty and row.exit_fill_price:
            # A leg filled partially before the forced exit: blend the two exits.
            total = row.exit_filled_qty + qty
            price = (row.exit_fill_price * row.exit_filled_qty + price * qty) / total
            qty = total
        row.exit_filled_qty = qty
        row.exit_fill_price = price
        row.exit_reason = reason
        row.realized_return = (price / row.entry_fill_price - 1).quantize(Decimal("0.000001"))
        row.realized_pnl_usd = ((price - row.entry_fill_price) * qty).quantize(Decimal("0.01"))
        row.status = PickStatus.EXITED.value

    def flatten(self, today: dt.date) -> int:
        """At the exit time: cancel what is open and sell what is held."""
        with session_scope(self.sf) as s:
            rows = list(s.scalars(select(DailyPickRow).where(DailyPickRow.session_date == today)))
            for r in rows:
                if r.status == PickStatus.PLANNED.value:
                    r.status = PickStatus.NOT_TRADED.value
                    r.skip_reason = r.skip_reason or "auto-trade was off"
        active = [
            r for r in rows if r.status in (PickStatus.SUBMITTED.value, PickStatus.ENTERED.value)
        ]
        if not active:
            return 0
        broker = self.broker_factory(TradingMode.PAPER)
        n = 0
        for r in active:
            try:
                bs = broker.get_bracket(str(r.id))
                if bs is None:
                    continue
                for leg in bs.open_leg_ids:
                    broker.cancel_order(leg)
                if bs.entry_status in (OrderStatus.SUBMITTED, OrderStatus.PARTIALLY_FILLED):
                    broker.cancel_order(bs.entry_broker_id)
                remaining = bs.entry_filled_qty - bs.exit_filled_qty
                if remaining > 0:
                    order = broker.submit_market_sell(f"{r.id}-exit", r.symbol, remaining)
                    with session_scope(self.sf) as s:
                        row = s.get_one(DailyPickRow, r.id)
                        row.status = PickStatus.EXITING.value
                        row.exit_order_id = order.broker_order_id
                    n += 1
            except BrokerError as exc:
                # e.g. shares still held by a leg being canceled: retried next minute.
                log.warning("pick flatten failed", extra={"pick": str(r.id), "error": str(exc)})
        return n

    def evaluate(self, today: dt.date) -> int:
        """Fill in what following each plan returned, from the day's final OHLC."""
        with session_scope(self.sf) as s:
            rows = list(
                s.scalars(
                    select(DailyPickRow).where(
                        DailyPickRow.session_date == today, DailyPickRow.plan_return.is_(None)
                    )
                )
            )
            cand_rows = list(
                s.scalars(
                    select(PickCandidateRow).where(
                        PickCandidateRow.session_date == today,
                        PickCandidateRow.plan_return.is_(None),
                    )
                )
            )
            mode = repo.settings_model(repo.get_settings_row(s)).trading_mode
        if not rows and not cand_rows:
            return 0
        symbols = sorted({r.symbol for r in rows} | {c.symbol for c in cand_rows})
        bars = self.md_factory(mode).get_daily_bars_multi(symbols, today, today)
        with session_scope(self.sf) as s:
            for c in cand_rows:
                day = next((b for b in bars.get(c.symbol, []) if b.session_date == today), None)
                if day is None:
                    continue
                crow = s.get_one(PickCandidateRow, c.id)
                ret, reason, _ = simulate_one(
                    float(day.open),
                    float(day.high),
                    float(day.low),
                    float(day.close),
                    float(crow.target_price) if crow.target_price is not None else None,
                    float(crow.stop_price) if crow.stop_price is not None else None,
                )
                crow.plan_return, crow.plan_exit_reason = _d(ret), reason
        n = 0
        with session_scope(self.sf) as s:
            for r in rows:
                day = next((b for b in bars.get(r.symbol, []) if b.session_date == today), None)
                if day is None:
                    continue
                row = s.get_one(DailyPickRow, r.id)
                ret, reason, px = simulate_one(
                    float(day.open),
                    float(day.high),
                    float(day.low),
                    float(day.close),
                    float(row.target_price) if row.target_price is not None else None,
                    float(row.stop_price) if row.stop_price is not None else None,
                )
                row.day_open, row.day_high, row.day_low, row.day_close = (
                    day.open,
                    day.high,
                    day.low,
                    day.close,
                )
                row.plan_return, row.plan_exit_reason, row.plan_exit_price = _d(ret), reason, _d(px)
                n += 1
            notify(s, "picks", {"session_date": today.isoformat(), "evaluated": n})
        if n and self._once("eval_alert", today):
            with session_scope(self.sf) as s:
                done = list(
                    s.scalars(select(DailyPickRow).where(DailyPickRow.session_date == today))
                )
            plan = [float(r.plan_return) for r in done if r.plan_return is not None]
            real = [r for r in done if r.realized_pnl_usd is not None]
            msg = f"Plan average {sum(plan) / len(plan) * 100:.2f}% over {len(plan)} picks."
            if real:
                msg += f" Traded P/L ${sum(float(r.realized_pnl_usd or 0) for r in real):.2f}."
            self.notifier.send(f"Daily picks results {today}", msg)
        return n


def family_label(key: str) -> str:
    return FAMILY_LABELS.get(Family(key), key)
