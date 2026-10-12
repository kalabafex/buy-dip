"""Runs queued ``Backtest`` rows."""

from __future__ import annotations

import datetime as dt
import logging
import uuid
from collections.abc import Callable

from sqlalchemy import text
from sqlalchemy.orm import Session, sessionmaker

from dipbuyer.backtest import WARMUP_CALENDAR_DAYS, run_backtest
from dipbuyer.data.bars import BarService
from dipbuyer.domain.enums import BacktestStatus, TradingMode
from dipbuyer.domain.models import RuleParams
from dipbuyer.persistence import repo
from dipbuyer.persistence.db import notify, session_scope
from dipbuyer.persistence.models import BacktestRow

log = logging.getLogger(__name__)


def claim_next(s: Session) -> uuid.UUID | None:
    row = s.execute(
        text(
            "UPDATE backtests SET status = 'RUNNING' WHERE id = ("
            " SELECT id FROM backtests WHERE status = 'QUEUED'"
            " ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1"
            ") RETURNING id"
        )
    ).first()
    return row[0] if row else None


def run_queued(
    sf: sessionmaker[Session], bar_service_factory: Callable[[TradingMode], BarService]
) -> int:
    ran = 0
    while True:
        with session_scope(sf) as s:
            bt_id = claim_next(s)
            live = repo.settings_model(repo.get_settings_row(s))
            mode = live.trading_mode
            # Same caps as live trading; never let the kill switch blank out a backtest.
            bt_settings = live.model_copy(
                update={"kill_switch": False, "trading_mode": TradingMode.PAPER}
            )
        if bt_id is None:
            return ran
        ran += 1
        try:
            with session_scope(sf) as s:
                bt = s.get_one(BacktestRow, bt_id)
                params = RuleParams.model_validate(bt.rule_snapshot)
                start = bt.start_date - dt.timedelta(days=WARMUP_CALENDAR_DAYS)
                svc = bar_service_factory(mode)
                svc.ensure_cached(s, params.symbol, start, bt.end_date)
                bars = repo.get_bars(s, params.symbol, start, bt.end_date)
                result = run_backtest(
                    params, bars, bt.start_date, bt.end_date, bt.starting_cash, bt_settings
                )
                bt.results = result.to_json()
                bt.status = BacktestStatus.DONE.value
                bt.finished_at = dt.datetime.now(dt.UTC)
                notify(s, "backtest", {"id": str(bt_id), "status": bt.status})
        except Exception as exc:
            log.exception("backtest failed", extra={"backtest_id": str(bt_id)})
            with session_scope(sf) as s:
                bt = s.get_one(BacktestRow, bt_id)
                bt.status = BacktestStatus.FAILED.value
                bt.error = str(exc)[:2000]
                bt.finished_at = dt.datetime.now(dt.UTC)
                notify(s, "backtest", {"id": str(bt_id), "status": bt.status})
