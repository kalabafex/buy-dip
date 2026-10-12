from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator

from fastapi import APIRouter, Request
from sqlalchemy import text
from sse_starlette import EventSourceResponse, ServerSentEvent

from dipbuyer.api.deps import DepsDep, UserDep
from dipbuyer.api.events import EventBus
from dipbuyer.api.schemas import HealthOut
from dipbuyer.persistence import repo

router = APIRouter(tags=["system"])


@router.get("/health", response_model=HealthOut)
def health(deps: DepsDep) -> HealthOut:
    try:
        with deps.session_factory() as s:
            s.execute(text("SELECT 1"))
            status = repo.get_worker_status(s)
            hb, tick = status.last_heartbeat_at, status.last_tick_at
            s.commit()
        return HealthOut(status="ok", db=True, last_heartbeat_at=hb, last_tick_at=tick)
    except Exception:
        return HealthOut(status="degraded", db=False, last_heartbeat_at=None, last_tick_at=None)


@router.get("/stream")
async def stream(request: Request, _: UserDep) -> EventSourceResponse:
    bus: EventBus = request.app.state.event_bus
    queue = bus.subscribe()

    async def gen() -> AsyncIterator[ServerSentEvent]:
        try:
            yield ServerSentEvent(event="hello", data="{}")
            while True:
                try:
                    evt = await asyncio.wait_for(queue.get(), timeout=15)
                except TimeoutError:
                    if await request.is_disconnected():
                        break
                    continue
                yield ServerSentEvent(
                    event=str(evt.get("event", "message")), data=json.dumps(evt.get("data", {}))
                )
        finally:
            bus.unsubscribe(queue)

    return EventSourceResponse(gen(), ping=15)
