"""Preset rules loaded by ``just seed-rules`` (always created disabled).

Chosen by a parameter sweep over S&P 500 index closes (1992-2022, rolling 3-year windows,
picked on 1992-2008 and checked on 2009-2022) and cross-checked on 20 large-cap stocks.
See docs/rule-research.md for the method, results and caveats.
"""

from __future__ import annotations

from decimal import Decimal

from dipbuyer.domain.enums import TrendFilter, TriggerType
from dipbuyer.domain.models import RuleParams, Tier

D = Decimal


def _tiers(*pairs: tuple[int, int]) -> list[Tier]:
    return [Tier(drop_pct=D(d), amount_usd=D(a)) for d, a in pairs]


PRESETS: list[RuleParams] = [
    # RSI(14) <= 35 for 2 consecutive evaluations; deeper tiers on pullback from the
    # 50-day high. Best and most consistent family in the sweep.
    RuleParams(
        symbol="SPY",
        trigger_type=TriggerType.RSI_OVERSOLD,
        rsi_threshold=D(35),
        lookback_days=50,
        tiers=_tiers((5, 100), (10, 200), (20, 300)),
        trend_filter=TrendFilter.NONE,
        confirm_evals=2,
        cooldown_days=5,
        max_position_usd=D(3000),
        limit_offset_pct=D("0.3"),
    ),
    # Same rule on the Nasdaq-100. The sweep had no Nasdaq-100 data; it held up on large-cap
    # tech stocks (AAPL, MSFT, AMD). Backtest it on real data before enabling.
    RuleParams(
        symbol="QQQ",
        trigger_type=TriggerType.RSI_OVERSOLD,
        rsi_threshold=D(35),
        lookback_days=50,
        tiers=_tiers((5, 100), (10, 200), (20, 300)),
        trend_filter=TrendFilter.NONE,
        confirm_evals=2,
        cooldown_days=5,
        max_position_usd=D(3000),
        limit_offset_pct=D("0.3"),
    ),
    # Five-step ladder on pullbacks from the 20-day high, with a 15-session cooldown.
    # Beat DCA in every 2009-2022 window; weaker in the 2000-2002 bear market.
    RuleParams(
        symbol="VOO",
        trigger_type=TriggerType.PULLBACK_FROM_HIGH,
        lookback_days=20,
        tiers=_tiers((4, 50), (8, 100), (12, 150), (16, 200), (20, 250)),
        trend_filter=TrendFilter.NONE,
        confirm_evals=2,
        cooldown_days=15,
        max_position_usd=D(3000),
        limit_offset_pct=D("0.3"),
    ),
]
