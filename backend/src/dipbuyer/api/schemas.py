"""API request/response schemas."""

from __future__ import annotations

import datetime as dt
import uuid
from decimal import Decimal
from typing import Annotated, Any, Literal

from pydantic import BaseModel, Field

from dipbuyer.domain.enums import (
    BacktestStatus,
    Decision,
    OrderStatus,
    TradingMode,
)
from dipbuyer.domain.models import RuleParams


class LoginIn(BaseModel):
    username: str
    password: str
    totp: str


class ReauthIn(BaseModel):
    password: str
    totp: str


class MeOut(BaseModel):
    username: str
    elevated_until: dt.datetime | None


class HealthOut(BaseModel):
    status: Literal["ok", "degraded"]
    db: bool
    last_heartbeat_at: dt.datetime | None
    last_tick_at: dt.datetime | None


class LastEvaluation(BaseModel):
    ts: dt.datetime
    decision: Decision
    last_price: Decimal | None
    pullback_pct: Decimal | None


class RuleOut(RuleParams):
    id: uuid.UUID
    created_at: dt.datetime
    updated_at: dt.datetime
    last_evaluation: LastEvaluation | None = None
    next_tier: int | None = None
    next_tier_price: Decimal | None = None
    distance_to_next_tier_pct: Decimal | None = None
    active_cycle_ref_high: Decimal | None = None
    tiers_filled: list[int] = Field(default_factory=list)


class EnabledIn(BaseModel):
    enabled: bool


class TierPreview(BaseModel):
    index: int
    drop_pct: Decimal
    amount_usd: Decimal
    trigger_price: Decimal | None
    filled: bool


class PreviewOut(BaseModel):
    symbol: str
    last: Decimal
    latest_bar_date: dt.date | None
    high_n: Decimal | None
    ref_high: Decimal | None
    sma50: Decimal | None
    sma200: Decimal | None
    sma_rule: Decimal | None
    rsi14: Decimal | None
    pullback_pct: Decimal | None
    condition_met: bool
    trend_ok: bool
    tiers: list[TierPreview]


class ChartBar(BaseModel):
    time: dt.date
    open: Decimal
    high: Decimal
    low: Decimal
    close: Decimal


class ChartPoint(BaseModel):
    time: dt.date
    value: Decimal


class FillMarker(BaseModel):
    time: dt.date
    price: Decimal
    qty: Decimal
    tier: int


class ChartOut(BaseModel):
    symbol: str
    bars: list[ChartBar]
    high_n: list[ChartPoint]
    sma50: list[ChartPoint]
    sma200: list[ChartPoint]
    tier_prices: list[TierPreview]
    fills: list[FillMarker]


class SettingsOut(BaseModel):
    trading_mode: TradingMode
    kill_switch: bool
    max_daily_spend_usd: Decimal
    max_weekly_spend_usd: Decimal
    evaluation_interval_minutes: int
    open_exclusion_minutes: int
    close_exclusion_minutes: int
    spend_today: Decimal
    spend_week: Decimal
    live_keys_configured: bool


class SettingsIn(BaseModel):
    max_daily_spend_usd: Annotated[Decimal, Field(ge=0, le=1_000_000)]
    max_weekly_spend_usd: Annotated[Decimal, Field(ge=0, le=5_000_000)]
    evaluation_interval_minutes: Annotated[int, Field(ge=1, le=60)]
    open_exclusion_minutes: Annotated[int, Field(ge=0, le=120)]
    close_exclusion_minutes: Annotated[int, Field(ge=0, le=120)]


class KillSwitchIn(BaseModel):
    on: bool


class ModeIn(BaseModel):
    mode: TradingMode
    confirm: str = ""


class OrderOut(BaseModel):
    id: uuid.UUID
    rule_id: uuid.UUID
    cycle_id: uuid.UUID | None
    symbol: str
    tier_index: int
    mode: TradingMode
    notional_usd: Decimal
    qty: Decimal
    limit_price: Decimal
    status: OrderStatus
    broker_order_id: str | None
    filled_qty: Decimal | None
    filled_avg_price: Decimal | None
    error: str | None
    created_at: dt.datetime
    submitted_at: dt.datetime | None
    updated_at: dt.datetime


