from __future__ import annotations

import datetime as dt

from dipbuyer.data.calendar import (
    market_state,
    ny_day_bounds,
    ny_week_bounds,
    previous_session,
    session_for,
    sessions_between,
    sessions_since,
)

UTC = dt.UTC


def test_holidays_and_early_close() -> None:
    assert session_for(dt.date(2025, 12, 25)) is None
    friday = session_for(dt.date(2025, 11, 28))  # day after Thanksgiving: 13:00 ET close
    assert friday is not None
    assert friday.close == dt.datetime(2025, 11, 28, 18, 0, tzinfo=UTC)
    assert previous_session(dt.date(2025, 12, 1)) == dt.date(2025, 11, 28)
    assert previous_session(dt.date(2025, 11, 28)) == dt.date(2025, 11, 26)


def test_sessions_between_spans_years() -> None:
    days = sessions_between(dt.date(2024, 12, 30), dt.date(2025, 1, 3))
    assert days == [
        dt.date(2024, 12, 30),
        dt.date(2024, 12, 31),
        dt.date(2025, 1, 2),
        dt.date(2025, 1, 3),
    ]


def test_sessions_since_counts_completed_sessions() -> None:
    fill = dt.datetime(2025, 11, 24, 15, tzinfo=UTC)
    # Tue 25, Wed 26, Fri 28 (early close) completed by Fri 19:00 UTC
    assert sessions_since(fill, dt.datetime(2025, 11, 28, 19, tzinfo=UTC)) == 3
    # Monday Dec 1 mid-session: Dec 1 not yet complete
    assert sessions_since(fill, dt.datetime(2025, 12, 1, 16, tzinfo=UTC)) == 3
    assert sessions_since(fill, dt.datetime(2025, 12, 1, 21, 1, tzinfo=UTC)) == 4


def test_market_state_and_exclusion_windows() -> None:
    day = dt.date(2025, 6, 10)
    s = session_for(day)
    assert s is not None
    assert not market_state(s.open - dt.timedelta(minutes=1), 15, 10).is_open
    st = market_state(s.open + dt.timedelta(minutes=14), 15, 10)
    assert st.is_open and st.in_exclusion_window
    st = market_state(s.open + dt.timedelta(minutes=15), 15, 10)
    assert st.is_open and not st.in_exclusion_window
    st = market_state(s.close - dt.timedelta(minutes=10), 15, 10)
    assert st.is_open and st.in_exclusion_window
    assert not market_state(s.close, 15, 10).is_open
    # early close: exclusion is relative to the 13:00 close
    ec = market_state(dt.datetime(2025, 11, 28, 17, 55, tzinfo=UTC), 15, 10)
    assert ec.is_open and ec.in_exclusion_window
    assert not market_state(dt.datetime(2025, 12, 25, 16, tzinfo=UTC), 15, 10).is_open


def test_ny_bounds() -> None:
    now = dt.datetime(2025, 6, 11, 2, 0, tzinfo=UTC)  # 22:00 ET on Tue Jun 10
    d0, d1 = ny_day_bounds(now)
    assert d0 == dt.datetime(2025, 6, 10, 4, tzinfo=UTC)
    assert d1 == dt.datetime(2025, 6, 11, 4, tzinfo=UTC)
    w0, w1 = ny_week_bounds(now)
    assert w0 == dt.datetime(2025, 6, 9, 4, tzinfo=UTC)  # Monday 00:00 ET
    assert w1 == dt.datetime(2025, 6, 16, 4, tzinfo=UTC)
