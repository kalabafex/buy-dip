from __future__ import annotations

import datetime as dt
from collections.abc import Sequence
from decimal import Decimal

from dipbuyer.data.calendar import sessions_between
from dipbuyer.domain.models import Bar, IndicatorSnapshot, RuleParams, Tier

D = Decimal


def make_bars(symbol: str, closes: Sequence[Decimal | float | str], end: dt.date) -> list[Bar]:
    """Bars on consecutive NYSE sessions ending at ``end`` (open=high=low=close)."""
    days = sessions_between(end - dt.timedelta(days=len(closes) * 2 + 30), end)[-len(closes) :]
    assert len(days) == len(closes)
    out: list[Bar] = []
    for d, c in zip(days, closes, strict=True):
        p = D(str(c))
        out.append(
            Bar(symbol=symbol, session_date=d, open=p, high=p, low=p, close=p, volume=D(1000))
        )
    return out


def rule(**kw: object) -> RuleParams:
    base: dict[str, object] = {
        "symbol": "TEST",
        "enabled": True,
        "tiers": [
            Tier(drop_pct=D(5), amount_usd=D(100)),
            Tier(drop_pct=D(10), amount_usd=D(200)),
            Tier(drop_pct=D(20), amount_usd=D(300)),
        ],
        "max_position_usd": D(1000),
        "confirm_evals": 1,
        "trend_filter": "NONE",
    }
    base.update(kw)
    return RuleParams.model_validate(base)


def snap(last: Decimal | str, **kw: object) -> IndicatorSnapshot:
    base: dict[str, object] = {
        "last_price": D(str(last)),
        "prior_close": D(100),
        "latest_bar_date": dt.date(2025, 6, 9),
        "ref_high": D(100),
        "sma50": D(95),
        "sma200": D(90),
        "sma_rule": None,
        "rsi14": D(50),
        "pullback_pct": (D(100) - D(str(last))) / D(100) * 100,
    }
    base.update(kw)
    return IndicatorSnapshot.model_validate(base)
