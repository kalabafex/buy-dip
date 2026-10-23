"""The picks scoring engine. Pure: numpy only, no I/O.

Per setup family, two small models are fitted at calibration time on the training period
and kept only if they beat the plain average on the validation period:

* a ridge regression of the trade return on standardized features (``projected move``);
* an L2-regularized logistic regression of "the trade ended positive" (``certainty``).

Feature contributions (coefficient times standardized value) are kept so every prediction can
be explained. Weekly reviews tune ``EngineParams`` (per-family multipliers, suspensions and a
certainty calibration) from live outcomes; see ``review.py``.
"""

from __future__ import annotations

import math
from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Any

import numpy as np
import numpy.typing as npt

from dipbuyer.picks.strategies import Features

F = npt.NDArray[np.float64]

FEATURES: tuple[str, ...] = (
    "gap_pct",
    "atr_pct",
    "rsi2",
    "trend50_pct",
    "trend200_pct",
    "down_streak",
    "volume_ratio",
    "dist_high20_pct",
)

FEATURE_LABELS: dict[str, str] = {
    "gap_pct": "Opening gap",
    "atr_pct": "Daily volatility (ATR %)",
    "rsi2": "2-day RSI",
    "trend50_pct": "Distance from 50-day average",
    "trend200_pct": "Distance from 200-day average",
    "down_streak": "Down days in a row",
    "volume_ratio": "Yesterday's volume vs 20-day average",
    "dist_high20_pct": "Distance from 20-day high",
}

FEATURE_UNITS: dict[str, str] = {
    "gap_pct": "%",
    "atr_pct": "%",
    "rsi2": "",
    "trend50_pct": "%",
    "trend200_pct": "%",
    "down_streak": "",
    "volume_ratio": "×",
    "dist_high20_pct": "%",
}

RIDGE_LAMBDA_PER_ROW = 0.05
LOGIT_LAMBDA = 5.0
MIN_ROWS_FOR_MODEL = 200


def feature_matrix(f: Features, idx: npt.NDArray[np.int64]) -> F:
    pc = f.prev_close[idx]
    with np.errstate(divide="ignore", invalid="ignore"):
        cols = [
            f.gap[idx] * 100,
            f.atr[idx] / pc * 100,
            f.rsi2[idx],
            (pc / f.sma50[idx] - 1) * 100,
            (pc / f.sma200[idx] - 1) * 100,
            f.down_streak[idx],
            f.volume_ratio[idx],
            (pc / f.high20[idx] - 1) * 100,
        ]
    x = np.column_stack(cols).astype(np.float64)
    x[~np.isfinite(x)] = np.nan
    return x


def _standardize(x: F, mean: F, std: F) -> F:
    z = (x - mean) / std
    z[~np.isfinite(z)] = 0.0  # missing values sit at the training mean
    return np.clip(z, -4.0, 4.0)


def _sigmoid(x: F | float) -> F | float:
    return 1.0 / (1.0 + np.exp(-np.clip(x, -30, 30)))


def fit_ridge(z: F, y: F, lam: float) -> tuple[F, float]:
    ybar = float(y.mean())
    a = z.T @ z + lam * np.eye(z.shape[1])
    beta = np.linalg.solve(a, z.T @ (y - ybar))
    return beta, ybar


def fit_logistic(z: F, y01: F, lam: float, iters: int = 25) -> tuple[F, float]:
    """L2-regularized logistic regression by Newton's method (intercept unpenalized)."""
    n, k = z.shape
    x = np.column_stack([np.ones(n), z])
    w = np.zeros(k + 1)
    p0 = min(max(float(y01.mean()), 1e-3), 1 - 1e-3)
    w[0] = math.log(p0 / (1 - p0))
    reg = np.full(k + 1, lam)
    reg[0] = 0.0
    for _ in range(iters):
        p = np.asarray(_sigmoid(x @ w))
        g = x.T @ (p - y01) + reg * w
        h = (x * (p * (1 - p))[:, None]).T @ x + np.diag(reg) + 1e-9 * np.eye(k + 1)
        step = np.linalg.solve(h, g)
        w -= step
        if float(np.abs(step).max()) < 1e-8:
            break
    return w[1:], float(w[0])


@dataclass
class FamilyModel:
    mean: list[float]
    std: list[float]
    ret_coef: list[float]
    ret_intercept: float
    win_coef: list[float]
    win_intercept: float
    use_ret: bool
    use_win: bool
    q25: float
    q75: float
    train_mean: float
    metrics: dict[str, float] = field(default_factory=dict[str, float])

    def to_json(self) -> dict[str, Any]:
        r = lambda xs: [round(float(v), 8) for v in xs]  # noqa: E731
        return {
            "features": list(FEATURES),
            "mean": r(self.mean),
            "std": r(self.std),
            "ret_coef": r(self.ret_coef),
            "ret_intercept": round(self.ret_intercept, 8),
            "win_coef": r(self.win_coef),
            "win_intercept": round(self.win_intercept, 8),
            "use_ret": self.use_ret,
            "use_win": self.use_win,
            "q25": round(self.q25, 8),
            "q75": round(self.q75, 8),
            "train_mean": round(self.train_mean, 8),
            "metrics": {k: round(float(v), 6) for k, v in self.metrics.items()},
        }

    @staticmethod
    def from_json(j: Mapping[str, Any]) -> FamilyModel:
        return FamilyModel(
            mean=list(j["mean"]),
            std=list(j["std"]),
            ret_coef=list(j["ret_coef"]),
            ret_intercept=float(j["ret_intercept"]),
            win_coef=list(j["win_coef"]),
            win_intercept=float(j["win_intercept"]),
            use_ret=bool(j["use_ret"]),
            use_win=bool(j["use_win"]),
            q25=float(j["q25"]),
            q75=float(j["q75"]),
            train_mean=float(j["train_mean"]),
            metrics=dict(j.get("metrics", {})),
        )


