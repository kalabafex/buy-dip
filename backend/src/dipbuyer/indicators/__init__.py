"""Pure indicator functions. No I/O.

All price inputs are ``Decimal``. ``high_n`` and ``sma`` are computed exactly in
``Decimal``; ``rsi_wilder`` is an oscillator (not money) and is computed with numpy
then returned as a ``Decimal`` rounded to 4 places.
"""

from __future__ import annotations

from collections.abc import Sequence
from decimal import Decimal

import numpy as np
import numpy.typing as npt

from dipbuyer.domain.models import Bar, IndicatorSnapshot
from dipbuyer.domain.money import HUNDRED

RSI_PLACES = Decimal("0.0001")
PCT_PLACES = Decimal("0.0001")

__all__ = [
    "compute",
    "high_n",
    "high_n_series",
    "pullback_pct",
    "rsi_wilder",
    "rsi_wilder_series",
    "sma",
    "sma_series",
]


def high_n(closes: Sequence[Decimal], n: int) -> Decimal | None:
    """Max of the last ``n`` completed session closes, or ``None`` if fewer than ``n``."""
    if n <= 0:
        raise ValueError("n must be positive")
    if len(closes) < n:
        return None
    return max(closes[-n:])


def sma(closes: Sequence[Decimal], n: int) -> Decimal | None:
    """Simple moving average of the last ``n`` closes, or ``None`` if fewer than ``n``."""
    if n <= 0:
        raise ValueError("n must be positive")
    if len(closes) < n:
        return None
    return sum(closes[-n:], Decimal(0)) / Decimal(n)


def pullback_pct(high: Decimal, last: Decimal) -> Decimal:
    """``(high - last) / high * 100``. Negative when ``last`` is above ``high``."""
    if high <= 0:
        raise ValueError("high must be positive")
    return (high - last) / high * HUNDRED


def _rsi_from_avgs(avg_gain: float, avg_loss: float) -> float:
    if avg_loss == 0.0:
        return 100.0 if avg_gain > 0.0 else 50.0
    rs = avg_gain / avg_loss
    return 100.0 - 100.0 / (1.0 + rs)


def _rsi_array(values: npt.NDArray[np.float64], period: int) -> npt.NDArray[np.float64]:
    """RSI for each index (NaN until ``period`` changes are available)."""
    out = np.full(values.shape[0], np.nan, dtype=np.float64)
    if values.shape[0] <= period:
        return out
    deltas = np.diff(values)
    gains = np.where(deltas > 0.0, deltas, 0.0)
    losses = np.where(deltas < 0.0, -deltas, 0.0)
    avg_gain = float(gains[:period].mean())
    avg_loss = float(losses[:period].mean())
    out[period] = _rsi_from_avgs(avg_gain, avg_loss)
    for i in range(period, deltas.shape[0]):
        avg_gain = (avg_gain * (period - 1) + float(gains[i])) / period
        avg_loss = (avg_loss * (period - 1) + float(losses[i])) / period
        out[i + 1] = _rsi_from_avgs(avg_gain, avg_loss)
    return out


def _to_array(closes: Sequence[Decimal]) -> npt.NDArray[np.float64]:
    return np.array([float(c) for c in closes], dtype=np.float64)


def _rsi_decimal(value: float) -> Decimal | None:
    if np.isnan(value):
        return None
    return Decimal(repr(value)).quantize(RSI_PLACES)


def rsi_wilder(closes: Sequence[Decimal], period: int = 14) -> Decimal | None:
    """Wilder's RSI of the final close. Needs at least ``period + 1`` closes."""
    if period <= 0:
        raise ValueError("period must be positive")
    if len(closes) <= period:
        return None
    return _rsi_decimal(float(_rsi_array(_to_array(closes), period)[-1]))


def rsi_wilder_series(closes: Sequence[Decimal], period: int = 14) -> list[Decimal | None]:
    return [_rsi_decimal(float(v)) for v in _rsi_array(_to_array(closes), period)]


def sma_series(closes: Sequence[Decimal], n: int) -> list[Decimal | None]:
    """SMA ending at each index, computed with an exact running sum."""
    out: list[Decimal | None] = []
    running = Decimal(0)
    for i, c in enumerate(closes):
        running += c
        if i >= n:
            running -= closes[i - n]
        out.append(running / Decimal(n) if i >= n - 1 else None)
    return out


def high_n_series(closes: Sequence[Decimal], n: int) -> list[Decimal | None]:
    """``high_n`` ending at each index (inclusive)."""
    return [max(closes[i - n + 1 : i + 1]) if i >= n - 1 else None for i in range(len(closes))]


def compute(
    bars: Sequence[Bar],
    last: Decimal,
    *,
    lookback_days: int,
    ma_period: int | None = None,
    rsi_period: int = 14,
) -> IndicatorSnapshot:
    """Compute the indicator snapshot for one evaluation.

    ``bars`` are completed daily bars (oldest first, excluding the current session).
    ``high_n`` and SMAs use completed closes only. RSI treats ``last`` as the provisional
    close of the current session so it moves intraday (see DECISIONS.md).
    """
    closes = [b.close for b in bars]
    ref_high = high_n(closes, lookback_days)
    return IndicatorSnapshot(
        last_price=last,
        prior_close=closes[-1] if closes else None,
        latest_bar_date=bars[-1].session_date if bars else None,
        ref_high=ref_high,
        sma50=sma(closes, 50),
        sma200=sma(closes, 200),
        sma_rule=sma(closes, ma_period) if ma_period is not None else None,
        rsi14=rsi_wilder([*closes, last], rsi_period),
        pullback_pct=(
            pullback_pct(ref_high, last).quantize(PCT_PLACES) if ref_high is not None else None
        ),
    )
