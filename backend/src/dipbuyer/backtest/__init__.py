"""Daily-bar backtester reusing ``indicators``, ``engine`` and ``risk`` unchanged.

Model (spec §13):

* one evaluation per session at the close (``last`` = that session's close, indicators
  from the prior completed sessions); ``confirm_evals`` therefore counts sessions;
* an order placed at the close fills at the next session's open if ``open <= limit``,
  otherwise it expires unfilled (day order) and the provisional tier mark is removed;
* caps, cooldowns and cycles are enforced exactly as in the live loop;
* baseline: the same total dollars the rule deployed, split into equal buys at the open
  of the first session of each month in the range;
* hold ("normal stock return"): the same total dollars bought at once at the first open.
"""

from __future__ import annotations

import datetime as dt
import uuid
from collections.abc import Sequence
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Any

from dipbuyer import engine, indicators, risk
from dipbuyer.broker.fake import FakeBroker
from dipbuyer.domain.constants import HISTORY_CALENDAR_DAYS
from dipbuyer.domain.enums import (
    SPEND_STATUSES,
    CycleAction,
    Decision,
    OrderStatus,
    TradingMode,
)
from dipbuyer.domain.models import (
    Bar,
    CycleView,
    GlobalSettingsModel,
    OrderIntent,
    RuleParams,
    Tier,
)
from dipbuyer.domain.money import CENT, QTY_STEP, ZERO, floor_qty

__all__ = ["BacktestResult", "Trade", "run_backtest"]

WARMUP_CALENDAR_DAYS = HISTORY_CALENDAR_DAYS + 10
_EPOCH = dt.datetime(2000, 1, 1, tzinfo=dt.UTC)


@dataclass
class Trade:
    session_date: dt.date
    placed_date: dt.date
    tier_index: int
    cycle_no: int
    notional: Decimal
    qty: Decimal
    limit_price: Decimal
    fill_price: Decimal | None
    status: OrderStatus

    def to_json(self) -> dict[str, Any]:
        return {
            "session_date": self.session_date.isoformat(),
            "placed_date": self.placed_date.isoformat(),
            "tier": self.tier_index + 1,
            "cycle": self.cycle_no,
            "notional": str(self.notional),
            "qty": str(self.qty),
            "limit_price": str(self.limit_price),
            "fill_price": str(self.fill_price) if self.fill_price is not None else None,
            "cost": str((self.qty * self.fill_price).quantize(CENT)) if self.fill_price else None,
            "status": self.status.value,
        }


@dataclass
class _Cycle:
    no: int
    id: uuid.UUID
    ref_high: Decimal
    tiers_filled: list[int]
    started_idx: int
    last_fill_idx: int | None = None


@dataclass
class _Intent:
    intent: OrderIntent
    placed_idx: int
    week: tuple[int, int]
    cycle: _Cycle | None


@dataclass
class Metrics:
    total_invested: Decimal
    final_value: Decimal
    final_equity: Decimal
    return_pct: Decimal
    max_drawdown_pct: Decimal
    num_buys: int
    avg_cost: Decimal | None

    def to_json(self) -> dict[str, Any]:
        return {
            "total_invested": str(self.total_invested.quantize(CENT)),
            "final_value": str(self.final_value.quantize(CENT)),
            "final_equity": str(self.final_equity.quantize(CENT)),
            "return_pct": str(self.return_pct.quantize(Decimal("0.01"))),
            "max_drawdown_pct": str(self.max_drawdown_pct.quantize(Decimal("0.01"))),
            "num_buys": self.num_buys,
            "avg_cost": str(self.avg_cost.quantize(Decimal("0.0001"))) if self.avg_cost else None,
        }


@dataclass
class BacktestResult:
    symbol: str
    start_date: dt.date
    end_date: dt.date
    starting_cash: Decimal
    rule: Metrics
    baseline: Metrics
    hold: Metrics
    """Buy and hold: the same dollars as the rule, all bought at the first session's open."""
    equity_curve: list[dict[str, str]] = field(default_factory=list[dict[str, str]])
    trades: list[Trade] = field(default_factory=list[Trade])
    decisions: dict[str, int] = field(default_factory=dict[str, int])

    def to_json(self) -> dict[str, Any]:
        return {
            "symbol": self.symbol,
            "start_date": self.start_date.isoformat(),
            "end_date": self.end_date.isoformat(),
            "starting_cash": str(self.starting_cash),
            "rule": self.rule.to_json(),
            "baseline": self.baseline.to_json(),
            "hold": self.hold.to_json(),
            "equity_curve": self.equity_curve,
            "trades": [t.to_json() for t in self.trades],
            "decisions": self.decisions,
        }


def _max_drawdown(values: Sequence[Decimal]) -> Decimal:
    peak = ZERO
    worst = ZERO
    for v in values:
        peak = max(peak, v)
        if peak > 0:
            worst = max(worst, (peak - v) / peak * 100)
    return worst


