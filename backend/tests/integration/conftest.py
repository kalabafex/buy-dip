from __future__ import annotations

import datetime as dt
import os
import shutil
import uuid
from collections.abc import Iterator
from dataclasses import dataclass
from decimal import Decimal as D

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import Engine, create_engine, text
from sqlalchemy.orm import Session, sessionmaker

from dipbuyer.alerts import RecordingNotifier
from dipbuyer.broker import FakeBroker
from dipbuyer.data.bars import BarService
from dipbuyer.data.market_data import FakeMarketData
from dipbuyer.domain.models import RuleParams
from dipbuyer.persistence import repo
from dipbuyer.persistence.models import RuleRow
from dipbuyer.worker.loop import TradingLoop
from tests.helpers import make_bars, rule

BACKEND = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
# Tuesday 2025-06-10 11:00 New York: market open, outside exclusion windows.
NOW = dt.datetime(2025, 6, 10, 15, 0, tzinfo=dt.UTC)
PREV_SESSION = dt.date(2025, 6, 9)

pytestmark = pytest.mark.integration


def _docker_available() -> bool:
    """True if a Docker daemon answers (Unix socket, Windows named pipe or DOCKER_HOST)."""
    if shutil.which("docker") is None:
        return False
    try:
        import docker  # installed with testcontainers

        docker.from_env().ping()
    except Exception:
        return False
    return True


@pytest.fixture(scope="session")
def pg_url() -> Iterator[str]:
    url = os.environ.get("TEST_DATABASE_URL")
    if url:
        yield url
        return
    if not _docker_available():
        pytest.skip("Docker not available and TEST_DATABASE_URL not set")
    os.environ.setdefault("TESTCONTAINERS_RYUK_DISABLED", "true")
    from testcontainers.postgres import PostgresContainer

    image = os.environ.get("TEST_POSTGRES_IMAGE", "postgres:16-alpine")
    with PostgresContainer(image, driver="psycopg") as pg:
        yield pg.get_connection_url()


@pytest.fixture(scope="session")
def db_engine(pg_url: str) -> Iterator[Engine]:
    cfg = Config(os.path.join(BACKEND, "alembic.ini"))
    cfg.attributes["database_url"] = pg_url
    command.upgrade(cfg, "head")
    engine = create_engine(pg_url)
    yield engine
    engine.dispose()


TABLES = (
    "engine_versions, engine_reviews, pick_candidates, daily_picks, pick_models, "
    "recommendations, "
    "position_snapshots, account_snapshots, evaluations, order_intents, dip_cycles, "
    "backtests, bars_daily, audit_log, rules"
)


@pytest.fixture
def sf(db_engine: Engine) -> Iterator[sessionmaker[Session]]:
    with db_engine.begin() as conn:
        conn.execute(text(f"TRUNCATE {TABLES} RESTART IDENTITY CASCADE"))
        conn.execute(
            text(
                "UPDATE global_settings SET trading_mode='PAPER', kill_switch=false, "
                "kill_switch_cancel_pending=false, max_daily_spend_usd=500, "
                "picks_autotrade=false, picks_notional_usd=1000, picks_min_expected_pct=0.05, "
                "max_weekly_spend_usd=1500, evaluation_interval_minutes=5, "
                "open_exclusion_minutes=15, close_exclusion_minutes=10"
            )
        )
        conn.execute(
            text(
                "INSERT INTO engine_versions (version, params, created_at) VALUES (1, "
                '\'{"version": 1, "family_multiplier": {}, "suspended": [], '
                '"certainty_a": 1.0, "certainty_b": 0.0}\'::jsonb, now())'
            )
        )
        conn.execute(
            text(
                "UPDATE worker_status SET last_tick_at=NULL, last_heartbeat_at=NULL, "
                "last_summary_date=NULL"
            )
        )
    yield sessionmaker(db_engine, expire_on_commit=False)


def add_rule(sf: sessionmaker[Session], params: RuleParams | None = None) -> uuid.UUID:
    with sf.begin() as s:
        row = RuleRow(id=uuid.uuid4())
        repo.apply_params(row, params or rule(symbol="SPY", max_position_usd=D(2000)))
        s.add(row)
        return row.id


def set_settings(sf: sessionmaker[Session], **kw: object) -> None:
    with sf.begin() as s:
        row = repo.get_settings_row(s)
        for k, v in kw.items():
            setattr(row, k, v)


@dataclass
class Clock:
    now: dt.datetime = NOW

    def __call__(self) -> dt.datetime:
        return self.now

    def advance(self, minutes: int) -> None:
        self.now += dt.timedelta(minutes=minutes)


@dataclass
class World:
    sf: sessionmaker[Session]
    engine: Engine
    broker: FakeBroker
    md: FakeMarketData
    notifier: RecordingNotifier
    clock: Clock

    def loop(self, *, dry_run: bool = False, broker: FakeBroker | None = None) -> TradingLoop:
        b = broker or self.broker
        svc = BarService(self.md)
        return TradingLoop(
            session_factory=self.sf,
            db_engine=self.engine,
            broker_factory=lambda _mode: b,
            bar_service_factory=lambda _mode: svc,
            notifier=self.notifier,
            now=self.clock,
            dry_run=dry_run,
        )


def dip_market(md: FakeMarketData, symbol: str = "SPY", last: str = "94") -> None:
    """220 sessions at 100 ending on the previous session; latest trade ``last``."""
    md.add_bars(make_bars(symbol, ["100"] * 220, PREV_SESSION))
    md.last[symbol] = D(last)


@pytest.fixture
def world(sf: sessionmaker[Session], db_engine: Engine) -> World:
    broker = FakeBroker(cash=D(10_000), now=NOW)
    md = FakeMarketData()
    dip_market(md)
    return World(sf, db_engine, broker, md, RecordingNotifier(), Clock())
