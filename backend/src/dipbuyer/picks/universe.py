"""The eligible universe: S&P 500 constituents bundled with the app.

Refresh with ``python -m dipbuyer.cli refresh-universe`` (downloads the public
datasets/s-and-p-500-companies list). Set ``UNIVERSE_CSV`` to use another file.
"""

from __future__ import annotations

import csv
import io
import os
from dataclasses import dataclass
from functools import lru_cache
from importlib import resources
from pathlib import Path

SOURCE_URL = (
    "https://raw.githubusercontent.com/datasets/s-and-p-500-companies/main/data/constituents.csv"
)


@dataclass(frozen=True)
class Member:
    symbol: str
    name: str
    sector: str


def parse_csv(text: str) -> list[Member]:
    rows = csv.DictReader(io.StringIO(text))
    out: list[Member] = []
    for r in rows:
        sym = (r.get("symbol") or r.get("Symbol") or "").strip().upper()
        if not sym:
            continue
        out.append(
            Member(
                symbol=sym,
                name=(r.get("name") or r.get("Security") or "").strip(),
                sector=(r.get("sector") or r.get("GICS Sector") or "").strip(),
            )
        )
    return out


@lru_cache(maxsize=1)
def load_universe() -> tuple[Member, ...]:
    override = os.environ.get("UNIVERSE_CSV")
    if override:
        text = Path(override).read_text(encoding="utf-8")
    else:
        text = resources.files("dipbuyer.picks").joinpath("data/sp500.csv").read_text("utf-8")
    return tuple(parse_csv(text))


def members_by_symbol() -> dict[str, Member]:
    return {m.symbol: m for m in load_universe()}
