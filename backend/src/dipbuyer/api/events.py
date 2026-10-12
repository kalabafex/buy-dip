"""Fan-out of Postgres NOTIFY events to SSE subscribers."""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
from typing import Any

import psycopg

from dipbuyer.persistence.db import EVENTS_CHANNEL

log = logging.getLogger(__name__)


class EventBus:
    def __init__(self) -> None:
        self._subscribers: set[asyncio.Queue[dict[str, Any]]] = set()
        self._task: asyncio.Task[None] | None = None

    def subscribe(self) -> asyncio.Queue[dict[str, Any]]:
        q: asyncio.Queue[dict[str, Any]] = asyncio.Queue(maxsize=200)
        self._subscribers.add(q)
        return q

    def unsubscribe(self, q: asyncio.Queue[dict[str, Any]]) -> None:
        self._subscribers.discard(q)

    def publish(self, event: dict[str, Any]) -> None:
        for q in list(self._subscribers):
            with contextlib.suppress(asyncio.QueueFull):
                q.put_nowait(event)

    def start(self, dsn: str) -> None:
        self._task = asyncio.create_task(self._listen(dsn))

    async def stop(self) -> None:
        if self._task is not None:
            self._task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._task

    async def _listen(self, dsn: str) -> None:
        delay = 1.0
        while True:
            try:
                async with await psycopg.AsyncConnection.connect(dsn, autocommit=True) as conn:
                    await conn.execute(f"LISTEN {EVENTS_CHANNEL}")
                    delay = 1.0
                    async for n in conn.notifies():
                        try:
                            self.publish(json.loads(n.payload))
                        except json.JSONDecodeError:
                            log.warning("bad event payload")
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                log.warning("event listener error; reconnecting", extra={"error": str(exc)})
                await asyncio.sleep(delay)
                delay = min(delay * 2, 30.0)


def psycopg_dsn(sqlalchemy_url: str) -> str:
    return sqlalchemy_url.replace("postgresql+psycopg://", "postgresql://", 1)
