"""Fan-out of Postgres NOTIFY events to SSE subscribers.

The LISTEN connection is a plain (synchronous) psycopg connection on a daemon thread.
psycopg's async connections cannot run on Windows' default ProactorEventLoop, and a thread
works the same on every OS. Events are handed to the event loop with
``call_soon_threadsafe``.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import threading
from typing import Any

import psycopg

from dipbuyer.persistence.db import EVENTS_CHANNEL

log = logging.getLogger(__name__)

POLL_SECONDS = 1.0


class EventBus:
    def __init__(self) -> None:
        self._subscribers: set[asyncio.Queue[dict[str, Any]]] = set()
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self._loop: asyncio.AbstractEventLoop | None = None

    def subscribe(self) -> asyncio.Queue[dict[str, Any]]:
        q: asyncio.Queue[dict[str, Any]] = asyncio.Queue(maxsize=200)
        self._subscribers.add(q)
        return q

    def unsubscribe(self, q: asyncio.Queue[dict[str, Any]]) -> None:
        self._subscribers.discard(q)

    def publish(self, event: dict[str, Any]) -> None:
        """Deliver to all subscribers. Must run on the event loop thread."""
        for q in list(self._subscribers):
            with contextlib.suppress(asyncio.QueueFull):
                q.put_nowait(event)

    def start(self, dsn: str) -> None:
        """Start listening. Call from the event loop (e.g. the app lifespan)."""
        self._loop = asyncio.get_running_loop()
        self._stop.clear()
        self._thread = threading.Thread(
            target=self._listen, args=(dsn,), name="pg-listen", daemon=True
        )
        self._thread.start()

    async def stop(self) -> None:
        self._stop.set()
        if self._thread is not None:
            await asyncio.to_thread(self._thread.join, POLL_SECONDS * 5)
            self._thread = None

    def _dispatch(self, payload: str) -> None:
        try:
            event = json.loads(payload)
        except json.JSONDecodeError:
            log.warning("bad event payload")
            return
        loop = self._loop
        if loop is not None and not loop.is_closed():
            loop.call_soon_threadsafe(self.publish, event)

    def _listen(self, dsn: str) -> None:
        delay = 1.0
        while not self._stop.is_set():
            try:
                with psycopg.connect(dsn, autocommit=True) as conn:
                    conn.execute(f"LISTEN {EVENTS_CHANNEL}")
                    delay = 1.0
                    while not self._stop.is_set():
                        for n in conn.notifies(timeout=POLL_SECONDS):
                            self._dispatch(n.payload)
            except Exception as exc:
                log.warning("event listener error; reconnecting", extra={"error": str(exc)})
                self._stop.wait(delay)
                delay = min(delay * 2, 30.0)


def psycopg_dsn(sqlalchemy_url: str) -> str:
    return sqlalchemy_url.replace("postgresql+psycopg://", "postgresql://", 1)
