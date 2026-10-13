from __future__ import annotations

import uuid

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select

from dipbuyer.api.deps import DbDep, DepsDep, UserDep
from dipbuyer.api.routers.rules import validate_symbol
from dipbuyer.api.schemas import (
    BacktestCreated,
    RecommendationApplyIn,
    RecommendationIn,
    RecommendationOut,
    RecommendationResults,
    RuleOut,
)
from dipbuyer.api.services import rule_out
from dipbuyer.domain.enums import BacktestStatus
from dipbuyer.domain.models import RuleParams
from dipbuyer.persistence import repo
from dipbuyer.persistence.db import notify
from dipbuyer.persistence.models import RecommendationRow, RuleRow

router = APIRouter(prefix="/recommendations", tags=["recommendations"])


def _out(row: RecommendationRow, *, with_results: bool = True) -> RecommendationOut:
    results = (
        RecommendationResults.model_validate(row.results)
        if with_results and row.results is not None
        else None
    )
    return RecommendationOut(
        id=row.id,
        symbol=row.symbol,
        years=row.years,
        budget_per_dip_usd=row.budget_per_dip_usd,
        max_position_usd=row.max_position_usd,
        status=BacktestStatus(row.status),
        progress=row.progress,
        results=results,
        error=row.error,
        created_at=row.created_at,
        finished_at=row.finished_at,
    )


@router.post("", response_model=BacktestCreated, status_code=201)
def create_recommendation(
    body: RecommendationIn, db: DbDep, deps: DepsDep, _: UserDep
) -> BacktestCreated:
    symbol = body.symbol.strip().upper()
    if body.max_position_usd < body.budget_per_dip_usd:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "max_position_usd must be >= budget_per_dip_usd"
        )
    validate_symbol(deps, db, symbol)
    row = RecommendationRow(
        id=uuid.uuid4(),
        symbol=symbol,
        years=body.years,
        budget_per_dip_usd=body.budget_per_dip_usd,
        max_position_usd=body.max_position_usd,
        status=BacktestStatus.QUEUED.value,
        progress=0,
    )
    db.add(row)
    return BacktestCreated(id=row.id)


@router.get("", response_model=list[RecommendationOut])
def list_recommendations(db: DbDep, _: UserDep) -> list[RecommendationOut]:
    rows = db.scalars(
        select(RecommendationRow).order_by(RecommendationRow.created_at.desc()).limit(50)
    )
    return [_out(r, with_results=False) for r in rows]


def _get(db: DbDep, rec_id: uuid.UUID) -> RecommendationRow:
    row = db.get(RecommendationRow, rec_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "recommendation not found")
    return row


@router.get("/{rec_id}", response_model=RecommendationOut)
def get_recommendation(rec_id: uuid.UUID, db: DbDep, _: UserDep) -> RecommendationOut:
    return _out(_get(db, rec_id))


@router.delete("/{rec_id}", status_code=204)
def delete_recommendation(rec_id: uuid.UUID, db: DbDep, _: UserDep) -> None:
    db.delete(_get(db, rec_id))


@router.post("/{rec_id}/apply", response_model=RuleOut, status_code=201)
def apply_recommendation(
    rec_id: uuid.UUID, body: RecommendationApplyIn, db: DbDep, _: UserDep
) -> RuleOut:
    """Create a rule from one recommended configuration."""
    row = _get(db, rec_id)
    if row.results is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "recommendation has no results yet")
    results = RecommendationResults.model_validate(row.results)
    items = [*results.recommendations, *([results.reference] if results.reference else [])]
    item = next((i for i in items if i.key == body.key), None)
    if item is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"no recommendation with key {body.key}")
    params = RuleParams.model_validate(
        {**item.params.model_dump(), "symbol": row.symbol, "enabled": body.enabled}
    )
    rule = RuleRow(id=uuid.uuid4())
    repo.apply_params(rule, params)
    db.add(rule)
    db.flush()
    db.refresh(rule)
    notify(db, "settings", {"rule_id": str(rule.id), "created_from": str(rec_id)})
    return rule_out(db, rule)
