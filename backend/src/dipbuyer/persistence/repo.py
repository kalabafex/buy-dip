"""Repository functions: conversion between ORM rows and domain models, and queries."""

from __future__ import annotations

import datetime as dt
import uuid
from collections.abc import Sequence
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from dipbuyer.domain.enums import (
    OPEN_ORDER_STATUSES,
    SPEND_STATUSES,
    CycleState,
    OrderStatus,
    TradingMode,
    TrendFilter,
    TriggerType,
)
from dipbuyer.domain.models import (
    Bar,
    GlobalSettingsModel,
    OrderIntent,
    Rule,
    RuleParams,
    Tier,
)
from dipbuyer.persistence.models import (
    BarDailyRow,
    DipCycleRow,
    EvaluationRow,
    GlobalSettingsRow,
    OrderIntentRow,
    RuleRow,
    WorkerStatusRow,
)

# --- settings -------------------------------------------------------------------------


def get_settings_row(session: Session, *, for_update: bool = False) -> GlobalSettingsRow:
    stmt = select(GlobalSettingsRow).where(GlobalSettingsRow.id == 1)
    if for_update:
        stmt = stmt.with_for_update()
    row = session.scalars(stmt).one_or_none()
    if row is None:
        session.execute(insert(GlobalSettingsRow).values(id=1).on_conflict_do_nothing())
        session.flush()
        row = session.scalars(stmt).one()
    return row


def settings_model(row: GlobalSettingsRow) -> GlobalSettingsModel:
    return GlobalSettingsModel(
        trading_mode=TradingMode(row.trading_mode),
        kill_switch=row.kill_switch,
        max_daily_spend_usd=row.max_daily_spend_usd,
        max_weekly_spend_usd=row.max_weekly_spend_usd,
        evaluation_interval_minutes=row.evaluation_interval_minutes,
        open_exclusion_minutes=row.open_exclusion_minutes,
        close_exclusion_minutes=row.close_exclusion_minutes,
    )


def get_worker_status(session: Session) -> WorkerStatusRow:
    row = session.get(WorkerStatusRow, 1)
    if row is None:
        session.execute(insert(WorkerStatusRow).values(id=1).on_conflict_do_nothing())
        session.flush()
        row = session.get_one(WorkerStatusRow, 1)
    return row


# --- rules ----------------------------------------------------------------------------


def rule_from_row(row: RuleRow) -> Rule:
    return Rule(
        id=row.id,
        symbol=row.symbol,
        enabled=row.enabled,
        trigger_type=TriggerType(row.trigger_type),
        lookback_days=row.lookback_days,
        tiers=[
            Tier(drop_pct=Decimal(t["drop_pct"]), amount_usd=Decimal(t["amount_usd"]))
            for t in row.tiers
        ],
        rsi_threshold=row.rsi_threshold,
        ma_period=row.ma_period,
        trend_filter=TrendFilter(row.trend_filter),
        confirm_evals=row.confirm_evals,
        max_position_usd=row.max_position_usd,
        cooldown_days=row.cooldown_days,
        limit_offset_pct=row.limit_offset_pct,
        created_at=row.created_at,
        updated_at=row.updated_at,
        deleted_at=row.deleted_at,
    )


def apply_params(row: RuleRow, p: RuleParams) -> None:
    row.symbol = p.symbol
    row.enabled = p.enabled
    row.trigger_type = p.trigger_type.value
    row.lookback_days = p.lookback_days
    row.tiers = [{"drop_pct": str(t.drop_pct), "amount_usd": str(t.amount_usd)} for t in p.tiers]
    row.rsi_threshold = p.rsi_threshold
    row.ma_period = p.ma_period
    row.trend_filter = p.trend_filter.value
    row.confirm_evals = p.confirm_evals
    row.max_position_usd = p.max_position_usd
    row.cooldown_days = p.cooldown_days
    row.limit_offset_pct = p.limit_offset_pct


def list_rules(session: Session, *, enabled_only: bool = False) -> list[RuleRow]:
    stmt = (
        select(RuleRow)
        .where(RuleRow.deleted_at.is_(None))
        .order_by(RuleRow.symbol, RuleRow.created_at)
    )
    if enabled_only:
        stmt = stmt.where(RuleRow.enabled.is_(True))
    return list(session.scalars(stmt))


def get_rule_row(session: Session, rule_id: uuid.UUID) -> RuleRow | None:
    row = session.get(RuleRow, rule_id)
    if row is None or row.deleted_at is not None:
        return None
    return row


# --- cycles ---------------------------------------------------------------------------


def get_active_cycle(
    session: Session, rule_id: uuid.UUID, *, for_update: bool = False
) -> DipCycleRow | None:
    stmt = select(DipCycleRow).where(
        DipCycleRow.rule_id == rule_id, DipCycleRow.state == CycleState.ACTIVE.value
    )
    if for_update:
        stmt = stmt.with_for_update()
    return session.scalars(stmt).one_or_none()


