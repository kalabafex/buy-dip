"""Preset rules loaded by ``python -m dipbuyer.cli seed-rules`` (always created disabled).

See docs/rule-research.md for how these were chosen and their backtest results.
"""

from __future__ import annotations

from decimal import Decimal

from dipbuyer.domain.models import RuleParams, Tier

D = Decimal


def _tiers(*pairs: tuple[str, str]) -> list[Tier]:
    return [Tier(drop_pct=D(d), amount_usd=D(a)) for d, a in pairs]


PRESETS: list[RuleParams] = []
