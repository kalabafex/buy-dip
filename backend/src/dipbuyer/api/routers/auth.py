from __future__ import annotations

import datetime as dt
import secrets
import time

from fastapi import APIRouter, HTTPException, Request, Response, status

from dipbuyer.api.deps import ELEVATION_SECONDS, DepsDep, UserDep
from dipbuyer.api.schemas import LoginIn, MeOut, ReauthIn
from dipbuyer.api.security import RateLimiter, TotpVerifier, verify_password

router = APIRouter(prefix="/auth", tags=["auth"])


def _limiter(request: Request) -> RateLimiter:
    limiter: RateLimiter = request.app.state.auth_limiter
    return limiter


def _check_rate(request: Request) -> None:
    key = request.client.host if request.client else "unknown"
    if not _limiter(request).allow(key):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "too many attempts")


def _verify(request: Request, deps: DepsDep, password: str, code: str) -> bool:
    env = deps.env
    ok_pw = verify_password(env.app_admin_password_hash.get_secret_value(), password)
    # Always check TOTP too so timing does not reveal which factor failed. The code is only
    # consumed (replay protection) when both factors are correct.
    totp: TotpVerifier = request.app.state.totp
    step = totp.match(code)
    return ok_pw and step is not None and totp.consume(step)


@router.post("/login", response_model=MeOut)
def login(body: LoginIn, request: Request, deps: DepsDep) -> MeOut:
    _check_rate(request)
    user_ok = secrets.compare_digest(body.username, deps.env.app_admin_username)
    if not (_verify(request, deps, body.password, body.totp) and user_ok):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid credentials")
    request.session.clear()
    request.session["user"] = deps.env.app_admin_username
    request.session["iat"] = int(time.time())
    return MeOut(username=deps.env.app_admin_username, elevated_until=None)


@router.post("/logout", status_code=204)
def logout(request: Request) -> Response:
    _check_rate(request)
    request.session.clear()
    return Response(status_code=204)


@router.post("/reauth", response_model=MeOut)
def reauth(body: ReauthIn, request: Request, deps: DepsDep, user: UserDep) -> MeOut:
    _check_rate(request)
    if not _verify(request, deps, body.password, body.totp):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid credentials")
    until = time.time() + ELEVATION_SECONDS
    request.session["elevated_until"] = until
    return MeOut(username=user, elevated_until=dt.datetime.fromtimestamp(until, dt.UTC))


@router.get("/me", response_model=MeOut)
def me(request: Request, user: UserDep) -> MeOut:
    until = request.session.get("elevated_until")
    elevated = (
        dt.datetime.fromtimestamp(until, dt.UTC)
        if isinstance(until, (int, float)) and until > time.time()
        else None
    )
    return MeOut(username=user, elevated_until=elevated)
