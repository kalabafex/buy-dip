"""In-memory broker with controllable fills, used by tests and the backtester."""

from __future__ import annotations

import datetime as dt
import threading
import uuid
from dataclasses import dataclass, field
from decimal import Decimal

from dipbuyer.broker.base import BrokerRejectedError, BrokerTransientError
from dipbuyer.domain.enums import OrderStatus
from dipbuyer.domain.models import (
    Account,
    AssetInfo,
    BrokerOrder,
    Clock,
    OrderIntent,
    Position,
)
from dipbuyer.domain.money import ZERO

_OPEN = {OrderStatus.SUBMITTED, OrderStatus.PARTIALLY_FILLED}


@dataclass
class FakeOrder:
    broker_order_id: str
    client_order_id: str
    symbol: str
    qty: Decimal
    limit_price: Decimal
    status: OrderStatus = OrderStatus.SUBMITTED
    filled_qty: Decimal = ZERO
    filled_avg_price: Decimal | None = None

    def view(self) -> BrokerOrder:
        return BrokerOrder(
            broker_order_id=self.broker_order_id,
            client_order_id=self.client_order_id,
            status=self.status,
            filled_qty=self.filled_qty,
            filled_avg_price=self.filled_avg_price,
        )


@dataclass
class _Holding:
    qty: Decimal = ZERO
    cost: Decimal = ZERO


@dataclass
class FakeBroker:
    cash: Decimal = Decimal(100_000)
    is_open: bool = True
    now: dt.datetime = field(default_factory=lambda: dt.datetime.now(dt.UTC))
    assets: dict[str, AssetInfo] = field(default_factory=dict[str, AssetInfo])
    marks: dict[str, Decimal] = field(default_factory=dict[str, Decimal])
    orders: dict[str, FakeOrder] = field(default_factory=dict[str, FakeOrder])
    holdings: dict[str, _Holding] = field(default_factory=dict[str, _Holding])
    submit_calls: int = 0
    # Failure injection: each entry is consumed by one submit call.
    # "timeout_after_accept": broker records the order, client sees a timeout.
    # "timeout_before_accept": request lost, client sees a timeout.
    # "reject": broker rejects.
    submit_failures: list[str] = field(default_factory=list[str])
    _lock: threading.Lock = field(default_factory=threading.Lock)

    # --- BrokerClient -----------------------------------------------------------------
    def get_clock(self) -> Clock:
        return Clock(
            timestamp=self.now,
            is_open=self.is_open,
            next_open=self.now + dt.timedelta(days=1),
            next_close=self.now + dt.timedelta(hours=1),
        )

    def get_account(self) -> Account:
        reserved = sum(
            (o.qty - o.filled_qty) * o.limit_price
            for o in self.orders.values()
            if o.status in _OPEN
        )
        equity = self.cash + sum(
            (h.qty * self.marks.get(sym, h.cost / h.qty if h.qty else ZERO))
            for sym, h in self.holdings.items()
        )
        return Account(equity=equity, cash=self.cash, buying_power=self.cash - reserved)

    def get_positions(self) -> list[Position]:
        out: list[Position] = []
        for sym, h in sorted(self.holdings.items()):
            if h.qty <= 0:
                continue
            avg = h.cost / h.qty
            mark = self.marks.get(sym, avg)
            mv = h.qty * mark
            out.append(
                Position(
                    symbol=sym,
                    qty=h.qty,
                    avg_entry_price=avg,
                    market_value=mv,
                    unrealized_pl=mv - h.cost,
                )
            )
        return out

    def get_asset(self, symbol: str) -> AssetInfo | None:
        return self.assets.get(symbol, AssetInfo(symbol=symbol, tradable=True, fractionable=True))

    def is_tradable(self, symbol: str) -> bool:
        asset = self.get_asset(symbol)
        return asset is not None and asset.tradable

    def submit_limit_buy(self, intent: OrderIntent) -> BrokerOrder:
        with self._lock:
            self.submit_calls += 1
            failure = self.submit_failures.pop(0) if self.submit_failures else None
            if failure == "timeout_before_accept":
                raise BrokerTransientError("simulated timeout before accept")
            if failure == "reject":
                raise BrokerRejectedError("simulated rejection")
            cid = str(intent.id)
            if cid in self.orders:
                raise BrokerRejectedError("client_order_id must be unique")
            order = FakeOrder(
                broker_order_id=str(uuid.uuid4()),
                client_order_id=cid,
                symbol=intent.symbol,
                qty=intent.qty,
                limit_price=intent.limit_price,
            )
            self.orders[cid] = order
            if failure == "timeout_after_accept":
                raise BrokerTransientError("simulated timeout after accept")
            return order.view()

    def get_order_by_client_id(self, client_order_id: str) -> BrokerOrder | None:
        order = self.orders.get(client_order_id)
        return order.view() if order else None

    def cancel_order(self, broker_order_id: str) -> None:
        for o in self.orders.values():
            if o.broker_order_id == broker_order_id and o.status in _OPEN:
                o.status = OrderStatus.CANCELED

    def cancel_all_open(self) -> None:
        for o in self.orders.values():
            if o.status in _OPEN:
                o.status = OrderStatus.CANCELED

    # --- simulation controls ----------------------------------------------------------
    def fill(self, client_order_id: str, price: Decimal, qty: Decimal | None = None) -> None:
        """Fill (fully, or ``qty`` more shares) at ``price``."""
        o = self.orders[client_order_id]
        if o.status not in _OPEN:
            raise ValueError(f"order {client_order_id} is {o.status}")
        add = o.qty - o.filled_qty if qty is None else min(qty, o.qty - o.filled_qty)
        cost = add * price
        prev_cost = (o.filled_avg_price or ZERO) * o.filled_qty
        o.filled_qty += add
        o.filled_avg_price = (prev_cost + cost) / o.filled_qty
        o.status = OrderStatus.FILLED if o.filled_qty >= o.qty else OrderStatus.PARTIALLY_FILLED
        self.cash -= cost
        h = self.holdings.setdefault(o.symbol, _Holding())
        h.qty += add
        h.cost += cost

    def expire(self, client_order_id: str) -> None:
        o = self.orders[client_order_id]
        if o.status in _OPEN:
            o.status = OrderStatus.EXPIRED

    def open_orders(self) -> list[FakeOrder]:
        return [o for o in self.orders.values() if o.status in _OPEN]

    def process_session_open(self, symbol: str, open_price: Decimal) -> None:
        """Backtest fill model: fill at the open if open <= limit, else expire."""
        for o in self.open_orders():
            if o.symbol != symbol:
                continue
            if open_price <= o.limit_price:
                self.fill(o.client_order_id, open_price)
            else:
                self.expire(o.client_order_id)
