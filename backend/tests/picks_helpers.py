"""Synthetic universes for daily-picks tests."""

from __future__ import annotations

import datetime as dt
from decimal import Decimal as D

import numpy as np

from dipbuyer.data.calendar import sessions_between
from dipbuyer.domain.models import Bar, DaySnapshot


def gap_reversal_universe(
    symbols: list[str], end: dt.date, n: int = 600, seed: int = 7
) -> dict[str, list[Bar]]:
    """Uptrending stocks where every ~15th day gaps down 3% and closes 2% above the open."""
    rng = np.random.default_rng(seed)
    days = sessions_between(end - dt.timedelta(days=n * 2), end)[-n:]
    out: dict[str, list[Bar]] = {}
    for k, sym in enumerate(symbols):
        p = 50.0 + 10 * k
        bars: list[Bar] = []
        for i, d in enumerate(days):
            if i > 220 and (i + k) % 15 == 0:
                o = p * 0.97
                c = o * 1.02
                h, lo = c * 1.001, o * 0.999
            else:
                o = p * (1 + rng.normal(0.0005, 0.002))
                c = o * (1 + rng.normal(0.0008, 0.004))
                h, lo = max(o, c) * 1.002, min(o, c) * 0.998
            bars.append(
                Bar(
                    symbol=sym,
                    session_date=d,
                    open=D(f"{o:.2f}"),
                    high=D(f"{h:.2f}"),
                    low=D(f"{lo:.2f}"),
                    close=D(f"{c:.2f}"),
                    volume=D(1000),
                )
            )
            p = c
        out[sym] = bars
    return out


def gap_down_snapshot(bars: list[Bar], day: dt.date, gap: float = -0.03) -> DaySnapshot:
    prev = bars[-1].close
    o = (prev * D(str(1 + gap))).quantize(D("0.01"))
    return DaySnapshot(
        symbol=bars[-1].symbol, session_date=day, open=o, high=o, low=o, last=o, prev_close=prev
    )
