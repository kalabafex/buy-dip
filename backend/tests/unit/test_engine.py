from __future__ import annotations

import uuid
from decimal import Decimal as D

from dipbuyer.domain.enums import CycleAction, CycleEndReason
from dipbuyer.domain.models import CycleView
from dipbuyer.engine import condition_met, evaluate, limit_price_for
from tests.helpers import rule, snap


def cycle(filled: tuple[int, ...] = (), ref: str = "100", since: int = 0) -> CycleView:
    return CycleView(
        id=uuid.uuid4(), ref_high=D(ref), tiers_filled=filled, sessions_since_last_fill=since
    )


# --- condition_met ---------------------------------------------------------------------


def test_pullback_condition() -> None:
    r = rule()
    assert condition_met(r, snap("95"))
    assert not condition_met(r, snap("95.01"))
    assert not condition_met(r, snap("95", pullback_pct=None))


def test_rsi_condition() -> None:
    r = rule(trigger_type="RSI_OVERSOLD", rsi_threshold=D(30))
    assert condition_met(r, snap("99", rsi14=D(30)))
    assert not condition_met(r, snap("99", rsi14=D("30.01")))
    assert not condition_met(r, snap("99", rsi14=None))


def test_below_ma_condition() -> None:
    r = rule(trigger_type="BELOW_MA", ma_period=20)
    assert condition_met(r, snap("99", sma_rule=D("99.5")))
    assert not condition_met(r, snap("99", sma_rule=D(99)))
    assert not condition_met(r, snap("99", sma_rule=None))


# --- confirmation ----------------------------------------------------------------------


def test_confirm_evals_counts_consecutive() -> None:
    r = rule(confirm_evals=3)
    res = evaluate(r, snap("94"), None, [True, False, True])
    assert res.consecutive_met == 2
    assert not res.triggered
    assert res.cycle_action is CycleAction.NONE
    res = evaluate(r, snap("94"), None, [False, True, True])
    assert res.consecutive_met == 3
    assert res.triggered
    assert res.cycle_action is CycleAction.OPEN


def test_condition_not_met_resets_count() -> None:
    res = evaluate(rule(confirm_evals=2), snap("99"), None, [True, True])
    assert res.consecutive_met == 0
    assert not res.condition_met
    assert res.tier_to_fill is None


# --- cycle transitions -----------------------------------------------------------------


def test_open_cycle_at_tier_1() -> None:
    res = evaluate(rule(), snap("94"), None, [])
    assert res.cycle_action is CycleAction.OPEN
    assert res.cycle_ref_high == D(100)
    assert res.tier_to_fill == 0
    assert res.notional == D(100)
    assert res.limit_price == D("94.28")  # 94 * 1.003 = 94.282


def test_open_cycle_skips_to_deepest_tier() -> None:
    res = evaluate(rule(), snap("85"), None, [])
    assert res.cycle_action is CycleAction.OPEN
    assert res.tier_to_fill == 1
    assert res.notional == D(200)


def test_triggered_without_high_n_does_nothing() -> None:
    r = rule(trigger_type="RSI_OVERSOLD", rsi_threshold=D(30))
    res = evaluate(r, snap("94", rsi14=D(20), ref_high=None), None, [])
    assert res.cycle_action is CycleAction.NONE
    assert res.tier_to_fill is None


def test_active_cycle_next_tier() -> None:
    res = evaluate(rule(), snap("89"), cycle((0,)), [])
    assert res.cycle_action is CycleAction.NONE
    assert res.tier_to_fill == 1


def test_active_cycle_uses_cycle_ref_high_not_current_high_n() -> None:
    # high_n has rolled down to 90, but the cycle anchor stays at 100.
    res = evaluate(rule(), snap("89", ref_high=D(90), pullback_pct=D("1.1")), cycle((0,)), [])
    assert res.tier_to_fill == 1


def test_filled_tier_not_refilled() -> None:
    res = evaluate(rule(), snap("94"), cycle((0,), since=1), [])
    assert res.tier_to_fill is None
    assert res.cycle_action is CycleAction.NONE


def test_skipped_tiers_are_not_back_filled() -> None:
    # tier 2 filled after skipping tier 1; at -6% tier 1 must not be bought.
    res = evaluate(rule(), snap("94"), cycle((1,), since=1), [])
    assert res.tier_to_fill is None
    res = evaluate(rule(), snap("79"), cycle((1,), since=1), [])
    assert res.tier_to_fill == 2


def test_close_on_recovery() -> None:
    # recover level = 100 * (1 - 5/200) = 97.5
    res = evaluate(rule(), snap("97.5"), cycle((0,)), [])
    assert res.cycle_action is CycleAction.CLOSE
    assert res.close_reason is CycleEndReason.RECOVERED
    res = evaluate(rule(), snap("97.49"), cycle((0,)), [])
    assert res.cycle_action is CycleAction.NONE


def test_close_on_cooldown_expiry() -> None:
    r = rule(cooldown_days=5)
    res = evaluate(r, snap("94"), cycle((0,), since=5), [])
    assert res.cycle_action is CycleAction.CLOSE
    assert res.close_reason is CycleEndReason.COOLDOWN_EXPIRED
    res = evaluate(r, snap("94"), cycle((0,), since=4), [])
    assert res.cycle_action is CycleAction.NONE


def test_new_tier_beats_cooldown_expiry() -> None:
    res = evaluate(rule(cooldown_days=1), snap("89"), cycle((0,), since=3), [])
    assert res.cycle_action is CycleAction.NONE
    assert res.tier_to_fill == 1


def test_rsi_trigger_opens_tier_1_without_pullback() -> None:
    r = rule(trigger_type="RSI_OVERSOLD", rsi_threshold=D(30))
    res = evaluate(r, snap("99", rsi14=D(25)), None, [])
    assert res.cycle_action is CycleAction.OPEN
    assert res.tier_to_fill == 0
    # deeper tiers still require the pullback from ref_high
    res = evaluate(r, snap("96", rsi14=D(25)), cycle((0,)), [])
    assert res.tier_to_fill is None
    res = evaluate(r, snap("89", rsi14=D(40)), cycle((0,)), [])
    assert res.tier_to_fill == 1


def test_below_ma_trigger_with_pullback_skips_to_deeper_tier() -> None:
    r = rule(trigger_type="BELOW_MA", ma_period=20)
    res = evaluate(r, snap("88", sma_rule=D(95)), None, [])
    assert res.tier_to_fill == 1


def test_limit_price_rounding() -> None:
    assert limit_price_for(rule(limit_offset_pct=D("0.3")), D("100.00")) == D("100.30")
    assert limit_price_for(rule(limit_offset_pct=D(0)), D("12.345")) == D("12.35")
    assert limit_price_for(rule(limit_offset_pct=D(2)), D("49.99")) == D("50.99")
