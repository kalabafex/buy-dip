"""Market data sources: Protocol, Alpaca implementation, and an in-memory fake."""

from __future__ import annotations

import datetime as dt
from collections.abc import Sequence
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Protocol

import requests
from alpaca.common.exceptions import APIError
from alpaca.data.enums import Adjustment, DataFeed
from alpaca.data.historical.stock import StockHistoricalDataClient
from alpaca.data.models import BarSet, Snapshot, Trade
from alpaca.data.requests import StockBarsRequest, StockLatestTradeRequest, StockSnapshotRequest
from alpaca.data.timeframe import TimeFrame, TimeFrameUnit

from dipbuyer.broker.base import BrokerError, BrokerTransientError, with_read_retries
from dipbuyer.data.calendar import ny_date
from dipbuyer.domain.models import Bar, DaySnapshot
from dipbuyer.domain.money import to_decimal


class MarketDataError(BrokerError):
    pass


class MarketData(Protocol):
    def get_daily_bars(self, symbol: str, start: dt.date, end: dt.date) -> list[Bar]: ...
    def get_latest_trade(self, symbol: str) -> Decimal: ...
    def get_daily_bars_multi(
        self, symbols: Sequence[str], start: dt.date, end: dt.date
    ) -> dict[str, list[Bar]]: ...
    def get_snapshots(self, symbols: Sequence[str]) -> dict[str, DaySnapshot]: ...


MULTI_CHUNK = 100


def _wrap(exc: Exception) -> Exception:
    if isinstance(exc, APIError):
        code = exc.status_code
        if code is None or code == 429 or code >= 500:
            return BrokerTransientError(f"alpaca data {code}: {exc}")
        return MarketDataError(f"alpaca data {code}: {exc}")
    if isinstance(exc, (requests.Timeout, requests.ConnectionError)):
        return BrokerTransientError(f"network: {exc}")
    return exc


class AlpacaMarketData:
    def __init__(self, key_id: str, secret: str, feed: str) -> None:
        if not key_id or not secret:
            raise ValueError("Alpaca data credentials are not configured")
        self._client = StockHistoricalDataClient(key_id, secret)
        self._feed = DataFeed.SIP if feed == "sip" else DataFeed.IEX

    def get_daily_bars(self, symbol: str, start: dt.date, end: dt.date) -> list[Bar]:
        return self.get_daily_bars_multi([symbol], start, end).get(symbol, [])

    def get_daily_bars_multi(
        self, symbols: Sequence[str], start: dt.date, end: dt.date
    ) -> dict[str, list[Bar]]:
        out: dict[str, list[Bar]] = {}
        for i in range(0, len(symbols), MULTI_CHUNK):
            out.update(self._bars_chunk(list(symbols[i : i + MULTI_CHUNK]), start, end))
        return out

    def _bars_chunk(self, symbols: list[str], start: dt.date, end: dt.date) -> dict[str, list[Bar]]:
        req = StockBarsRequest(
            symbol_or_symbols=symbols,
            timeframe=TimeFrame(1, TimeFrameUnit("Day")),
            start=dt.datetime.combine(start, dt.time(), tzinfo=dt.UTC),
            end=dt.datetime.combine(end + dt.timedelta(days=1), dt.time(), tzinfo=dt.UTC),
            adjustment=Adjustment.SPLIT,
            feed=self._feed,
        )

        def fetch() -> object:
            try:
                return self._client.get_stock_bars(req)
            except (APIError, requests.RequestException) as exc:
                raise _wrap(exc) from exc

        result = with_read_retries(fetch)
        if not isinstance(result, BarSet):
            raise MarketDataError("unexpected bars response")
        out: dict[str, list[Bar]] = {}
        for sym, rows in result.data.items():
            bars: list[Bar] = []
            for b in rows:
                day = ny_date(b.timestamp)
                if not start <= day <= end:
                    continue
                bars.append(
                    Bar(
                        symbol=sym,
                        session_date=day,
                        open=to_decimal(b.open),
                        high=to_decimal(b.high),
                        low=to_decimal(b.low),
                        close=to_decimal(b.close),
                        volume=to_decimal(b.volume),
                    )
                )
            out[sym] = sorted(bars, key=lambda x: x.session_date)
        return out

    def get_latest_trade(self, symbol: str) -> Decimal:
        req = StockLatestTradeRequest(symbol_or_symbols=symbol, feed=self._feed)

        def fetch() -> object:
            try:
                return self._client.get_stock_latest_trade(req)
            except (APIError, requests.RequestException) as exc:
                raise _wrap(exc) from exc

        result = with_read_retries(fetch)
        trade = result.get(symbol) if isinstance(result, dict) else None
        if not isinstance(trade, Trade):
            raise MarketDataError(f"no latest trade for {symbol}")
        return to_decimal(trade.price)

    def get_snapshots(self, symbols: Sequence[str]) -> dict[str, DaySnapshot]:
        out: dict[str, DaySnapshot] = {}
        for i in range(0, len(symbols), MULTI_CHUNK):
            req = StockSnapshotRequest(
                symbol_or_symbols=list(symbols[i : i + MULTI_CHUNK]), feed=self._feed
            )

            def fetch(req: StockSnapshotRequest = req) -> object:
                try:
                    return self._client.get_stock_snapshot(req)
                except (APIError, requests.RequestException) as exc:
                    raise _wrap(exc) from exc

            result = with_read_retries(fetch)
            if not isinstance(result, dict):
                raise MarketDataError("unexpected snapshot response")
            for sym, snap in result.items():
                if not isinstance(snap, Snapshot) or snap.daily_bar is None:
                    continue
                db = snap.daily_bar
                last = snap.latest_trade.price if snap.latest_trade is not None else db.close
                prev = (
                    snap.previous_daily_bar.close if snap.previous_daily_bar is not None else None
                )
                out[str(sym)] = DaySnapshot(
                    symbol=str(sym),
                    session_date=ny_date(db.timestamp),
                    open=to_decimal(db.open),
                    high=to_decimal(db.high),
                    low=to_decimal(db.low),
                    last=to_decimal(last),
                    prev_close=to_decimal(prev) if prev is not None else None,
                )
        return out


@dataclass
class FakeMarketData:
    bars: dict[str, list[Bar]] = field(default_factory=dict)
    last: dict[str, Decimal] = field(default_factory=dict)
    snapshots: dict[str, DaySnapshot] = field(default_factory=dict[str, DaySnapshot])
    bar_calls: int = 0

    def add_bars(self, bars: Sequence[Bar]) -> None:
        for b in bars:
            self.bars.setdefault(b.symbol, []).append(b)
        for sym in self.bars:
            self.bars[sym].sort(key=lambda x: x.session_date)

    def get_daily_bars(self, symbol: str, start: dt.date, end: dt.date) -> list[Bar]:
        self.bar_calls += 1
        return [b for b in self.bars.get(symbol, []) if start <= b.session_date <= end]

    def get_latest_trade(self, symbol: str) -> Decimal:
        if symbol not in self.last:
            raise MarketDataError(f"no latest trade for {symbol}")
        return self.last[symbol]

    def get_daily_bars_multi(
        self, symbols: Sequence[str], start: dt.date, end: dt.date
    ) -> dict[str, list[Bar]]:
        self.bar_calls += 1
        return {
            s: [b for b in self.bars.get(s, []) if start <= b.session_date <= end]
            for s in symbols
            if s in self.bars
        }

    def get_snapshots(self, symbols: Sequence[str]) -> dict[str, DaySnapshot]:
        return {s: self.snapshots[s] for s in symbols if s in self.snapshots}
