"""Alerting: ``Notifier`` protocol and an ntfy.sh implementation."""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Protocol

import httpx

log = logging.getLogger(__name__)


class Notifier(Protocol):
    def send(self, title: str, message: str, *, priority: str = "default") -> None: ...


class NullNotifier:
    def send(self, title: str, message: str, *, priority: str = "default") -> None:
        log.info("alert (no notifier configured)", extra={"title": title})


@dataclass
class RecordingNotifier:
    sent: list[tuple[str, str, str]] = field(default_factory=list)

    def send(self, title: str, message: str, *, priority: str = "default") -> None:
        self.sent.append((title, message, priority))


class NtfyNotifier:
    def __init__(self, topic_url: str, client: httpx.Client | None = None) -> None:
        self.topic_url = topic_url
        self._client = client or httpx.Client(timeout=10)

    def send(self, title: str, message: str, *, priority: str = "default") -> None:
        try:
            r = self._client.post(
                self.topic_url,
                content=message.encode(),
                headers={
                    "Title": title,
                    "Priority": priority,
                    "Tags": "chart_with_downwards_trend",
                },
            )
            r.raise_for_status()
        except httpx.HTTPError as exc:
            # Alerts must never break trading.
            log.warning("ntfy send failed", extra={"error": str(exc)})


def make_notifier(topic_url: str) -> Notifier:
    return NtfyNotifier(topic_url) if topic_url else NullNotifier()


def ping_heartbeat(url: str, client: httpx.Client | None = None) -> None:
    if not url:
        return
    try:
        (client or httpx.Client(timeout=10)).get(url).raise_for_status()
    except httpx.HTTPError as exc:
        log.warning("heartbeat ping failed", extra={"error": str(exc)})
