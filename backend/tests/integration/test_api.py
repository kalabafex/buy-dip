from __future__ import annotations

import datetime as dt
import time
import uuid
from collections.abc import Iterator
from decimal import Decimal as D
from typing import Any

import pyotp
import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from dipbuyer.alerts import RecordingNotifier
from dipbuyer.api.app import create_app
from dipbuyer.api.deps import AppDeps
from dipbuyer.api.security import hash_password
from dipbuyer.config import Settings
from dipbuyer.data.bars import BarService
from dipbuyer.data.market_data import FakeMarketData
from dipbuyer.domain.enums import TradingMode
from dipbuyer.domain.models import AssetInfo
from dipbuyer.persistence.models import AuditLogRow, EvaluationRow, OrderIntentRow
from dipbuyer.worker.backtest_runner import run_queued
from tests.helpers import make_bars
from tests.integration.conftest import NOW, PREV_SESSION, add_rule, dip_market

PASSWORD = "correct horse battery staple"
PW_HASH = hash_password(PASSWORD)


class Ctx:
    def __init__(self, client: TestClient, totp: pyotp.TOTP, notifier: RecordingNotifier) -> None:
        self.client = client
        self.totp = totp
        self.notifier = notifier

    def login(self) -> None:
        r = self.client.post(
            "/api/auth/login",
            json={"username": "admin", "password": PASSWORD, "totp": self.totp.now()},
        )
        assert r.status_code == 200, r.text

    def reauth(self) -> None:
        r = self.client.post(
            "/api/auth/reauth",
            json={"password": PASSWORD, "totp": self.totp.at(int(time.time()) + 30)},
        )
        assert r.status_code == 200, r.text


def make_env(**kw: Any) -> Settings:
    base: dict[str, Any] = {
        "app_admin_username": "admin",
        "app_admin_password_hash": SecretStr(PW_HASH),
        "app_totp_secret": SecretStr(pyotp.random_base32()),
        "session_secret": SecretStr("s" * 40),
        "session_cookie_secure": False,
        "cors_origin": "http://localhost:5173",
    }
    base.update(kw)
    return Settings(**base)


@pytest.fixture
def api(sf: sessionmaker[Session]) -> Iterator[Ctx]:
    env = make_env()
    md = FakeMarketData()
    dip_market(md)
    md.add_bars(make_bars("QQQ", ["200"] * 230, PREV_SESSION))
    md.last["QQQ"] = D(190)
    svc = BarService(md)
    notifier = RecordingNotifier()

    def asset_lookup(symbol: str, _mode: TradingMode) -> AssetInfo | None:
        if symbol == "NOPE":
            return None
        return AssetInfo(symbol=symbol, tradable=symbol != "HALT", fractionable=True)

    deps = AppDeps(
        env=env,
        session_factory=sf,
        asset_lookup=asset_lookup,
        bar_service=lambda _mode: svc,
        notifier=notifier,
        enable_listener=False,
        now=lambda: NOW,
    )
    with TestClient(create_app(deps)) as client:
        yield Ctx(client, pyotp.TOTP(env.app_totp_secret.get_secret_value()), notifier)


RULE = {
    "symbol": "spy",
    "trigger_type": "PULLBACK_FROM_HIGH",
    "lookback_days": 20,
    "tiers": [{"drop_pct": 5, "amount_usd": "100"}, {"drop_pct": 10, "amount_usd": 200}],
    "trend_filter": "NONE",
    "confirm_evals": 2,
    "max_position_usd": 1000,
    "cooldown_days": 5,
    "limit_offset_pct": "0.3",
}


def test_health_is_public(api: Ctx) -> None:
    r = api.client.get("/api/health")
    assert r.status_code == 200
    assert r.json()["db"] is True


def test_requires_auth(api: Ctx) -> None:
    for path in ("/api/rules", "/api/settings", "/api/orders", "/api/evaluations", "/api/account"):
        assert api.client.get(path).status_code == 401
    assert api.client.get("/api/auth/me").status_code == 401