def get_last_closed_cycle(session: Session, rule_id: uuid.UUID) -> DipCycleRow | None:
    stmt = (
        select(DipCycleRow)
        .where(DipCycleRow.rule_id == rule_id, DipCycleRow.state == CycleState.CLOSED.value)
        .order_by(DipCycleRow.ended_at.desc())
        .limit(1)
    )
    return session.scalars(stmt).one_or_none()


# --- intents --------------------------------------------------------------------------


def intent_from_row(row: OrderIntentRow) -> OrderIntent:
    return OrderIntent(
        id=row.id,
        rule_id=row.rule_id,
        cycle_id=row.cycle_id,
        symbol=row.symbol,
        tier_index=row.tier_index,
        mode=TradingMode(row.mode),
        notional_usd=row.notional_usd,
        qty=row.qty,
        limit_price=row.limit_price,
        status=OrderStatus(row.status),
        broker_order_id=row.broker_order_id,
        filled_qty=row.filled_qty,
        filled_avg_price=row.filled_avg_price,
        error=row.error,
        created_at=row.created_at,
        submitted_at=row.submitted_at,
        updated_at=row.updated_at,
    )


def _status_values(statuses: frozenset[OrderStatus]) -> list[str]:
    return [s.value for s in statuses]


def has_open_intent(session: Session, rule_id: uuid.UUID, mode: TradingMode) -> bool:
    stmt = select(func.count()).where(
        OrderIntentRow.rule_id == rule_id,
        OrderIntentRow.mode == mode.value,
        OrderIntentRow.status.in_(_status_values(OPEN_ORDER_STATUSES)),
    )
    return (session.scalar(stmt) or 0) > 0


def open_intents(session: Session) -> list[OrderIntentRow]:
    stmt = select(OrderIntentRow).where(
        OrderIntentRow.status.in_(_status_values(OPEN_ORDER_STATUSES))
    )
    return list(session.scalars(stmt))


def open_notional_for_symbol(session: Session, symbol: str, mode: TradingMode) -> Decimal:
    stmt = select(func.coalesce(func.sum(OrderIntentRow.notional_usd), 0)).where(
        OrderIntentRow.symbol == symbol,
        OrderIntentRow.mode == mode.value,
        OrderIntentRow.status.in_(_status_values(OPEN_ORDER_STATUSES)),
    )
    return Decimal(session.scalar(stmt) or 0)


def spend_between(
    session: Session, start: dt.datetime, end: dt.datetime, mode: TradingMode
) -> Decimal:
    """Sum of notional for SUBMITTED/PARTIALLY_FILLED/FILLED intents created in [start, end)."""
    stmt = select(func.coalesce(func.sum(OrderIntentRow.notional_usd), 0)).where(
        OrderIntentRow.mode == mode.value,
        OrderIntentRow.status.in_(_status_values(SPEND_STATUSES)),
        OrderIntentRow.created_at >= start,
        OrderIntentRow.created_at < end,
    )
    return Decimal(session.scalar(stmt) or 0)


# --- evaluations ----------------------------------------------------------------------


def session_condition_flags(
    session: Session, rule_id: uuid.UUID, session_date: dt.date, limit: int = 20
) -> list[bool]:
    """Prior ``condition_met`` flags for the rule in this NY session, oldest first."""
    stmt = (
        select(EvaluationRow.condition_met)
        .where(EvaluationRow.rule_id == rule_id, EvaluationRow.session_date == session_date)
        .order_by(EvaluationRow.ts.desc(), EvaluationRow.id.desc())
        .limit(limit)
    )
    return list(reversed(list(session.scalars(stmt))))


# --- bars -----------------------------------------------------------------------------


def bar_from_row(row: BarDailyRow) -> Bar:
    return Bar(
        symbol=row.symbol,
        session_date=row.session_date,
        open=row.open,
        high=row.high,
        low=row.low,
        close=row.close,
        volume=row.volume,
    )


def get_bars(session: Session, symbol: str, start: dt.date, end: dt.date) -> list[Bar]:
    stmt = (
        select(BarDailyRow)
        .where(
            BarDailyRow.symbol == symbol,
            BarDailyRow.session_date >= start,
            BarDailyRow.session_date <= end,
        )
        .order_by(BarDailyRow.session_date)
    )
    return [bar_from_row(r) for r in session.scalars(stmt)]


def bar_date_range(session: Session, symbol: str) -> tuple[dt.date | None, dt.date | None]:
    row = session.execute(
        select(func.min(BarDailyRow.session_date), func.max(BarDailyRow.session_date)).where(
            BarDailyRow.symbol == symbol
        )
    ).one()
    return row[0], row[1]


def upsert_bars(session: Session, bars: Sequence[Bar]) -> int:
    if not bars:
        return 0
    values = [
        {
            "symbol": b.symbol,
            "session_date": b.session_date,
            "open": b.open,
            "high": b.high,
            "low": b.low,
            "close": b.close,
            "volume": b.volume,
        }
        for b in bars
    ]
    stmt = insert(BarDailyRow).values(values)
    stmt = stmt.on_conflict_do_update(
        constraint="uq_bars_symbol_date",
        set_={k: stmt.excluded[k] for k in ("open", "high", "low", "close", "volume")},
    )
    session.execute(stmt)
    return len(values)
