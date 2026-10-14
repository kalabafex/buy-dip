"""Daily bar loading with a Postgres cache (``BarDaily``)."""

from __future__ import annotations

import datetime as dt
import logging
from collections.abc import Sequence
from decimal import Decimal

from sqlalchemy.orm import Session

from dipbuyer.data.calendar import previous_session, sessions_between
from dipbuyer.data.market_data import MarketData
from dipbuyer.domain.constants import HISTORY_CALENDAR_DAYS
from dipbuyer.domain.models import Bar
from dipbuyer.persistence import repo

log = logging.getLogger(__name__)


class BarService:
    def __init__(self, market_data: MarketData) -> None:
        self.md = market_data
        # symbol -> earliest start already requested; history before the first cached bar
        # (pre-IPO, or before the window) is not re-requested every tick.
        self._head_checked: dict[str, dt.date] = {}

    def ensure_cached(self, session: Session, symbol: str, start: dt.date, end: dt.date) -> int:
        """Fetch only sessions missing from the cache within [start, end].

        Missing = sessions before the earliest cached bar or after the latest one. Interior
        gaps (halts) are not refetched.
        """
        sessions = sessions_between(start, end)
        if not sessions:
            return 0
        first, last = sessions[0], sessions[-1]
        lo, hi = repo.bar_date_range(session, symbol)
        fetched = 0
        checked = self._head_checked.get(symbol)
        if lo is None or hi is None:
            fetched += repo.upsert_bars(session, self.md.get_daily_bars(symbol, start, end))
            self._head_checked[symbol] = start
        else:
            if first < lo and (checked is None or start < checked):
                self._head_checked[symbol] = start
                head = self.md.get_daily_bars(symbol, start, lo - dt.timedelta(days=1))
                fetched += repo.upsert_bars(session, head)
            if hi < last:
                tail = self.md.get_daily_bars(symbol, hi + dt.timedelta(days=1), end)
                fetched += repo.upsert_bars(session, tail)
        if fetched:
            log.info("cached bars", extra={"symbol": symbol, "count": fetched})
        session.flush()
        return fetched

    def completed_bars(self, session: Session, symbol: str, today: dt.date) -> list[Bar]:
        """Completed daily bars up to the previous session, oldest first."""
        end = previous_session(today)
        start = end - dt.timedelta(days=HISTORY_CALENDAR_DAYS)
        self.ensure_cached(session, symbol, start, end)
        return repo.get_bars(session, symbol, start, end)

    def load(self, session: Session, symbol: str, today: dt.date) -> tuple[list[Bar], Decimal]:
        """Return (completed bars, latest trade price)."""
        bars = self.completed_bars(session, symbol, today)
        return bars, self.md.get_latest_trade(symbol)

    def ensure_cached_many(
        self, session: Session, symbols: Sequence[str], start: dt.date, end: dt.date
    ) -> int:
        """Batch version of ``ensure_cached`` using multi-symbol requests.

        Symbols are grouped by the date range they are missing so each group is one
        request per 100 symbols.
        """
        sessions = sessions_between(start, end)
        if not sessions or not symbols:
            return 0
        first, last = sessions[0], sessions[-1]
        ranges = repo.bar_date_ranges(session, symbols)
        groups: dict[tuple[dt.date, dt.date], list[str]] = {}
        for sym in symbols:
            rng = ranges.get(sym)
            if rng is None:
                if self._head_checked.get(sym) is None or start < self._head_checked[sym]:
                    groups.setdefault((start, end), []).append(sym)
                    self._head_checked[sym] = start
                continue
            lo, hi = rng
            if first < lo and (sym not in self._head_checked or start < self._head_checked[sym]):
                self._head_checked[sym] = start
                groups.setdefault((start, lo - dt.timedelta(days=1)), []).append(sym)
            if hi < last:
                groups.setdefault((hi + dt.timedelta(days=1), end), []).append(sym)
        fetched = 0
        for (g_start, g_end), syms in groups.items():
            for bars in self.md.get_daily_bars_multi(syms, g_start, g_end).values():
                fetched += repo.upsert_bars(session, bars)
        if fetched:
            log.info("cached bars", extra={"symbols": len(symbols), "count": fetched})
        session.flush()
        return fetched
