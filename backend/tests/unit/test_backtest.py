from __future__ import annotations

import datetime as dt
import json
from decimal import Decimal as D
from pathlib import Path

import pytest

from dipbuyer.backtest import default_rule, run_backtest
from dipbuyer.cli import format_result, load_csv_bars
from dipbuyer.domain.models import GlobalSettingsModel
from tests.helpers import make_bars, rule

FIXTURES = Path(__file__).parent.parent / "fixtures"
GOLDEN = FIXTURES / "SYNTH_backtest_golden.json"


def _run() -> dict[str, object]:
    bars = load_csv_bars(FIXTURES / "SYNTH_daily.csv")
    res = run_backtest(
        default_rule("SYNTH"), bars, dt.date(2021, 1, 1), dt.date(2023, 12, 29), D(10000)
    )
    return res.to_json()


def test_backtest_is_deterministic_and_matches_golden() -> None:
    a, b = _run(), _run()
    assert a == b
    golden = json.loads(GOLDEN.read_text())
    assert a["rule"] == golden["rule"]
    assert a["baseline"] == golden["baseline"]
    assert a["decisions"] == golden["decisions"]
    assert a["trades"] == golden["trades"]


def test_backtest_baseline_invests_same_dollars() -> None:
    r = _run()
    rule_inv = D(r["rule"]["total_invested"])  # type: ignore[index]
    base_inv = D(r["baseline"]["total_invested"])  # type: ignore[index]
    assert rule_inv > 0
    assert abs(rule_inv - base_inv) <= D("0.05")


def test_fill_at_next_open_or_expire() -> None:
    # 220 flat sessions at 100, then a drop to 94 (tier 1), next open 95 > limit 94.28 -> expire;
    # then close 93, next open 93 <= limit -> fill at 93.
    closes = ["100"] * 220 + ["94", "94", "93", "93"]
    bars = make_bars("T", closes, dt.date(2025, 6, 9))
    bars = [b.model_copy(update={"open": D(95)}) if i == 221 else b for i, b in enumerate(bars)]
    r = rule(symbol="T", max_position_usd=D(5000))
    res = run_backtest(r, bars, bars[220].session_date, bars[-1].session_date, D(10000))
    got = [(t.status.value, t.tier_index, t.placed_date, t.fill_price) for t in res.trades]
    assert got == [
        ("EXPIRED", 0, bars[220].session_date, None),
        ("FILLED", 0, bars[221].session_date, D(93)),
    ]


def test_kill_switch_blocks_backtest_orders() -> None:
    bars = load_csv_bars(FIXTURES / "SYNTH_daily.csv")
    res = run_backtest(
        default_rule("SYNTH"),
        bars,
        dt.date(2021, 1, 1),
        dt.date(2023, 12, 29),
        D(10000),
        GlobalSettingsModel(kill_switch=True),
    )
    assert res.trades == []
    assert "ORDER" not in res.decisions


def test_cli_format() -> None:
    bars = load_csv_bars(FIXTURES / "SYNTH_daily.csv")
    res = run_backtest(
        default_rule("SYNTH"), bars, dt.date(2022, 1, 1), dt.date(2022, 12, 30), D(5000)
    )
    text = format_result(res)
    assert "Monthly DCA" in text and "Return %" in text


def test_empty_range_raises() -> None:
    bars = make_bars("T", ["100"] * 5, dt.date(2025, 6, 9))
    with pytest.raises(ValueError, match="no bars"):
        run_backtest(rule(symbol="T"), bars, dt.date(2030, 1, 1), dt.date(2030, 2, 1), D(1))
