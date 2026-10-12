from __future__ import annotations

import uuid

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select

from dipbuyer.api.deps import DbDep, UserDep
from dipbuyer.api.schemas import BacktestCreated, BacktestIn, BacktestOut
from dipbuyer.domain.enums import BacktestStatus
from dipbuyer.persistence import repo
from dipbuyer.persistence.models import BacktestRow

router = APIRouter(prefix="/backtests", tags=["backtests"])


@router.post("", response_model=BacktestCreated, status_code=201)
def create_backtest(body: BacktestIn, db: DbDep, _: UserDep) -> BacktestCreated:
    if body.end_date <= body.start_date:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "end_date must be after start")
    if body.params is not None:
        params = body.params
    elif body.rule_id is not None:
        row = repo.get_rule_row(db, body.rule_id)
        if row is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "rule not found")
        params = repo.rule_from_row(row)
    else:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "rule_id or params required")
    snapshot = params.model_dump(
        mode="json", exclude={"id", "created_at", "updated_at", "deleted_at"}
    )
    bt = BacktestRow(
        id=uuid.uuid4(),
        rule_id=body.rule_id,
        rule_snapshot=snapshot,
        start_date=body.start_date,
        end_date=body.end_date,
        starting_cash=body.starting_cash,
        status=BacktestStatus.QUEUED.value,
    )
    db.add(bt)
    return BacktestCreated(id=bt.id)


@router.get("", response_model=list[BacktestOut])
def list_backtests(db: DbDep, _: UserDep) -> list[BacktestOut]:
    rows = db.scalars(select(BacktestRow).order_by(BacktestRow.created_at.desc()).limit(50))
    out: list[BacktestOut] = []
    for r in rows:
        b = BacktestOut.model_validate(r, from_attributes=True)
        out.append(b.model_copy(update={"results": None}))
    return out


@router.get("/{backtest_id}", response_model=BacktestOut)
def get_backtest(backtest_id: uuid.UUID, db: DbDep, _: UserDep) -> BacktestOut:
    row = db.get(BacktestRow, backtest_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "backtest not found")
    return BacktestOut.model_validate(row, from_attributes=True)
