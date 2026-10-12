from __future__ import annotations

import datetime as dt
import time
from collections.abc import Callable, Iterator
from dataclasses import dataclass, field
from typing import Annotated

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy.orm import Session, sessionmaker

from dipbuyer.alerts import Notifier
from dipbuyer.config import Settings
from dipbuyer.data.bars import BarService
from dipbuyer.domain.enums import TradingMode
from dipbuyer.domain.models import AssetInfo

ELEVATION_SECONDS = 300


@dataclass
class AppDeps:
    env: Settings
    session_factory: sessionmaker[Session]
    asset_lookup: Callable[[str, TradingMode], AssetInfo | None]
    bar_service: Callable[[TradingMode], BarService]
    notifier: Notifier
    enable_listener: bool = True
    now: Callable[[], dt.datetime] = field(default=lambda: dt.datetime.now(dt.UTC))


def get_deps(request: Request) -> AppDeps:
    deps: AppDeps = request.app.state.deps
    return deps


DepsDep = Annotated[AppDeps, Depends(get_deps)]


def get_db(deps: DepsDep) -> Iterator[Session]:
    session = deps.session_factory()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


DbDep = Annotated[Session, Depends(get_db)]


def require_user(request: Request) -> str:
    user = request.session.get("user")
    if not isinstance(user, str):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "not authenticated")
    return user


UserDep = Annotated[str, Depends(require_user)]


def is_elevated(request: Request) -> bool:
    until = request.session.get("elevated_until")
    return isinstance(until, (int, float)) and until > time.time()


def require_elevated(request: Request, _user: UserDep) -> None:
    if not is_elevated(request):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "re-authentication required")


ElevatedDep = Annotated[None, Depends(require_elevated)]
