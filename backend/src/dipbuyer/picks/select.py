"""Choose today's picks from a calibration and today's opens. Pure: no I/O."""

from __future__ import annotations

import datetime as dt
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Any

import numpy as np

from dipbuyer.domain.models import Bar
from dipbuyer.domain.money import round_to_cent
from dipbuyer.picks.engine import (
    FEATURE_LABELS,
    FEATURE_UNITS,
    FEATURES,
    Contribution,
    EngineParams,
    FamilyModel,
    explain_return,
    feature_matrix,
    model_win_probability,
)
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

PICKS_PER_DAY = 3
CANDIDATES_KEPT = 30
"""Top-scored candidates stored daily (picks plus runners-up) and scored after the close;
they are the evidence the weekly review learns from."""
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
    projected_return: float
    """Projected move from entry to exit (fraction), after costs."""
    projected_low: float
    projected_high: float
    """Middle 50% of past outcomes, shifted to this projection."""
    certainty: float
    """Calibrated probability that following the plan ends positive."""
    raw_certainty: float
    base_return: float
    """Stock/setup history blend before feature adjustments and weekly scaling."""
    model_adjustment: float
    multiplier: float
    samples: int
    stock_mean: float | None
    stock_win: float | None
    family_mean: float
    family_win: float
    accepted: bool
    suspended: bool
    features: dict[str, Any]
    contributions: list[Contribution] = field(default_factory=list[Contribution])
    reasons: list[dict[str, Any]] = field(default_factory=list[dict[str, Any]])

    @property
    def eligible(self) -> bool:
        """May be picked and traded: validated setup that the weekly review has not suspended."""
        return self.accepted and not self.suspended

    @property
    def label(self) -> str:
        return FAMILY_LABELS[self.family]

    @property
    def description(self) -> str:
        return FAMILY_DESCRIPTIONS[self.family]


def _num(x: float) -> float | None:
    return None if not np.isfinite(x) else round(float(x), 6)


def _blend(n: int, stock: float | None, family: float) -> float:
    return ((n * stock) if stock is not None else 0.0) + SHRINK_K * family


def candidates_for_symbol(
    symbol: str,
    bars: Sequence[Bar],
    opening: Opening,
    calibration_families: Mapping[str, Any],
    stock_stats: Mapping[str, Mapping[str, Any]],
    params: EngineParams | None = None,
) -> list[Candidate]:
    """Setups firing for ``symbol`` today. ``bars`` are completed sessions (oldest first)."""
    params = params or EngineParams()
    if len(bars) < 210 or opening.open <= 0:
        return []
    op = float(opening.open)
    o = np.array([float(b.open) for b in bars] + [op])
    h = np.array([float(b.high) for b in bars] + [op])
    lo = np.array([float(b.low) for b in bars] + [op])
    c = np.array([float(b.close) for b in bars] + [op])
    v = np.array([float(b.volume) for b in bars] + [0.0])
    f = compute_features(o, h, lo, c, v)
    t = np.array([c.shape[0] - 1])
    x = feature_matrix(f, t)[0]
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
        base = _blend(n, s_mean, fam_mean) / (n + SHRINK_K)
        model_json = fam_json.get("model")
        model = FamilyModel.from_json(model_json) if model_json else None
        adjustment, contribs = explain_return(model, x) if model is not None else (0.0, [])
        mult = params.multiplier(fam_key)
        projected = (base + adjustment) * mult
        p_family = (
            model_win_probability(model, x) if model is not None and model.use_win else fam_win
        )
        raw_p = _blend(n, s_win, p_family) / (n + SHRINK_K)
        certainty = params.calibrate_certainty(raw_p)
        if model is not None:
            low = projected + (model.q25 - model.train_mean) * abs(mult)
            high = projected + (model.q75 - model.train_mean) * abs(mult)
        else:
            low, high = projected, projected
        atr = float(f.atr[-1])
        entry_ref = op * (1 + ENTRY_SLIP)
        target, stop = plan_levels(entry_ref, atr, cfg)
        feats = {name: _num(float(x[i])) for i, name in enumerate(FEATURES)}
        feats |= {
            "atr": _num(atr),
            "sma50": _num(f.sma50[-1]),
            "sma200": _num(f.sma200[-1]),
            "prev_close": _num(f.prev_close[-1]),
        }
        cand = Candidate(
            symbol=symbol,
            family=fam,
            exit=cfg,
            open=opening.open,
            entry_limit=round_to_cent(opening.open * (1 + ENTRY_LIMIT_BUFFER)),
            target=round_to_cent(Decimal(repr(float(target)))) if np.isfinite(target) else None,
            stop=round_to_cent(Decimal(repr(float(stop)))) if np.isfinite(stop) else None,
            projected_return=projected,
            projected_low=min(low, high),
            projected_high=max(low, high),
            certainty=certainty,
            raw_certainty=raw_p,
            base_return=base,
            model_adjustment=adjustment,
            multiplier=mult,
            samples=n,
            stock_mean=s_mean,
            stock_win=s_win,
            family_mean=fam_mean,
            family_win=fam_win,
            accepted=bool(fam_json["accepted"]),
            suspended=fam_key in params.suspended,
            features=feats,
            contributions=contribs if model is not None and model.use_ret else [],
        )
        cand.reasons = build_reasons(cand, fam_json, model, params)
        out.append(cand)
    return out


