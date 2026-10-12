"""``BrokerClient`` backed by the official ``alpaca-py`` SDK."""

from __future__ import annotations

import logging
from collections.abc import Callable
from decimal import Decimal

import requests
from alpaca.common.exceptions import APIError
from alpaca.trading.client import TradingClient
from alpaca.trading.enums import OrderSide, OrderType, TimeInForce
from alpaca.trading.enums import OrderStatus as AlpacaOrderStatus
from alpaca.trading.models import Asset as AlpacaAsset
from alpaca.trading.models import Clock as AlpacaClock
from alpaca.trading.models import Order as AlpacaOrder
from alpaca.trading.models import Position as AlpacaPosition
from alpaca.trading.models import TradeAccount
from alpaca.trading.requests import LimitOrderRequest

from dipbuyer.broker.base import (
    BrokerError,
    BrokerRejectedError,
    BrokerTransientError,
    with_read_retries,
)
from dipbuyer.domain.enums import OrderStatus, TradingMode
from dipbuyer.domain.models import (
    Account,
    AssetInfo,
    BrokerOrder,
    Clock,
    OrderIntent,
    Position,
)
from dipbuyer.domain.money import ZERO, to_decimal, to_decimal_opt

log = logging.getLogger(__name__)

_STATUS_MAP: dict[AlpacaOrderStatus, OrderStatus] = {
    AlpacaOrderStatus.PARTIALLY_FILLED: OrderStatus.PARTIALLY_FILLED,
    AlpacaOrderStatus.FILLED: OrderStatus.FILLED,
    AlpacaOrderStatus.CANCELED: OrderStatus.CANCELED,
    AlpacaOrderStatus.EXPIRED: OrderStatus.EXPIRED,
    AlpacaOrderStatus.REJECTED: OrderStatus.REJECTED,
}


def map_order_status(status: AlpacaOrderStatus) -> OrderStatus:
    """Everything that is not filled or terminal is still working at the broker."""
    return _STATUS_MAP.get(status, OrderStatus.SUBMITTED)


def _translate(exc: Exception) -> Exception:
    if isinstance(exc, APIError):
        raw_code: object = getattr(exc, "status_code", None)
        code = raw_code if isinstance(raw_code, int) else None
        if code is None or code == 429 or code >= 500:
            return BrokerTransientError(f"alpaca {code}: {exc}")
        return BrokerRejectedError(f"alpaca {code}: {exc}")
    if isinstance(exc, (requests.Timeout, requests.ConnectionError)):
        return BrokerTransientError(f"network: {exc}")
    return exc


def _call[T](fn: Callable[[], T]) -> T:
    try:
        return fn()
    except (APIError, requests.RequestException) as exc:
        raise _translate(exc) from exc


def _expect[T](value: object, cls: type[T]) -> T:
    if not isinstance(value, cls):
        raise BrokerError(f"unexpected Alpaca response type {type(value).__name__}")
    return value


def to_broker_order(o: AlpacaOrder) -> BrokerOrder:
    return BrokerOrder(
        broker_order_id=str(o.id),
        client_order_id=o.client_order_id,
        status=map_order_status(o.status),
        filled_qty=to_decimal_opt(o.filled_qty) or ZERO,
        filled_avg_price=to_decimal_opt(o.filled_avg_price),
    )


class AlpacaBroker:
    def __init__(self, key_id: str, secret: str, mode: TradingMode) -> None:
        if not key_id or not secret:
            raise ValueError(f"Alpaca {mode.value} credentials are not configured")
        paper = mode is TradingMode.PAPER
        # Reads: SDK retries 429/504 itself; we add backoff for other 5xx/timeouts.
        self._client = TradingClient(key_id, secret, paper=paper)
        # Writes: only retry 429 inside the SDK (request was not processed); everything
        # else is handled by submit_idempotent via client_order_id lookup.
        self._write_client = TradingClient(key_id, secret, paper=paper)
        setattr(self._write_client, "_retry_codes", [429])  # noqa: B010 - not exposed by SDK
        self.mode = mode

    def get_clock(self) -> Clock:
        c = with_read_retries(lambda: _call(self._client.get_clock))
        c = _expect(c, AlpacaClock)
        return Clock(
            timestamp=c.timestamp, is_open=c.is_open, next_open=c.next_open, next_close=c.next_close
        )

    def get_account(self) -> Account:
        a = with_read_retries(lambda: _call(self._client.get_account))
        a = _expect(a, TradeAccount)
        return Account(
            equity=to_decimal_opt(a.equity) or ZERO,
            cash=to_decimal_opt(a.cash) or ZERO,
            buying_power=to_decimal_opt(a.buying_power) or ZERO,
        )

    def get_positions(self) -> list[Position]:
        raw = with_read_retries(lambda: _call(self._client.get_all_positions))
        items: list[object] = list(_expect(raw, list))  # pyright: ignore[reportUnknownArgumentType]
        out: list[Position] = []
        for item in items:
            p = _expect(item, AlpacaPosition)
            out.append(
                Position(
                    symbol=p.symbol,
                    qty=to_decimal(p.qty),
                    avg_entry_price=to_decimal(p.avg_entry_price),
                    market_value=to_decimal_opt(p.market_value) or ZERO,
                    unrealized_pl=to_decimal_opt(p.unrealized_pl) or ZERO,
                )
            )
        return out

    def get_asset(self, symbol: str) -> AssetInfo | None:
        try:
            a = with_read_retries(lambda: _call(lambda: self._client.get_asset(symbol)))
        except BrokerRejectedError:
            return None
        a = _expect(a, AlpacaAsset)
        return AssetInfo(symbol=a.symbol, tradable=a.tradable, fractionable=a.fractionable)

    def is_tradable(self, symbol: str) -> bool:
        asset = self.get_asset(symbol)
        return asset is not None and asset.tradable

    def submit_limit_buy(self, intent: OrderIntent) -> BrokerOrder:
        req = LimitOrderRequest(
            symbol=intent.symbol,
            qty=float(intent.qty),
            side=OrderSide.BUY,
            type=OrderType.LIMIT,
            time_in_force=TimeInForce.DAY,
            limit_price=float(intent.limit_price),
            client_order_id=str(intent.id),
        )
        o = _call(lambda: self._write_client.submit_order(req))
        o = _expect(o, AlpacaOrder)
        return to_broker_order(o)

    def get_order_by_client_id(self, client_order_id: str) -> BrokerOrder | None:
        try:
            o = with_read_retries(
                lambda: _call(lambda: self._client.get_order_by_client_id(client_order_id))
            )
        except BrokerRejectedError as exc:
            if "404" in str(exc) or "not found" in str(exc).lower():
                return None
            raise
        o = _expect(o, AlpacaOrder)
        return to_broker_order(o)

    def cancel_order(self, broker_order_id: str) -> None:
        _call(lambda: self._write_client.cancel_order_by_id(broker_order_id))

    def cancel_all_open(self) -> None:
        _call(self._write_client.cancel_orders)


def decimal_qty_str(qty: Decimal) -> str:
    return format(qty.normalize(), "f")
