from __future__ import annotations

import asyncio

from sqlalchemy.orm import Session, sessionmaker

from dipbuyer.api.events import EventBus, psycopg_dsn
from dipbuyer.persistence.db import notify


def test_notify_reaches_sse_subscribers(sf: sessionmaker[Session], pg_url: str) -> None:
    async def scenario() -> dict[str, object]:
        bus = EventBus()
        q = bus.subscribe()
        bus.start(psycopg_dsn(pg_url))
        await asyncio.sleep(1.0)  # let LISTEN start
        with sf.begin() as s:
            notify(s, "order", {"id": "abc", "status": "FILLED"})
        try:
            return await asyncio.wait_for(q.get(), timeout=10)
        finally:
            await bus.stop()

    evt = asyncio.run(scenario())
    assert evt == {"event": "order", "data": {"id": "abc", "status": "FILLED"}}