def _pct(x: float, digits: int = 2) -> str:
    return f"{x * 100:+.{digits}f}%"


def _setup_trigger_text(c: Candidate) -> str:
    f = c.features
    gap, trend200 = f.get("gap_pct"), f.get("trend200_pct")
    match c.family:
        case Family.GAP_DOWN_REVERSAL:
            return (
                f"Opened {abs(gap or 0):.1f}% below yesterday's close of ${f.get('prev_close')} "
                f"while {trend200 or 0:+.1f}% versus its 200-day average."
            )
        case Family.GAP_UP_MOMENTUM:
            return (
                f"Opened {gap or 0:.1f}% above yesterday's close while "
                f"{f.get('trend50_pct') or 0:+.1f}% versus its 50-day average."
            )
        case Family.RSI2_OVERSOLD:
            return (
                f"2-day RSI is {f.get('rsi2') or 0:.0f} (below 10 = sharply oversold) while "
                f"{trend200 or 0:+.1f}% versus its 200-day average; quiet open ({gap or 0:+.1f}%)."
            )
        case Family.PULLBACK_UPTREND:
            return (
                f"{int(f.get('down_streak') or 0)} down closes in a row while the 50-day average "
                f"is above the 200-day average."
            )
        case Family.BREAKOUT_20D:
            return f"Closed at a 20-day high yesterday and opened {gap or 0:+.1f}% higher."


