"""Structured JSON logging with secret redaction."""

from __future__ import annotations

import logging
import re
import sys

from pythonjsonlogger.json import JsonFormatter

_SECRET_KEYS = re.compile(r"(secret|password|key_id|token|authorization|cookie)", re.I)
_REDACTED = "***"


class RedactingFormatter(JsonFormatter):
    def process_log_record(self, log_data: dict[str, object]) -> dict[str, object]:
        for k in list(log_data):
            if _SECRET_KEYS.search(k):
                log_data[k] = _REDACTED
        return super().process_log_record(log_data)


class SecretFilter(logging.Filter):
    """Removes known secret values from formatted messages."""

    def __init__(self, secrets: list[str]) -> None:
        super().__init__()
        self.secrets = [s for s in secrets if s and len(s) >= 6]

    def filter(self, record: logging.LogRecord) -> bool:
        if self.secrets:
            msg = record.getMessage()
            for s in self.secrets:
                msg = msg.replace(s, _REDACTED)
            record.msg = msg
            record.args = None
        return True


def setup_logging(level: str = "INFO", secrets: list[str] | None = None) -> None:
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(
        RedactingFormatter("%(asctime)s %(levelname)s %(name)s %(message)s", timestamp=False)
    )
    handler.addFilter(SecretFilter(secrets or []))
    root = logging.getLogger()
    root.handlers[:] = [handler]
    root.setLevel(level)
    for noisy in ("urllib3", "httpx", "apscheduler.executors.default"):
        logging.getLogger(noisy).setLevel(logging.WARNING)
