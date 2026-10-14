from __future__ import annotations

import datetime as dt
from collections.abc import Iterator
from decimal import Decimal as D
from pathlib import Path

import pytest
from sqlalchemy import Engine, select
from sqlalchemy.orm import Session, sessionmaker

from dipbuyer.alerts import RecordingNotifier
from dipbuyer.broker import FakeBroker
from dipbuyer.data.bars import BarService
from dipbuyer.data.market_data import FakeMarketData
from dipbuyer.domain.models import Bar
from dipbuyer.persistence.models import DailyPickRow, PickModelRow
from dipbuyer.picks import universe as universe_mod
from dipbuyer.worker.picks_trader import PicksTrader
from tests.integration.conftest import set_settings
from tests.picks_helpers import gap_down_snapshot, gap_reversal_universe

TODAY = dt.date(2025, 6, 10)
PREV = dt.date(2025, 6, 9)
UTC = dt.UTC
SYMS = [f"S{i}" for i in range(24)]


class Clock:
    def __init__(self) -> None:
        self.now = dt.datetime(2025, 6, 10, 12, 0, tzinfo=UTC)

    def __call__(self) -> dt.datetime:
        return self.now


@pytest.fixture
def small_universe(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    csv = tmp_path / "u.csv"
    csv.write_text("symbol,name,sector\n" + "".join(f"{s},{s} Corp,Tech\n" for s in SYMS))
    monkeypatch.setenv("UNIVERSE_CSV", str(csv))
    universe_mod.load_universe.cache_clear()
    yield
    universe_mod.load_universe.cache_clear()


class Env:
    def __init__(self, sf: sessionmaker[Session], engine: Engine) -> None:
        self.sf = sf
        self.clock = Clock()
        self.md = FakeMarketData()
        self.history = gap_reversal_universe(SYMS, PREV)
        self.md.add_bars([b for bars in self.history.values() for b in bars])
        self.md.snapshots = {s: gap_down_snapshot(bars, TODAY) for s, bars in self.history.items()}
        self.broker = FakeBroker(cash=D(100_000), now=self.clock.now)
        self.notifier = RecordingNotifier()
        svc = BarService(self.md)
        self.trader = PicksTrader(
            session_factory=sf,
            db_engine=engine,
            broker_factory=lambda _m: self.broker,
            market_data_factory=lambda _m: self.md,
            bar_service_factory=lambda _m: svc,
            notifier=self.notifier,
            now=self.clock,
        )

    def at(self, hh: int, mm: int) -> str:
        self.clock.now = dt.datetime(2025, 6, 10, hh, mm, tzinfo=UTC)
        return self.trader.tick()

    def picks(self) -> list[DailyPickRow]:
        with self.sf() as s:
            return list(s.scalars(select(DailyPickRow).order_by(DailyPickRow.rank)))

    def calibrate(self, *, with_exits: bool = True) -> None:
        assert self.trader.run_calibrations() == 1
        with self.sf.begin() as s:
            model = s.scalars(select(PickModelRow)).one()
            assert model.status == "DONE", model.error
            if with_exits:  # force a target/stop so bracket legs are exercised
                summary = dict(model.summary or {})
                fams = dict(summary["families"])
                g = dict(fams["GAP_DOWN_REVERSAL"])
                g["exit"] = {"key": "t0.5-s0.5", "target_atr": 0.5, "stop_atr": 0.5}
                fams["GAP_DOWN_REVERSAL"] = g
                summary["families"] = fams
                model.summary = summary


@pytest.fixture
def env(sf: sessionmaker[Session], db_engine: Engine, small_universe: None) -> Env:
    return Env(sf, db_engine)


def add_today_bars(env: Env) -> None:
    bars = []
    for s, snap in env.md.snapshots.items():
        o = snap.open
        bars.append(
            Bar(
                symbol=s,
                session_date=TODAY,
                open=o,
                high=o * D("1.03"),
                low=o * D("0.995"),
                close=o * D("1.02"),
                volume=D(1),
            )
        )
    env.md.add_bars(bars)


def test_full_trading_day(env: Env) -> None:
    env.calibrate()
    set_settings(env.sf, picks_autotrade=True, picks_notional_usd=D(1000))
    assert env.at(13, 34) == "ran"  # before entry time: prefetch only
    assert env.picks() == []
    env.at(13, 36)  # 9:36 ET
    picks = env.picks()
    assert len(picks) == 5
    assert [p.rank for p in picks] == [1, 2, 3, 4, 5]
    assert all(p.status == "SUBMITTED" for p in picks), [(p.status, p.skip_reason) for p in picks]
    p1 = picks[0]
    assert p1.entry_time == dt.datetime(2025, 6, 10, 13, 35, tzinfo=UTC)
    assert p1.exit_time == dt.datetime(2025, 6, 10, 19, 55, tzinfo=UTC)
    assert p1.target_price is not None and p1.stop_price is not None
    assert p1.stop_price < p1.open_price < p1.entry_limit < p1.target_price
    assert p1.qty == int(D(1000) / p1.entry_limit)
    assert len(env.broker.brackets) == 5
    assert any(t.startswith("Daily picks") for t, _, _ in env.notifier.sent)

    # fills: 1 -> target, 2 -> stop, 3 and 4 held, 5 never fills
    for p in picks[:4]:
        env.broker.fill(str(p.id), p.entry_limit)
    env.broker.hit_exit(str(picks[0].id), "TARGET")
    env.broker.hit_exit(str(picks[1].id), "STOP")
    env.at(13, 40)
    by_rank = {p.rank: p for p in env.picks()}
    assert by_rank[1].status == "EXITED" and by_rank[1].exit_reason == "TARGET"
    assert by_rank[1].realized_return is not None and by_rank[1].realized_return > 0
    assert by_rank[2].status == "EXITED" and by_rank[2].exit_reason == "STOP"
    assert by_rank[2].realized_pnl_usd is not None and by_rank[2].realized_pnl_usd < 0
    assert by_rank[3].status == "ENTERED" and by_rank[5].status == "SUBMITTED"

    for p in picks[2:4]:
        env.broker.marks[p.symbol] = p.entry_limit * D("1.01")
    env.at(19, 56)  # forced exit at 15:56 ET
    by_rank = {p.rank: p for p in env.picks()}
    assert by_rank[3].status == "EXITED" and by_rank[3].exit_reason == "TIME"
    assert by_rank[3].realized_return == D("0.01")
    assert by_rank[5].status == "NOT_FILLED"
    # broker holds nothing from the picks any more
    assert all(h.qty == 0 for h in env.broker.holdings.values())

    add_today_bars(env)
    env.at(20, 20)  # after close: evaluate the plans
    for p in env.picks():
        assert p.plan_return is not None and p.plan_exit_reason in {"TARGET", "STOP", "TIME"}
        assert p.day_close is not None
    assert any(t.startswith("Daily picks results") for t, _, _ in env.notifier.sent)


def test_autotrade_off_shows_picks_without_trading(env: Env) -> None:
    env.calibrate()
    env.at(13, 36)
    assert [p.status for p in env.picks()] == ["PLANNED"] * 5
    assert env.broker.brackets == {}
    env.at(19, 56)
    assert {p.status for p in env.picks()} == {"NOT_TRADED"}


def test_live_mode_never_trades_picks(env: Env) -> None:
    env.calibrate()
    set_settings(env.sf, picks_autotrade=True, trading_mode="LIVE")
    env.at(13, 36)
    assert env.broker.brackets == {}
    assert len(env.picks()) == 5


def test_kill_switch_blocks_pick_entries(env: Env) -> None:
    env.calibrate()
    set_settings(env.sf, picks_autotrade=True, kill_switch=True)
    env.at(13, 36)
    assert env.broker.brackets == {}


def test_no_picks_without_model_and_after_late_cutoff(env: Env) -> None:
    assert env.at(13, 36) == "no_model"
    env.calibrate()
    env.at(19, 30)  # too late to publish new picks
    assert env.picks() == []


def test_expensive_stock_is_watch_only(env: Env) -> None:
    env.calibrate()
    set_settings(env.sf, picks_autotrade=True, picks_notional_usd=D(10))
    env.at(13, 36)
    picks = env.picks()
    assert {p.status for p in picks} == {"WATCH"}
    assert all("per-pick budget" in (p.skip_reason or "") for p in picks)


def test_picks_api(env: Env, sf: sessionmaker[Session]) -> None:
    import pyotp
    from fastapi.testclient import TestClient

    from dipbuyer.api.app import create_app
    from dipbuyer.api.deps import AppDeps
    from tests.integration.test_api import PASSWORD, make_env

    env.calibrate()
    set_settings(env.sf, picks_autotrade=True)
    env.at(13, 36)
    for p in env.picks():
        env.broker.fill(str(p.id), p.entry_limit)
    env.broker.hit_exit(str(env.picks()[0].id), "TARGET")
    env.at(13, 40)
    add_today_bars(env)
    env.at(20, 20)

    app_env = make_env()
    deps = AppDeps(
        env=app_env,
        session_factory=sf,
        asset_lookup=lambda *_: None,  # type: ignore[arg-type]
        bar_service=lambda _m: None,  # type: ignore[arg-type,return-value]
        notifier=RecordingNotifier(),
        enable_listener=False,
        now=lambda: dt.datetime(2025, 6, 10, 20, 30, tzinfo=UTC),
    )
    with TestClient(create_app(deps)) as c:
        code = pyotp.TOTP(app_env.app_totp_secret.get_secret_value()).now()
        c.post("/api/auth/login", json={"username": "admin", "password": PASSWORD, "totp": code})
        day = c.get("/api/picks/day").json()
        assert day["session_date"] == "2025-06-10" and day["generated"]
        assert day["entry_time"].startswith("2025-06-10T13:35")
        assert len(day["picks"]) == 5 and day["model"]["status"] == "DONE"
        p = day["picks"][0]
        assert p["family_label"] == "Gap-down reversal"
        assert p["status"] == "EXITED" and p["exit_reason"] == "TARGET"
        assert D(p["realized_return_pct"]) > 0 and D(p["plan_return_pct"]) != 0
        assert D(p["target_pct"]) > 0 > D(p["stop_pct"])
        assert day["realized_pnl_usd"] is not None
        days = c.get("/api/picks/days").json()
        assert days[0]["picks"] == 5 and days[0]["traded"] == 5
        perf = c.get("/api/picks/performance").json()
        assert perf["days"] == 1 and perf["plan_evaluated"] == 5
        assert "GAP_DOWN_REVERSAL" in perf["by_family"]
        model = c.get("/api/picks/model").json()
        assert any(f["accepted"] for f in model["families"])
        s = c.get("/api/picks/settings").json()
        assert s["autotrade"] is True
        r = c.put(
            "/api/picks/settings",
            json={"autotrade": False, "notional_usd": 500, "min_expected_pct": 0.1},
        )
        assert r.status_code == 200 and D(r.json()["notional_usd"]) == 500
        assert c.post("/api/picks/model/calibrate").status_code == 201
        set_settings(sf, trading_mode="LIVE")
        r = c.put(
            "/api/picks/settings",
            json={"autotrade": True, "notional_usd": 500, "min_expected_pct": 0.1},
        )
        assert r.status_code == 409
