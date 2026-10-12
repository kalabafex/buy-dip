from __future__ import annotations

import datetime as dt
import uuid
from decimal import Decimal as D
from typing import Any

import pytest
import responses

from dipbuyer.broker import (
    BrokerRejectedError,
    BrokerTransientError,
    FakeBroker,
    SubmitFailedError,
    submit_idempotent,
    with_read_retries,
)
from dipbuyer.broker.alpaca import AlpacaBroker
from dipbuyer.domain.enums import OrderStatus, TradingMode
from dipbuyer.domain.models import OrderIntent

NOW = dt.datetime(2025, 6, 10, 15, tzinfo=dt.UTC)


def intent(**kw: Any) -> OrderIntent:
    base: dict[str, Any] = {
        "id": uuid.uuid4(),
        "rule_id": uuid.uuid4(),
        "cycle_id": None,
        "symbol": "SPY",
        "tier_index": 0,
        "mode": TradingMode.PAPER,
        "notional_usd": D(100),
        "qty": D("0.2"),
        "limit_price": D("500.10"),
        "created_at": NOW,
        "updated_at": NOW,
    }
    base.update(kw)
    return OrderIntent(**base)


def no_sleep(_: float) -> None:
    return None


# --- FakeBroker + submit_idempotent ------------------------------------------------------


def test_submit_happy_path() -> None:
    b = FakeBroker()
    i = intent()
    bo = submit_idempotent(b, i, sleep=no_sleep)
    assert bo.client_order_id == str(i.id)
    assert bo.status is OrderStatus.SUBMITTED
    assert len(b.orders) == 1


def test_timeout_after_accept_is_found_not_resubmitted() -> None:
    b = FakeBroker(submit_failures=["timeout_after_accept"])
    i = intent()
    bo = submit_idempotent(b, i, sleep=no_sleep)
    assert bo.client_order_id == str(i.id)
    assert b.submit_calls == 1
    assert len(b.orders) == 1


def test_timeout_before_accept_resubmits_once() -> None:
    b = FakeBroker(submit_failures=["timeout_before_accept"])
    bo = submit_idempotent(b, intent(), sleep=no_sleep)
    assert bo.status is OrderStatus.SUBMITTED
    assert b.submit_calls == 2
    assert len(b.orders) == 1


def test_two_lost_submits_fail_after_max_attempts() -> None:
    b = FakeBroker(submit_failures=["timeout_before_accept", "timeout_before_accept"])
    with pytest.raises(SubmitFailedError):
        submit_idempotent(b, intent(), sleep=no_sleep)
    assert b.submit_calls == 2
    assert not b.orders


def test_second_attempt_timeout_after_accept_is_found() -> None:
    b = FakeBroker(submit_failures=["timeout_before_accept", "timeout_after_accept"])
    bo = submit_idempotent(b, intent(), sleep=no_sleep)
    assert bo.status is OrderStatus.SUBMITTED
    assert len(b.orders) == 1


def test_rejection_not_retried() -> None:
    b = FakeBroker(submit_failures=["reject"])
    with pytest.raises(BrokerRejectedError):
        submit_idempotent(b, intent(), sleep=no_sleep)
    assert b.submit_calls == 1


def test_read_retries_backoff() -> None:
    calls: list[float] = []
    attempts = {"n": 0}

    def flaky() -> int:
        attempts["n"] += 1
        if attempts["n"] < 3:
            raise BrokerTransientError("503")
        return 7

    assert with_read_retries(flaky, sleep=calls.append) == 7
    assert calls == [0.5, 1.0]
    with pytest.raises(BrokerTransientError):
        with_read_retries(lambda: (_ for _ in ()).throw(BrokerTransientError("x")), sleep=no_sleep)


def test_fake_broker_fills_and_account() -> None:
    b = FakeBroker(cash=D(1000))
    i = intent(qty=D(2), limit_price=D(100))
    b.submit_limit_buy(i)
    assert b.get_account().buying_power == D(800)
    b.fill(str(i.id), D(99), qty=D(1))
    assert b.get_order_by_client_id(str(i.id)).status is OrderStatus.PARTIALLY_FILLED  # type: ignore[union-attr]
    b.fill(str(i.id), D(98))
    o = b.get_order_by_client_id(str(i.id))
    assert o is not None and o.status is OrderStatus.FILLED
    assert o.filled_avg_price == D("98.5")
    assert b.cash == D(803)
    [pos] = b.get_positions()
    assert pos.qty == D(2) and pos.avg_entry_price == D("98.5")


def test_fake_broker_session_open_fill_model() -> None:
    b = FakeBroker()
    i1, i2 = intent(limit_price=D(100)), intent(limit_price=D(90))
    b.submit_limit_buy(i1)
    b.submit_limit_buy(i2)
    b.process_session_open("SPY", D(95))
    assert b.orders[str(i1.id)].status is OrderStatus.FILLED
    assert b.orders[str(i1.id)].filled_avg_price == D(95)
    assert b.orders[str(i2.id)].status is OrderStatus.EXPIRED


# --- AlpacaBroker against stubbed HTTP ---------------------------------------------------

BASE = "https://paper-api.alpaca.markets/v2"