def test_login_logout_and_cookie_flags(api: Ctx) -> None:
    bad = api.client.post(
        "/api/auth/login", json={"username": "admin", "password": "wrong", "totp": api.totp.now()}
    )
    assert bad.status_code == 401
    bad = api.client.post(
        "/api/auth/login", json={"username": "admin", "password": PASSWORD, "totp": "000000"}
    )
    assert bad.status_code == 401
    r = api.client.post(
        "/api/auth/login",
        json={"username": "admin", "password": PASSWORD, "totp": api.totp.now()},
    )
    assert r.status_code == 200
    cookie = r.headers["set-cookie"].lower()
    assert "httponly" in cookie and "samesite=strict" in cookie
    assert api.client.get("/api/auth/me").json()["username"] == "admin"
    # replayed TOTP code is rejected
    replay = api.client.post(
        "/api/auth/login",
        json={"username": "admin", "password": PASSWORD, "totp": api.totp.now()},
    )
    assert replay.status_code == 401
    assert api.client.post("/api/auth/logout").status_code == 204
    assert api.client.get("/api/rules").status_code == 401


def test_secure_cookie_in_production(sf: sessionmaker[Session]) -> None:
    env = make_env(session_cookie_secure=True)
    deps = AppDeps(
        env=env,
        session_factory=sf,
        asset_lookup=lambda *_: None,
        bar_service=lambda _m: None,  # type: ignore[arg-type,return-value]
        notifier=RecordingNotifier(),
        enable_listener=False,
    )
    client = TestClient(create_app(deps), base_url="https://testserver")
    totp = pyotp.TOTP(env.app_totp_secret.get_secret_value())
    r = client.post(
        "/api/auth/login", json={"username": "admin", "password": PASSWORD, "totp": totp.now()}
    )
    assert "secure" in r.headers["set-cookie"].lower()


def test_auth_rate_limit(api: Ctx) -> None:
    codes = [
        api.client.post(
            "/api/auth/login", json={"username": "x", "password": "y", "totp": "1"}
        ).status_code
        for _ in range(11)
    ]
    assert codes[:10] == [401] * 10
    assert codes[10] == 429


def test_rules_crud_toggle_preview_chart(api: Ctx) -> None:
    api.login()
    c = api.client
    r = c.post("/api/rules", json=RULE)
    assert r.status_code == 201, r.text
    created = r.json()
    rid = created["id"]
    assert created["symbol"] == "SPY" and created["enabled"] is False
    assert D(created["tiers"][0]["amount_usd"]) == D(100)

    assert [x["id"] for x in c.get("/api/rules").json()] == [rid]
    upd = {**RULE, "lookback_days": 30, "tiers": [{"drop_pct": 4, "amount_usd": 150}]}
    r = c.put(f"/api/rules/{rid}", json=upd)
    assert r.status_code == 200 and r.json()["lookback_days"] == 30

    r = c.patch(f"/api/rules/{rid}/enabled", json={"enabled": True})
    assert r.json()["enabled"] is True

    p = c.get(f"/api/rules/{rid}/preview").json()
    assert D(p["last"]) == D(94) and D(p["high_n"]) == D(100)
    assert D(p["pullback_pct"]) == D(6)
    assert p["condition_met"] is True
    assert D(p["tiers"][0]["trigger_price"]) == D(96)  # 100 * (1 - 4%)

    unsaved = c.post("/api/rules/preview", json={**RULE, "symbol": "QQQ"}).json()
    assert D(unsaved["pullback_pct"]) == D(5)
    assert [D(t["trigger_price"]) for t in unsaved["tiers"]] == [D(190), D(180)]

    ch = c.get(f"/api/rules/{rid}/chart", params={"days": 90}).json()
    assert ch["symbol"] == "SPY"
    assert 55 <= len(ch["bars"]) <= 70
    assert ch["sma200"] and ch["high_n"] and ch["sma50"]
    assert len(ch["tier_prices"]) == 1

    assert c.delete(f"/api/rules/{rid}").status_code == 204
    assert c.get(f"/api/rules/{rid}").status_code == 404
    assert c.get("/api/rules").json() == []


