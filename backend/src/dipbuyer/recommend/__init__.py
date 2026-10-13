"""History-based rule recommendations. Pure: takes bars, returns ranked candidates.

For one symbol, a compact grid of rule parameters (the families that held up in
docs/rule-research.md, plus the app's default rule for reference) is backtested with the
unchanged backtester over rolling 3-year windows. Windows are split chronologically into a
*selection* half and a *validation* half; a rule is ranked by how consistently it beat
monthly DCA (same dollars) in both halves, then by its median edge.
"""

from __future__ import annotations

import datetime as dt
import statistics
from collections.abc import Callable, Sequence
from concurrent.futures import ProcessPoolExecutor, as_completed
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Any

from dipbuyer import engine, indicators
from dipbuyer.backtest import run_backtest
from dipbuyer.domain.constants import HISTORY_CALENDAR_DAYS
from dipbuyer.domain.enums import TrendFilter, TriggerType
from dipbuyer.domain.models import Bar, GlobalSettingsModel, RuleParams, Tier

__all__ = [
    "Candidate",
    "RecommendationResult",
    "candidate_grid",
    "recommend",
    "rolling_windows",
]

D = Decimal
WINDOW_YEARS = 3
STEP_MONTHS = 6
MIN_WINDOWS = 4
# Generous caps so the comparison measures the rule itself, not the global spend caps.
SIM_SETTINGS = GlobalSettingsModel(
    max_daily_spend_usd=D(1_000_000), max_weekly_spend_usd=D(1_000_000)
)


@dataclass(frozen=True)
class Candidate:
    key: str
    label: str
    trigger_type: TriggerType
    drops: tuple[int, ...]
    lookback_days: int = 50
    rsi_threshold: int | None = None
    ma_period: int | None = None
    trend_filter: TrendFilter = TrendFilter.NONE
    confirm_evals: int = 2
    cooldown_days: int = 5
    is_reference: bool = False

    def to_rule(self, symbol: str, budget_per_dip: Decimal, max_position: Decimal) -> RuleParams:
        """Tier amounts grow linearly (1, 2, 3, ...) and sum to ``budget_per_dip``."""
        weights = list(range(1, len(self.drops) + 1))
        unit = budget_per_dip / sum(weights)
        amounts = [(unit * w).quantize(D(1)) or D(1) for w in weights]
        return RuleParams(
            symbol=symbol,
            enabled=False,
            trigger_type=self.trigger_type,
            lookback_days=self.lookback_days,
            tiers=[
                Tier(drop_pct=D(d), amount_usd=a) for d, a in zip(self.drops, amounts, strict=True)
            ],
            rsi_threshold=D(self.rsi_threshold) if self.rsi_threshold is not None else None,
            ma_period=self.ma_period,
            trend_filter=self.trend_filter,
            confirm_evals=self.confirm_evals,
            max_position_usd=max(max_position, sum(amounts, D(0))),
            cooldown_days=self.cooldown_days,
            limit_offset_pct=D("0.3"),
        )


def _drops_label(drops: tuple[int, ...]) -> str:
    return "/".join(f"-{d}%" for d in drops)


def candidate_grid() -> list[Candidate]:
    out: list[Candidate] = []
    for rsi in (30, 35, 40):
        for drops in ((3, 6, 10), (5, 10, 20)):
            for confirm in (1, 2):
                for cooldown in (0, 5):
                    out.append(
                        Candidate(
                            key=f"rsi{rsi}-{'-'.join(map(str, drops))}-c{confirm}-cd{cooldown}",
                            label=f"RSI ≤ {rsi}, tiers {_drops_label(drops)}",
                            trigger_type=TriggerType.RSI_OVERSOLD,
                            rsi_threshold=rsi,
                            drops=drops,
                            confirm_evals=confirm,
                            cooldown_days=cooldown,
                        )
                    )
    for lookback in (20, 50):
        for drops in ((3, 6, 10), (5, 10, 15), (4, 8, 12, 16, 20)):
            for cooldown in (5, 15):
                out.append(
                    Candidate(
                        key=f"pb{lookback}-{'-'.join(map(str, drops))}-cd{cooldown}",
                        label=f"Pullback from {lookback}-day high, tiers {_drops_label(drops)}",
                        trigger_type=TriggerType.PULLBACK_FROM_HIGH,
                        lookback_days=lookback,
                        drops=drops,
                        cooldown_days=cooldown,
                    )
                )
    for ma in (50, 200):
        for cooldown in (5, 15):
            out.append(
                Candidate(
                    key=f"ma{ma}-5-10-20-cd{cooldown}",
                    label=f"Below {ma}-day average, tiers -5%/-10%/-20%",
                    trigger_type=TriggerType.BELOW_MA,
                    ma_period=ma,
                    drops=(5, 10, 20),
                    cooldown_days=cooldown,
                )
            )
    out.append(
        Candidate(
            key="default",
            label="App default: pullback from 20-day high, above 200-day average",
            trigger_type=TriggerType.PULLBACK_FROM_HIGH,
            lookback_days=20,
            drops=(5, 10, 20),
            trend_filter=TrendFilter.ABOVE_200DMA,
            is_reference=True,
        )
    )
    return out