def _corr(a: F, b: F) -> float:
    if a.size < 3 or float(a.std()) == 0 or float(b.std()) == 0:
        return 0.0
    return float(np.corrcoef(a, b)[0, 1])


def fit_family_model(x_tr: F, y_tr: F, x_va: F, y_va: F) -> FamilyModel | None:
    """Fit on training rows; keep each model only if it beats the average on validation."""
    if x_tr.shape[0] < MIN_ROWS_FOR_MODEL:
        return None
    mean = np.nanmean(x_tr, axis=0)
    std = np.nanstd(x_tr, axis=0)
    mean[~np.isfinite(mean)] = 0.0
    std[~np.isfinite(std) | (std == 0)] = 1.0
    z_tr = _standardize(x_tr, mean, std)
    beta, b0 = fit_ridge(z_tr, y_tr, RIDGE_LAMBDA_PER_ROW * z_tr.shape[0])
    y01 = (y_tr > 0).astype(np.float64)
    w, w0 = fit_logistic(z_tr, y01, LOGIT_LAMBDA)
    metrics: dict[str, float] = {
        "train_rows": float(x_tr.shape[0]),
        "val_rows": float(x_va.shape[0]),
    }
    use_ret = use_win = False
    if x_va.shape[0] >= 50:
        z_va = _standardize(x_va, mean, std)
        pred = b0 + z_va @ beta
        mse_model = float(np.mean((y_va - pred) ** 2))
        mse_base = float(np.mean((y_va - b0) ** 2))
        corr = _corr(pred, y_va)
        metrics |= {"val_corr": corr, "val_mse_gain": 1 - mse_model / mse_base if mse_base else 0}
        use_ret = corr > 0.02 and mse_model < mse_base
        p = np.asarray(_sigmoid(w0 + z_va @ w))
        yv = (y_va > 0).astype(np.float64)
        base_rate = float(y01.mean())
        brier = float(np.mean((p - yv) ** 2))
        brier_base = float(np.mean((base_rate - yv) ** 2))
        metrics |= {"val_brier": brier, "val_brier_base": brier_base}
        use_win = brier < brier_base
    return FamilyModel(
        mean=mean.tolist(),
        std=std.tolist(),
        ret_coef=beta.tolist(),
        ret_intercept=b0,
        win_coef=w.tolist(),
        win_intercept=w0,
        use_ret=use_ret,
        use_win=use_win,
        q25=float(np.quantile(y_tr, 0.25)),
        q75=float(np.quantile(y_tr, 0.75)),
        train_mean=float(y_tr.mean()),
        metrics=metrics,
    )


@dataclass(frozen=True)
class Contribution:
    feature: str
    value: float | None
    impact: float
    """Effect on the projected return (fraction) relative to the setup's average."""


def explain_return(model: FamilyModel, x: F) -> tuple[float, list[Contribution]]:
    """Deviation from the setup average predicted from features, and per-feature impacts."""
    mean, std = np.array(model.mean), np.array(model.std)
    z = _standardize(x.reshape(1, -1), mean, std)[0]
    coef = np.array(model.ret_coef)
    impacts = coef * z
    contribs = [
        Contribution(
            feature=name,
            value=None if not np.isfinite(x[i]) else float(x[i]),
            impact=float(impacts[i]),
        )
        for i, name in enumerate(FEATURES)
    ]
    return (float(impacts.sum()) if model.use_ret else 0.0), contribs


def model_win_probability(model: FamilyModel, x: F) -> float:
    z = _standardize(x.reshape(1, -1), np.array(model.mean), np.array(model.std))[0]
    return float(_sigmoid(model.win_intercept + float(z @ np.array(model.win_coef))))


# --- weekly-tuned parameters ---------------------------------------------------------------


@dataclass
class EngineParams:
    version: int = 1
    family_multiplier: dict[str, float] = field(default_factory=dict[str, float])
    suspended: list[str] = field(default_factory=list[str])
    certainty_a: float = 1.0
    certainty_b: float = 0.0

    def multiplier(self, family: str) -> float:
        return float(self.family_multiplier.get(family, 1.0))

    def calibrate_certainty(self, p: float) -> float:
        p = min(max(p, 1e-4), 1 - 1e-4)
        logit = math.log(p / (1 - p))
        return float(_sigmoid(self.certainty_a * logit + self.certainty_b))

    def to_json(self) -> dict[str, Any]:
        return {
            "version": self.version,
            "family_multiplier": {
                k: round(v, 4) for k, v in sorted(self.family_multiplier.items())
            },
            "suspended": sorted(self.suspended),
            "certainty_a": round(self.certainty_a, 4),
            "certainty_b": round(self.certainty_b, 4),
        }

    @staticmethod
    def from_json(j: Mapping[str, Any] | None) -> EngineParams:
        if not j:
            return EngineParams()
        return EngineParams(
            version=int(j.get("version", 1)),
            family_multiplier={k: float(v) for k, v in (j.get("family_multiplier") or {}).items()},
            suspended=list(j.get("suspended") or []),
            certainty_a=float(j.get("certainty_a", 1.0)),
            certainty_b=float(j.get("certainty_b", 0.0)),
        )