class EvaluationOut(BaseModel):
    id: int
    rule_id: uuid.UUID
    symbol: str
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


class OrderPage(BaseModel):
    items: list[OrderOut]
    total: int
    limit: int
    offset: int


class EvaluationPage(BaseModel):
    items: list[EvaluationOut]
    total: int
    limit: int
    offset: int


class AccountOut(BaseModel):
    ts: dt.datetime
    mode: TradingMode
    equity: Decimal
    cash: Decimal
    buying_power: Decimal


class PositionOut(BaseModel):
    symbol: str
    qty: Decimal
    avg_entry_price: Decimal
    market_value: Decimal
    unrealized_pl: Decimal
    ts: dt.datetime


class BacktestIn(BaseModel):
    rule_id: uuid.UUID | None = None
    params: RuleParams | None = None
    start_date: dt.date
    end_date: dt.date
    starting_cash: Annotated[Decimal, Field(gt=0, le=100_000_000)] = Decimal(10000)


class BacktestCreated(BaseModel):
    id: uuid.UUID


class BacktestOut(BaseModel):
    id: uuid.UUID
    rule_id: uuid.UUID | None
    rule_snapshot: dict[str, Any]
    start_date: dt.date
    end_date: dt.date
    starting_cash: Decimal
    status: BacktestStatus
    results: dict[str, Any] | None
    error: str | None
    created_at: dt.datetime
    finished_at: dt.datetime | None


# --- recommendations -----------------------------------------------------------------


class RecommendationIn(BaseModel):
    symbol: Annotated[str, Field(min_length=1, max_length=12)]
    years: Annotated[int, Field(ge=5, le=20)] = 10
    budget_per_dip_usd: Annotated[Decimal, Field(gt=0, le=100_000)] = Decimal(600)
    max_position_usd: Annotated[Decimal, Field(gt=0, le=10_000_000)] = Decimal(3000)


class RecommendationHalf(BaseModel):
    windows: int
    windows_with_buys: int
    win_rate: float
    median_edge_pct: float
    worst_edge_pct: float


class RecommendationMetrics(BaseModel):
    total_invested: Decimal
    final_value: Decimal
    final_equity: Decimal
    return_pct: Decimal
    max_drawdown_pct: Decimal
    num_buys: int
    avg_cost: Decimal | None


class ProfitPoint(BaseModel):
    date: dt.date
    rule: Decimal
    baseline: Decimal
    hold: Decimal | None = None
    """Buy and hold (same dollars bought at the start); absent in older results."""


class RecommendationFullPeriod(BaseModel):
    start: dt.date
    end: dt.date
    rule: RecommendationMetrics
    baseline: RecommendationMetrics
    hold: RecommendationMetrics | None = None
    """Buy and hold over the same period; absent in results computed before it existed."""
    profit_curve: list[ProfitPoint]


class RecommendationCurrent(BaseModel):
    as_of: dt.date | None = None
    last_close: Decimal | None = None
    condition_met: bool | None = None
    pullback_pct: Decimal | None = None
    rsi14: Decimal | None = None


class RecommendedParams(RuleParams):
    """Rule parameters of a recommendation (same fields as RuleParams)."""


class RecommendationItem(BaseModel):
    key: str
    label: str
    is_reference: bool
    confidence: Literal["strong", "moderate", "weak"]
    params: RecommendedParams
    selection: RecommendationHalf
    validation: RecommendationHalf
    median_cost_advantage_pct: float
    buys_per_year: float
    current: RecommendationCurrent
    full_period: RecommendationFullPeriod


class RecommendationHistory(BaseModel):
    first: dt.date
    last: dt.date


class RecommendationResults(BaseModel):
    symbol: str
    history: RecommendationHistory
    windows: int
    window_years: int
    split_date: dt.date | None
    candidates_tested: int
    recommendations: list[RecommendationItem]
    reference: RecommendationItem | None


class RecommendationOut(BaseModel):
    id: uuid.UUID
    symbol: str
    years: int
    budget_per_dip_usd: Decimal
    max_position_usd: Decimal
    status: BacktestStatus
    progress: int
    results: RecommendationResults | None
    error: str | None
    created_at: dt.datetime
    finished_at: dt.datetime | None


