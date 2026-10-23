from __future__ import annotations

import datetime as dt
from decimal import Decimal as D

import numpy as np
import pytest

from dipbuyer.picks.calibrate import calibrate
from dipbuyer.picks.engine import (
    EngineParams,
    FamilyModel,
    explain_return,
    fit_family_model,
    fit_logistic,
    fit_ridge,
)
from dipbuyer.picks.review import Outcome, review
from dipbuyer.picks.select import Opening, candidates_for_symbol, rank
from dipbuyer.picks.strategies import Family
from tests.picks_helpers import gap_reversal_universe

END = dt.date(2025, 6, 9)
TODAY = dt.date(2025, 6, 14)


def test_ridge_recovers_signal() -> None:
    rng = np.random.default_rng(0)
    z = rng.normal(size=(2000, 3))
    y = 0.01 + 0.004 * z[:, 0] - 0.002 * z[:, 2] + rng.normal(0, 0.001, 2000)
    beta, b0 = fit_ridge(z, y, lam=1.0)
    assert b0 == pytest.approx(0.01, abs=1e-3)
    assert beta[0] == pytest.approx(0.004, abs=3e-4)
    assert abs(beta[1]) < 3e-4


def test_logistic_learns_direction() -> None:
    rng = np.random.default_rng(1)
    z = rng.normal(size=(3000, 2))
    p = 1 / (1 + np.exp(-(0.3 + 1.5 * z[:, 0])))
    y = (rng.random(3000) < p).astype(float)
    w, w0 = fit_logistic(z, y, lam=1.0)
    assert w[0] == pytest.approx(1.5, abs=0.25) and abs(w[1]) < 0.2
    assert w0 == pytest.approx(0.3, abs=0.15)


def test_family_model_is_gated_on_validation() -> None:
    rng = np.random.default_rng(2)
    x = rng.normal(size=(1200, 8))
    y_signal = 0.002 * x[:, 0] + rng.normal(0, 0.002, 1200)
    y_noise = rng.normal(0, 0.01, 1200)
    good = fit_family_model(x[:800], y_signal[:800], x[800:], y_signal[800:])
    bad = fit_family_model(x[:800], y_noise[:800], x[800:], y_noise[800:])
    assert good is not None and good.use_ret
    assert bad is not None and not bad.use_ret
    assert fit_family_model(x[:50], y_noise[:50], x[:50], y_noise[:50]) is None
    dev, contribs = explain_return(good, x[0])
    assert dev == pytest.approx(sum(c.impact for c in contribs))
    assert FamilyModel.from_json(good.to_json()).use_ret


def test_engine_params_scale_and_suspend_candidates() -> None:
    uni = gap_reversal_universe([f"S{i}" for i in range(24)], END)
    cal = calibrate(uni)
    fams = cal.summary_json()["families"]
    sym, bars = "S0", uni["S0"]
    o = Opening(open=(bars[-1].close * D("0.97")).quantize(D("0.01")))
    base = next(
        c
        for c in candidates_for_symbol(sym, bars, o, fams, cal.stock_stats)
        if c.family is Family.GAP_DOWN_REVERSAL
    )
    p = EngineParams(
        version=3,
        family_multiplier={"GAP_DOWN_REVERSAL": 0.5},
        suspended=["GAP_DOWN_REVERSAL"],
        certainty_a=0.5,
        certainty_b=0.0,
    )
    tuned = next(
        c
        for c in candidates_for_symbol(sym, bars, o, fams, cal.stock_stats, p)
        if c.family is Family.GAP_DOWN_REVERSAL
    )
    assert tuned.projected_return == pytest.approx(base.projected_return * 0.5)
    assert tuned.suspended and not tuned.eligible
    assert abs(tuned.certainty - 0.5) < abs(base.certainty - 0.5)  # a < 1 shrinks toward 50%
    texts = " ".join(r["text"] for r in tuned.reasons)
    assert "x0.50" in texts and "suspended" in texts and "engine v3" in texts
    assert not rank([tuned]) or not rank([tuned])[0].eligible


def outcomes(
    fam: str,
    n: int,
    projected: float,
    realized: float,
    cert: float = 0.6,
    win_share: float | None = None,
) -> list[Outcome]:
    out = []
    rng = np.random.default_rng(n)
    for i in range(n):
        r = realized + rng.normal(0, abs(realized) * 0.5 + 1e-4)
        if win_share is not None:
            r = abs(r) if i < int(n * win_share) else -abs(r)
        out.append(
            Outcome(TODAY - dt.timedelta(days=i % 40), fam, i < 3, projected, 1.0, cert, cert, r)
        )
    return out


def test_review_scales_overconfident_family() -> None:
    rows = outcomes("GAP_DOWN_REVERSAL", 40, projected=0.004, realized=0.001)
    new, rep = review(rows, EngineParams(), TODAY)
    m = new.family_multiplier["GAP_DOWN_REVERSAL"]
    assert 0.7 < m < 1.0  # moved 30% of the way toward ~0.25
    assert new.version == 2
    assert rep["changes"][0]["kind"] == "multiplier"
    assert "projected +0.40%" in rep["changes"][0]["reason"]


def test_review_suspends_losing_family_and_needs_evidence() -> None:
    few = outcomes("BREAKOUT_20D", 10, projected=0.003, realized=-0.004)
    new, rep = review(few, EngineParams(), TODAY)
    assert new.suspended == [] and rep["changes"] == [] and new.version == 1
    many = outcomes("BREAKOUT_20D", 60, projected=0.003, realized=-0.004)
    new, rep = review(many, EngineParams(), TODAY)
    assert "BREAKOUT_20D" in new.suspended
    assert any(c["kind"] == "suspend" for c in rep["changes"])


def test_review_recalibrates_overconfident_certainty() -> None:
    rows = outcomes(
        "GAP_DOWN_REVERSAL", 120, projected=0.002, realized=0.002, cert=0.8, win_share=0.5
    )
    new, rep = review(rows, EngineParams(), TODAY)
    assert new.calibrate_certainty(0.8) < 0.8
    assert rep["certainty"]["brier_after"] < rep["certainty"]["brier_before"]
    assert rep["window"]["calibration"]
    assert rep["week"]["all"]["n"] > 0 and rep["week"]["picks"]["n"] > 0
