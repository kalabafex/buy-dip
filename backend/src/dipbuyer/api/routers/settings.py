from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request, status

from dipbuyer.api.deps import DbDep, DepsDep, UserDep, is_elevated
from dipbuyer.api.schemas import KillSwitchIn, ModeIn, SettingsIn, SettingsOut
from dipbuyer.data.calendar import ny_day_bounds, ny_week_bounds
from dipbuyer.domain.enums import TradingMode
from dipbuyer.persistence import repo
from dipbuyer.persistence.db import notify
from dipbuyer.persistence.models import AuditLogRow

router = APIRouter(tags=["settings"])


def _out(db: DbDep, deps: DepsDep) -> SettingsOut:
    row = repo.get_settings_row(db)
    m = repo.settings_model(row)
    now = deps.now()
    d0, d1 = ny_day_bounds(now)
    w0, w1 = ny_week_bounds(now)
    key, secret = deps.env.alpaca_live_key_id, deps.env.alpaca_live_secret
    return SettingsOut(
        **m.model_dump(),
        spend_today=repo.spend_between(db, d0, d1, m.trading_mode),
        spend_week=repo.spend_between(db, w0, w1, m.trading_mode),
        live_keys_configured=bool(key.get_secret_value() and secret.get_secret_value()),
    )


@router.get("/settings", response_model=SettingsOut)
def get_settings(db: DbDep, deps: DepsDep, _: UserDep) -> SettingsOut:
    return _out(db, deps)


@router.put("/settings", response_model=SettingsOut)
def put_settings(body: SettingsIn, db: DbDep, deps: DepsDep, _: UserDep) -> SettingsOut:
    if body.max_weekly_spend_usd < body.max_daily_spend_usd:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "weekly cap must be >= daily cap"
        )
    row = repo.get_settings_row(db, for_update=True)
    for k, v in body.model_dump().items():
        setattr(row, k, v)
    db.add(AuditLogRow(action="settings", detail=body.model_dump(mode="json")))
    db.flush()
    notify(db, "settings", {"changed": "settings"})
    return _out(db, deps)


@router.post("/kill-switch", response_model=SettingsOut)
def kill_switch(
    body: KillSwitchIn, request: Request, db: DbDep, deps: DepsDep, _: UserDep
) -> SettingsOut:
    if not body.on and not is_elevated(request):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "re-authentication required")
    row = repo.get_settings_row(db, for_update=True)
    if row.kill_switch != body.on:
        row.kill_switch = body.on
        row.kill_switch_cancel_pending = body.on
        db.add(AuditLogRow(action="kill_switch", detail={"on": body.on}))
        db.flush()
        notify(db, "settings", {"kill_switch": body.on})
        deps.notifier.send(
            "Kill switch " + ("ON" if body.on else "OFF"),
            "Trading halted; open orders will be canceled." if body.on else "Trading resumed.",
            priority="high",
        )
    return _out(db, deps)


@router.post("/mode", response_model=SettingsOut)
def set_mode(body: ModeIn, request: Request, db: DbDep, deps: DepsDep, _: UserDep) -> SettingsOut:
    if body.mode is TradingMode.LIVE:
        if not is_elevated(request):
            raise HTTPException(status.HTTP_403_FORBIDDEN, "re-authentication required")
        if body.confirm != "LIVE":
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, 'confirm must be "LIVE"')
        if not (
            deps.env.alpaca_live_key_id.get_secret_value()
            and deps.env.alpaca_live_secret.get_secret_value()
        ):
            raise HTTPException(status.HTTP_409_CONFLICT, "live keys are not configured")
    row = repo.get_settings_row(db, for_update=True)
    if row.trading_mode != body.mode.value:
        previous = row.trading_mode
        row.trading_mode = body.mode.value
        db.add(AuditLogRow(action="mode", detail={"from": previous, "to": body.mode.value}))
        db.flush()
        notify(db, "settings", {"trading_mode": body.mode.value})
        deps.notifier.send(
            f"Mode changed to {body.mode.value}", f"Was {previous}.", priority="high"
        )
    return _out(db, deps)
