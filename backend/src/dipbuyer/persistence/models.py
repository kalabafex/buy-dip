"""SQLAlchemy ORM models. Money columns are NUMERIC(18,6); timestamps are UTC."""

from __future__ import annotations

import datetime as dt
import uuid
from decimal import Decimal
from typing import Any

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

Money = Numeric(18, 6)


def utcnow() -> dt.datetime:
    return dt.datetime.now(dt.UTC)


class Base(DeclarativeBase):
    type_annotation_map = {  # noqa: RUF012
        Decimal: Money,
        dt.datetime: DateTime(timezone=True),
        uuid.UUID: UUID(as_uuid=True),
    }


class RuleRow(Base):
    __tablename__ = "rules"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    symbol: Mapped[str] = mapped_column(String(12), index=True)
    enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    trigger_type: Mapped[str] = mapped_column(String(32))
    lookback_days: Mapped[int] = mapped_column(Integer)
    tiers: Mapped[list[dict[str, str]]] = mapped_column(JSONB)
    rsi_threshold: Mapped[Decimal | None]
    ma_period: Mapped[int | None] = mapped_column(Integer)
    trend_filter: Mapped[str] = mapped_column(String(32))
    confirm_evals: Mapped[int] = mapped_column(Integer)
    max_position_usd: Mapped[Decimal]
    cooldown_days: Mapped[int] = mapped_column(Integer)
    limit_offset_pct: Mapped[Decimal]
    created_at: Mapped[dt.datetime] = mapped_column(default=utcnow)
    updated_at: Mapped[dt.datetime] = mapped_column(default=utcnow, onupdate=utcnow)
    deleted_at: Mapped[dt.datetime | None]


