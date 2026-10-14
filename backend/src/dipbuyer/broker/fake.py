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
    BracketState,
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
class FakeBracket:
    entry: FakeOrder
    take_profit: FakeOrder | None
    stop_loss: FakeOrder | None

    def legs(self) -> list[FakeOrder]:
        return [x for x in (self.take_profit, self.stop_loss) if x is not None]


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
    brackets: dict[str, FakeBracket] = field(default_factory=dict[str, FakeBracket])
    sells: dict[str, FakeOrder] = field(default_factory=dict[str, FakeOrder])
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
        order = self.orders.get(client_order_id) or self.sells.get(client_order_id)
        return order.view() if order else None

    def _all_orders(self) -> list[FakeOrder]:
        legs = [leg for b in self.brackets.values() for leg in b.legs()]
        return [*self.orders.values(), *legs, *self.sells.values()]

    def cancel_order(self, broker_order_id: str) -> None:
        for o in self._all_orders():
            if o.broker_order_id == broker_order_id and o.status in _OPEN:
                o.status = OrderStatus.CANCELED
                self._cancel_sibling_leg(o)

    def cancel_all_open(self) -> None:
        for o in self._all_orders():
            if o.status in _OPEN:
                o.status = OrderStatus.CANCELED

    def _cancel_sibling_leg(self, leg: FakeOrder) -> None:
        """Exit legs are one-cancels-other."""
        for b in self.brackets.values():
            if leg in b.legs():
                for other in b.legs():
                    if other is not leg and other.status in _OPEN:
                        other.status = OrderStatus.CANCELED

    # --- bracket orders -------------------------------------------------------------------
    def submit_bracket_buy(
        self,
        client_order_id: str,
        symbol: str,
        qty: int,
        limit_price: Decimal,
        take_profit: Decimal | None,
        stop_loss: Decimal | None,
    ) -> BrokerOrder:
        with self._lock:
            self.submit_calls += 1
            failure = self.submit_failures.pop(0) if self.submit_failures else None
            if failure == "timeout_before_accept":
                raise BrokerTransientError("simulated timeout before accept")
            if failure == "reject":
                raise BrokerRejectedError("simulated rejection")
            if client_order_id in self.orders:
                raise BrokerRejectedError("client_order_id must be unique")
            entry = FakeOrder(
                broker_order_id=str(uuid.uuid4()),
                client_order_id=client_order_id,
                symbol=symbol,
                qty=Decimal(qty),
                limit_price=limit_price,
            )

            def leg(price: Decimal | None) -> FakeOrder | None:
                if price is None:
                    return None
                return FakeOrder(
                    broker_order_id=str(uuid.uuid4()),
                    client_order_id=f"{client_order_id}-leg-{uuid.uuid4().hex[:6]}",
                    symbol=symbol,
                    qty=Decimal(qty),
                    limit_price=price,
                )

            self.orders[client_order_id] = entry
            self.brackets[client_order_id] = FakeBracket(entry, leg(take_profit), leg(stop_loss))
            if failure == "timeout_after_accept":
                raise BrokerTransientError("simulated timeout after accept")
            return entry.view()

    def get_bracket(self, client_order_id: str) -> BracketState | None:
        b = self.brackets.get(client_order_id)
        if b is None:
            return None
        filled_leg = next((x for x in b.legs() if x.filled_qty > 0), None)
        reason = None
        if filled_leg is not None:
            reason = "TARGET" if filled_leg is b.take_profit else "STOP"
        return BracketState(
            entry_broker_id=b.entry.broker_order_id,
            entry_status=b.entry.status,
            entry_filled_qty=b.entry.filled_qty,
            entry_avg_price=b.entry.filled_avg_price,
            exit_filled_qty=filled_leg.filled_qty if filled_leg else ZERO,
            exit_avg_price=filled_leg.filled_avg_price if filled_leg else None,
            exit_reason=reason,
            open_leg_ids=tuple(x.broker_order_id for x in b.legs() if x.status in _OPEN),
        )

    def submit_market_sell(self, client_order_id: str, symbol: str, qty: Decimal) -> BrokerOrder:
        with self._lock:
            if client_order_id in self.sells:
                raise BrokerRejectedError("client_order_id must be unique")
            price = self.marks.get(symbol)
            h = self.holdings.get(symbol)
            if price is None and h is not None and h.qty > 0:
                price = h.cost / h.qty
            order = FakeOrder(
                broker_order_id=str(uuid.uuid4()),
                client_order_id=client_order_id,
                symbol=symbol,
                qty=qty,
                limit_price=price or ZERO,
            )
            self.sells[client_order_id] = order
            if price is not None:
                self._sell(symbol, qty, price)
                order.filled_qty, order.filled_avg_price = qty, price
                order.status = OrderStatus.FILLED
            return order.view()

    def _sell(self, symbol: str, qty: Decimal, price: Decimal) -> None:
        h = self.holdings.setdefault(symbol, _Holding())
        if h.qty > 0:
            h.cost -= h.cost * (qty / h.qty)
        h.qty -= qty
        self.cash += qty * price

    def hit_exit(self, client_order_id: str, which: str, price: Decimal | None = None) -> None:
        """Fill the TARGET or STOP leg of a filled bracket (OCO cancels the other)."""
        b = self.brackets[client_order_id]
        leg = b.take_profit if which == "TARGET" else b.stop_loss
        if leg is None or leg.status not in _OPEN:
            raise ValueError(f"no open {which} leg")
        px = price if price is not None else leg.limit_price
        qty = b.entry.filled_qty
        leg.filled_qty, leg.filled_avg_price, leg.status = qty, px, OrderStatus.FILLED
        self._sell(b.entry.symbol, qty, px)
        self._cancel_sibling_leg(leg)

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
