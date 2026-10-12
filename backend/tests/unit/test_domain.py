from __future__ import annotations

from decimal import Decimal as D

import pytest
from pydantic import ValidationError

from dipbuyer.domain.money import floor_qty, round_to_cent, to_decimal
from tests.helpers import rule


def test_symbol_uppercased() -> None:
    assert rule(symbol=" spy ").symbol == "SPY"


@pytest.mark.parametrize(
    "kw",
    [
        {"tiers": []},
        {"tiers": [{"drop_pct": 5, "amount_usd": 1}] * 6},
        {"tiers": [{"drop_pct": 10, "amount_usd": 1}, {"drop_pct": 5, "amount_usd": 1}]},
        {"tiers": [{"drop_pct": 5, "amount_usd": 1}, {"drop_pct": 5, "amount_usd": 1}]},
        {"tiers": [{"drop_pct": "0.5", "amount_usd": 1}]},
        {"tiers": [{"drop_pct": 61, "amount_usd": 1}]},
        {"tiers": [{"drop_pct": 5, "amount_usd": 0}]},
        {"trigger_type": "RSI_OVERSOLD"},
        {"trigger_type": "RSI_OVERSOLD", "rsi_threshold": 4},
        {"trigger_type": "BELOW_MA"},
        {"trigger_type": "BELOW_MA", "ma_period": 9},
        {"max_position_usd": D(599)},
        {"lookback_days": 4},
        {"lookback_days": 251},
        {"confirm_evals": 0},
        {"cooldown_days": 61},
        {"limit_offset_pct": D("2.01")},
        {"symbol": "BAD SYM"},
    ],
)
def test_rule_validation_rejects(kw: dict[str, object]) -> None:
    with pytest.raises(ValidationError):
        rule(**kw)


def test_rule_defaults() -> None:
    from dipbuyer.domain.models import RuleParams

    r = RuleParams(symbol="spy", tiers=[{"drop_pct": 5, "amount_usd": 100}], max_position_usd=100)  # type: ignore[list-item]
    assert r.enabled is False
    assert r.lookback_days == 20
    assert r.confirm_evals == 2
    assert r.cooldown_days == 5
    assert r.limit_offset_pct == D("0.3")
    assert r.trend_filter.value == "ABOVE_200DMA"


def test_money_helpers() -> None:
    assert to_decimal(0.1) == D("0.1")
    assert to_decimal("1.25") == D("1.25")
    assert to_decimal(3) == D(3)
    with pytest.raises(TypeError):
        to_decimal(True)
    assert round_to_cent(D("1.005")) == D("1.01")
    assert floor_qty(D("1.2345679")) == D("1.234567")
