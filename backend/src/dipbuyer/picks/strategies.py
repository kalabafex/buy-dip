"""Intraday setups evaluated on daily OHLC bars. Pure: numpy only, no I/O.

All arrays are float64 and aligned by day index ``t``. Features at ``t`` only use completed
days ``< t`` plus the open of day ``t`` (known at the time picks are made, just after the
open). Prices here are statistics inputs, not money: orders are sized in Decimal elsewhere.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum

import numpy as np
import numpy.typing as npt

F = npt.NDArray[np.float64]
B = npt.NDArray[np.bool_]

ENTRY_SLIP = 0.0005  # 5 bps paid on entry versus the open
EXIT_SLIP = 0.0005  # 5 bps on stop and time exits (target exits are limit orders)


class Family(StrEnum):
    GAP_DOWN_REVERSAL = "GAP_DOWN_REVERSAL"
    GAP_UP_MOMENTUM = "GAP_UP_MOMENTUM"
    RSI2_OVERSOLD = "RSI2_OVERSOLD"
    PULLBACK_UPTREND = "PULLBACK_UPTREND"
    BREAKOUT_20D = "BREAKOUT_20D"


FAMILY_LABELS: dict[Family, str] = {
    Family.GAP_DOWN_REVERSAL: "Gap-down reversal",
    Family.GAP_UP_MOMENTUM: "Gap-up momentum",
    Family.RSI2_OVERSOLD: "Short-term oversold (RSI-2)",
    Family.PULLBACK_UPTREND: "Pullback in an uptrend",
    Family.BREAKOUT_20D: "20-day breakout",
}

FAMILY_DESCRIPTIONS: dict[Family, str] = {
    Family.GAP_DOWN_REVERSAL: (
        "Opened 1-8% below yesterday's close while in a long-term uptrend; these gaps often "
        "partly fill during the day."
    ),
    Family.GAP_UP_MOMENTUM: (
        "Opened 1-5% above yesterday's close while above its 50-day average; strong opens "
        "sometimes keep running."
    ),
    Family.RSI2_OVERSOLD: (
        "2-day RSI below 10 (sharply oversold) while above its 200-day average, and a quiet open."
    ),
    Family.PULLBACK_UPTREND: (
        "Three down closes in a row while the 50-day average is above the 200-day average."
    ),
    Family.BREAKOUT_20D: "Closed at a 20-day high yesterday and opened higher today.",
}


@dataclass(frozen=True)
class ExitConfig:
    target_atr: float | None
    stop_atr: float | None

    @property
    def key(self) -> str:
        t = "none" if self.target_atr is None else f"{self.target_atr:g}"
        s = "none" if self.stop_atr is None else f"{self.stop_atr:g}"
        return f"t{t}-s{s}"


EXIT_GRID: tuple[ExitConfig, ...] = tuple(
    ExitConfig(t, s) for t in (0.5, 1.0, None) for s in (0.5, 1.0, None)
)


@dataclass(frozen=True)
class Features:
    """Per-day features for one symbol (index ``t`` uses data before day ``t``)."""

    open: F
    high: F
    low: F
    close: F
    prev_close: F
    gap: F
    atr: F
    sma50: F
    sma200: F
    rsi2: F
    down_streak: F
    high20: F
    volume_ratio: F
    """Yesterday's volume / average volume of the 20 sessions before it."""


def _rolling_mean_prev(x: F, n: int) -> F:
    """Mean of x[t-n:t] at index t (NaN until n values exist)."""
    out = np.full(x.shape[0], np.nan)
    if x.shape[0] <= n:
        return out
    cs = np.concatenate([[0.0], np.cumsum(x)])
    out[n:] = (cs[n:-1] - cs[: -n - 1]) / n
    return out


def _rolling_max_prev(x: F, n: int) -> F:
    out = np.full(x.shape[0], np.nan)
    for t in range(n, x.shape[0]):
        out[t] = x[t - n : t].max()
    return out


def _wilder_rsi_prev(close: F, period: int) -> F:
    """Wilder RSI of closes up to t-1, at index t."""
    n = close.shape[0]
    out = np.full(n, np.nan)
    if n <= period + 1:
        return out
    d = np.diff(close)
    gains, losses = np.maximum(d, 0.0), np.maximum(-d, 0.0)
    ag, al = gains[:period].mean(), losses[:period].mean()

    def rsi(g: float, lo: float) -> float:
        if lo == 0.0:
            return 100.0 if g > 0 else 50.0
        return 100.0 - 100.0 / (1.0 + g / lo)

    # RSI of closes[0..period] is known at index period+1.
    out[period + 1] = rsi(ag, al)
    for i in range(period, d.shape[0] - 1):
        ag = (ag * (period - 1) + gains[i]) / period
        al = (al * (period - 1) + losses[i]) / period
        out[i + 2] = rsi(ag, al)
    return out


