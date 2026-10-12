from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, status
from pydantic import ValidationError

from dipbuyer.api.deps import DbDep, DepsDep, UserDep
from dipbuyer.api.schemas import ChartOut, EnabledIn, PreviewOut, RuleOut
from dipbuyer.api.services import chart, preview, rule_out
from dipbuyer.broker import BrokerError
from dipbuyer.domain.models import RuleParams
from dipbuyer.persistence import repo
from dipbuyer.persistence.db import notify
from dipbuyer.persistence.models import RuleRow

router = APIRouter(prefix="/rules", tags=["rules"])


def _get(db: DbDep, rule_id: uuid.UUID) -> RuleRow:
    row = repo.get_rule_row(db, rule_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "rule not found")
    return row


def _validate_symbol(deps: DepsDep, db: DbDep, symbol: str) -> None:
    mode = repo.settings_model(repo.get_settings_row(db)).trading_mode
    try:
        asset = deps.asset_lookup(symbol, mode)
    except (BrokerError, ValueError) as exc:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE, f"cannot validate symbol: {exc}"
        ) from exc
    if asset is None or not asset.tradable:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, f"{symbol} is not tradable")


@router.get("", response_model=list[RuleOut])
def list_rules(db: DbDep, _: UserDep) -> list[RuleOut]:
    return [rule_out(db, r) for r in repo.list_rules(db)]


@router.post("", response_model=RuleOut, status_code=201)
def create_rule(body: RuleParams, db: DbDep, deps: DepsDep, _: UserDep) -> RuleOut:
    _validate_symbol(deps, db, body.symbol)
    row = RuleRow(id=uuid.uuid4())
    repo.apply_params(row, body)
    db.add(row)
    db.flush()
    db.refresh(row)
    return rule_out(db, row)


@router.post("/preview", response_model=PreviewOut)
def preview_params(body: RuleParams, db: DbDep, deps: DepsDep, _: UserDep) -> PreviewOut:
    """Preview for unsaved rule parameters (used by the create form)."""
    return _preview(db, deps, body, None)


@router.get("/{rule_id}", response_model=RuleOut)
def get_rule(rule_id: uuid.UUID, db: DbDep, _: UserDep) -> RuleOut:
    return rule_out(db, _get(db, rule_id))


@router.put("/{rule_id}", response_model=RuleOut)
def update_rule(
    rule_id: uuid.UUID, body: RuleParams, db: DbDep, deps: DepsDep, _: UserDep
) -> RuleOut:
    row = _get(db, rule_id)
    if body.symbol != row.symbol:
        if repo.get_active_cycle(db, rule_id) is not None or repo.has_open_intent(
            db, rule_id, repo.settings_model(repo.get_settings_row(db)).trading_mode
        ):
            raise HTTPException(
                status.HTTP_409_CONFLICT, "cannot change symbol while a cycle or order is open"
            )
        _validate_symbol(deps, db, body.symbol)
    repo.apply_params(row, body)
    db.flush()
    return rule_out(db, row)


@router.delete("/{rule_id}", status_code=204)
def delete_rule(rule_id: uuid.UUID, db: DbDep, deps: DepsDep, _: UserDep) -> None:
    row = _get(db, rule_id)
    row.enabled = False
    row.deleted_at = deps.now()


@router.patch("/{rule_id}/enabled", response_model=RuleOut)
def set_enabled(rule_id: uuid.UUID, body: EnabledIn, db: DbDep, _: UserDep) -> RuleOut:
    row = _get(db, rule_id)
    row.enabled = body.enabled
    db.flush()
    notify(db, "settings", {"rule_id": str(rule_id), "enabled": body.enabled})
    return rule_out(db, row)


def _preview(db: DbDep, deps: DepsDep, params: RuleParams, rule_id: uuid.UUID | None) -> PreviewOut:
    mode = repo.settings_model(repo.get_settings_row(db)).trading_mode
    try:
        return preview(db, deps.bar_service(mode), params, rule_id, deps.now())
    except (BrokerError, ValueError) as exc:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, f"market data: {exc}") from exc


@router.get("/{rule_id}/preview", response_model=PreviewOut)
def preview_rule(rule_id: uuid.UUID, db: DbDep, deps: DepsDep, _: UserDep) -> PreviewOut:
    row = _get(db, rule_id)
    try:
        params = repo.rule_from_row(row)
    except ValidationError as exc:  # pragma: no cover - rows are validated on write
        raise HTTPException(500, str(exc)) from exc
    return _preview(db, deps, params, rule_id)


@router.get("/{rule_id}/chart", response_model=ChartOut)
def rule_chart(
    rule_id: uuid.UUID,
    db: DbDep,
    deps: DepsDep,
    _: UserDep,
    days: Annotated[int, Query(ge=5, le=1500)] = 180,
) -> ChartOut:
    row = _get(db, rule_id)
    mode = repo.settings_model(repo.get_settings_row(db)).trading_mode
    try:
        return chart(db, deps.bar_service(mode), row, days, deps.now())
    except (BrokerError, ValueError) as exc:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, f"market data: {exc}") from exc
