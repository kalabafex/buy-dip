from __future__ import annotations

import datetime as dt
from decimal import Decimal as D

import pytest

from dipbuyer.indicators import (
    compute,
    high_n,
    high_n_series,
    pullback_pct,
    rsi_wilder,
    rsi_wilder_series,
    sma,
    sma_series,
)
from tests.helpers import make_bars

CLOSES = [D(10), D(11), D(12), D(11), D(13)]


def test_high_n() -> None:
    assert high_n(CLOSES, 3) == D(13)
    assert high_n(CLOSES[:4], 3) == D(12)
    assert high_n(CLOSES, 5) == D(13)
    assert high_n(CLOSES, 6) is None
    with pytest.raises(ValueError, match="positive"):
        high_n(CLOSES, 0)


def test_sma_exact_decimal() -> None:
    assert sma(CLOSES, 3) == D(12)  # (12 + 11 + 13) / 3
    assert sma(CLOSES, 5) == D("11.4")  # 57 / 5
    assert sma(CLOSES, 6) is None


def test_series_match_scalars() -> None:
    assert sma_series(CLOSES, 3) == [None, None, D(11), sma(CLOSES[:4], 3), D(12)]
    assert high_n_series(CLOSES, 2) == [None, D(11), D(12), D(12), D(13)]


def test_pullback_pct() -> None:
    assert pullback_pct(D(100), D(95)) == D(5)
    assert pullback_pct(D(200), D(150)) == D(25)
    assert pullback_pct(D(100), D(110)) == D(-10)
    with pytest.raises(ValueError, match="positive"):
        pullback_pct(D(0), D(1))


def test_rsi_wilder_hand_computed_period_3() -> None:
    # deltas: +1 +1 -1 +1 +1 -1
    # seed: avg_gain = 2/3, avg_loss = 1/3 -> RS 2 -> 66.6667
    # +1: gain 7/9, loss 2/9 -> RS 3.5 -> 77.7778
    # +1: gain 23/27, loss 4/27 -> RS 5.75 -> 85.1852
    # -1: gain 46/81, loss 35/81 -> RS 46/35 -> 56.7901
    closes = [D(x) for x in (1, 2, 3, 2, 3, 4, 3)]
    series = rsi_wilder_series(closes, 3)
    assert series[:3] == [None, None, None]
    assert series[3:] == [D("66.6667"), D("77.7778"), D("85.1852"), D("56.7901")]
    assert rsi_wilder(closes, 3) == D("56.7901")
    assert rsi_wilder(closes[:3], 3) is None


def test_rsi_extremes() -> None:
    assert rsi_wilder([D(x) for x in range(1, 20)]) == D(100)
    assert rsi_wilder([D(5)] * 20) == D(50)
    assert rsi_wilder([D(x) for x in range(20, 1, -1)]) == D(0)


# Wilder's 14-period example as published by StockCharts. Their table rounds averages to
# 2 places at each step, so our unrounded values agree to within 0.1.
STOCKCHARTS_CLOSES = (
    "44.34 44.09 44.15 43.61 44.33 44.83 45.10 45.42 45.84 46.08 45.89 46.03 45.61 46.28 "
    "46.28 46.00 46.03 46.41 46.22 45.64 46.21 46.25 45.71 46.45 45.78 45.35 44.03 44.17"
).split()
STOCKCHARTS_RSI = [
    70.53,
    66.32,
    66.55,
    69.41,
    66.36,
    57.97,
    62.93,
    63.26,
    56.06,
    62.38,
    54.71,
    50.42,
    39.99,
    41.46,
]


def test_rsi_matches_published_reference() -> None:
    series = rsi_wilder_series([D(c) for c in STOCKCHARTS_CLOSES])
    got = [float(v) for v in series[14:] if v is not None]
    assert len(got) == len(STOCKCHARTS_RSI)
    for g, want in zip(got, STOCKCHARTS_RSI, strict=True):
        assert g == pytest.approx(want, abs=0.1)


def test_compute_uses_completed_bars_and_last() -> None:
    closes = [100 + (i % 7) for i in range(210)]
    bars = make_bars("X", closes, dt.date(2025, 6, 9))
    ind = compute(bars, D(95), lookback_days=20, ma_period=10)
    cl = [b.close for b in bars]
    assert ind.ref_high == max(cl[-20:])
    assert ind.sma50 == sum(cl[-50:]) / 50
    assert ind.sma200 == sum(cl[-200:]) / 200
    assert ind.sma_rule == sum(cl[-10:]) / 10
    assert ind.prior_close == cl[-1]
    assert ind.latest_bar_date == dt.date(2025, 6, 9)
    assert ind.rsi14 == rsi_wilder([*cl, D(95)])
    assert ind.pullback_pct == ((max(cl[-20:]) - D(95)) / max(cl[-20:]) * 100).quantize(D("0.0001"))


def test_compute_insufficient_history() -> None:
    bars = make_bars("X", [100, 101, 102], dt.date(2025, 6, 9))
    ind = compute(bars, D(100), lookback_days=20)
    assert ind.ref_high is None
    assert ind.pullback_pct is None
    assert ind.sma200 is None
    assert ind.rsi14 is None
