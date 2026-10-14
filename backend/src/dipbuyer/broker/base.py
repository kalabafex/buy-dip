from __future__ import annotations

import logging
import time
from collections.abc import Callable
from decimal import Decimal
from typing import Protocol

from dipbuyer.domain.models import (
    Account,
    AssetInfo,
    BracketState,
    BrokerOrder,
    Clock,
    OrderIntent,
    Position,
)

log = logging.getLogger(__name__)


class BrokerError(Exception):
    """Base class for broker errors."""


class BrokerTransientError(BrokerError):
    """Timeout, connection failure, 429 or 5xx: the outcome of a write is unknown."""


class BrokerRejectedError(BrokerError):
    """The broker definitively refused the request (4xx other than 429)."""


class BrokerClient(Protocol):
    def get_clock(self) -> Clock: ...
    def get_account(self) -> Account: ...
    def get_positions(self) -> list[Position]: ...
    def is_tradable(self, symbol: str) -> bool: ...
    def get_asset(self, symbol: str) -> AssetInfo | None: ...
    def submit_limit_buy(self, intent: OrderIntent) -> BrokerOrder: ...
    def get_order_by_client_id(self, client_order_id: str) -> BrokerOrder | None: ...
    def cancel_order(self, broker_order_id: str) -> None: ...
    def cancel_all_open(self) -> None: ...
    def submit_bracket_buy(
        self,
        client_order_id: str,
        symbol: str,
        qty: int,
        limit_price: Decimal,
        take_profit: Decimal | None,
        stop_loss: Decimal | None,
    ) -> BrokerOrder: ...
    def get_bracket(self, client_order_id: str) -> BracketState | None: ...
    def submit_market_sell(
        self, client_order_id: str, symbol: str, qty: Decimal
    ) -> BrokerOrder: ...


class SubmitFailedError(BrokerError):
    def __init__(self, message: str, *, attempts: int) -> None:
        super().__init__(message)
        self.attempts = attempts


MAX_SUBMIT_ATTEMPTS = 2


def submit_idempotent(
    broker: BrokerClient,
    intent: OrderIntent,
    *,
    sleep: Callable[[float], None] = time.sleep,
) -> BrokerOrder:
    """Submit ``intent`` at most ``MAX_SUBMIT_ATTEMPTS`` times without duplicating it.

    After any transient error the order is looked up by ``client_order_id`` and only
    resubmitted if the broker has no record of it. Rejections are not retried.
    """
    client_id = str(intent.id)
    last_error: Exception | None = None
    for attempt in range(1, MAX_SUBMIT_ATTEMPTS + 1):
        if attempt > 1:
            existing = _lookup_with_retry(broker, client_id, sleep)
            if existing is not None:
                log.info("order found after failed submit", extra={"intent_id": client_id})
                return existing
        try:
            return broker.submit_limit_buy(intent)
        except BrokerRejectedError:
            raise
        except BrokerTransientError as exc:
            last_error = exc
            log.warning(
                "transient submit error",
                extra={"intent_id": client_id, "attempt": attempt, "error": str(exc)},
            )
    existing = _lookup_with_retry(broker, client_id, sleep)
    if existing is not None:
        return existing
    raise SubmitFailedError(
        f"submit failed after {MAX_SUBMIT_ATTEMPTS} attempts: {last_error}",
        attempts=MAX_SUBMIT_ATTEMPTS,
    )


def _lookup_with_retry(
    broker: BrokerClient, client_id: str, sleep: Callable[[float], None]
) -> BrokerOrder | None:
    return with_read_retries(lambda: broker.get_order_by_client_id(client_id), sleep=sleep)


def with_read_retries[T](
    fn: Callable[[], T],
    *,
    attempts: int = 4,
    base_delay: float = 0.5,
    sleep: Callable[[float], None] = time.sleep,
) -> T:
    """Run a read with exponential backoff on transient errors (429/5xx/timeouts)."""
    for i in range(attempts):
        try:
            return fn()
        except BrokerTransientError:
            if i == attempts - 1:
                raise
            sleep(base_delay * (2**i))
    raise AssertionError("unreachable")
