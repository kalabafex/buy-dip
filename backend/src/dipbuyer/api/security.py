"""Password (argon2) and TOTP (RFC 6238) verification plus a small rate limiter."""

from __future__ import annotations

import hmac
import threading
import time
from collections import deque

import pyotp
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError

_hasher = PasswordHasher()


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password_hash: str, password: str) -> bool:
    if not password_hash:
        return False
    try:
        return _hasher.verify(password_hash, password)
    except (VerificationError, InvalidHashError):
        return False


class TotpVerifier:
    """Verifies codes with ±1 step tolerance and rejects replay of a used step."""

    def __init__(self, secret: str) -> None:
        self.secret = secret
        self._last_step = -1
        self._lock = threading.Lock()

    def match(self, code: str, now: float | None = None) -> int | None:
        """Return the unused time step ``code`` is valid for, without consuming it."""
        if not self.secret or not code.isdigit():
            return None
        totp = pyotp.TOTP(self.secret)
        t = time.time() if now is None else now
        step_now = int(t // totp.interval)
        with self._lock:
            for step in (step_now - 1, step_now, step_now + 1):
                if step > self._last_step and hmac.compare_digest(
                    totp.at(step * totp.interval), code
                ):
                    return step
        return None

    def consume(self, step: int) -> bool:
        """Mark ``step`` used. False if it (or a later step) was already used."""
        with self._lock:
            if step <= self._last_step:
                return False
            self._last_step = step
            return True

    def verify(self, code: str, now: float | None = None) -> bool:
        step = self.match(code, now)
        return step is not None and self.consume(step)


class RateLimiter:
    """Sliding-window limiter keyed by client address."""

    def __init__(self, max_requests: int, window_seconds: float) -> None:
        self.max = max_requests
        self.window = window_seconds
        self._hits: dict[str, deque[float]] = {}
        self._lock = threading.Lock()

    def allow(self, key: str) -> bool:
        now = time.monotonic()
        with self._lock:
            q = self._hits.setdefault(key, deque())
            while q and now - q[0] > self.window:
                q.popleft()
            if len(q) >= self.max:
                return False
            q.append(now)
            return True
