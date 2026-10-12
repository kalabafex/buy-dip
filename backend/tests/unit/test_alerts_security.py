from __future__ import annotations

import json
import logging

import httpx
import pyotp
import respx

from dipbuyer.alerts import NtfyNotifier, make_notifier, ping_heartbeat
from dipbuyer.api.security import RateLimiter, TotpVerifier, hash_password, verify_password
from dipbuyer.logging_setup import RedactingFormatter, SecretFilter

TOPIC = "https://ntfy.example.com/dipbuyer-test"


@respx.mock
def test_ntfy_notifier_posts_title_and_body() -> None:
    route = respx.post(TOPIC).mock(return_value=httpx.Response(200))
    NtfyNotifier(TOPIC).send("Filled SPY", "1 @ 500", priority="high")
    req = route.calls.last.request
    assert req.headers["Title"] == "Filled SPY"
    assert req.headers["Priority"] == "high"
    assert req.content == b"1 @ 500"


@respx.mock
def test_ntfy_failure_is_swallowed() -> None:
    respx.post(TOPIC).mock(return_value=httpx.Response(500))
    NtfyNotifier(TOPIC).send("x", "y")  # does not raise


def test_notifier_noop_when_unset() -> None:
    assert type(make_notifier("")).__name__ == "NullNotifier"


@respx.mock
def test_heartbeat_ping() -> None:
    route = respx.get("https://hc-ping.com/abc").mock(return_value=httpx.Response(200))
    ping_heartbeat("https://hc-ping.com/abc")
    assert route.called
    ping_heartbeat("")  # no-op


def test_password_hashing() -> None:
    h = hash_password("hunter2hunter2")
    assert verify_password(h, "hunter2hunter2")
    assert not verify_password(h, "nope")
    assert not verify_password("", "x")
    assert not verify_password("not-a-hash", "x")


def test_totp_replay_and_window() -> None:
    secret = pyotp.random_base32()
    totp = pyotp.TOTP(secret)
    v = TotpVerifier(secret)
    t = 1_700_000_000
    code = totp.at(t)
    assert v.match(code, t) is not None
    assert v.verify(code, t)
    assert not v.verify(code, t)  # replay
    assert v.verify(totp.at(t + 30), t)  # next step within tolerance
    assert not v.verify(totp.at(t + 120), t)  # outside window
    assert not v.verify("abc", t)
    assert not TotpVerifier("").verify("123456", t)


def test_rate_limiter() -> None:
    rl = RateLimiter(2, 60)
    assert rl.allow("a") and rl.allow("a") and not rl.allow("a")
    assert rl.allow("b")


def test_log_redaction(capsys: object) -> None:
    rec = logging.LogRecord("t", logging.INFO, __file__, 1, "key is SUPERSECRET123", None, None)
    rec.alpaca_secret = "x"  # type: ignore[attr-defined]
    rec.rule_id = "r1"  # type: ignore[attr-defined]
    SecretFilter(["SUPERSECRET123"]).filter(rec)
    out = json.loads(RedactingFormatter("%(message)s").format(rec))
    assert out["message"] == "key is ***"
    assert out["alpaca_secret"] == "***"
    assert out["rule_id"] == "r1"
