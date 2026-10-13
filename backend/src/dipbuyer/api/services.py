"""Read-side helpers shared by routers (preview, chart, rule summaries)."""

from __future__ import annotations

import datetime as dt
import uuid
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from dipbuyer import engine as rule_engine
from dipbuyer import indicators
from dipbuyer.api.schemas import (
    ChartBar,
    ChartOut,
    ChartPoint,
    FillMarker,
    LastEvaluation,
    PreviewOut,
    RuleOut,
    TierPreview,
)
from dipbuyer.data.bars import BarService
from dipbuyer.data.calendar import ny_date, previous_session
from dipbuyer.domain.enums import Decision, OrderStatus, TrendFilter
from dipbuyer.domain.models import RuleParams
from dipbuyer.domain.money import HUNDRED, round_to_cent
from dipbuyer.persistence import repo
from dipbuyer.persistence.models import DipCycleRow, EvaluationRow, OrderIntentRow, RuleRow


def tier_prices(params: RuleParams, ref: Decimal | None, filled: list[int]) -> list[TierPreview]:
    return [
        TierPreview(
            index=i,
            drop_pct=t.drop_pct,
            amount_usd=t.amount_usd,
            trigger_price=round_to_cent(ref * (1 - t.drop_pct / HUNDRED)) if ref else None,
            filled=i in filled,
        )
        for i, t in enumerate(params.tiers)
    ]


def rule_out(s: Session, row: RuleRow) -> RuleOut:
    rule = repo.rule_from_row(row)
    ev = s.scalars(
        select(EvaluationRow)
        .where(EvaluationRow.rule_id == row.id)
        .order_by(EvaluationRow.ts.desc(), EvaluationRow.id.desc())
        .limit(1)
    ).one_or_none()
    cycle = repo.get_active_cycle(s, row.id)
    filled = list(cycle.tiers_filled) if cycle else []
    ref = cycle.ref_high if cycle else (ev.ref_high if ev else None)
    floor = max(filled, default=-1)
    nxt = next((i for i in range(len(rule.tiers)) if i > floor), None)
    next_tier: int | None = None
    next_price: Decimal | None = None
    distance: Decimal | None = None
    if ref and nxt is not None:
        next_tier = nxt
        next_price = round_to_cent(ref * (1 - rule.tiers[nxt].drop_pct / HUNDRED))
        if ev and ev.last_price:
            distance = ((ev.last_price - next_price) / ev.last_price * HUNDRED).quantize(
                Decimal("0.01")
            )
    # RuleOut is frozen (it extends RuleParams), so every field is set at construction.
    return RuleOut(
        **rule.model_dump(exclude={"deleted_at"}),
        last_evaluation=(
            LastEvaluation(
                ts=ev.ts,
                decision=Decision(ev.decision),
                last_price=ev.last_price,
                pullback_pct=ev.pullback_pct,
            )
            if ev
            else None
        ),
        active_cycle_ref_high=cycle.ref_high if cycle else None,
        tiers_filled=filled,
        next_tier=next_tier,
        next_tier_price=next_price,
        distance_to_next_tier_pct=distance,
    )


def preview(
    s: Session,
    bar_service: BarService,
    params: RuleParams,
    rule_id: uuid.UUID | None,
    now: dt.datetime,
) -> PreviewOut:
    today = ny_date(now)
    bars, last = bar_service.load(s, params.symbol, today)
    ind = indicators.compute(
        bars, last, lookback_days=params.lookback_days, ma_period=params.ma_period
    )
    cycle = repo.get_active_cycle(s, rule_id) if rule_id else None
    filled = list(cycle.tiers_filled) if cycle else []
    ref = cycle.ref_high if cycle else ind.ref_high
    trend_ok = params.trend_filter is TrendFilter.NONE or (
        ind.sma200 is not None and ind.last_price > ind.sma200
    )
    return PreviewOut(
        symbol=params.symbol,
        last=last,
        latest_bar_date=ind.latest_bar_date,
        high_n=ind.ref_high,
        ref_high=ref,
        sma50=ind.sma50,
        sma200=ind.sma200,
        sma_rule=ind.sma_rule,
        rsi14=ind.rsi14,
        pullback_pct=ind.pullback_pct,
        condition_met=rule_engine.condition_met(params, ind),
        trend_ok=trend_ok,
        tiers=tier_prices(params, ref, filled),
    )


def chart(
    s: Session, bar_service: BarService, row: RuleRow, days: int, now: dt.datetime
) -> ChartOut:
    params = repo.rule_from_row(row)
    end = previous_session(ny_date(now))
    start = end - dt.timedelta(days=days + 420)
    bar_service.ensure_cached(s, params.symbol, start, end)
    bars = repo.get_bars(s, params.symbol, start, end)
    closes = [b.close for b in bars]
    hn = indicators.high_n_series(closes, params.lookback_days)
    s50 = indicators.sma_series(closes, 50)
    s200 = indicators.sma_series(closes, 200)
    cutoff = end - dt.timedelta(days=days)

    def series(vals: list[Decimal | None]) -> list[ChartPoint]:
        return [
            ChartPoint(time=b.session_date, value=round_to_cent(v))
            for b, v in zip(bars, vals, strict=True)
            if v is not None and b.session_date >= cutoff
        ]

    cycle = s.scalars(
        select(DipCycleRow).where(DipCycleRow.rule_id == row.id, DipCycleRow.state == "ACTIVE")
    ).one_or_none()
    ref = cycle.ref_high if cycle else (hn[-1] if hn else None)
    fills = s.scalars(
        select(OrderIntentRow)
        .where(
            OrderIntentRow.rule_id == row.id,
            OrderIntentRow.status.in_(
                [OrderStatus.FILLED.value, OrderStatus.PARTIALLY_FILLED.value]
            ),
        )
        .order_by(OrderIntentRow.created_at)
    )
    return ChartOut(
        symbol=params.symbol,
        bars=[
            ChartBar(time=b.session_date, open=b.open, high=b.high, low=b.low, close=b.close)
            for b in bars
            if b.session_date >= cutoff
        ],
        high_n=series(hn),
        sma50=series(s50),
        sma200=series(s200),
        tier_prices=tier_prices(params, ref, list(cycle.tiers_filled) if cycle else []),
        fills=[
            FillMarker(
                time=ny_date(f.submitted_at or f.created_at),
                price=f.filled_avg_price or f.limit_price,
                qty=f.filled_qty or f.qty,
                tier=f.tier_index,
            )
            for f in fills
        ],
    )