def _add_months(d: dt.date, months: int) -> dt.date:
    m = d.month - 1 + months
    return dt.date(d.year + m // 12, m % 12 + 1, 1)


def rolling_windows(first: dt.date, last: dt.date) -> list[tuple[dt.date, dt.date]]:
    """3-year windows starting every 6 months, after one year of indicator warm-up."""
    start = _add_months(dt.date(first.year, first.month, 1), 13)
    out: list[tuple[dt.date, dt.date]] = []
    while True:
        end = _add_months(start, WINDOW_YEARS * 12) - dt.timedelta(days=1)
        if end > last:
            break
        out.append((start, end))
        start = _add_months(start, STEP_MONTHS)
    return out


@dataclass
class HalfStats:
    windows: int
    windows_with_buys: int
    win_rate: float
    median_edge: float
    worst_edge: float

    def to_json(self) -> dict[str, Any]:
        return {
            "windows": self.windows,
            "windows_with_buys": self.windows_with_buys,
            "win_rate": round(self.win_rate, 4),
            "median_edge_pct": round(self.median_edge, 2),
            "worst_edge_pct": round(self.worst_edge, 2),
        }


def _half(edges: Sequence[float | None]) -> HalfStats:
    got = [e for e in edges if e is not None]
    return HalfStats(
        windows=len(edges),
        windows_with_buys=len(got),
        win_rate=sum(1 for e in got if e > 0) / len(got) if got else 0.0,
        median_edge=statistics.median(got) if got else 0.0,
        worst_edge=min(got) if got else 0.0,
    )


@dataclass
class Scored:
    candidate: Candidate
    selection: HalfStats
    validation: HalfStats
    median_cost_advantage: float
    buys_per_year: float
    score: tuple[float, float]
    confidence: str
    full_period: dict[str, Any] = field(default_factory=dict[str, Any])

    def to_json(
        self, symbol: str, budget: Decimal, max_position: Decimal, current: dict[str, Any]
    ) -> dict[str, Any]:
        params = self.candidate.to_rule(symbol, budget, max_position)
        return {
            "key": self.candidate.key,
            "label": self.candidate.label,
            "is_reference": self.candidate.is_reference,
            "confidence": self.confidence,
            "params": params.model_dump(mode="json"),
            "selection": self.selection.to_json(),
            "validation": self.validation.to_json(),
            "median_cost_advantage_pct": round(self.median_cost_advantage, 2),
            "buys_per_year": round(self.buys_per_year, 1),
            "current": current,
            "full_period": self.full_period,
        }


def _confidence(sel: HalfStats, val: HalfStats) -> str:
    lo = min(sel.win_rate, val.win_rate)
    edge = min(sel.median_edge, val.median_edge)
    if lo >= 0.8 and edge >= 2:
        return "strong"
    if lo >= 0.6 and edge > 0:
        return "moderate"
    return "weak"


def _score(
    cand: Candidate, bars: Sequence[Bar], windows: Sequence[tuple[dt.date, dt.date]]
) -> Scored:
    rule = cand.to_rule("SIM", D(600), D(10**9))
    sim_bars = [b.model_copy(update={"symbol": "SIM"}) for b in bars]
    edges: list[float | None] = []
    cost_adv: list[float] = []
    buys = 0
    years = 0.0
    for start, end in windows:
        res = run_backtest(rule, sim_bars, start, end, D(10**8), SIM_SETTINGS)
        years += (end - start).days / 365.25
        buys += res.rule.num_buys
        if (
            res.rule.total_invested <= 0
            or res.baseline.avg_cost is None
            or res.rule.avg_cost is None
        ):
            edges.append(None)
            continue
        edges.append(float(res.rule.return_pct - res.baseline.return_pct))
        cost_adv.append(
            float((res.baseline.avg_cost - res.rule.avg_cost) / res.baseline.avg_cost * 100)
        )
    half = len(windows) // 2
    sel, val = _half(edges[:half]), _half(edges[half:])
    coverage = (sel.windows_with_buys + val.windows_with_buys) / max(1, len(windows))
    lo = min(sel.win_rate, val.win_rate) if coverage >= 0.75 else 0.0
    return Scored(
        candidate=cand,
        selection=sel,
        validation=val,
        median_cost_advantage=statistics.median(cost_adv) if cost_adv else 0.0,
        buys_per_year=buys / years if years else 0.0,
        score=(lo, sel.median_edge + val.median_edge),
        confidence=_confidence(sel, val) if coverage >= 0.75 else "weak",
    )


CURVE_POINTS = 160


def _full_period(
    cand: Candidate, bars: Sequence[Bar], start: dt.date, end: dt.date
) -> dict[str, Any]:
    """One backtest over the whole tested range, with a profit curve (rule vs DCA)."""
    rule = cand.to_rule("SIM", D(600), D(10**9))
    sim_bars = [b.model_copy(update={"symbol": "SIM"}) for b in bars]
    cash = D(10**8)
    res = run_backtest(rule, sim_bars, start, end, cash, SIM_SETTINGS)
    curve = res.equity_curve
    step = max(1, len(curve) // CURVE_POINTS)
    points = curve[::step]
    if curve and points[-1] is not curve[-1]:
        points.append(curve[-1])
    return {
        "start": res.start_date.isoformat(),
        "end": res.end_date.isoformat(),
        "rule": res.rule.to_json(),
        "baseline": res.baseline.to_json(),
        "profit_curve": [
            {
                "date": p["date"],
                "rule": str((D(p["rule"]) - cash).quantize(D("0.01"))),
                "baseline": str((D(p["baseline"]) - cash).quantize(D("0.01"))),
            }
            for p in points
        ],
    }


def _current(cand: Candidate, bars: Sequence[Bar]) -> dict[str, Any]:
    """Would this rule's condition be met at the latest close?"""
    if len(bars) < 2:
        return {}
    last_day = bars[-1].session_date
    window = [
        b
        for b in bars[:-1]
        if b.session_date >= last_day - dt.timedelta(days=HISTORY_CALENDAR_DAYS)
    ]
    rule = cand.to_rule("SIM", D(600), D(10**9))
    ind = indicators.compute(
        window, bars[-1].close, lookback_days=rule.lookback_days, ma_period=rule.ma_period
    )
    return {
        "as_of": last_day.isoformat(),
        "last_close": str(bars[-1].close),
        "condition_met": engine.condition_met(rule, ind),
        "pullback_pct": str(ind.pullback_pct) if ind.pullback_pct is not None else None,
        "rsi14": str(ind.rsi14) if ind.rsi14 is not None else None,
    }


@dataclass
class RecommendationResult:
    symbol: str
    first_date: dt.date
    last_date: dt.date
    windows: list[tuple[dt.date, dt.date]]
    ranked: list[Scored]
    reference: Scored | None
    current: dict[str, dict[str, Any]] = field(default_factory=dict[str, dict[str, Any]])

    def to_json(self, budget: Decimal, max_position: Decimal, top: int = 5) -> dict[str, Any]:
        def j(s: Scored) -> dict[str, Any]:
            return s.to_json(
                self.symbol, budget, max_position, self.current.get(s.candidate.key, {})
            )

        return {
            "symbol": self.symbol,
            "history": {"first": self.first_date.isoformat(), "last": self.last_date.isoformat()},
            "windows": len(self.windows),
            "window_years": WINDOW_YEARS,
            "split_date": self.windows[len(self.windows) // 2][0].isoformat()
            if self.windows
            else None,
            "candidates_tested": len(self.ranked) + (1 if self.reference else 0),
            "recommendations": [j(s) for s in self.ranked[:top]],
            "reference": j(self.reference) if self.reference else None,
        }


def recommend(
    symbol: str,
    bars: Sequence[Bar],
    *,
    candidates: Sequence[Candidate] | None = None,
    progress: Callable[[int, int], None] | None = None,
    max_workers: int | None = None,
) -> RecommendationResult:
    bars = sorted(bars, key=lambda b: b.session_date)
    if not bars:
        raise ValueError(f"no price history for {symbol}")
    windows = rolling_windows(bars[0].session_date, bars[-1].session_date)
    if len(windows) < MIN_WINDOWS:
        raise ValueError(
            f"{symbol}: need about {WINDOW_YEARS + 3} years of history for recommendations; "
            f"have {bars[0].session_date} to {bars[-1].session_date}"
        )
    cands = list(candidates or candidate_grid())
    scored: list[Scored] = []
    if max_workers is not None and max_workers > 1:
        with ProcessPoolExecutor(max_workers) as ex:
            futures = [ex.submit(_score, c, bars, windows) for c in cands]
            for i, fut in enumerate(as_completed(futures)):
                scored.append(fut.result())
                if progress is not None:
                    progress(i + 1, len(cands))
        order = {c.key: i for i, c in enumerate(cands)}
        scored.sort(key=lambda s: order[s.candidate.key])
    else:
        for i, cand in enumerate(cands):
            scored.append(_score(cand, bars, windows))
            if progress is not None:
                progress(i + 1, len(cands))
    reference = next((s for s in scored if s.candidate.is_reference), None)
    ranked = sorted(
        (s for s in scored if not s.candidate.is_reference), key=lambda s: s.score, reverse=True
    )
    shown = [*ranked[:5], *([reference] if reference is not None else [])]
    current = {s.candidate.key: _current(s.candidate, bars) for s in shown}
    for s in shown:
        s.full_period = _full_period(s.candidate, bars, windows[0][0], windows[-1][1])
    return RecommendationResult(
        symbol=symbol,
        first_date=bars[0].session_date,
        last_date=bars[-1].session_date,
        windows=windows,
        ranked=ranked,
        reference=reference,
        current=current,
    )
