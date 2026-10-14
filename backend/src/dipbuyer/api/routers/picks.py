"""Daily picks: today's plan, history, performance, calibration and settings."""

from __future__ import annotations

import datetime as dt
from decimal import Decimal
from typing import Annotated, Any

from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy import select

from dipbuyer.api.deps import DbDep, DepsDep, UserDep
from dipbuyer.api.schemas import (
    PickFamilyOut,
    PickFamilyStats,
    PickModelOut,
    PickOut,
    PicksDayOut,
    PicksDaySummary,
    PicksPerformanceOut,
    PicksPerformancePoint,
    PicksSettingsIn,
    PicksSettingsOut,
)
from dipbuyer.data.calendar import ny_date, session_for
from dipbuyer.domain.enums import BacktestStatus
from dipbuyer.persistence import repo
from dipbuyer.persistence.db import notify
from dipbuyer.persistence.models import DailyPickRow, PickModelRow
from dipbuyer.picks.select import entry_exit_times
from dipbuyer.picks.strategies import FAMILY_DESCRIPTIONS, FAMILY_LABELS, Family
from dipbuyer.worker.picks_trader import latest_model, queue_calibration

router = APIRouter(prefix="/picks", tags=["picks"])

PCT = Decimal("0.0001")
HUNDRED = Decimal(100)


def _pct(x: Decimal | None) -> Decimal | None:
    return None if x is None else (x * HUNDRED).quantize(PCT)


def pick_out(r: DailyPickRow) -> PickOut:
    fam = Family(r.family)
    notional = (r.entry_limit * r.qty).quantize(Decimal("0.01")) if r.qty else None
    return PickOut(
        id=r.id,
        session_date=r.session_date,
        rank=r.rank,
        symbol=r.symbol,
        name=r.name,
        sector=r.sector,
        family=r.family,
        family_label=FAMILY_LABELS[fam],
        family_description=FAMILY_DESCRIPTIONS[fam],
        exit_key=r.exit_key,
        accepted=r.accepted,
        features=r.features,
        open_price=r.open_price,
        entry_limit=r.entry_limit,
        target_price=r.target_price,
        stop_price=r.stop_price,
        target_pct=_pct(r.target_price / r.entry_limit - 1) if r.target_price else None,
        stop_pct=_pct(r.stop_price / r.entry_limit - 1) if r.stop_price else None,
        entry_time=r.entry_time,
        exit_time=r.exit_time,
        expected_return_pct=_pct(r.expected_return) or Decimal(0),
        win_rate=r.win_rate,
        samples=r.samples,
        family_mean_pct=_pct(r.family_mean) or Decimal(0),
        qty=r.qty,
        notional_usd=notional,
        expected_pnl_usd=(notional * r.expected_return).quantize(Decimal("0.01"))
        if notional
        else None,
        status=r.status,
        skip_reason=r.skip_reason,
        mode=r.mode,
        entry_filled_qty=r.entry_filled_qty,
        entry_fill_price=r.entry_fill_price,
        exit_filled_qty=r.exit_filled_qty,
        exit_fill_price=r.exit_fill_price,
        exit_reason=r.exit_reason,
        realized_return_pct=_pct(r.realized_return),
        realized_pnl_usd=r.realized_pnl_usd,
        plan_return_pct=_pct(r.plan_return),
        plan_exit_reason=r.plan_exit_reason,
        plan_exit_price=r.plan_exit_price,
        day_open=r.day_open,
        day_high=r.day_high,
        day_low=r.day_low,
        day_close=r.day_close,
        error=r.error,
    )


def model_out(m: PickModelRow) -> PickModelOut:
    fams: list[PickFamilyOut] = []
    summary: dict[str, Any] = m.summary or {}
    for key, f in (summary.get("families") or {}).items():
        fam = Family(key)
        fams.append(
            PickFamilyOut(
                family=key,
                label=FAMILY_LABELS[fam],
                description=FAMILY_DESCRIPTIONS[fam],
                exit_key=f["exit"]["key"],
                target_atr=f["exit"]["target_atr"],
                stop_atr=f["exit"]["stop_atr"],
                accepted=f["accepted"],
                train=PickFamilyStats(**f["train"]),
                validation=PickFamilyStats(**f["validation"]),
            )
        )
    split = summary.get("split_date")
    return PickModelOut(
        id=m.id,
        status=BacktestStatus(m.status),
        progress=m.progress,
        data_start=m.data_start,
        data_end=m.data_end,
        split_date=dt.date.fromisoformat(split) if split else None,
        symbols=m.symbols,
        families=fams,
        error=m.error,
        created_at=m.created_at,
        finished_at=m.finished_at,
    )