def test_rule_validation(api: Ctx) -> None:
    api.login()
    c = api.client
    assert c.post("/api/rules", json={**RULE, "symbol": "NOPE"}).status_code == 422
    assert c.post("/api/rules", json={**RULE, "symbol": "HALT"}).status_code == 422
    bad_tiers = {
        **RULE,
        "tiers": [{"drop_pct": 10, "amount_usd": 1}, {"drop_pct": 5, "amount_usd": 1}],
    }
    assert c.post("/api/rules", json=bad_tiers).status_code == 422
    assert c.post("/api/rules", json={**RULE, "max_position_usd": 10}).status_code == 422
    assert c.post("/api/rules", json={**RULE, "trigger_type": "RSI_OVERSOLD"}).status_code == 422
    assert c.get(f"/api/rules/{uuid.uuid4()}").status_code == 404


def test_settings_kill_switch_and_mode(api: Ctx, sf: sessionmaker[Session]) -> None:
    api.login()
    c = api.client
    s = c.get("/api/settings").json()
    assert s["trading_mode"] == "PAPER" and s["kill_switch"] is False
    assert s["live_keys_configured"] is False

    new = {
        "max_daily_spend_usd": 300,
        "max_weekly_spend_usd": 900,
        "evaluation_interval_minutes": 10,
        "open_exclusion_minutes": 20,
        "close_exclusion_minutes": 5,
    }
    r = c.put("/api/settings", json=new)
    assert r.status_code == 200 and D(r.json()["max_daily_spend_usd"]) == D(300)
    assert c.put("/api/settings", json={**new, "max_weekly_spend_usd": 100}).status_code == 422
    assert c.put("/api/settings", json={**new, "evaluation_interval_minutes": 0}).status_code == 422

    # turning ON needs no elevation; turning OFF does
    assert c.post("/api/kill-switch", json={"on": True}).json()["kill_switch"] is True
    assert c.post("/api/kill-switch", json={"on": False}).status_code == 403
    api.reauth()
    assert c.post("/api/kill-switch", json={"on": False}).json()["kill_switch"] is False
    titles = [t for t, _, _ in api.notifier.sent]
    assert "Kill switch ON" in titles and "Kill switch OFF" in titles

    # LIVE: elevated (yes, from reauth above) + confirm + keys configured
    assert c.post("/api/mode", json={"mode": "LIVE", "confirm": "live"}).status_code == 422
    assert c.post("/api/mode", json={"mode": "LIVE", "confirm": "LIVE"}).status_code == 409
    with sf() as s2:
        actions = [a.action for a in s2.scalars(select(AuditLogRow))]
    assert actions.count("kill_switch") == 2


def test_mode_live_requires_elevation(sf: sessionmaker[Session]) -> None:
    env = make_env(alpaca_live_key_id=SecretStr("AK"), alpaca_live_secret=SecretStr("SK"))
    notifier = RecordingNotifier()
    deps = AppDeps(
        env=env,
        session_factory=sf,
        asset_lookup=lambda *_: None,
        bar_service=lambda _m: None,  # type: ignore[arg-type,return-value]
        notifier=notifier,
        enable_listener=False,
    )
    with TestClient(create_app(deps)) as client:
        ctx = Ctx(client, pyotp.TOTP(env.app_totp_secret.get_secret_value()), notifier)
        ctx.login()
        assert client.post("/api/mode", json={"mode": "LIVE", "confirm": "LIVE"}).status_code == 403
        ctx.reauth()
        r = client.post("/api/mode", json={"mode": "LIVE", "confirm": "LIVE"})
        assert r.status_code == 200 and r.json()["trading_mode"] == "LIVE"
        assert client.post("/api/mode", json={"mode": "PAPER"}).json()["trading_mode"] == "PAPER"
        assert [t for t, _, _ in notifier.sent] == ["Mode changed to LIVE", "Mode changed to PAPER"]