def _volume_ratio_prev(v: F) -> F:
    """v[t-1] / mean(v[t-21:t-1]) at index t (NaN when unknown or zero)."""
    out = np.full(v.shape[0], np.nan)
    avg = _rolling_mean_prev(v, 20)  # avg[t] = mean(v[t-20:t])
    for t in range(21, v.shape[0]):
        base = avg[t - 1]
        if np.isfinite(base) and base > 0 and v[t - 1] > 0:
            out[t] = v[t - 1] / base
    return out


def compute_features(o: F, h: F, lo: F, c: F, v: F | None = None) -> Features:
    n = c.shape[0]
    prev_close = np.full(n, np.nan)
    prev_close[1:] = c[:-1]
    tr = np.full(n, np.nan)
    tr[1:] = np.maximum.reduce([h[1:] - lo[1:], np.abs(h[1:] - c[:-1]), np.abs(lo[1:] - c[:-1])])
    tr[0] = h[0] - lo[0]
    # Streak of consecutive down closes ending at day t-1, available at t.
    down = np.zeros(n)
    s = 0.0
    for t in range(1, n):
        s = s + 1 if c[t] < c[t - 1] else 0.0
        if t + 1 < n:
            down[t + 1] = s
    return Features(
        open=o,
        high=h,
        low=lo,
        close=c,
        prev_close=prev_close,
        gap=o / prev_close - 1.0,
        atr=_rolling_mean_prev(tr, 14),
        sma50=_rolling_mean_prev(c, 50),
        sma200=_rolling_mean_prev(c, 200),
        rsi2=_wilder_rsi_prev(c, 2),
        down_streak=down,
        high20=_rolling_max_prev(c, 20),
        volume_ratio=_volume_ratio_prev(v) if v is not None else np.full(n, np.nan),
    )


def signal_mask(f: Features, family: Family) -> B:
    """Days on which the setup fires (decided at the open of that day)."""
    pc = f.prev_close
    with np.errstate(invalid="ignore"):
        match family:
            case Family.GAP_DOWN_REVERSAL:
                m = (f.gap <= -0.01) & (f.gap >= -0.08) & (pc > f.sma200)
            case Family.GAP_UP_MOMENTUM:
                m = (f.gap >= 0.01) & (f.gap <= 0.05) & (pc > f.sma50)
            case Family.RSI2_OVERSOLD:
                m = (f.rsi2 < 10.0) & (pc > f.sma200) & (np.abs(f.gap) < 0.02)
            case Family.PULLBACK_UPTREND:
                m = (f.down_streak >= 3) & (f.sma50 > f.sma200) & (pc > f.sma200)
            case Family.BREAKOUT_20D:
                m = (pc >= f.high20) & (f.gap > 0.0) & (f.gap < 0.05)
    valid = np.isfinite(f.atr) & (f.atr > 0) & np.isfinite(pc)
    return np.asarray(m & valid, dtype=np.bool_)


def plan_levels(entry: F | float, atr: F | float, cfg: ExitConfig) -> tuple[F | float, F | float]:
    """(target, stop) prices; NaN when the config has no target/stop."""
    target = entry + cfg.target_atr * atr if cfg.target_atr is not None else np.nan
    stop = entry - cfg.stop_atr * atr if cfg.stop_atr is not None else np.nan
    return target, stop


# Exit reasons (also used for live trades).
TARGET, STOP, TIME = "TARGET", "STOP", "TIME"


def simulate(f: Features, idx: npt.NDArray[np.int64], cfg: ExitConfig) -> tuple[F, list[str]]:
    """Intraday outcome for trades entered at the open of each day in ``idx``.

    Daily bars do not say whether the high or the low came first, so when both the stop and
    the target are inside the day's range the stop is assumed to hit first (conservative).
    """
    entry = f.open[idx] * (1 + ENTRY_SLIP)
    atr = f.atr[idx]
    target, stop = plan_levels(entry, atr, cfg)
    hi, lo, cl = f.high[idx], f.low[idx], f.close[idx]
    exit_px = cl * (1 - EXIT_SLIP)
    reasons = np.full(idx.shape[0], TIME, dtype=object)
    if cfg.target_atr is not None:
        hit_t = hi >= target
        exit_px = np.where(hit_t, target, exit_px)
        reasons = np.where(hit_t, TARGET, reasons)
    if cfg.stop_atr is not None:
        hit_s = lo <= stop
        exit_px = np.where(hit_s, stop * (1 - EXIT_SLIP), exit_px)
        reasons = np.where(hit_s, STOP, reasons)
    return exit_px / entry - 1.0, [str(r) for r in reasons]


def simulate_one(
    open_: float, high: float, low: float, close: float, target: float | None, stop: float | None
) -> tuple[float, str, float]:
    """Plan outcome for one day: (return, reason, exit price). Entry at open + slippage."""
    entry = open_ * (1 + ENTRY_SLIP)
    if stop is not None and low <= stop:
        px = stop * (1 - EXIT_SLIP)
        return px / entry - 1.0, STOP, px
    if target is not None and high >= target:
        return target / entry - 1.0, TARGET, target
    px = close * (1 - EXIT_SLIP)
    return px / entry - 1.0, TIME, px
