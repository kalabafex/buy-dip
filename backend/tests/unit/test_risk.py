from __future__ import annotations

import datetime as dt
from decimal import Decimal as D
from typing import Any

import pytest

from dipbuyer.domain.enums import Decision, TradingMode
from dipbuyer.domain.models import GlobalSettingsModel
from dipbuyer.engine import EngineResult, evaluate
from dipbuyer.risk import RiskContext, check, size_order
from tests.helpers import rule, snap

PREV = dt.date(2025, 6, 9)


def ctx(**kw: Any) -> RiskContext:
    settings_kw = kw.pop("settings", {})
    base: dict[str, Any] = {
        "settings": GlobalSettingsModel(**settings_kw),
        "mode": TradingMode.PAPER,
        "calendar_open": True,
        "broker_clock_open": True,
        "in_exclusion_window": False,
        "expected_prev_session": PREV,
        "has_open_order": False,
        "tiers_filled": (),
        "sessions_since_prev_cycle_fill": None,
        "spend_today": D(0),
        "spend_week": D(0),
        "position_value": D(0),
        "buying_power": D(10_000),
        "fractionable": True,
    }
    base.update(kw)
    return RiskContext(**base)


def opening(last: str = "94", **snap_kw: Any) -> EngineResult:
    res = evaluate(rule(), snap(last, **snap_kw), None, [])
    assert res.tier_to_fill == 0
    return res


def test_order_when_all_checks_pass() -> None:
    d = check(rule(), opening(), ctx())
    assert d.decision is Decision.ORDER
    assert d.place_order
    # $100 at limit 94.28 -> 1.060670 shares (floored to 6 dp)
    assert d.qty == D("1.060670")


def test_no_trigger() -> None:
    res = evaluate(rule(), snap("99"), None, [])
    assert check(rule(), res, ctx()).decision is Decision.NO_TRIGGER


@pytest.mark.parametrize(
    ("kwargs", "snap_kw", "expected"),
    [
        ({"settings": {"kill_switch": True}}, {}, Decision.SKIP_KILL_SWITCH),
        ({"calendar_open": False}, {}, Decision.SKIP_MARKET_CLOSED),
        ({"broker_clock_open": False}, {}, Decision.SKIP_MARKET_CLOSED),
        ({"in_exclusion_window": True}, {}, Decision.SKIP_EXCLUSION_WINDOW),
        ({}, {"latest_bar_date": dt.date(2025, 6, 6)}, Decision.SKIP_STALE_DATA),
        ({}, {"prior_close": D(80)}, Decision.SKIP_PRICE_SANITY),
        ({}, {"prior_close": D(111)}, Decision.SKIP_PRICE_SANITY),
        ({"has_open_order": True}, {}, Decision.SKIP_OPEN_ORDER),
        ({"tiers_filled": (0,)}, {}, Decision.SKIP_TIER_FILLED),
        ({"sessions_since_prev_cycle_fill": 4}, {}, Decision.SKIP_COOLDOWN),
        ({"spend_today": D("400.01")}, {}, Decision.SKIP_DAILY_CAP),
        ({"spend_week": D("1400.01")}, {}, Decision.SKIP_WEEKLY_CAP),
        ({"position_value": D("900.01")}, {}, Decision.SKIP_POSITION_CAP),
        ({"buying_power": D("99.99")}, {}, Decision.SKIP_BUYING_POWER),
        ({"mode": TradingMode.LIVE}, {}, Decision.SKIP_MODE_MISMATCH),
    ],
)
def test_each_skip_reason(
    kwargs: dict[str, Any], snap_kw: dict[str, Any], expected: Decision
) -> None:
    d = check(rule(), opening(**snap_kw), ctx(**kwargs))
    assert d.decision is expected
    assert not d.place_order


def test_trend_filter() -> None:
    r = rule(trend_filter="ABOVE_200DMA")
    res = evaluate(r, snap("94", sma200=D(94)), None, [])
    assert check(r, res, ctx()).decision is Decision.SKIP_TREND_FILTER
    res = evaluate(r, snap("94", sma200=None), None, [])
    assert check(r, res, ctx()).decision is Decision.SKIP_TREND_FILTER
    res = evaluate(r, snap("94", sma200=D("93.99")), None, [])
    assert check(r, res, ctx()).decision is Decision.ORDER


def test_cooldown_only_applies_to_new_cycles() -> None:
    import uuid

    from dipbuyer.domain.models import CycleView

    cyc = CycleView(id=uuid.uuid4(), ref_high=D(100), tiers_filled=(0,), sessions_since_last_fill=1)
    res = evaluate(rule(), snap("89"), cyc, [])
    assert res.tier_to_fill == 1
    d = check(rule(), res, ctx(tiers_filled=(0,), sessions_since_prev_cycle_fill=0))
    assert d.decision is Decision.ORDER
    assert check(rule(), opening(), ctx(sessions_since_prev_cycle_fill=5)).place_order


def test_caps_are_inclusive() -> None:
    assert check(rule(), opening(), ctx(spend_today=D(400))).place_order
    assert check(rule(), opening(), ctx(spend_week=D(1400))).place_order
    assert check(rule(), opening(), ctx(position_value=D(900))).place_order
    assert check(rule(), opening(), ctx(buying_power=D(100))).place_order


def test_check_order_kill_switch_first() -> None:
    d = check(
        rule(),
        opening(),
        ctx(settings={"kill_switch": True}, calendar_open=False, has_open_order=True),
    )
    assert d.decision is Decision.SKIP_KILL_SWITCH


def test_qty_zero_for_whole_shares() -> None:
    # $100 cannot buy one share at ~$940 when the asset is not fractionable.
    r = rule()
    res = evaluate(
        r, snap("940", ref_high=D(1000), prior_close=D(1000), pullback_pct=D(6)), None, []
    )
    d = check(r, res, ctx(fractionable=False))
    assert d.decision is Decision.SKIP_QTY_ZERO


def test_size_order() -> None:
    assert size_order(D(100), D(3), True) == D("33.333333")
    assert size_order(D(100), D(3), False) == D(33)
    assert size_order(D(100), D(0), True) == D(0)
