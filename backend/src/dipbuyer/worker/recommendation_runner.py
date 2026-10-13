"""Runs queued ``Recommendation`` rows (history-based rule recommendations)."""

from __future__ import annotations

import datetime as dt
import logging
import os
import uuid
from collections.abc import Callable

from sqlalchemy import text, update
from sqlalchemy.orm import Session, sessionmaker

from dipbuyer.data.bars import BarService
from dipbuyer.data.calendar import ny_date, previous_session
from dipbuyer.domain.constants import HISTORY_CALENDAR_DAYS
from dipbuyer.domain.enums import BacktestStatus, TradingMode
from dipbuyer.persistence import repo
from dipbuyer.persistence.db import notify, session_scope
from dipbuyer.persistence.models import RecommendationRow
from dipbuyer.recommend import recommend

log = logging.getLogger(__name__)


def claim_next(s: Session) -> uuid.UUID | None:
    row = s.execute(
        text(
            "UPDATE recommendations SET status = 'RUNNING' WHERE id = ("
            " SELECT id FROM recommendations WHERE status = 'QUEUED'"
            " ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1"
            ") RETURNING id"
        )
    ).first()
    return row[0] if row else None


def default_workers() -> int:
    return max(1, min(4, (os.cpu_count() or 2) - 1))


def _progress_writer(sf: sessionmaker[Session], rec_id: uuid.UUID) -> Callable[[int, int], None]:
    """Persist progress in ~5% steps (and notify SSE subscribers)."""
    last_pct = -1

    def progress(done: int, total: int) -> None:
        nonlocal last_pct
        pct = int(done * 100 / total)
        if pct - last_pct >= 5 or done == total:
            last_pct = pct
            with session_scope(sf) as s:
                s.execute(
                    update(RecommendationRow)
                    .where(RecommendationRow.id == rec_id)
                    .values(progress=min(pct, 99))
                )
                notify(s, "recommendation", {"id": str(rec_id), "progress": pct})

    return progress


def run_queued(
    sf: sessionmaker[Session],
    bar_service_factory: Callable[[TradingMode], BarService],
    *,
    now: Callable[[], dt.datetime] = lambda: dt.datetime.now(dt.UTC),
    max_workers: int | None = None,
) -> int:
    ran = 0
    while True:
        with session_scope(sf) as s:
            rec_id = claim_next(s)
            mode = repo.settings_model(repo.get_settings_row(s)).trading_mode
        if rec_id is None:
            return ran
        ran += 1
        try:
            with session_scope(sf) as s:
                row = s.get_one(RecommendationRow, rec_id)
                end = previous_session(ny_date(now()))
                start = end - dt.timedelta(days=row.years * 365 + HISTORY_CALENDAR_DAYS)
                svc = bar_service_factory(mode)
                svc.ensure_cached(s, row.symbol, start, end)
                bars = repo.get_bars(s, row.symbol, start, end)
                symbol, budget, max_pos = row.symbol, row.budget_per_dip_usd, row.max_position_usd
            result = recommend(
                symbol,
                bars,
                progress=_progress_writer(sf, rec_id),
                max_workers=max_workers or default_workers(),
            )
            with session_scope(sf) as s:
                row = s.get_one(RecommendationRow, rec_id)
                row.results = result.to_json(budget, max_pos)
                row.status = BacktestStatus.DONE.value
                row.progress = 100
                row.finished_at = dt.datetime.now(dt.UTC)
                notify(s, "recommendation", {"id": str(rec_id), "status": row.status})
        except Exception as exc:
            log.exception("recommendation failed", extra={"recommendation_id": str(rec_id)})
            with session_scope(sf) as s:
                row = s.get_one(RecommendationRow, rec_id)
                row.status = BacktestStatus.FAILED.value
                row.error = str(exc)[:2000]
                row.finished_at = dt.datetime.now(dt.UTC)
                notify(s, "recommendation", {"id": str(rec_id), "status": row.status})