def _metrics(
    invested: Decimal, qty: Decimal, last_close: Decimal, equity: Sequence[Decimal], buys: int
) -> Metrics:
    final_value = qty * last_close
    return Metrics(
        total_invested=invested,
        final_value=final_value,
        final_equity=equity[-1] if equity else ZERO,
        return_pct=(final_value - invested) / invested * 100 if invested > 0 else ZERO,
        max_drawdown_pct=_max_drawdown(equity),
        num_buys=buys,
        avg_cost=invested / qty if qty > 0 else None,
    )


def _ts(idx: int) -> dt.datetime:
    """Synthetic, strictly increasing timestamp for session index ``idx``."""
    return _EPOCH + dt.timedelta(days=idx)


def run_backtest(
    rule: RuleParams,
    bars: Sequence[Bar],
    start: dt.date,
    end: dt.date,
    starting_cash: Decimal,
    settings: GlobalSettingsModel | None = None,
) -> BacktestResult:
    """Run ``rule`` over ``bars`` (oldest first, including warm-up history before ``start``)."""
    settings = settings or GlobalSettingsModel()
    bars = sorted(bars, key=lambda b: b.session_date)
    idxs = [i for i, b in enumerate(bars) if start <= b.session_date <= end]
    if not idxs:
        raise ValueError("no bars in the requested date range")
    broker = FakeBroker(cash=starting_cash)
    cycle: _Cycle | None = None
    prev_cycle_fill_idx: int | None = None
    open_intents: list[_Intent] = []
    spent: list[_Intent] = []  # intents in SPEND_STATUSES
    flags: list[bool] = []
    trades: list[Trade] = []
    decisions: dict[str, int] = {}
    equity: list[Decimal] = []
    curve_dates: list[dt.date] = []
    invested = ZERO
    held = ZERO
    buys = 0
    cycles_opened = 0

    lo = 0
    for i in idxs:
        bar = bars[i]
        # 1. Session open: fill or expire yesterday's orders.
        broker.process_session_open(rule.symbol, bar.open)
        for oi in open_intents:
            bo = broker.get_order_by_client_id(str(oi.intent.id))
            if bo is None:
                continue
            oi.intent.status = bo.status
            if bo.status is OrderStatus.FILLED and bo.filled_avg_price is not None:
                invested += bo.filled_qty * bo.filled_avg_price
                held += bo.filled_qty
                buys += 1
            else:
                spent.remove(oi)
                if oi.cycle is not None and oi.intent.tier_index in oi.cycle.tiers_filled:
                    oi.cycle.tiers_filled.remove(oi.intent.tier_index)
            trades.append(
                Trade(
                    session_date=bar.session_date,
                    placed_date=bars[oi.placed_idx].session_date,
                    tier_index=oi.intent.tier_index,
                    cycle_no=oi.cycle.no if oi.cycle else 0,
                    notional=oi.intent.notional_usd,
                    qty=bo.filled_qty if bo.status is OrderStatus.FILLED else oi.intent.qty,
                    limit_price=oi.intent.limit_price,
                    fill_price=bo.filled_avg_price,
                    status=bo.status,
                )
            )
        open_intents = []

        # 2. Session close: evaluate over the same history window the live loop uses.
        window_start = (
            bars[i - 1].session_date - dt.timedelta(days=HISTORY_CALENDAR_DAYS)
            if i
            else bar.session_date
        )
        while lo < i and bars[lo].session_date < window_start:
            lo += 1
        ind = indicators.compute(
            bars[lo:i], bar.close, lookback_days=rule.lookback_days, ma_period=rule.ma_period
        )
        view = (
            CycleView(
                id=cycle.id,
                ref_high=cycle.ref_high,
                tiers_filled=tuple(cycle.tiers_filled),
                sessions_since_last_fill=i - (cycle.last_fill_idx or cycle.started_idx),
            )
            if cycle is not None
            else None
        )
        result = engine.evaluate(rule, ind, view, flags)
        flags.append(result.condition_met)
        if result.cycle_action is CycleAction.CLOSE and cycle is not None:
            if cycle.last_fill_idx is not None:
                prev_cycle_fill_idx = cycle.last_fill_idx
            cycle = None

        week = bar.session_date.isocalendar()[:2]
        account = broker.get_account()
        rctx = risk.RiskContext(
            settings=settings,
            mode=TradingMode.PAPER,
            calendar_open=True,
            broker_clock_open=True,
            in_exclusion_window=False,
            expected_prev_session=bars[i - 1].session_date if i > 0 else bar.session_date,
            has_open_order=bool(open_intents),
            tiers_filled=tuple(cycle.tiers_filled) if cycle is not None else (),
            sessions_since_prev_cycle_fill=(
                i - prev_cycle_fill_idx if prev_cycle_fill_idx is not None else None
            ),
            spend_today=sum((x.intent.notional_usd for x in spent if x.placed_idx == i), ZERO),
            spend_week=sum((x.intent.notional_usd for x in spent if x.week == week), ZERO),
            position_value=invested,
            buying_power=account.buying_power,
            fractionable=True,
        )
        decision = risk.check(rule, result, rctx)
        decisions[decision.decision.value] = decisions.get(decision.decision.value, 0) + 1
        if decision.decision is Decision.ORDER:
            tier = result.tier_to_fill
            notional, limit_price, qty = result.notional, result.limit_price, decision.qty
            if tier is None or notional is None or limit_price is None or qty is None:
                raise RuntimeError("ORDER decision without sizing")
            if result.cycle_action is CycleAction.OPEN:
                if result.cycle_ref_high is None:
                    raise RuntimeError("OPEN without ref_high")
                cycles_opened += 1
                cycle = _Cycle(
                    no=cycles_opened,
                    id=uuid.uuid4(),
                    ref_high=result.cycle_ref_high,
                    tiers_filled=[],
                    started_idx=i,
                )
            intent = OrderIntent(
                id=uuid.uuid4(),
                rule_id=uuid.UUID(int=0),
                cycle_id=cycle.id if cycle else None,
                symbol=rule.symbol,
                tier_index=tier,
                mode=TradingMode.PAPER,
                notional_usd=notional,
                qty=qty,
                limit_price=limit_price,
                status=OrderStatus.SUBMITTED,
                created_at=_ts(i),
                updated_at=_ts(i),
            )
            broker.submit_limit_buy(intent)
            oi = _Intent(intent=intent, placed_idx=i, week=week, cycle=cycle)
            open_intents.append(oi)
            if intent.status in SPEND_STATUSES:
                spent.append(oi)
            if cycle is not None:
                cycle.tiers_filled.append(tier)
                cycle.last_fill_idx = i

        broker.marks[rule.symbol] = bar.close
        equity.append(broker.get_account().equity)
        curve_dates.append(bar.session_date)

    last_close = bars[idxs[-1]].close
    rule_metrics = _metrics(invested, held, last_close, equity, buys)

    # Baseline: equal monthly buys at the open of each month's first session.
    month_firsts: list[int] = []
    seen: set[tuple[int, int]] = set()
    for i in idxs:
        key = (bars[i].session_date.year, bars[i].session_date.month)
        if key not in seen:
            seen.add(key)
            month_firsts.append(i)
    per_buy = (invested / len(month_firsts)) if month_firsts else ZERO
    b_cash, b_qty, b_invested, b_buys = starting_cash, ZERO, ZERO, 0
    b_equity: list[Decimal] = []
    firsts = set(month_firsts)
    for i in idxs:
        if i in firsts and per_buy > 0:
            q = floor_qty(per_buy / bars[i].open)
            if q >= QTY_STEP:
                cost = q * bars[i].open
                b_cash -= cost
                b_qty += q
                b_invested += cost
                b_buys += 1
        b_equity.append(b_cash + b_qty * bars[i].close)
    baseline_metrics = _metrics(b_invested, b_qty, last_close, b_equity, b_buys)

    # Buy and hold: the rule's total dollars invested at once at the first open.
    first = bars[idxs[0]]
    h_qty = floor_qty(invested / first.open) if invested > 0 else ZERO
    h_cost = h_qty * first.open
    h_equity = [starting_cash - h_cost + h_qty * bars[i].close for i in idxs]
    hold_metrics = _metrics(h_cost, h_qty, last_close, h_equity, 1 if h_qty > 0 else 0)

    curve = [
        {
            "date": d.isoformat(),
            "rule": str(e.quantize(CENT)),
            "baseline": str(be.quantize(CENT)),
            "hold": str(he.quantize(CENT)),
        }
        for d, e, be, he in zip(curve_dates, equity, b_equity, h_equity, strict=True)
    ]
    return BacktestResult(
        symbol=rule.symbol,
        start_date=bars[idxs[0]].session_date,
        end_date=bars[idxs[-1]].session_date,
        starting_cash=starting_cash,
        rule=rule_metrics,
        baseline=baseline_metrics,
        hold=hold_metrics,
        equity_curve=curve,
        trades=trades,
        decisions=dict(sorted(decisions.items())),
    )


def default_rule(symbol: str) -> RuleParams:
    """Default rule parameters used by the CLI backtest."""
    return RuleParams(
        symbol=symbol,
        enabled=True,
        tiers=[
            Tier(drop_pct=Decimal(5), amount_usd=Decimal(100)),
            Tier(drop_pct=Decimal(10), amount_usd=Decimal(200)),
            Tier(drop_pct=Decimal(20), amount_usd=Decimal(300)),
        ],
        max_position_usd=Decimal(5000),
    )
