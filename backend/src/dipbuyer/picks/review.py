"""Weekly engine review: compare predictions with outcomes and tune ``EngineParams``.

Pure: takes evaluated candidate records (the daily picks *and* the runners-up that were
scored but not picked) and the current parameters; returns new parameters and a report.

Tuning is deliberately conservative: each change needs a minimum amount of live evidence,
moves only part of the way toward what the evidence suggests, and is bounded.
"""

from __future__ import annotations

import datetime as dt
import itertools
import math
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any

import numpy as np

from dipbuyer.picks.engine import EngineParams, fit_logistic
from dipbuyer.picks.strategies import FAMILY_LABELS, Family

WINDOW_DAYS = 56  # 8 weeks of evidence for tuning
WEEK_DAYS = 7
MIN_FAMILY_FOR_SCALE = 20
MIN_FAMILY_FOR_SUSPEND = 30
MIN_FOR_CERTAINTY = 60
SCALE_STEP = 0.3  # move 30% of the way toward the implied multiplier each week
SCALE_BOUNDS = (0.0, 1.5)
CERTAINTY_STEP = 0.5
A_BOUNDS = (0.25, 2.5)
B_BOUNDS = (-2.0, 2.0)
SUSPEND_T = -2.0
CERTAINTY_BINS = (0.0, 0.4, 0.5, 0.6, 0.7, 1.01)


@dataclass(frozen=True)
class Outcome:
    session_date: dt.date
    family: str
    chosen: bool
    projected: float
    """Projected return used at the time (fractions; after the multiplier of that time)."""
    multiplier: float
    certainty: float
    raw_certainty: float
    realized: float
    """What following the plan returned (fraction)."""


def _stats(rows: Sequence[Outcome]) -> dict[str, Any]:
    if not rows:
        return {"n": 0}
    proj = np.array([r.projected for r in rows])
    real = np.array([r.realized for r in rows])
    cert = np.array([r.certainty for r in rows])
    win = (real > 0).astype(float)
    std = float(real.std(ddof=1)) if len(rows) > 1 else 0.0
    return {
        "n": len(rows),
        "projected_mean_pct": round(float(proj.mean()) * 100, 4),
        "realized_mean_pct": round(float(real.mean()) * 100, 4),
        "bias_pct": round(float((real - proj).mean()) * 100, 4),
        "mae_pct": round(float(np.abs(real - proj).mean()) * 100, 4),
        "direction_hit_rate": round(float((np.sign(proj) == np.sign(real)).mean()), 4),
        "win_rate": round(float(win.mean()), 4),
        "avg_certainty": round(float(cert.mean()), 4),
        "brier": round(float(((cert - win) ** 2).mean()), 5),
        "t_stat": round(float(real.mean() / (std / math.sqrt(len(rows)))), 2) if std > 0 else 0.0,
    }


