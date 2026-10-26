from __future__ import annotations

import datetime as dt
import uuid
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
from dipbuyer.persistence.models import (
    DailyPickRow,
    EngineReviewRow,
    EngineVersionRow,
    PickCandidateRow,
    PickModelRow,
)
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
    assert len(picks) == 3
    assert [p.rank for p in picks] == [1, 2, 3]
    assert all(p.status == "SUBMITTED" for p in picks), [(p.status, p.skip_reason) for p in picks]
    p1 = picks[0]
    assert p1.entry_time == dt.datetime(2025, 6, 10, 13, 35, tzinfo=UTC)
    assert p1.exit_time == dt.datetime(2025, 6, 10, 19, 55, tzinfo=UTC)
    assert p1.target_price is not None and p1.stop_price is not None
    assert p1.stop_price < p1.open_price < p1.entry_limit < p1.target_price
    assert p1.qty == int(D(1000) / p1.entry_limit)
    # engine outputs and the saved explanation
    assert p1.certainty is not None and D(0) < p1.certainty < D(1)
    assert p1.projected_low is not None and p1.projected_high is not None
    assert p1.projected_low <= p1.expected_return <= p1.projected_high
    assert p1.engine_version == 1
    assert p1.reasons and p1.reasons[0]["kind"] == "setup"
    assert {r["kind"] for r in p1.reasons} >= {"setup_history", "stock_history", "certainty"}
    with env.sf() as s:
        cands = list(s.scalars(select(PickCandidateRow).order_by(PickCandidateRow.score_rank)))
    assert len(cands) > 3 and sum(c.chosen for c in cands) == 3
    assert {c.symbol for c in cands if c.chosen} == {p.symbol for p in picks}
    assert len(env.broker.brackets) == 3
    assert any(t.startswith("Daily picks") for t, _, _ in env.notifier.sent)

    # fills: 1 -> target, 2 held to the forced exit, 3 never fills
    for p in picks[:2]:
        env.broker.fill(str(p.id), p.entry_limit)
    env.broker.hit_exit(str(picks[0].id), "TARGET")
    env.at(13, 40)
    by_rank = {p.rank: p for p in env.picks()}
    assert by_rank[1].status == "EXITED" and by_rank[1].exit_reason == "TARGET"
    assert by_rank[1].realized_return is not None and by_rank[1].realized_return > 0
    assert by_rank[2].status == "ENTERED" and by_rank[3].status == "SUBMITTED"

    env.broker.marks[picks[1].symbol] = picks[1].entry_limit * D("1.01")
    env.at(19, 56)  # forced exit at 15:56 ET
    by_rank = {p.rank: p for p in env.picks()}
    assert by_rank[2].status == "EXITED" and by_rank[2].exit_reason == "TIME"
    assert by_rank[2].realized_return == D("0.01")
    assert by_rank[3].status == "NOT_FILLED"
    assert all(h.qty == 0 for h in env.broker.holdings.values())

    add_today_bars(env)
    env.at(20, 20)  # after close: evaluate the plans and every candidate
    for p in env.picks():
        assert p.plan_return is not None and p.plan_exit_reason in {"TARGET", "STOP", "TIME"}
        assert p.day_close is not None
    with env.sf() as s:
        cands = list(s.scalars(select(PickCandidateRow)))
    assert all(c.plan_return is not None for c in cands)
    assert any(t.startswith("Daily picks results") for t, _, _ in env.notifier.sent)


def test_stop_exit(env: Env) -> None:
    env.calibrate()
    set_settings(env.sf, picks_autotrade=True)
    env.at(13, 36)
    p = env.picks()[0]
    env.broker.fill(str(p.id), p.entry_limit)
    env.broker.hit_exit(str(p.id), "STOP")
    env.at(13, 40)
    p = env.picks()[0]
    assert p.status == "EXITED" and p.exit_reason == "STOP"
    assert p.realized_pnl_usd is not None and p.realized_pnl_usd < 0


def test_weekly_review_creates_new_engine_version(env: Env) -> None:
    env.calibrate()
    env.at(13, 36)
    add_today_bars(env)
    env.at(20, 20)
    # Synthetic history of overconfident projections for the gap setup.
    with env.sf.begin() as s:
        for k in range(40):
            day = TODAY - dt.timedelta(days=1 + k)
            s.add(
                PickCandidateRow(
                    id=uuid.uuid4(),
                    session_date=day,
                    score_rank=1,
                    symbol=f"Z{k}",
                    family="GAP_DOWN_REVERSAL",
                    chosen=k % 5 == 0,
                    eligible=True,
                    engine_version=1,
                    open_price=D(100),
                    target_price=None,
                    stop_price=None,
                    projected_return=D("0.004"),
                    projected_low=D("0"),
                    projected_high=D("0.01"),
                    certainty=D("0.6"),
                    raw_certainty=D("0.6"),
                    multiplier=D(1),
                    features={},
                    reasons=[],
                    plan_return=D("0.0005") if k % 3 else D("-0.001"),
                    plan_exit_reason="TIME",
                )
            )
    # Not a weekend yet: nothing happens. Saturday morning: the review runs once.
    assert env.trader.run_weekly_review() is False
    env.clock.now = dt.datetime(2025, 6, 14, 14, 0, tzinfo=UTC)
    assert env.trader.run_weekly_review() is True
    assert env.trader.run_weekly_review() is False
    with env.sf() as s:
        rev = s.scalars(select(EngineReviewRow)).one()
        versions = [v.version for v in s.scalars(select(EngineVersionRow))]
    assert rev.version_before == 1 and rev.version_after == 2 and sorted(versions) == [1, 2]
    assert any(c["family"] == "GAP_DOWN_REVERSAL" for c in rev.report["changes"])
    assert any(t.startswith("Engine review v2") for t, _, _ in env.notifier.sent)
    # the next day's picks use the tuned engine
    with env.sf() as s:
        from dipbuyer.worker.picks_trader import active_engine

        params = active_engine(s)
    assert params.version == 2 and params.multiplier("GAP_DOWN_REVERSAL") < 1


