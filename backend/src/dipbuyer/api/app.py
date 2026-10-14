from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import APIRouter, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.sessions import SessionMiddleware

from dipbuyer.alerts import make_notifier
from dipbuyer.api.deps import AppDeps
from dipbuyer.api.events import EventBus, psycopg_dsn
from dipbuyer.api.routers import (
    activity,
    auth,
    backtests,
    picks,
    recommendations,
    rules,
    settings,
    system,
)
from dipbuyer.api.security import RateLimiter, TotpVerifier
from dipbuyer.broker.alpaca import AlpacaBroker
from dipbuyer.config import Settings, get_settings
from dipbuyer.data.bars import BarService
from dipbuyer.data.market_data import AlpacaMarketData
from dipbuyer.domain.enums import TradingMode
from dipbuyer.domain.models import AssetInfo
from dipbuyer.logging_setup import setup_logging
from dipbuyer.persistence.db import get_engine, make_session_factory

log = logging.getLogger(__name__)


def build_default_deps(env: Settings) -> AppDeps:
    """Production wiring. The API only *reads* from Alpaca (asset lookup, market data)."""
    brokers: dict[TradingMode, AlpacaBroker] = {}

    def asset_lookup(symbol: str, mode: TradingMode) -> AssetInfo | None:
        if mode not in brokers:
            key, secret = env.alpaca_keys(mode)
            brokers[mode] = AlpacaBroker(key, secret, mode)
        return brokers[mode].get_asset(symbol)

    services: dict[TradingMode, BarService] = {}

    def bar_service(mode: TradingMode) -> BarService:
        if mode not in services:
            key, secret = env.alpaca_keys(mode)
            services[mode] = BarService(AlpacaMarketData(key, secret, env.alpaca_data_feed))
        return services[mode]

    return AppDeps(
        env=env,
        session_factory=make_session_factory(get_engine(env.database_url)),
        asset_lookup=asset_lookup,
        bar_service=bar_service,
        notifier=make_notifier(env.ntfy_topic_url),
    )


def create_app(deps: AppDeps | None = None) -> FastAPI:
    if deps is None:
        env = get_settings()
        setup_logging(
            env.log_level,
            secrets=[
                env.alpaca_paper_secret.get_secret_value(),
                env.alpaca_live_secret.get_secret_value(),
                env.session_secret.get_secret_value(),
                env.app_totp_secret.get_secret_value(),
            ],
        )
        deps = build_default_deps(env)
    env = deps.env
    secret = env.session_secret.get_secret_value()
    if len(secret) < 32:
        raise RuntimeError("SESSION_SECRET must be set (at least 32 characters)")
    bus = EventBus()

    @asynccontextmanager
    async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
        if deps.enable_listener:
            bus.start(psycopg_dsn(env.database_url))
        yield
        await bus.stop()

    app = FastAPI(
        title="Dip Buyer",
        version="0.1.0",
        lifespan=lifespan,
        docs_url="/api/docs",
        openapi_url="/api/openapi.json",
        redoc_url=None,
    )
    app.state.deps = deps
    app.state.event_bus = bus
    app.state.auth_limiter = RateLimiter(max_requests=10, window_seconds=60)
    app.state.totp = TotpVerifier(env.app_totp_secret.get_secret_value())
    app.add_middleware(
        SessionMiddleware,
        secret_key=secret,
        session_cookie="dipbuyer_session",
        max_age=12 * 3600,
        same_site="strict",
        https_only=env.session_cookie_secure,
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[env.cors_origin],
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
        allow_headers=["Content-Type"],
    )
    api = APIRouter(prefix="/api")
    for r in (auth, system, rules, settings, activity, backtests, recommendations, picks):
        api.include_router(r.router)
    app.include_router(api)
    return app