def _settings_out(db: DbDep) -> PicksSettingsOut:
    row = repo.get_settings_row(db)
    return PicksSettingsOut(
        autotrade=row.picks_autotrade,
        notional_usd=row.picks_notional_usd,
        min_expected_pct=row.picks_min_expected_pct,
        trading_mode=repo.settings_model(row).trading_mode,
    )


@router.get("/day", response_model=PicksDayOut)
def picks_day(db: DbDep, deps: DepsDep, _: UserDep, date: dt.date | None = None) -> PicksDayOut:
    """Picks for ``date`` (default: today in New York, or the latest day with picks)."""
    day = date or ny_date(deps.now())
    rows = list(
        db.scalars(
            select(DailyPickRow).where(DailyPickRow.session_date == day).order_by(DailyPickRow.rank)
        )
    )
    sess = session_for(day)
    entry_at, exit_at = entry_exit_times(sess.open, sess.close) if sess else (None, None)
    plan = [r.plan_return for r in rows if r.plan_return is not None]
    real = [r.realized_pnl_usd for r in rows if r.realized_pnl_usd is not None]
    model = latest_model(db)
    running = db.scalars(
        select(PickModelRow)
        .where(PickModelRow.status.in_([BacktestStatus.QUEUED.value, BacktestStatus.RUNNING.value]))
        .order_by(PickModelRow.created_at.desc())
        .limit(1)
    ).one_or_none()
    return PicksDayOut(
        session_date=day,
        is_trading_day=sess is not None,
        entry_time=entry_at,
        exit_time=exit_at,
        generated=bool(rows),
        picks=[pick_out(r) for r in rows],
        plan_return_avg_pct=_pct(sum(plan, Decimal(0)) / len(plan)) if plan else None,
        realized_pnl_usd=sum(real, Decimal(0)) if real else None,
        settings=_settings_out(db),
        model=model_out(model) if model else None,
        calibration_in_progress=model_out(running) if running else None,
    )


@router.get("/days", response_model=list[PicksDaySummary])
def picks_days(
    db: DbDep, _: UserDep, limit: Annotated[int, Query(ge=1, le=365)] = 60
) -> list[PicksDaySummary]:
    rows = list(
        db.scalars(
            select(DailyPickRow).order_by(DailyPickRow.session_date.desc(), DailyPickRow.rank)
        )
    )
    by_day: dict[dt.date, list[DailyPickRow]] = {}
    for r in rows:
        by_day.setdefault(r.session_date, []).append(r)
    out: list[PicksDaySummary] = []
    for day in sorted(by_day, reverse=True)[:limit]:
        rs = by_day[day]
        plan = [r.plan_return for r in rs if r.plan_return is not None]
        real = [r.realized_pnl_usd for r in rs if r.realized_pnl_usd is not None]
        out.append(
            PicksDaySummary(
                session_date=day,
                picks=len(rs),
                traded=sum(1 for r in rs if r.entry_filled_qty),
                expected_avg_pct=_pct(sum((r.expected_return for r in rs), Decimal(0)) / len(rs))
                or Decimal(0),
                plan_return_avg_pct=_pct(sum(plan, Decimal(0)) / len(plan)) if plan else None,
                plan_wins=sum(1 for p in plan if p > 0),
                realized_pnl_usd=sum(real, Decimal(0)) if real else None,
                realized_wins=sum(1 for p in real if p > 0),
            )
        )
    return out