def test_autotrade_off_shows_picks_without_trading(env: Env) -> None:
    env.calibrate()
    env.at(13, 36)
    assert [p.status for p in env.picks()] == ["PLANNED"] * 3
    assert env.broker.brackets == {}
    env.at(19, 56)
    assert {p.status for p in env.picks()} == {"NOT_TRADED"}


def test_live_mode_never_trades_picks(env: Env) -> None:
    env.calibrate()
    set_settings(env.sf, picks_autotrade=True, trading_mode="LIVE")
    env.at(13, 36)
    assert env.broker.brackets == {}
    assert len(env.picks()) == 3


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
        assert len(day["picks"]) == 3 and day["model"]["status"] == "DONE"
        p = day["picks"][0]
        assert p["family_label"] == "Gap-down reversal"
        assert p["status"] == "EXITED" and p["exit_reason"] == "TARGET"
        assert D(p["realized_return_pct"]) > 0 and D(p["plan_return_pct"]) != 0
        assert D(p["target_pct"]) > 0 > D(p["stop_pct"])
        assert 0 < D(p["certainty_pct"]) < 100
        assert D(p["projected_low_pct"]) <= D(p["projected_move_pct"]) <= D(p["projected_high_pct"])
        assert p["reasons"][0]["kind"] == "setup" and p["engine_version"] == 1
        cands = c.get("/api/picks/candidates").json()
        assert len(cands) > 3 and sum(x["chosen"] for x in cands) == 3
        assert all(x["plan_return_pct"] is not None for x in cands)
        eng = c.get("/api/picks/engine").json()
        assert eng["active"]["version"] == 1 and eng["reviews"] == []
        rev = c.post("/api/picks/engine/review")
        assert rev.status_code == 201, rev.text
        assert rev.json()["window_all"]["n"] == len(cands)
        assert len(c.get("/api/picks/engine").json()["reviews"]) == 1
        assert day["realized_pnl_usd"] is not None
        days = c.get("/api/picks/days").json()
        assert days[0]["picks"] == 3 and days[0]["traded"] == 3
        perf = c.get("/api/picks/performance").json()
        assert perf["days"] == 1 and perf["plan_evaluated"] == 3
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


def test_live_quotes_poll_and_api(env: Env, sf: sessionmaker[Session]) -> None:
    import pyotp
    from fastapi.testclient import TestClient

    from dipbuyer.api.app import create_app
    from dipbuyer.api.deps import AppDeps
    from dipbuyer.persistence.models import PickQuoteRow
    from tests.integration.test_api import PASSWORD, make_env

    env.calibrate()
    env.clock.now = dt.datetime(2025, 6, 10, 13, 0, tzinfo=UTC)
    assert env.trader.poll_quotes() == 0  # before the open: nothing
    env.at(13, 36)
    picked = {p.symbol for p in env.picks()}
    assert env.trader.poll_quotes() > 0  # picks + top runners-up
    assert env.trader.poll_quotes() == 0  # unchanged prices are not stored twice
    sym = sorted(picked)[0]
    snap = env.md.snapshots[sym]
    env.clock.now = dt.datetime(2025, 6, 10, 13, 37, tzinfo=UTC)
    env.md.snapshots[sym] = snap.model_copy(
        update={"last": snap.last * D("1.01"), "as_of": env.clock.now}
    )
    assert env.trader.poll_quotes() == 1
    with env.sf() as s:
        rows = list(s.scalars(select(PickQuoteRow).where(PickQuoteRow.symbol == sym)))
        n_symbols = len(set(s.scalars(select(PickQuoteRow.symbol))))
    assert len(rows) == 2
    assert len(picked) < n_symbols <= 13
    env.clock.now = dt.datetime(2025, 6, 10, 21, 0, tzinfo=UTC)
    assert env.trader.poll_quotes() == 0  # after the close

    app_env = make_env()
    deps = AppDeps(
        env=app_env,
        session_factory=sf,
        asset_lookup=lambda *_: None,  # type: ignore[arg-type]
        bar_service=lambda _m: None,  # type: ignore[arg-type,return-value]
        notifier=RecordingNotifier(),
        enable_listener=False,
        now=lambda: dt.datetime(2025, 6, 10, 14, 0, tzinfo=UTC),
    )
    with TestClient(create_app(deps)) as c:
        code = pyotp.TOTP(app_env.app_totp_secret.get_secret_value()).now()
        c.post("/api/auth/login", json={"username": "admin", "password": PASSWORD, "totp": code})
        q = c.get("/api/picks/quotes").json()
        assert q["session_date"] == "2025-06-10" and q["market_open"] is True
        assert q["interval_seconds"] == 15
        by = {x["symbol"]: x for x in q["quotes"]}
        assert picked <= set(by)
        assert len(by[sym]["series"]) == 2
        assert D(by[sym]["last"]) == snap.last * D("1.01")
        assert D(by[sym]["open"]) == snap.open and by[sym]["change_pct"] is not None