class GlobalSettingsRow(Base):
    __tablename__ = "global_settings"
    __table_args__ = (CheckConstraint("id = 1", name="single_row"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    trading_mode: Mapped[str] = mapped_column(String(8), default="PAPER")
    kill_switch: Mapped[bool] = mapped_column(Boolean, default=False)
    kill_switch_cancel_pending: Mapped[bool] = mapped_column(Boolean, default=False)
    max_daily_spend_usd: Mapped[Decimal] = mapped_column(default=Decimal(500))
    max_weekly_spend_usd: Mapped[Decimal] = mapped_column(default=Decimal(1500))
    evaluation_interval_minutes: Mapped[int] = mapped_column(Integer, default=5)
    open_exclusion_minutes: Mapped[int] = mapped_column(Integer, default=15)
    close_exclusion_minutes: Mapped[int] = mapped_column(Integer, default=10)
    updated_at: Mapped[dt.datetime] = mapped_column(default=utcnow, onupdate=utcnow)


class WorkerStatusRow(Base):
    __tablename__ = "worker_status"
    __table_args__ = (CheckConstraint("id = 1", name="worker_single_row"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    last_tick_at: Mapped[dt.datetime | None]
    last_heartbeat_at: Mapped[dt.datetime | None]
    last_summary_date: Mapped[dt.date | None] = mapped_column(Date)


class EvaluationRow(Base):
    __tablename__ = "evaluations"
    __table_args__ = (Index("ix_evaluations_rule_ts", "rule_id", "ts"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    rule_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("rules.id"))
    ts: Mapped[dt.datetime] = mapped_column(default=utcnow)
    session_date: Mapped[dt.date] = mapped_column(Date)
    last_price: Mapped[Decimal | None]
    ref_high: Mapped[Decimal | None]
    sma50: Mapped[Decimal | None]
    sma200: Mapped[Decimal | None]
    rsi14: Mapped[Decimal | None]
    pullback_pct: Mapped[Decimal | None]
    condition_met: Mapped[bool] = mapped_column(Boolean)
    consecutive_met: Mapped[int] = mapped_column(Integer)
    tier_hit: Mapped[int | None] = mapped_column(Integer)
    decision: Mapped[str] = mapped_column(String(32), index=True)
    reason: Mapped[str] = mapped_column(Text)


class DipCycleRow(Base):
    __tablename__ = "dip_cycles"
    __table_args__ = (
        Index(
            "uq_dip_cycles_one_active",
            "rule_id",
            unique=True,
            postgresql_where="state = 'ACTIVE'",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    rule_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("rules.id"), index=True)
    state: Mapped[str] = mapped_column(String(8))
    ref_high: Mapped[Decimal]
    tiers_filled: Mapped[list[int]] = mapped_column(ARRAY(Integer), default=list)
    started_at: Mapped[dt.datetime] = mapped_column(default=utcnow)
    last_fill_at: Mapped[dt.datetime | None]
    ended_at: Mapped[dt.datetime | None]
    end_reason: Mapped[str | None] = mapped_column(String(32))


class OrderIntentRow(Base):
    __tablename__ = "order_intents"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    rule_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("rules.id"), index=True)
    cycle_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("dip_cycles.id"))
    symbol: Mapped[str] = mapped_column(String(12), index=True)
    tier_index: Mapped[int] = mapped_column(Integer)
    mode: Mapped[str] = mapped_column(String(8))
    notional_usd: Mapped[Decimal]
    qty: Mapped[Decimal]
    limit_price: Mapped[Decimal]
    status: Mapped[str] = mapped_column(String(20), index=True)
    broker_order_id: Mapped[str | None] = mapped_column(String(64))
    filled_qty: Mapped[Decimal | None]
    filled_avg_price: Mapped[Decimal | None]
    error: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[dt.datetime] = mapped_column(default=utcnow, index=True)
    submitted_at: Mapped[dt.datetime | None]
    updated_at: Mapped[dt.datetime] = mapped_column(default=utcnow, onupdate=utcnow)


class AccountSnapshotRow(Base):
    __tablename__ = "account_snapshots"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    ts: Mapped[dt.datetime] = mapped_column(default=utcnow, index=True)
    mode: Mapped[str] = mapped_column(String(8))
    equity: Mapped[Decimal]
    cash: Mapped[Decimal]
    buying_power: Mapped[Decimal]


class PositionSnapshotRow(Base):
    __tablename__ = "position_snapshots"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    account_snapshot_id: Mapped[int] = mapped_column(
        ForeignKey("account_snapshots.id", ondelete="CASCADE"), index=True
    )
    ts: Mapped[dt.datetime] = mapped_column(default=utcnow)
    symbol: Mapped[str] = mapped_column(String(12))
    qty: Mapped[Decimal]
    avg_entry_price: Mapped[Decimal]
    market_value: Mapped[Decimal]
    unrealized_pl: Mapped[Decimal]


class BarDailyRow(Base):
    __tablename__ = "bars_daily"
    __table_args__ = (UniqueConstraint("symbol", "session_date", name="uq_bars_symbol_date"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    symbol: Mapped[str] = mapped_column(String(12))
    session_date: Mapped[dt.date] = mapped_column(Date)
    open: Mapped[Decimal]
    high: Mapped[Decimal]
    low: Mapped[Decimal]
    close: Mapped[Decimal]
    volume: Mapped[Decimal] = mapped_column(Numeric(20, 2))


class BacktestRow(Base):
    __tablename__ = "backtests"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    rule_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("rules.id"))
    rule_snapshot: Mapped[dict[str, Any]] = mapped_column(JSONB)
    start_date: Mapped[dt.date] = mapped_column(Date)
    end_date: Mapped[dt.date] = mapped_column(Date)
    starting_cash: Mapped[Decimal]
    status: Mapped[str] = mapped_column(String(16), index=True)
    results: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    error: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[dt.datetime] = mapped_column(default=utcnow)
    finished_at: Mapped[dt.datetime | None]


class AuditLogRow(Base):
    """Records kill-switch and mode changes made through the API."""

    __tablename__ = "audit_log"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    ts: Mapped[dt.datetime] = mapped_column(default=utcnow, server_default=func.now())
    action: Mapped[str] = mapped_column(String(64))
    detail: Mapped[dict[str, Any]] = mapped_column(JSONB)
