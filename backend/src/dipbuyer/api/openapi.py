"""Export the OpenAPI schema without a database or secrets (for ``just gen-api``)."""

from __future__ import annotations

from typing import Any

from pydantic import SecretStr
from sqlalchemy.orm import sessionmaker

from dipbuyer.alerts import NullNotifier
from dipbuyer.api.app import create_app
from dipbuyer.api.deps import AppDeps
from dipbuyer.config import Settings


def _unavailable(*_args: object) -> Any:
    raise RuntimeError("not available during schema export")


def export_openapi() -> dict[str, Any]:
    deps = AppDeps(
        env=Settings(session_secret=SecretStr("x" * 32)),
        session_factory=sessionmaker(),
        asset_lookup=_unavailable,
        bar_service=_unavailable,
        notifier=NullNotifier(),
        enable_listener=False,
    )
    return create_app(deps).openapi()