def _bins(rows: Sequence[Outcome]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for lo, hi in itertools.pairwise(CERTAINTY_BINS):
        b = [r for r in rows if lo <= r.certainty < hi]
        out.append(
            {
                "range": f"{lo:.0%}-{min(hi, 1.0):.0%}",
                "n": len(b),
                "avg_certainty": round(sum(r.certainty for r in b) / len(b), 4) if b else None,
                "win_rate": round(sum(1 for r in b if r.realized > 0) / len(b), 4) if b else None,
            }
        )
    return out


def _clip(x: float, lo_hi: tuple[float, float]) -> float:
    return min(max(x, lo_hi[0]), lo_hi[1])


def _label(fam: str) -> str:
    try:
        return FAMILY_LABELS[Family(fam)]
    except ValueError:
        return fam


def review(
    outcomes: Sequence[Outcome], params: EngineParams, today: dt.date
) -> tuple[EngineParams, dict[str, Any]]:
    window = [o for o in outcomes if (today - o.session_date).days <= WINDOW_DAYS]
    week = [o for o in window if (today - o.session_date).days <= WEEK_DAYS]
    changes: list[dict[str, Any]] = []
    new = EngineParams(
        version=params.version,
        family_multiplier=dict(params.family_multiplier),
        suspended=list(params.suspended),
        certainty_a=params.certainty_a,
        certainty_b=params.certainty_b,
    )

    families: dict[str, dict[str, Any]] = {}
    for fam in sorted({o.family for o in window}):
        rows = [o for o in window if o.family == fam]
        st = _stats(rows)
        st["label"] = _label(fam)
        unscaled = np.array([o.projected / o.multiplier if o.multiplier else 0.0 for o in rows])
        real = np.array([o.realized for o in rows])
        old_m = params.multiplier(fam)
        if len(rows) >= MIN_FAMILY_FOR_SCALE and float(unscaled.mean()) > 1e-4:
            implied = _clip(float(real.mean()) / float(unscaled.mean()), (-0.5, 2.0))
            new_m = round(_clip(old_m + SCALE_STEP * (implied - old_m), SCALE_BOUNDS), 4)
            st["implied_multiplier"] = round(implied, 4)
            if abs(new_m - old_m) >= 0.01:
                new.family_multiplier[fam] = new_m
                changes.append(
                    {
                        "kind": "multiplier",
                        "family": fam,
                        "from": round(old_m, 4),
                        "to": new_m,
                        "reason": (
                            f"{_label(fam)}: projected {st['projected_mean_pct']:+.2f}% vs "
                            f"realized {st['realized_mean_pct']:+.2f}% over {len(rows)} "
                            "scored candidates; "
                            f"implied scale x{implied:.2f}, moved 30% of the way."
                        ),
                    }
                )
        t = float(st.get("t_stat", 0.0))
        if fam not in new.suspended and len(rows) >= MIN_FAMILY_FOR_SUSPEND and t <= SUSPEND_T:
            new.suspended.append(fam)
            changes.append(
                {
                    "kind": "suspend",
                    "family": fam,
                    "reason": (
                        f"{_label(fam)} lost {st['realized_mean_pct']:+.2f}% per trade over "
                        f"{len(rows)} live candidates (t = {t:.1f}); suspended from picks."
                    ),
                }
            )
        elif fam in new.suspended and len(rows) >= MIN_FAMILY_FOR_SUSPEND and t > -0.5:
            new.suspended.remove(fam)
            changes.append(
                {
                    "kind": "unsuspend",
                    "family": fam,
                    "reason": (
                        f"{_label(fam)} recovered to {st['realized_mean_pct']:+.2f}% per trade "
                        f"(t = {t:.1f}); allowed again."
                    ),
                }
            )
        families[fam] = st

    certainty_note: dict[str, Any] = {}
    if len(window) >= MIN_FOR_CERTAINTY:
        raw = np.clip(np.array([o.raw_certainty for o in window]), 1e-4, 1 - 1e-4)
        logit = np.log(raw / (1 - raw)).reshape(-1, 1)
        y = np.array([1.0 if o.realized > 0 else 0.0 for o in window])
        coef, intercept = fit_logistic(logit, y, lam=1.0)
        fit_a, fit_b = float(coef[0]), float(intercept)
        a = round(
            _clip(params.certainty_a + CERTAINTY_STEP * (fit_a - params.certainty_a), A_BOUNDS), 4
        )
        b = round(
            _clip(params.certainty_b + CERTAINTY_STEP * (fit_b - params.certainty_b), B_BOUNDS), 4
        )

        def brier(aa: float, bb: float) -> float:
            p = 1 / (1 + np.exp(-(aa * logit[:, 0] + bb)))
            return float(((p - y) ** 2).mean())

        certainty_note = {
            "fit_a": round(fit_a, 4),
            "fit_b": round(fit_b, 4),
            "brier_before": round(brier(params.certainty_a, params.certainty_b), 5),
            "brier_after": round(brier(a, b), 5),
        }
        if abs(a - params.certainty_a) >= 0.01 or abs(b - params.certainty_b) >= 0.01:
            new.certainty_a, new.certainty_b = a, b
            changes.append(
                {
                    "kind": "certainty",
                    "from": {"a": params.certainty_a, "b": params.certainty_b},
                    "to": {"a": a, "b": b},
                    "reason": (
                        f"Certainty said {_stats(window)['avg_certainty']:.0%} on average, "
                        f"actual win rate was {_stats(window)['win_rate']:.0%} over "
                        f"{len(window)} candidates; recalibrated (Brier "
                        f"{certainty_note['brier_before']:.4f} -> "
                        f"{certainty_note['brier_after']:.4f})."
                    ),
                }
            )
    if changes:
        new.version = params.version + 1
    report = {
        "reviewed_on": today.isoformat(),
        "window_days": WINDOW_DAYS,
        "version_before": params.version,
        "version_after": new.version,
        "week": {
            "all": _stats(week),
            "picks": _stats([o for o in week if o.chosen]),
        },
        "window": {
            "all": _stats(window),
            "picks": _stats([o for o in window if o.chosen]),
            "calibration": _bins(window),
        },
        "families": families,
        "certainty": certainty_note,
        "changes": changes,
        "params_before": params.to_json(),
        "params_after": new.to_json(),
        "summary": (
            f"{len(changes)} change(s) from {len(window)} scored candidates over the last "
            f"{WINDOW_DAYS} days ({len(week)} this week)."
            if changes
            else f"No changes: {len(window)} scored candidates over the last {WINDOW_DAYS} days "
            f"({len(week)} this week) did not justify any."
        ),
    }
    return new, report