def build_reasons(
    c: Candidate,
    fam_json: Mapping[str, Any],
    model: FamilyModel | None,
    params: EngineParams,
) -> list[dict[str, Any]]:
    """Plain-language record of why the engine scored this candidate as it did."""
    val = fam_json["validation"]
    out: list[dict[str, Any]] = [
        {"kind": "setup", "text": f"{c.label}: {_setup_trigger_text(c)}", "impact_pct": None},
        {
            "kind": "setup_history",
            "text": (
                f"Across the universe this setup averaged {_pct(c.family_mean)} per trade with "
                f"{c.family_win:.0%} winners over {int(val['n'])} recent trades "
                f"(t = {float(val.get('t_stat', 0)):.1f}); "
                + ("validated." if c.accepted else "not validated, so it is never traded.")
            ),
            "impact_pct": round(c.family_mean * 100, 4),
        },
    ]
    if c.samples:
        out.append(
            {
                "kind": "stock_history",
                "text": (
                    f"{c.symbol} itself: {c.samples} past occurrences, average "
                    f"{_pct(c.stock_mean or 0)}, {c.stock_win or 0:.0%} winners; weighted "
                    f"{c.samples}:{int(SHRINK_K)} against the setup average."
                ),
                "impact_pct": round((c.stock_mean or 0) * 100, 4),
            }
        )
    else:
        out.append(
            {
                "kind": "stock_history",
                "text": f"No past occurrences for {c.symbol}; the setup average is used.",
                "impact_pct": None,
            }
        )
    out.append(
        {
            "kind": "base",
            "text": f"History-based starting point: {_pct(c.base_return)}.",
            "impact_pct": round(c.base_return * 100, 4),
        }
    )
    if model is not None and model.use_ret:
        top = sorted(c.contributions, key=lambda k: abs(k.impact), reverse=True)[:4]
        for k in top:
            if abs(k.impact) < 0.00005:
                continue
            val_txt = "n/a" if k.value is None else f"{k.value:.2f}{FEATURE_UNITS[k.feature]}"
            out.append(
                {
                    "kind": "factor",
                    "feature": k.feature,
                    "text": (
                        f"{FEATURE_LABELS[k.feature]} {val_txt} "
                        f"{'raises' if k.impact > 0 else 'lowers'} the projection by "
                        f"{abs(k.impact) * 100:.2f} pts."
                    ),
                    "impact_pct": round(k.impact * 100, 4),
                }
            )
    elif model is not None:
        out.append(
            {
                "kind": "factor",
                "text": (
                    "Feature model did not beat the plain average on recent data, "
                    "so it is not used."
                ),
                "impact_pct": None,
            }
        )
    if abs(c.multiplier - 1.0) > 1e-9:
        out.append(
            {
                "kind": "engine",
                "text": (
                    f"Weekly review (engine v{params.version}) scales {c.label} projections by "
                    f"x{c.multiplier:.2f} based on live results."
                ),
                "impact_pct": round(
                    (c.base_return + c.model_adjustment) * (c.multiplier - 1) * 100, 4
                ),
            }
        )
    if c.suspended:
        out.append(
            {
                "kind": "engine",
                "text": (
                    f"{c.label} is suspended by the weekly review after poor live results; "
                    "shown only."
                ),
                "impact_pct": None,
            }
        )
    exit_txt = (
        "no target or stop (holding to the exit tested best)"
        if c.exit.target_atr is None and c.exit.stop_atr is None
        else ", ".join(
            x
            for x in (
                f"target {c.exit.target_atr:g}x ATR" if c.exit.target_atr is not None else "",
                f"stop {c.exit.stop_atr:g}x ATR" if c.exit.stop_atr is not None else "",
            )
            if x
        )
    )
    out.append(
        {
            "kind": "plan",
            "text": f"Exit chosen on the training years: {exit_txt}.",
            "impact_pct": None,
        }
    )
    cert_src = "feature model" if model is not None and model.use_win else "historical win rate"
    calib = (
        ""
        if abs(params.certainty_a - 1) < 1e-9 and abs(params.certainty_b) < 1e-9
        else f", recalibrated by engine v{params.version} from {c.raw_certainty:.0%}"
    )
    out.append(
        {
            "kind": "certainty",
            "text": (
                f"Certainty {c.certainty:.0%}: probability of a positive result from the "
                f"{cert_src}{calib}."
            ),
            "impact_pct": None,
        }
    )
    out.append(
        {
            "kind": "projection",
            "text": (
                f"Projected move {_pct(c.projected_return)} after costs; middle half of past "
                f"outcomes {_pct(c.projected_low)} to {_pct(c.projected_high)}."
            ),
            "impact_pct": round(c.projected_return * 100, 4),
        }
    )
    return out


def _key(c: Candidate) -> tuple[bool, float, float]:
    return (c.eligible, c.projected_return, c.certainty)


def best_per_symbol(candidates: Sequence[Candidate]) -> list[Candidate]:
    best: dict[str, Candidate] = {}
    for cand in candidates:
        cur = best.get(cand.symbol)
        if cur is None or _key(cand) > _key(cur):
            best[cand.symbol] = cand
    return sorted(best.values(), key=_key, reverse=True)


def rank(candidates: Sequence[Candidate], limit: int = PICKS_PER_DAY) -> list[Candidate]:
    """Best candidate per symbol; eligible setups first, then projected move, then certainty."""
    return best_per_symbol(candidates)[:limit]


def entry_exit_times(
    open_utc: dt.datetime, close_utc: dt.datetime
) -> tuple[dt.datetime, dt.datetime]:
    """Planned entry 5 minutes after the open, forced exit 5 minutes before the close."""
    return open_utc + dt.timedelta(minutes=5), close_utc - dt.timedelta(minutes=5)