@router.get("/performance", response_model=PicksPerformanceOut)
def picks_performance(db: DbDep, _: UserDep) -> PicksPerformanceOut:
    rows = list(db.scalars(select(DailyPickRow).order_by(DailyPickRow.session_date)))
    days = sorted({r.session_date for r in rows})
    plan = [r for r in rows if r.plan_return is not None]
    traded = [r for r in rows if r.realized_pnl_usd is not None]
    series: list[PicksPerformancePoint] = []
    cum_plan, cum_real = Decimal(0), Decimal(0)
    for day in days:
        dp = [r.plan_return for r in plan if r.session_date == day and r.plan_return is not None]
        if dp:
            cum_plan += sum(dp, Decimal(0)) / len(dp)
        cum_real += sum(
            (r.realized_pnl_usd or Decimal(0) for r in traded if r.session_date == day), Decimal(0)
        )
        series.append(
            PicksPerformancePoint(
                session_date=day,
                plan_cum_pct=_pct(cum_plan) or Decimal(0),
                realized_cum_usd=cum_real,
            )
        )
    by_family: dict[str, dict[str, Any]] = {}
    for r in plan:
        f = by_family.setdefault(
            r.family, {"label": FAMILY_LABELS[Family(r.family)], "n": 0, "wins": 0, "sum": 0.0}
        )
        f["n"] += 1
        f["wins"] += 1 if (r.plan_return or 0) > 0 else 0
        f["sum"] += float(r.plan_return or 0)
    for f in by_family.values():
        f["win_rate"] = round(f["wins"] / f["n"], 4)
        f["avg_pct"] = round(f.pop("sum") / f["n"] * 100, 4)
    return PicksPerformanceOut(
        days=len(days),
        picks=len(rows),
        plan_evaluated=len(plan),
        plan_win_rate=(sum(1 for r in plan if (r.plan_return or 0) > 0) / len(plan))
        if plan
        else None,
        plan_avg_pct=_pct(sum((r.plan_return or Decimal(0) for r in plan), Decimal(0)) / len(plan))
        if plan
        else None,
        expected_avg_pct=_pct(sum((r.expected_return for r in rows), Decimal(0)) / len(rows))
        if rows
        else None,
        traded=len(traded),
        realized_win_rate=(
            sum(1 for r in traded if (r.realized_pnl_usd or 0) > 0) / len(traded)
            if traded
            else None
        ),
        realized_pnl_usd=sum((r.realized_pnl_usd or Decimal(0) for r in traded), Decimal(0)),
        by_family=by_family,
        series=series,
    )


@router.get("/model", response_model=PickModelOut | None)
def picks_model(db: DbDep, _: UserDep) -> PickModelOut | None:
    row = db.scalars(
        select(PickModelRow).order_by(PickModelRow.created_at.desc()).limit(1)
    ).one_or_none()
    return model_out(row) if row else None


@router.post("/model/calibrate", response_model=PickModelOut, status_code=201)
def calibrate_now(db: DbDep, _: UserDep) -> PickModelOut:
    row = queue_calibration(db)
    notify(db, "picks", {"model": str(row.id), "status": row.status})
    return model_out(row)


@router.get("/settings", response_model=PicksSettingsOut)
def get_picks_settings(db: DbDep, _: UserDep) -> PicksSettingsOut:
    return _settings_out(db)


@router.put("/settings", response_model=PicksSettingsOut)
def put_picks_settings(
    body: PicksSettingsIn, db: DbDep, deps: DepsDep, _: UserDep
) -> PicksSettingsOut:
    row = repo.get_settings_row(db, for_update=True)
    if body.autotrade and repo.settings_model(row).trading_mode.value != "PAPER":
        raise HTTPException(
            status.HTTP_409_CONFLICT, "picks auto-trade is only available in PAPER mode"
        )
    changed = row.picks_autotrade != body.autotrade
    row.picks_autotrade = body.autotrade
    row.picks_notional_usd = body.notional_usd
    row.picks_min_expected_pct = body.min_expected_pct
    db.flush()
    notify(db, "settings", {"picks": True})
    if changed:
        deps.notifier.send(
            "Picks auto-trade " + ("ON" if body.autotrade else "OFF"),
            f"${body.notional_usd} per pick, paper account only.",
        )
    return _settings_out(db)
