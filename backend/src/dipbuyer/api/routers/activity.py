from __future__ import annotations

import datetime as dt
import uuid
from typing import Annotated, Any

from fastapi import APIRouter, Query
from sqlalchemy import Select, func, select

from dipbuyer.api.deps import DbDep, UserDep
from dipbuyer.api.schemas import (
    AccountOut,
    EvaluationOut,
    EvaluationPage,
    OrderOut,
    OrderPage,
    PositionOut,
)
from dipbuyer.domain.enums import Decision, OrderStatus, TradingMode
from dipbuyer.persistence.models import (
    AccountSnapshotRow,
    EvaluationRow,
    OrderIntentRow,
    PositionSnapshotRow,
    RuleRow,
)

router = APIRouter(tags=["activity"])

Limit = Annotated[int, Query(ge=1, le=500)]
Offset = Annotated[int, Query(ge=0)]


def _count(db: DbDep, stmt: Select[*tuple[Any, ...]]) -> int:
    return db.scalar(select(func.count()).select_from(stmt.order_by(None).subquery())) or 0


@router.get("/orders", response_model=OrderPage)
def list_orders(
    db: DbDep,
    _: UserDep,
    symbol: str | None = None,
    status: Annotated[list[OrderStatus] | None, Query()] = None,
    rule_id: uuid.UUID | None = None,
    from_: Annotated[dt.datetime | None, Query(alias="from")] = None,
    to: dt.datetime | None = None,
    limit: Limit = 50,
    offset: Offset = 0,
) -> OrderPage:
    stmt = select(OrderIntentRow)
    if symbol:
        stmt = stmt.where(OrderIntentRow.symbol == symbol.upper())
    if status:
        stmt = stmt.where(OrderIntentRow.status.in_([s.value for s in status]))
    if rule_id:
        stmt = stmt.where(OrderIntentRow.rule_id == rule_id)
    if from_:
        stmt = stmt.where(OrderIntentRow.created_at >= from_)
    if to:
        stmt = stmt.where(OrderIntentRow.created_at < to)
    total = _count(db, stmt)
    rows = db.scalars(
        stmt.order_by(OrderIntentRow.created_at.desc()).limit(limit).offset(offset)
    ).all()
    return OrderPage(
        items=[OrderOut.model_validate(r, from_attributes=True) for r in rows],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.get("/evaluations", response_model=EvaluationPage)
def list_evaluations(
    db: DbDep,
    _: UserDep,
    rule_id: uuid.UUID | None = None,
    decision: Annotated[list[Decision] | None, Query()] = None,
    triggered_only: bool = False,
    from_: Annotated[dt.datetime | None, Query(alias="from")] = None,
    to: dt.datetime | None = None,
    limit: Limit = 50,
    offset: Offset = 0,
) -> EvaluationPage:
    stmt = select(EvaluationRow, RuleRow.symbol).join(RuleRow, RuleRow.id == EvaluationRow.rule_id)
    if rule_id:
        stmt = stmt.where(EvaluationRow.rule_id == rule_id)
    if decision:
        stmt = stmt.where(EvaluationRow.decision.in_([d.value for d in decision]))
    if triggered_only:
        stmt = stmt.where(EvaluationRow.tier_hit.is_not(None))
    if from_:
        stmt = stmt.where(EvaluationRow.ts >= from_)
    if to:
        stmt = stmt.where(EvaluationRow.ts < to)
    total = _count(db, stmt)
    rows = db.execute(
        stmt.order_by(EvaluationRow.ts.desc(), EvaluationRow.id.desc()).limit(limit).offset(offset)
    ).all()
    items = [
        EvaluationOut(
            id=e.id,
            rule_id=e.rule_id,
            symbol=sym,
            ts=e.ts,
            last_price=e.last_price,
            ref_high=e.ref_high,
            sma50=e.sma50,
            sma200=e.sma200,
            rsi14=e.rsi14,
            pullback_pct=e.pullback_pct,
            condition_met=e.condition_met,
            consecutive_met=e.consecutive_met,
            tier_hit=e.tier_hit,
            decision=Decision(e.decision),
            reason=e.reason,
        )
        for e, sym in rows
    ]
    return EvaluationPage(items=items, total=total, limit=limit, offset=offset)


def _latest_snapshot(db: DbDep) -> AccountSnapshotRow | None:
    return db.scalars(
        select(AccountSnapshotRow).order_by(AccountSnapshotRow.ts.desc()).limit(1)
    ).one_or_none()


@router.get("/account", response_model=AccountOut | None)
def account(db: DbDep, _: UserDep) -> AccountOut | None:
    snap = _latest_snapshot(db)
    if snap is None:
        return None
    return AccountOut(
        ts=snap.ts,
        mode=TradingMode(snap.mode),
        equity=snap.equity,
        cash=snap.cash,
        buying_power=snap.buying_power,
    )


@router.get("/positions", response_model=list[PositionOut])
def positions(db: DbDep, _: UserDep) -> list[PositionOut]:
    snap = _latest_snapshot(db)
    if snap is None:
        return []
    rows = db.scalars(
        select(PositionSnapshotRow)
        .where(PositionSnapshotRow.account_snapshot_id == snap.id)
        .order_by(PositionSnapshotRow.symbol)
    )
    return [PositionOut.model_validate(r, from_attributes=True) for r in rows]