def order_json(
    cid: str, status: str = "new", filled: str = "0", avg: str | None = None
) -> dict[str, Any]:
    ts = "2025-06-10T15:00:00Z"
    return {
        "id": "61e69015-8549-4bfd-b9c3-01e75843f47d",
        "client_order_id": cid,
        "created_at": ts,
        "updated_at": ts,
        "submitted_at": ts,
        "filled_at": None,
        "expired_at": None,
        "canceled_at": None,
        "failed_at": None,
        "replaced_at": None,
        "replaced_by": None,
        "replaces": None,
        "asset_id": "b0b6dd9d-8b9b-48a9-ba46-b9d54906e415",
        "symbol": "SPY",
        "asset_class": "us_equity",
        "notional": None,
        "qty": "0.2",
        "filled_qty": filled,
        "filled_avg_price": avg,
        "order_class": "simple",
        "order_type": "limit",
        "type": "limit",
        "side": "buy",
        "time_in_force": "day",
        "limit_price": "500.1",
        "stop_price": None,
        "status": status,
        "extended_hours": False,
        "legs": None,
        "trail_percent": None,
        "trail_price": None,
        "hwm": None,
    }


@responses.activate
def test_alpaca_submit_sends_client_order_id_and_limit_fields() -> None:
    i = intent()
    responses.post(f"{BASE}/orders", json=order_json(str(i.id)))
    bo = AlpacaBroker("key", "secret", TradingMode.PAPER).submit_limit_buy(i)
    assert bo.client_order_id == str(i.id)
    assert bo.status is OrderStatus.SUBMITTED
    body = responses.calls[0].request.body
    assert body is not None
    import json

    assert isinstance(body, (bytes, str))
    sent = json.loads(body)
    assert sent["client_order_id"] == str(i.id)
    assert sent["type"] == "limit"
    assert sent["time_in_force"] == "day"
    assert sent["side"] == "buy"
    assert D(str(sent["limit_price"])) == D("500.1")


@responses.activate
def test_alpaca_submit_5xx_then_lookup_finds_order_exactly_one_order() -> None:
    i = intent()
    cid = str(i.id)
    responses.post(f"{BASE}/orders", status=500, json={"message": "internal"})
    responses.get(
        f"{BASE}/orders:by_client_order_id",
        json=order_json(cid, status="partially_filled", filled="0.1", avg="500"),
    )
    bo = submit_idempotent(AlpacaBroker("key", "secret", TradingMode.PAPER), i, sleep=no_sleep)
    assert bo.status is OrderStatus.PARTIALLY_FILLED
    assert bo.filled_qty == D("0.1")
    posts = [c for c in responses.calls if c.request.method == "POST"]
    assert len(posts) == 1


@responses.activate
def test_alpaca_lookup_404_returns_none_and_resubmits() -> None:
    i = intent()
    cid = str(i.id)
    responses.post(f"{BASE}/orders", status=503, json={"message": "unavailable"})
    responses.get(f"{BASE}/orders:by_client_order_id", status=404, json={"message": "not found"})
    responses.post(f"{BASE}/orders", json=order_json(cid))
    bo = submit_idempotent(AlpacaBroker("key", "secret", TradingMode.PAPER), i, sleep=no_sleep)
    assert bo.status is OrderStatus.SUBMITTED
    posts = [c for c in responses.calls if c.request.method == "POST"]
    assert len(posts) == 2


@responses.activate
def test_alpaca_reject_maps_to_rejected_error() -> None:
    responses.post(f"{BASE}/orders", status=403, json={"message": "insufficient buying power"})
    with pytest.raises(BrokerRejectedError):
        AlpacaBroker("key", "secret", TradingMode.PAPER).submit_limit_buy(intent())


@responses.activate
def test_alpaca_status_mapping() -> None:
    i = intent()
    for raw, want in [
        ("accepted", OrderStatus.SUBMITTED),
        ("pending_new", OrderStatus.SUBMITTED),
        ("filled", OrderStatus.FILLED),
        ("canceled", OrderStatus.CANCELED),
        ("expired", OrderStatus.EXPIRED),
        ("rejected", OrderStatus.REJECTED),
    ]:
        responses.get(f"{BASE}/orders:by_client_order_id", json=order_json(str(i.id), status=raw))
        bo = AlpacaBroker("key", "secret", TradingMode.PAPER).get_order_by_client_id(str(i.id))
        assert bo is not None and bo.status is want
        responses.reset()


@responses.activate
def test_alpaca_account_and_positions_are_decimal() -> None:
    responses.get(
        f"{BASE}/account",
        json={
            "id": "61e69015-8549-4bfd-b9c3-01e75843f47d",
            "account_number": "PA1",
            "status": "ACTIVE",
            "crypto_status": "ACTIVE",
            "currency": "USD",
            "buying_power": "20000.10",
            "cash": "10000.05",
            "equity": "10500.33",
            "pattern_day_trader": False,
            "trading_blocked": False,
            "transfers_blocked": False,
            "account_blocked": False,
            "created_at": "2024-01-01T00:00:00Z",
            "trade_suspended_by_user": False,
            "shorting_enabled": False,
        },
    )
    acct = AlpacaBroker("key", "secret", TradingMode.PAPER).get_account()
    assert acct.equity == D("10500.33")
    assert isinstance(acct.cash, D)


def test_alpaca_requires_keys() -> None:
    with pytest.raises(ValueError, match="credentials"):
        AlpacaBroker("", "", TradingMode.LIVE)
