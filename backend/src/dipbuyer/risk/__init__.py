"""Pure risk checks over a ``RiskContext``. No I/O.

Checks run in the order of spec §8; the first failure wins. A final sizing step turns
the notional into a quantity and skips with ``SKIP_QTY_ZERO`` when nothing can be bought.
"""

from __future__ import annotations

import datetime as dt
from decimal import Decimal

from dipbuyer.domain.enums import CycleAction, Decision, TradingMode, TrendFilter
from dipbuyer.domain.models import Frozen, GlobalSettingsModel, RuleParams
from dipbuyer.domain.money import QTY_STEP, ZERO, floor_qty, floor_whole
from dipbuyer.engine import EngineResult

__all__ = ["PRICE_SANITY_PCT", "RiskContext", "RiskDecision", "check", "size_order"]

PRICE_SANITY_PCT = Decimal(15)


class RiskContext(Frozen):
    settings: GlobalSettingsModel
    mode: TradingMode
    """The mode the runner is operating in (which broker keys it holds)."""
    calendar_open: bool
    broker_clock_open: bool
    in_exclusion_window: bool
    expected_prev_session: dt.date
    has_open_order: bool
    tiers_filled: tuple[int, ...]
    sessions_since_prev_cycle_fill: int | None
    """Sessions since the last fill of the most recent *closed* cycle, if any."""
    spend_today: Decimal
    spend_week: Decimal
    position_value: Decimal
    buying_power: Decimal
    fractionable: bool


class RiskDecision(Frozen):
    decision: Decision
    reason: str
    qty: Decimal | None = None

    @property
    def place_order(self) -> bool:
        return self.decision is Decision.ORDER


def size_order(notional: Decimal, limit_price: Decimal, fractionable: bool) -> Decimal:
    """``floor(notional / limit_price)`` to 6 decimals, or whole shares if not fractionable."""
    if limit_price <= 0:
        return ZERO
    raw = notional / limit_price
    return floor_qty(raw) if fractionable else floor_whole(raw)


def _skip(decision: Decision, reason: str) -> RiskDecision:
    return RiskDecision(decision=decision, reason=reason)


def check(rule: RuleParams, engine_result: EngineResult, ctx: RiskContext) -> RiskDecision:
    tier = engine_result.tier_to_fill
    notional = engine_result.notional
    limit_price = engine_result.limit_price
    if tier is None or notional is None or limit_price is None:
        return _skip(Decision.NO_TRIGGER, engine_result.reason)
    ind = engine_result.indicators
    s = ctx.settings

    # 1. kill switch
    if s.kill_switch:
        return _skip(Decision.SKIP_KILL_SWITCH, "kill switch is on")
    # 2. market hours
    if not (ctx.calendar_open and ctx.broker_clock_open):
        return _skip(Decision.SKIP_MARKET_CLOSED, "market closed")
    if ctx.in_exclusion_window:
        return _skip(Decision.SKIP_EXCLUSION_WINDOW, "inside open/close exclusion window")
    # 3. data freshness and price sanity
    if ind.latest_bar_date != ctx.expected_prev_session:
        return _skip(
            Decision.SKIP_STALE_DATA,
            f"latest bar {ind.latest_bar_date} != previous session {ctx.expected_prev_session}",
        )
    prior = ind.prior_close
    if prior is None or prior <= 0:
        return _skip(Decision.SKIP_STALE_DATA, "no prior close")
    move = abs(ind.last_price - prior) / prior * 100
    if move > PRICE_SANITY_PCT:
        return _skip(
            Decision.SKIP_PRICE_SANITY, f"last {ind.last_price} moved {move:.2f}% from {prior}"
        )
    # 4. trend filter
    if rule.trend_filter is TrendFilter.ABOVE_200DMA and (
        ind.sma200 is None or ind.last_price <= ind.sma200
    ):
        return _skip(
            Decision.SKIP_TREND_FILTER, f"last {ind.last_price} not above SMA200 {ind.sma200}"
        )
    # 5. open order
    if ctx.has_open_order:
        return _skip(Decision.SKIP_OPEN_ORDER, "rule has an open order")
    # 6. tier already filled
    if tier in ctx.tiers_filled:
        return _skip(Decision.SKIP_TIER_FILLED, f"tier {tier + 1} already filled")
    # 7. cooldown (new cycles only)
    if (
        engine_result.cycle_action is CycleAction.OPEN
        and ctx.sessions_since_prev_cycle_fill is not None
        and ctx.sessions_since_prev_cycle_fill < rule.cooldown_days
    ):
        return _skip(
            Decision.SKIP_COOLDOWN,
            f"{ctx.sessions_since_prev_cycle_fill} sessions since last fill < {rule.cooldown_days}",
        )
    # 8-9. spend caps
    if ctx.spend_today + notional > s.max_daily_spend_usd:
        return _skip(
            Decision.SKIP_DAILY_CAP,
            f"spend today {ctx.spend_today} + {notional} > {s.max_daily_spend_usd}",
        )
    if ctx.spend_week + notional > s.max_weekly_spend_usd:
        return _skip(
            Decision.SKIP_WEEKLY_CAP,
            f"spend week {ctx.spend_week} + {notional} > {s.max_weekly_spend_usd}",
        )
    # 10. position cap
    if ctx.position_value + notional > rule.max_position_usd:
        return _skip(
            Decision.SKIP_POSITION_CAP,
            f"position {ctx.position_value} + {notional} > {rule.max_position_usd}",
        )
    # 11. buying power
    if ctx.buying_power < notional:
        return _skip(Decision.SKIP_BUYING_POWER, f"buying power {ctx.buying_power} < {notional}")
    # 12. mode
    if ctx.mode is not s.trading_mode:
        return _skip(Decision.SKIP_MODE_MISMATCH, f"runner {ctx.mode} != settings {s.trading_mode}")
    # sizing
    qty = size_order(notional, limit_price, ctx.fractionable)
    if qty < (QTY_STEP if ctx.fractionable else Decimal(1)):
        return _skip(Decision.SKIP_QTY_ZERO, f"qty rounds to zero at {limit_price}")
    return RiskDecision(
        decision=Decision.ORDER,
        reason=f"buy tier {tier + 1}: {qty} @ {limit_price} (${notional})",
        qty=qty,
    )
