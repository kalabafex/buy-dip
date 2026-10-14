"""Pydantic domain models shared by the pure core, persistence, API and worker."""

from __future__ import annotations

import datetime as dt
import itertools
import uuid
from decimal import Decimal
from typing import Annotated, Self

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from dipbuyer.domain.enums import (
    CycleEndReason,
    CycleState,
    Decision,
    OrderStatus,
    TradingMode,
    TrendFilter,
    TriggerType,
)


class Frozen(BaseModel):
    model_config = ConfigDict(frozen=True)


class Tier(Frozen):
    drop_pct: Annotated[Decimal, Field(ge=Decimal(1), le=Decimal(60))]
    amount_usd: Annotated[Decimal, Field(gt=Decimal(0))]


class RuleParams(Frozen):
    """User-editable rule parameters with the validation rules of spec §5."""

    symbol: Annotated[str, Field(min_length=1, max_length=12)]
    enabled: bool = False
    trigger_type: TriggerType = TriggerType.PULLBACK_FROM_HIGH
    lookback_days: Annotated[int, Field(ge=5, le=250)] = 20
    tiers: Annotated[list[Tier], Field(min_length=1, max_length=5)]
    rsi_threshold: Annotated[Decimal, Field(ge=Decimal(5), le=Decimal(50))] | None = None
    ma_period: Annotated[int, Field(ge=10, le=250)] | None = None
    trend_filter: TrendFilter = TrendFilter.ABOVE_200DMA
    confirm_evals: Annotated[int, Field(ge=1, le=10)] = 2
    max_position_usd: Annotated[Decimal, Field(gt=Decimal(0))]
    cooldown_days: Annotated[int, Field(ge=0, le=60)] = 5
    limit_offset_pct: Annotated[Decimal, Field(ge=Decimal(0), le=Decimal(2))] = Decimal("0.3")

    @field_validator("symbol")
    @classmethod
    def _upper_symbol(cls, v: str) -> str:
        v = v.strip().upper()
        if not v.replace(".", "").replace("-", "").isalnum():
            raise ValueError("symbol must be alphanumeric")
        return v

    @model_validator(mode="after")
    def _cross_field(self) -> Self:
        drops = [t.drop_pct for t in self.tiers]
        if any(b <= a for a, b in itertools.pairwise(drops)):
            raise ValueError("tier drop_pct must be strictly increasing")
        if self.trigger_type is TriggerType.RSI_OVERSOLD and self.rsi_threshold is None:
            raise ValueError("rsi_threshold is required for RSI_OVERSOLD")
        if self.trigger_type is TriggerType.BELOW_MA and self.ma_period is None:
            raise ValueError("ma_period is required for BELOW_MA")
        if self.max_position_usd < sum((t.amount_usd for t in self.tiers), Decimal(0)):
            raise ValueError("max_position_usd must be >= sum of tier amounts")
        return self


class Rule(RuleParams):
    id: uuid.UUID
    created_at: dt.datetime
    updated_at: dt.datetime
    deleted_at: dt.datetime | None = None


class GlobalSettingsModel(Frozen):
    trading_mode: TradingMode = TradingMode.PAPER
    kill_switch: bool = False
    max_daily_spend_usd: Annotated[Decimal, Field(ge=Decimal(0))] = Decimal(500)
    max_weekly_spend_usd: Annotated[Decimal, Field(ge=Decimal(0))] = Decimal(1500)
    evaluation_interval_minutes: Annotated[int, Field(ge=1, le=60)] = 5
    open_exclusion_minutes: Annotated[int, Field(ge=0, le=120)] = 15
    close_exclusion_minutes: Annotated[int, Field(ge=0, le=120)] = 10


class Bar(Frozen):
    symbol: str
    session_date: dt.date
    open: Decimal
    high: Decimal
    low: Decimal
    close: Decimal
    volume: Decimal


class DaySnapshot(Frozen):
    """Current-session market data for one symbol (from a market-data snapshot)."""

    symbol: str
    session_date: dt.date
    open: Decimal
    high: Decimal
    low: Decimal
    last: Decimal
    prev_close: Decimal | None = None


class IndicatorSnapshot(Frozen):
    """Indicator values for one evaluation. ``None`` means not enough history."""

    last_price: Decimal
    prior_close: Decimal | None
    latest_bar_date: dt.date | None
    ref_high: Decimal | None
    sma50: Decimal | None
    sma200: Decimal | None
    sma_rule: Decimal | None
    rsi14: Decimal | None
    pullback_pct: Decimal | None


class CycleView(Frozen):
    """The engine's view of an active dip cycle."""

    id: uuid.UUID
    ref_high: Decimal
    tiers_filled: tuple[int, ...]
    sessions_since_last_fill: int
    """Completed sessions since ``last_fill_at`` (or ``started_at`` if never filled)."""


class Clock(Frozen):
    timestamp: dt.datetime
    is_open: bool
    next_open: dt.datetime
    next_close: dt.datetime


class Account(Frozen):
    equity: Decimal
    cash: Decimal
    buying_power: Decimal


class Position(Frozen):
    symbol: str
    qty: Decimal
    avg_entry_price: Decimal
    market_value: Decimal
    unrealized_pl: Decimal


class AssetInfo(Frozen):
    symbol: str
    tradable: bool
    fractionable: bool


class BrokerOrder(Frozen):
    broker_order_id: str
    client_order_id: str
    status: OrderStatus
    filled_qty: Decimal
    filled_avg_price: Decimal | None


class BracketState(Frozen):
    """State of an entry order and its take-profit / stop-loss exit legs."""

    entry_broker_id: str
    entry_status: OrderStatus
    entry_filled_qty: Decimal
    entry_avg_price: Decimal | None
    exit_filled_qty: Decimal = Decimal(0)
    exit_avg_price: Decimal | None = None
    exit_reason: str | None = None
    """TARGET or STOP when an exit leg filled."""
    open_leg_ids: tuple[str, ...] = ()


class OrderIntent(BaseModel):
    id: uuid.UUID
    rule_id: uuid.UUID
    cycle_id: uuid.UUID | None
    symbol: str
    tier_index: int
    mode: TradingMode
    notional_usd: Decimal
    qty: Decimal
    limit_price: Decimal
    status: OrderStatus = OrderStatus.PENDING
    broker_order_id: str | None = None
    filled_qty: Decimal | None = None
    filled_avg_price: Decimal | None = None
    error: str | None = None
    created_at: dt.datetime
    submitted_at: dt.datetime | None = None
    updated_at: dt.datetime


class DipCycleModel(BaseModel):
    id: uuid.UUID
    rule_id: uuid.UUID
    state: CycleState
    ref_high: Decimal
    tiers_filled: list[int]
    started_at: dt.datetime
    last_fill_at: dt.datetime | None = None
    ended_at: dt.datetime | None = None
    end_reason: CycleEndReason | None = None


class EvaluationModel(BaseModel):
    rule_id: uuid.UUID
    ts: dt.datetime
    last_price: Decimal | None
    ref_high: Decimal | None
    sma50: Decimal | None
    sma200: Decimal | None
    rsi14: Decimal | None
    pullback_pct: Decimal | None
    condition_met: bool
    consecutive_met: int
    tier_hit: int | None
    decision: Decision
    reason: str
