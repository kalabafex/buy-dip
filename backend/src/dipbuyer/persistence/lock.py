"""Postgres advisory lock for the single trading-loop runner."""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager

from sqlalchemy import Engine, text

TRADING_LOOP_LOCK_KEY = 0x0D1B_B0E5  # arbitrary, stable


@contextmanager
def try_advisory_lock(engine: Engine, key: int = TRADING_LOOP_LOCK_KEY) -> Iterator[bool]:
    """Yield True while holding a session-level advisory lock, False if it is taken.

    The lock lives on a dedicated connection that is held for the whole block, so it is
    released when the block exits or if the process dies (connection closes).
    """
    with engine.connect() as conn:
        got = bool(conn.execute(text("SELECT pg_try_advisory_lock(:k)"), {"k": key}).scalar())
        conn.commit()
        try:
            yield got
        finally:
            if got:
                conn.execute(text("SELECT pg_advisory_unlock(:k)"), {"k": key})
                conn.commit()
