"""NYSE session calendar (holidays and early closes) via pandas_market_calendars."""

from __future__ import annotations

import datetime as dt
from dataclasses import dataclass
from functools import lru_cache
from zoneinfo import ZoneInfo

import pandas as pd
import pandas_market_calendars as mcal

NY = ZoneInfo("America/New_York")


@dataclass(frozen=True)
class SessionTimes:
    date: dt.date
    open: dt.datetime  # UTC
    close: dt.datetime  # UTC (early closes respected)


@lru_cache(maxsize=8)
def _schedule(year: int) -> dict[dt.date, SessionTimes]:
    cal = mcal.get_calendar("XNYS")
    sched = cal.schedule(start_date=f"{year - 1}-12-01", end_date=f"{year + 1}-01-31")
    out: dict[dt.date, SessionTimes] = {}
    for idx, row in sched.iterrows():
        day = pd.Timestamp(str(idx)).date()
        out[day] = SessionTimes(
            date=day,
            open=pd.Timestamp(row["market_open"]).to_pydatetime(),
            close=pd.Timestamp(row["market_close"]).to_pydatetime(),
        )
    return out


def ny_date(ts: dt.datetime) -> dt.date:
    return ts.astimezone(NY).date()


def session_for(day: dt.date) -> SessionTimes | None:
    return _schedule(day.year).get(day)


def is_trading_day(day: dt.date) -> bool:
    return session_for(day) is not None


def previous_session(day: dt.date) -> dt.date:
    """The last trading session strictly before ``day``."""
    d = day - dt.timedelta(days=1)
    for _ in range(30):
        if is_trading_day(d):
            return d
        d -= dt.timedelta(days=1)
    raise RuntimeError(f"no session found before {day}")


def sessions_between(start: dt.date, end: dt.date) -> list[dt.date]:
    """Trading sessions in the inclusive range [start, end]."""
    if end < start:
        return []
    out: list[dt.date] = []
    for year in range(start.year, end.year + 1):
        out.extend(d for d in _schedule(year) if start <= d <= end and d.year == year)
    return sorted(set(out))


def sessions_since(ts: dt.datetime, now: dt.datetime) -> int:
    """Number of sessions completed after ``ts`` up to ``now`` (both UTC).

    Sessions are counted by NY date: sessions strictly after ts's NY date whose close is
    at or before ``now``.
    """
    start = ny_date(ts) + dt.timedelta(days=1)
    end = ny_date(now)
    count = 0
    for d in sessions_between(start, end):
        s = session_for(d)
        if s is not None and s.close <= now:
            count += 1
    return count


@dataclass(frozen=True)
class MarketState:
    session: SessionTimes | None
    is_open: bool
    in_exclusion_window: bool


def market_state(now: dt.datetime, open_excl_min: int, close_excl_min: int) -> MarketState:
    s = session_for(ny_date(now))
    if s is None or not (s.open <= now < s.close):
        return MarketState(session=s, is_open=False, in_exclusion_window=False)
    excl = now < s.open + dt.timedelta(minutes=open_excl_min) or now >= s.close - dt.timedelta(
        minutes=close_excl_min
    )
    return MarketState(session=s, is_open=True, in_exclusion_window=excl)


def ny_day_bounds(now: dt.datetime) -> tuple[dt.datetime, dt.datetime]:
    day = ny_date(now)
    start = dt.datetime.combine(day, dt.time(), tzinfo=NY)
    return start.astimezone(dt.UTC), (start + dt.timedelta(days=1)).astimezone(dt.UTC)


def ny_week_bounds(now: dt.datetime) -> tuple[dt.datetime, dt.datetime]:
    day = ny_date(now)
    monday = day - dt.timedelta(days=day.isoweekday() - 1)
    start = dt.datetime.combine(monday, dt.time(), tzinfo=NY)
    return start.astimezone(dt.UTC), (start + dt.timedelta(days=7)).astimezone(dt.UTC)
