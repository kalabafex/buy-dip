from __future__ import annotations

import datetime as dt
import math
from decimal import Decimal as D

import pytest

from dipbuyer.domain.enums import TrendFilter
from dipbuyer.recommend import candidate_grid, recommend, rolling_windows
from tests.helpers import make_bars


def wavy_closes(n: int) -> list[str]:
    # Uptrend with regular ~12% dips: dip buying should beat DCA here.
    return [f"{100 * (1.0004**i) * (1 + 0.07 * math.sin(i / 25)):.2f}" for i in range(n)]


def test_rolling_windows() -> None:
    w = rolling_windows(dt.date(2015, 1, 2), dt.date(2025, 6, 30))
    assert w[0] == (dt.date(2016, 2, 1), dt.date(2019, 1, 31))
    assert all((e - s).days > 3 * 365 - 5 for s, e in w)
    assert w[-1][1] <= dt.date(2025, 6, 30)
    assert w[1][0] == dt.date(2016, 8, 1)


def test_grid_has_reference_default_rule() -> None:
    grid = candidate_grid()
    refs = [c for c in grid if c.is_reference]
    assert len(refs) == 1 and refs[0].trend_filter is TrendFilter.ABOVE_200DMA
    assert len({c.key for c in grid}) == len(grid)


def test_candidate_to_rule_scales_budget() -> None:
    c = next(c for c in candidate_grid() if c.key.startswith("pb20-4-8"))
    r = c.to_rule("SPY", D(750), D(3000))
    assert [t.amount_usd for t in r.tiers] == [D(50), D(100), D(150), D(200), D(250)]
    assert r.enabled is False and r.max_position_usd == D(3000)


def test_recommend_ranks_and_reports() -> None:
    bars = make_bars("SYN", wavy_closes(1900), dt.date(2025, 6, 9))
    grid = candidate_grid()
    subset = [c for c in grid if c.key in {"rsi35-5-10-20-c2-cd5", "pb20-3-6-10-cd5", "default"}]
    seen: list[int] = []
    res = recommend("SYN", bars, candidates=subset, progress=lambda d, t: seen.append(d))
    assert seen[-1] == 3
    assert res.reference is not None and res.reference.candidate.key == "default"
    assert len(res.ranked) == 2
    assert res.ranked[0].score >= res.ranked[1].score
    out = res.to_json(D(600), D(3000))
    top = out["recommendations"][0]
    assert top["params"]["symbol"] == "SYN"
    assert top["confidence"] in {"strong", "moderate", "weak"}
    assert top["full_period"]["profit_curve"]
    assert "hold" in top["full_period"] and "hold" in top["full_period"]["profit_curve"][0]
    assert "condition_met" in top["current"]
    assert out["windows"] == len(res.windows) >= 4


def test_recommend_needs_enough_history() -> None:
    bars = make_bars("SYN", wavy_closes(400), dt.date(2025, 6, 9))
    with pytest.raises(ValueError, match="years of history"):
        recommend("SYN", bars)


def test_recommend_parallel_matches_serial() -> None:
    bars = make_bars("SYN", wavy_closes(1900), dt.date(2025, 6, 9))
    subset = [c for c in candidate_grid() if c.key in {"rsi35-5-10-20-c2-cd5", "ma200-5-10-20-cd5"}]
    serial = recommend("SYN", bars, candidates=subset).to_json(D(600), D(3000))
    parallel = recommend("SYN", bars, candidates=subset, max_workers=2).to_json(D(600), D(3000))
    assert serial == parallel