class RecommendationApplyIn(BaseModel):
    key: str
    enabled: bool = False


# --- daily picks ---------------------------------------------------------------------


class PickOut(BaseModel):
    id: uuid.UUID
    session_date: dt.date
    rank: int
    symbol: str
    name: str
    sector: str
    family: str
    family_label: str
    family_description: str
    exit_key: str
    accepted: bool
    features: dict[str, Any]
    open_price: Decimal
    entry_limit: Decimal
    target_price: Decimal | None
    stop_price: Decimal | None
    target_pct: Decimal | None
    """Target distance from the entry limit, in percent."""
    stop_pct: Decimal | None
    entry_time: dt.datetime
    exit_time: dt.datetime
    expected_return_pct: Decimal
    win_rate: Decimal
    samples: int
    family_mean_pct: Decimal
    qty: int | None
    notional_usd: Decimal | None
    expected_pnl_usd: Decimal | None
    status: str
    skip_reason: str | None
    mode: str | None
    entry_filled_qty: Decimal | None
    entry_fill_price: Decimal | None
    exit_filled_qty: Decimal | None
    exit_fill_price: Decimal | None
    exit_reason: str | None
    realized_return_pct: Decimal | None
    realized_pnl_usd: Decimal | None
    plan_return_pct: Decimal | None
    plan_exit_reason: str | None
    plan_exit_price: Decimal | None
    day_open: Decimal | None
    day_high: Decimal | None
    day_low: Decimal | None
    day_close: Decimal | None
    error: str | None


class PicksSettingsOut(BaseModel):
    autotrade: bool
    notional_usd: Decimal
    min_expected_pct: Decimal
    trading_mode: TradingMode


class PicksSettingsIn(BaseModel):
    autotrade: bool
    notional_usd: Annotated[Decimal, Field(gt=0, le=1_000_000)]
    min_expected_pct: Annotated[Decimal, Field(ge=-5, le=5)]


class PickFamilyStats(BaseModel):
    n: int
    mean: float
    win_rate: float
    avg_win: float
    avg_loss: float
    std: float
    t_stat: float


class PickFamilyOut(BaseModel):
    family: str
    label: str
    description: str
    exit_key: str
    target_atr: float | None
    stop_atr: float | None
    accepted: bool
    train: PickFamilyStats
    validation: PickFamilyStats


class PickModelOut(BaseModel):
    id: uuid.UUID
    status: BacktestStatus
    progress: int
    data_start: dt.date | None
    data_end: dt.date | None
    split_date: dt.date | None
    symbols: int
    families: list[PickFamilyOut]
    error: str | None
    created_at: dt.datetime
    finished_at: dt.datetime | None


class PicksDayOut(BaseModel):
    session_date: dt.date
    is_trading_day: bool
    entry_time: dt.datetime | None
    exit_time: dt.datetime | None
    generated: bool
    picks: list[PickOut]
    plan_return_avg_pct: Decimal | None
    realized_pnl_usd: Decimal | None
    settings: PicksSettingsOut
    model: PickModelOut | None
    """Latest finished calibration (null until the first one completes)."""
    calibration_in_progress: PickModelOut | None


class PicksDaySummary(BaseModel):
    session_date: dt.date
    picks: int
    traded: int
    expected_avg_pct: Decimal
    plan_return_avg_pct: Decimal | None
    plan_wins: int
    realized_pnl_usd: Decimal | None
    realized_wins: int


class PicksPerformancePoint(BaseModel):
    session_date: dt.date
    plan_cum_pct: Decimal
    """Cumulative sum of the day's average plan return (equal weight per pick)."""
    realized_cum_usd: Decimal


class PicksPerformanceOut(BaseModel):
    days: int
    picks: int
    plan_evaluated: int
    plan_win_rate: float | None
    plan_avg_pct: Decimal | None
    expected_avg_pct: Decimal | None
    traded: int
    realized_win_rate: float | None
    realized_pnl_usd: Decimal
    by_family: dict[str, dict[str, Any]]
    series: list[PicksPerformancePoint]
