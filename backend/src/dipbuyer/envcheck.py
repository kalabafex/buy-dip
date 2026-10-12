"""Pre-flight validation of the ``.env`` file used by docker compose (``just up``)."""

from __future__ import annotations

import base64
import binascii
from dataclasses import dataclass, field
from pathlib import Path

from dotenv import dotenv_values

REQUIRED_NON_EMPTY = ("SESSION_SECRET", "APP_ADMIN_PASSWORD_HASH", "APP_TOTP_SECRET")


@dataclass
class EnvReport:
    errors: list[str] = field(default_factory=list[str])
    warnings: list[str] = field(default_factory=list[str])

    @property
    def ok(self) -> bool:
        return not self.errors


def _raw_assignments(text: str) -> dict[str, list[str]]:
    """Key -> raw right-hand sides, in file order (to spot duplicates and quoting)."""
    out: dict[str, list[str]] = {}
    for line in text.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        key, _, raw = stripped.partition("=")
        key = key.removeprefix("export ").strip()
        out.setdefault(key, []).append(raw.strip())
    return out


def check_env_file(path: Path) -> EnvReport:
    report = EnvReport()
    if not path.exists():
        report.errors.append(f"{path} not found: copy .env.example to .env and fill it in")
        return report
    text = path.read_text(encoding="utf-8-sig")
    raw = _raw_assignments(text)
    values = {k: (v or "") for k, v in dotenv_values(path).items()}

    for key, rhs in raw.items():
        if len(rhs) > 1:
            report.warnings.append(
                f"{key} is set {len(rhs)} times; the last one wins. Remove the extra lines."
            )
        last = rhs[-1]
        if last and not last.startswith(("'", '"')) and " #" in last:
            report.warnings.append(f"{key}: move the inline '# ...' comment to its own line")

    for key in REQUIRED_NON_EMPTY:
        if not values.get(key):
            hint = {
                "SESSION_SECRET": "`just gen-secret`",
                "APP_ADMIN_PASSWORD_HASH": "`just hash-pw`",
                "APP_TOTP_SECRET": "`just gen-totp`",
            }[key]
            report.errors.append(f"{key} is empty: generate it with {hint}")

    secret = values.get("SESSION_SECRET", "")
    if secret and len(secret) < 32:
        report.errors.append(
            f"SESSION_SECRET is {len(secret)} characters; it needs at least 32 "
            "(`just gen-secret` prints one)"
        )

    pw_hash = values.get("APP_ADMIN_PASSWORD_HASH", "")
    if pw_hash:
        if not pw_hash.startswith("$argon2"):
            report.errors.append(
                "APP_ADMIN_PASSWORD_HASH is not an argon2 hash: use `just hash-pw`"
            )
        rhs = raw.get("APP_ADMIN_PASSWORD_HASH", [""])[-1]
        if not rhs.startswith("'"):
            report.errors.append(
                "APP_ADMIN_PASSWORD_HASH must be in single quotes, e.g. "
                "APP_ADMIN_PASSWORD_HASH='$argon2id$...' (docker compose expands '$' otherwise)"
            )

    totp = values.get("APP_TOTP_SECRET", "")
    if totp:
        try:
            base64.b32decode(totp.upper() + "=" * (-len(totp) % 8), casefold=True)
        except (binascii.Error, ValueError):
            report.errors.append("APP_TOTP_SECRET is not valid base32: use `just gen-totp`")

    if not (values.get("ALPACA_PAPER_KEY_ID") and values.get("ALPACA_PAPER_SECRET")):
        report.warnings.append(
            "Alpaca paper keys are empty: login works, but rules, preview, chart, "
            "backtests and trading need them"
        )
    if "@db:" not in values.get("DATABASE_URL", "@db:"):
        report.warnings.append("DATABASE_URL does not point at the compose 'db' service")
    return report
