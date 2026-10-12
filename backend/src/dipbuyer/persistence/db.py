from __future__ import annotations

import json
from collections.abc import Iterator
from contextlib import contextmanager
from functools import lru_cache
from typing import Any

from sqlalchemy import Engine, create_engine, text
from sqlalchemy.orm import Session, sessionmaker

from dipbuyer.config import get_settings

EVENTS_CHANNEL = "dipbuyer_events"


@lru_cache
def get_engine(url: str | None = None) -> Engine:
    return create_engine(url or get_settings().database_url, pool_pre_ping=True)


def make_session_factory(engine: Engine) -> sessionmaker[Session]:
    return sessionmaker(engine, expire_on_commit=False)


@contextmanager
def session_scope(factory: sessionmaker[Session]) -> Iterator[Session]:
    session = factory()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def notify(session: Session, event: str, payload: dict[str, Any]) -> None:
    """Publish an event to API SSE subscribers via Postgres NOTIFY (sent on commit)."""
    body = json.dumps({"event": event, "data": payload}, default=str)
    session.execute(text("SELECT pg_notify(:ch, :body)"), {"ch": EVENTS_CHANNEL, "body": body})
