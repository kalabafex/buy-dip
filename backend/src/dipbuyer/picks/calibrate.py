"""Calibrate the intraday setups on a universe of daily bars. Pure: no I/O.

For every setup family and exit configuration (target/stop as multiples of ATR), all
historical trades across the universe are simulated. The configuration with the best mean
return on the *training* period (first 2/3 of days) is chosen per family, then judged on the
*validation* period (last 1/3). A family is ``accepted`` only if its validation mean return is
positive after costs. Per-stock statistics of the chosen configuration are kept so live picks
can blend stock-specific history with the family average (shrinkage).
"""

from __future__ import annotations

import datetime as dt
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any

import numpy as np

from dipbuyer.domain.models import Bar
from dipbuyer.picks.engine import FEATURES, FamilyModel, feature_matrix, fit_family_model
from dipbuyer.picks.strategies import (
    EXIT_GRID,
    ExitConfig,
    Family,
    Features,
    compute_features,
    signal_mask,
    simulate,
)

TRAIN_FRACTION = 2 / 3
MIN_TRAIN_TRADES = 200
MIN_VALIDATION_TRADES = 100
MIN_BARS = 260
MIN_VALIDATION_T = 2.0
"""A family is accepted only if its validation mean is at least this many standard errors
above zero, so that small random edges in noisy data are not mistaken for real ones."""


@dataclass
class Stats:
    n: int
    mean: float
    win_rate: float
    avg_win: float
    avg_loss: float
    std: float = 0.0

    @property
    def t_stat(self) -> float:
        if self.n < 2 or self.std <= 0:
            return 0.0
        return self.mean / (self.std / float(np.sqrt(self.n)))

    @staticmethod
    def of(returns: Sequence[float] | np.ndarray) -> Stats:
        r = np.asarray(returns, dtype=np.float64)
        if r.size == 0:
            return Stats(0, 0.0, 0.0, 0.0, 0.0)
        wins, losses = r[r > 0], r[r <= 0]
        return Stats(
            n=int(r.size),
            mean=float(r.mean()),
            win_rate=float((r > 0).mean()),
            avg_win=float(wins.mean()) if wins.size else 0.0,
            avg_loss=float(losses.mean()) if losses.size else 0.0,
            std=float(r.std(ddof=1)) if r.size > 1 else 0.0,
        )

    def to_json(self) -> dict[str, float | int]:
        return {
            "n": self.n,
            "mean": round(self.mean, 6),
            "win_rate": round(self.win_rate, 4),
            "avg_win": round(self.avg_win, 6),
            "avg_loss": round(self.avg_loss, 6),
            "std": round(self.std, 6),
            "t_stat": round(self.t_stat, 2),
        }


def _stats_from(j: Mapping[str, Any]) -> Stats:
    return Stats(
        n=int(j["n"]),
        mean=float(j["mean"]),
        win_rate=float(j["win_rate"]),
        avg_win=float(j["avg_win"]),
        avg_loss=float(j["avg_loss"]),
        std=float(j["std"]),
    )


@dataclass
class FamilyResult:
    family: Family
    exit: ExitConfig
    train: Stats
    validation: Stats
    accepted: bool
    grid: dict[str, dict[str, Any]] = field(default_factory=dict[str, dict[str, Any]])
    model: FamilyModel | None = None

    def to_json(self) -> dict[str, Any]:
        return {
            "family": self.family.value,
            "exit": {
                "key": self.exit.key,
                "target_atr": self.exit.target_atr,
                "stop_atr": self.exit.stop_atr,
            },
            "train": self.train.to_json(),
            "validation": self.validation.to_json(),
            "accepted": self.accepted,
            "grid": self.grid,
            "model": self.model.to_json() if self.model is not None else None,
        }


@dataclass
class SymbolData:
    dates: list[dt.date]
    features: Features


def to_symbol_data(bars: Sequence[Bar]) -> SymbolData | None:
    bars = sorted(bars, key=lambda b: b.session_date)
    if len(bars) < MIN_BARS:
        return None
    arr = np.array(
        [
            [float(b.open), float(b.high), float(b.low), float(b.close), float(b.volume)]
            for b in bars
        ],
        dtype=np.float64,
    )
    return SymbolData(
        dates=[b.session_date for b in bars],
        features=compute_features(arr[:, 0], arr[:, 1], arr[:, 2], arr[:, 3], arr[:, 4]),
    )


