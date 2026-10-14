"""Choose today's picks from a calibration and today's opens. Pure: no I/O."""

from __future__ import annotations

import datetime as dt
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from decimal import Decimal
from typing import Any

import numpy as np

from dipbuyer.domain.models import Bar
from dipbuyer.domain.money import round_to_cent
from dipbuyer.picks.strategies import (
    ENTRY_SLIP,
    FAMILY_DESCRIPTIONS,
    FAMILY_LABELS,
    ExitConfig,
    Family,
    compute_features,
    plan_levels,
    signal_mask,
)

PICKS_PER_DAY = 5
SHRINK_K = 20.0
ENTRY_LIMIT_BUFFER = Decimal("0.003")  # buy limit up to 0.3% above the open


@dataclass(frozen=True)
class Opening:
    """Today's opening data for one symbol (from a market snapshot)."""

    open: Decimal
    last: Decimal | None = None


@dataclass
class Candidate:
    symbol: str
    family: Family
    exit: ExitConfig
    open: Decimal
    entry_limit: Decimal
    target: Decimal | None
    stop: Decimal | None
    expected_return: float
    win_rate: float
    samples: int
    stock_mean: float | None
    family_mean: float
    accepted: bool
    features: dict[str, Any]

    @property
    def label(self) -> str:
        return FAMILY_LABELS[self.family]

    @property
    def description(self) -> str:
        return FAMILY_DESCRIPTIONS[self.family]


def _num(x: float) -> float | None:
    return None if not np.isfinite(x) else round(float(x), 6)


def candidates_for_symbol(
    symbol: str,
    bars: Sequence[Bar],
    opening: Opening,
    calibration_families: Mapping[str, Any],
    stock_stats: Mapping[str, Mapping[str, Any]],
) -> list[Candidate]:
    """Setups firing for ``symbol`` today. ``bars`` are completed sessions (oldest first)."""
    if len(bars) < 210 or opening.open <= 0:
        return []
    o = np.array([float(b.open) for b in bars] + [float(opening.open)])
    h = np.array([float(b.high) for b in bars] + [float(opening.open)])
    lo = np.array([float(b.low) for b in bars] + [float(opening.open)])
    c = np.array([float(b.close) for b in bars] + [float(opening.open)])
    f = compute_features(o, h, lo, c)
    out: list[Candidate] = []
    for fam_key, fam_json in calibration_families.items():
        fam = Family(fam_key)
        if not bool(signal_mask(f, fam)[-1]):
            continue
        ex = fam_json["exit"]
        cfg = ExitConfig(ex["target_atr"], ex["stop_atr"])
        fam_mean = float(fam_json["validation"]["mean"])
        fam_win = float(fam_json["validation"]["win_rate"])
        st = stock_stats.get(symbol, {}).get(fam_key)
        n = int(st["n"]) if st else 0
        s_mean = float(st["mean"]) if st else None
        s_win = float(st["win_rate"]) if st else None
        expected = ((n * s_mean) if s_mean is not None else 0.0) + SHRINK_K * fam_mean
        expected /= n + SHRINK_K
        win = ((n * s_win) if s_win is not None else 0.0) + SHRINK_K * fam_win
        win /= n + SHRINK_K
        atr = float(f.atr[-1])
        entry_ref = float(opening.open) * (1 + ENTRY_SLIP)
        target, stop = plan_levels(entry_ref, atr, cfg)
        out.append(
            Candidate(
                symbol=symbol,
                family=fam,
                exit=cfg,
                open=opening.open,
                entry_limit=round_to_cent(opening.open * (1 + ENTRY_LIMIT_BUFFER)),
                target=round_to_cent(Decimal(repr(float(target)))) if np.isfinite(target) else None,
                stop=round_to_cent(Decimal(repr(float(stop)))) if np.isfinite(stop) else None,
                expected_return=expected,
                win_rate=win,
                samples=n,
                stock_mean=s_mean,
                family_mean=fam_mean,
                accepted=bool(fam_json["accepted"]),
                features={
                    "gap_pct": _num(f.gap[-1] * 100),
                    "atr": _num(atr),
                    "atr_pct": _num(atr / float(f.prev_close[-1]) * 100),
                    "rsi2": _num(f.rsi2[-1]),
                    "sma50": _num(f.sma50[-1]),
                    "sma200": _num(f.sma200[-1]),
                    "prev_close": _num(f.prev_close[-1]),
                    "down_streak": int(f.down_streak[-1]),
                },
            )
        )
    return out


def rank(candidates: Sequence[Candidate], limit: int = PICKS_PER_DAY) -> list[Candidate]:
    """Best candidate per symbol, accepted families first, then by expected return."""
    best: dict[str, Candidate] = {}
    for cand in candidates:
        cur = best.get(cand.symbol)
        if cur is None or (cand.accepted, cand.expected_return) > (
            cur.accepted,
            cur.expected_return,
        ):
            best[cand.symbol] = cand
    ordered = sorted(best.values(), key=lambda x: (x.accepted, x.expected_return), reverse=True)
    return ordered[:limit]


def entry_exit_times(
    open_utc: dt.datetime, close_utc: dt.datetime
) -> tuple[dt.datetime, dt.datetime]:
    """Planned entry 5 minutes after the open, forced exit 5 minutes before the close."""
    return open_utc + dt.timedelta(minutes=5), close_utc - dt.timedelta(minutes=5)