def test_orders_and_evaluations_pagination(api: Ctx, sf: sessionmaker[Session]) -> None:
    api.login()
    rid = add_rule(sf)
    with sf.begin() as s:
        for i in range(7):
            s.add(
                OrderIntentRow(
                    id=uuid.uuid4(),
                    rule_id=rid,
                    cycle_id=None,
                    symbol="SPY",
                    tier_index=0,
                    mode="PAPER",
                    notional_usd=D(100),
                    qty=D(1),
                    limit_price=D(94),
                    status="FILLED" if i % 2 else "EXPIRED",
                    created_at=NOW - dt.timedelta(minutes=i),
                    updated_at=NOW,
                )
            )
            s.add(
                EvaluationRow(
                    rule_id=rid,
                    ts=NOW - dt.timedelta(minutes=i),
                    session_date=NOW.date(),
                    last_price=D(94),
                    ref_high=D(100),
                    sma50=None,
                    sma200=None,
                    rsi14=None,
                    pullback_pct=D(6),
                    condition_met=True,
                    consecutive_met=1,
                    tier_hit=0 if i < 3 else None,
                    decision="ORDER" if i < 3 else "NO_TRIGGER",
                    reason="x",
                )
            )
    c = api.client
    page = c.get("/api/orders", params={"limit": 3, "offset": 0}).json()
    assert page["total"] == 7 and len(page["items"]) == 3
    assert c.get("/api/orders", params={"status": "FILLED"}).json()["total"] == 3
    assert c.get("/api/orders", params={"symbol": "qqq"}).json()["total"] == 0
    since = (NOW - dt.timedelta(minutes=2, seconds=30)).isoformat()
    assert c.get("/api/orders", params={"from": since}).json()["total"] == 3
    ev = c.get("/api/evaluations", params={"rule_id": str(rid), "limit": 5}).json()
    assert ev["total"] == 7 and ev["items"][0]["symbol"] == "SPY"
    assert c.get("/api/evaluations", params={"triggered_only": True}).json()["total"] == 3
    assert c.get("/api/evaluations", params={"decision": "NO_TRIGGER"}).json()["total"] == 4
    assert c.get("/api/account").json() is None
    assert c.get("/api/positions").json() == []


def test_backtest_queue_and_run(api: Ctx, sf: sessionmaker[Session]) -> None:
    api.login()
    c = api.client
    md = FakeMarketData()
    closes = [100 + ((i * 7) % 13) - (15 if 300 < i < 320 else 0) for i in range(500)]
    md.add_bars(make_bars("SPY", closes, PREV_SESSION))
    rid = c.post("/api/rules", json=RULE).json()["id"]
    r = c.post(
        "/api/backtests",
        json={
            "rule_id": rid,
            "start_date": "2024-06-01",
            "end_date": "2025-06-01",
            "starting_cash": 5000,
        },
    )
    assert r.status_code == 201
    bt_id = r.json()["id"]
    assert c.get(f"/api/backtests/{bt_id}").json()["status"] == "QUEUED"
    adhoc = c.post(
        "/api/backtests",
        json={"params": RULE, "start_date": "2024-06-01", "end_date": "2025-06-01"},
    )
    assert adhoc.status_code == 201
    assert (
        c.post(
            "/api/backtests", json={"start_date": "2024-06-01", "end_date": "2025-06-01"}
        ).status_code
        == 422
    )
    assert run_queued(sf, lambda _m: BarService(md)) == 2
    done = c.get(f"/api/backtests/{bt_id}").json()
    assert done["status"] == "DONE", done["error"]
    assert set(done["results"]) >= {"rule", "baseline", "equity_curve", "trades"}
    assert len(c.get("/api/backtests").json()) == 2


def test_openapi_schema_lists_all_routes(api: Ctx) -> None:
    paths = set(api.client.get("/api/openapi.json").json()["paths"])
    for p in (
        "/api/auth/login",
        "/api/auth/logout",
        "/api/auth/reauth",
        "/api/health",
        "/api/rules",
        "/api/rules/{rule_id}",
        "/api/rules/{rule_id}/enabled",
        "/api/rules/{rule_id}/preview",
        "/api/rules/{rule_id}/chart",
        "/api/settings",
        "/api/kill-switch",
        "/api/mode",
        "/api/orders",
        "/api/evaluations",
        "/api/account",
        "/api/positions",
        "/api/backtests",
        "/api/backtests/{backtest_id}",
        "/api/stream",
    ):
        assert p in paths