@dataclass
class Calibration:
    start: dt.date
    end: dt.date
    split_date: dt.date
    symbols: int
    families: dict[str, FamilyResult]
    stock_stats: dict[str, dict[str, dict[str, float | int]]]
    """symbol -> family -> Stats json (full period, chosen exit config)."""

    def summary_json(self) -> dict[str, Any]:
        return {
            "start": self.start.isoformat(),
            "end": self.end.isoformat(),
            "split_date": self.split_date.isoformat(),
            "symbols": self.symbols,
            "families": {k: v.to_json() for k, v in self.families.items()},
        }


def _fit_model(
    data: Mapping[str, SymbolData],
    per_symbol: Mapping[str, tuple[np.ndarray, np.ndarray]],
    returns: Mapping[str, np.ndarray],
) -> FamilyModel | None:
    """Feature models for one family's chosen exit (train/validation split as above)."""
    xs_tr, ys_tr, xs_va, ys_va = [], [], [], []
    for sym, (idx, is_train) in per_symbol.items():
        r = returns.get(sym)
        if r is None:
            continue
        x = feature_matrix(data[sym].features, idx)
        xs_tr.append(x[is_train])
        ys_tr.append(r[is_train])
        xs_va.append(x[~is_train])
        ys_va.append(r[~is_train])
    if not xs_tr:
        return None
    width = len(FEATURES)

    def cat(parts: list[np.ndarray], two_d: bool) -> np.ndarray:
        if not parts:
            return np.empty((0, width)) if two_d else np.empty(0)
        return np.concatenate(parts)

    return fit_family_model(
        cat(xs_tr, True), cat(ys_tr, False), cat(xs_va, True), cat(ys_va, False)
    )


def calibrate(
    universe: Mapping[str, Sequence[Bar]],
    *,
    progress: Callable[[int, int], None] | None = None,
) -> Calibration:
    data: dict[str, SymbolData] = {}
    for sym, bars in universe.items():
        sd = to_symbol_data(bars)
        if sd is not None:
            data[sym] = sd
    if not data:
        raise ValueError("not enough history in the universe to calibrate")
    all_dates = sorted({d for sd in data.values() for d in sd.dates})
    split_date = all_dates[int(len(all_dates) * TRAIN_FRACTION)]

    families: dict[str, FamilyResult] = {}
    stock_stats: dict[str, dict[str, dict[str, float | int]]] = {}
    fams = list(Family)
    for fi, fam in enumerate(fams):
        # trades per symbol: indices and whether in training period
        per_symbol: dict[str, tuple[np.ndarray, np.ndarray]] = {}
        for sym, sd in data.items():
            idx = np.flatnonzero(signal_mask(sd.features, fam))
            if idx.size:
                is_train = np.array([sd.dates[i] < split_date for i in idx], dtype=bool)
                per_symbol[sym] = (idx, is_train)
        best: tuple[float, ExitConfig] | None = None
        grid: dict[str, dict[str, Any]] = {}
        returns_by_cfg: dict[str, dict[str, np.ndarray]] = {}
        for cfg in EXIT_GRID:
            train_r: list[np.ndarray] = []
            val_r: list[np.ndarray] = []
            by_sym: dict[str, np.ndarray] = {}
            for sym, (idx, is_train) in per_symbol.items():
                r, _ = simulate(data[sym].features, idx, cfg)
                by_sym[sym] = r
                train_r.append(r[is_train])
                val_r.append(r[~is_train])
            tr = Stats.of(np.concatenate(train_r) if train_r else np.array([]))
            va = Stats.of(np.concatenate(val_r) if val_r else np.array([]))
            grid[cfg.key] = {"train": tr.to_json(), "validation": va.to_json()}
            returns_by_cfg[cfg.key] = by_sym
            if tr.n >= MIN_TRAIN_TRADES and (best is None or tr.mean > best[0]):
                best = (tr.mean, cfg)
        chosen = best[1] if best is not None else EXIT_GRID[-1]
        train_stats = _stats_from(grid[chosen.key]["train"])
        val_stats = _stats_from(grid[chosen.key]["validation"])
        accepted = (
            best is not None
            and val_stats.n >= MIN_VALIDATION_TRADES
            and val_stats.mean > 0
            and val_stats.t_stat >= MIN_VALIDATION_T
        )
        model = _fit_model(data, per_symbol, returns_by_cfg.get(chosen.key, {}))
        families[fam.value] = FamilyResult(
            fam, chosen, train_stats, val_stats, accepted, grid, model
        )
        for sym, r in returns_by_cfg.get(chosen.key, {}).items():
            stock_stats.setdefault(sym, {})[fam.value] = Stats.of(r).to_json()
        if progress is not None:
            progress(fi + 1, len(fams))
    return Calibration(
        start=all_dates[0],
        end=all_dates[-1],
        split_date=split_date,
        symbols=len(data),
        families=families,
        stock_stats=stock_stats,
    )
