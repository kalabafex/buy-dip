from __future__ import annotations

import datetime as dt
from decimal import Decimal as D

import numpy as np
import pytest

from dipbuyer.picks.calibrate import Stats, calibrate
from dipbuyer.picks.select import Opening, candidates_for_symbol, entry_exit_times, rank
from dipbuyer.picks.strategies import (
    ENTRY_SLIP,
    EXIT_SLIP,
    ExitConfig,
    Family,
    compute_features,
    signal_mask,
    simulate,
    simulate_one,
)
from dipbuyer.picks.universe import load_universe, parse_csv
from tests.picks_helpers import gap_reversal_universe

END = dt.date(2025, 6, 9)


def arr(*xs: float) -> np.ndarray:
    return np.array(xs, dtype=np.float64)


def test_features_use_only_prior_days() -> None:
    c = arr(10, 11, 12, 11, 10, 9, 10)
    o = arr(10, 10.5, 11.5, 11.8, 10.8, 9.8, 8.0)
    f = compute_features(o, c + 0.5, c - 0.5, c)
    assert f.prev_close[1] == 10 and np.isnan(f.prev_close[0])
    assert f.gap[6] == pytest.approx(8.0 / 9 - 1)
    # closes 12 -> 11 -> 10 -> 9: three down closes ending at day 5, known at day 6
    assert f.down_streak[6] == 3
    assert f.down_streak[5] == 2


def test_gap_down_signal_and_trend_filter() -> None:
    n = 260
    c = np.linspace(50, 100, n)
    o = c.copy()
    o[-1] = c[-2] * 0.97  # gap down 3% today
    f = compute_features(o, c * 1.01, c * 0.99, c)
    m = signal_mask(f, Family.GAP_DOWN_REVERSAL)
    assert m[-1] and not m[-2]
    o2 = o.copy()
    o2[-1] = c[-2] * 0.90  # -10% gap is excluded (news crash)
    assert not signal_mask(compute_features(o2, c * 1.01, c * 0.99, c), Family.GAP_DOWN_REVERSAL)[
        -1
    ]


def test_simulate_stop_first_when_both_inside_range() -> None:
    f = compute_features(arr(100, 100), arr(101, 105), arr(99, 95), arr(100, 101))
    f.atr[1] = 2.0
    r, reasons = simulate(f, np.array([1]), ExitConfig(1.0, 1.0))
    entry = 100 * (1 + ENTRY_SLIP)
    assert reasons == ["STOP"]
    assert r[0] == pytest.approx((entry - 2) * (1 - EXIT_SLIP) / entry - 1)
    r, reasons = simulate(f, np.array([1]), ExitConfig(1.0, None))
    assert reasons == ["TARGET"] and r[0] == pytest.approx((entry + 2) / entry - 1)
    r, reasons = simulate(f, np.array([1]), ExitConfig(None, None))
    assert reasons == ["TIME"] and r[0] == pytest.approx(101 * (1 - EXIT_SLIP) / entry - 1)


def test_simulate_one() -> None:
    ret, reason, px = simulate_one(100, 103, 99.5, 101, target=102, stop=99)
    assert reason == "TARGET" and px == 102
    ret, reason, _ = simulate_one(100, 103, 98, 101, target=102, stop=99)
    assert reason == "STOP" and ret < 0
    ret, reason, _ = simulate_one(100, 101, 99.5, 100.5, target=None, stop=None)
    assert reason == "TIME"


def test_stats_t_stat() -> None:
    s = Stats.of([0.01, 0.02, -0.005, 0.015])
    assert s.n == 4 and s.win_rate == 0.75 and s.t_stat > 1
    assert Stats.of([]).n == 0


def test_calibration_accepts_a_real_edge_and_rejects_noise() -> None:
    uni = gap_reversal_universe([f"S{i}" for i in range(24)], END)
    cal = calibrate(uni)
    gap = cal.families[Family.GAP_DOWN_REVERSAL.value]
    assert gap.accepted
    assert gap.validation.mean > 0.01 and gap.validation.t_stat > 2
    assert cal.stock_stats["S0"][Family.GAP_DOWN_REVERSAL.value]["n"] > 5
    # gap-up momentum essentially never fires here: not enough trades to accept
    assert not cal.families[Family.GAP_UP_MOMENTUM.value].accepted


def test_calibration_rejects_random_walks() -> None:
    rng = np.random.default_rng(3)
    from dipbuyer.data.calendar import sessions_between
    from dipbuyer.domain.models import Bar

    days = sessions_between(END - dt.timedelta(days=1100), END)[-700:]
    uni = {}
    for k in range(40):
        p = 100.0
        bars = []
        for d in days:
            o = p * (1 + rng.normal(0, 0.006))
            c = o * (1 + rng.normal(0, 0.012))
            h, lo = (
                max(o, c) * (1 + abs(rng.normal(0, 0.004))),
                min(o, c) * (1 - abs(rng.normal(0, 0.004))),
            )
            bars.append(
                Bar(
                    symbol=f"R{k}",
                    session_date=d,
                    open=D(f"{o:.2f}"),
                    high=D(f"{h:.2f}"),
                    low=D(f"{lo:.2f}"),
                    close=D(f"{c:.2f}"),
                    volume=D(1),
                )
            )
            p = c
        uni[f"R{k}"] = bars
    cal = calibrate(uni)
    assert not any(f.accepted for f in cal.families.values())


def test_candidates_and_rank() -> None:
    uni = gap_reversal_universe([f"S{i}" for i in range(24)], END)
    cal = calibrate(uni)
    fams = cal.summary_json()["families"]
    cands = []
    for sym, bars in uni.items():
        o = (bars[-1].close * D("0.97")).quantize(D("0.01"))
        cands += candidates_for_symbol(sym, bars, Opening(open=o), fams, cal.stock_stats)
    gaps = [c for c in cands if c.family is Family.GAP_DOWN_REVERSAL]
    assert len(gaps) >= 20
    c = gaps[0]
    assert c.entry_limit == (c.open * D("1.003")).quantize(D("0.01"))
    if c.target is not None:
        assert c.target > c.entry_limit
    if c.stop is not None:
        assert c.stop < c.open
    assert 0 < c.win_rate <= 1
    top = rank(cands)
    assert len(top) == 5 and len({t.symbol for t in top}) == 5
    assert all(t.accepted for t in top)
    assert [t.expected_return for t in top] == sorted(
        (t.expected_return for t in top), reverse=True
    )


def test_entry_exit_times() -> None:
    o = dt.datetime(2025, 11, 28, 14, 30, tzinfo=dt.UTC)
    c = dt.datetime(2025, 11, 28, 18, 0, tzinfo=dt.UTC)
    assert entry_exit_times(o, c) == (o + dt.timedelta(minutes=5), c - dt.timedelta(minutes=5))


def test_universe() -> None:
    u = load_universe()
    assert len(u) > 490
    syms = {m.symbol for m in u}
    assert {"AAPL", "MSFT", "BRK.B"} <= syms
    assert parse_csv("Symbol,Security,GICS Sector\nabc,ABC Inc,Tech\n")[0].symbol == "ABC"
