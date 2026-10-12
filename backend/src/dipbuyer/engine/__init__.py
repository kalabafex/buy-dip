"""Pure rule evaluation and dip-cycle state machine. No I/O.

Semantics (see DECISIONS.md for rationale):

* ``condition_met`` comes from the rule's trigger type.
* ``triggered`` requires ``consecutive_met >= confirm_evals``; ``recent_evaluations`` is
  the caller-selected window of prior ``condition_met`` flags, oldest first (same NY
  session live; prior sessions in the backtest).
* With no active cycle, a trigger proposes opening a cycle with ``ref_high = high_n``.
  The cycle is only persisted if the resulting order passes risk.
* Tier ``i`` is eligible when the drop from the cycle's ``ref_high`` reaches
  ``tiers[i].drop_pct`` and ``i`` is unfilled. For RSI/BELOW_MA triggers tier 0 is also
  eligible whenever the trigger fires. The deepest eligible unfilled tier is chosen; tiers
  shallower than the deepest filled tier are considered consumed (no stacking/back-fill).
* An active cycle closes as RECOVERED when ``last >= ref_high * (1 - d0/200)``, or as
  COOLDOWN_EXPIRED when ``cooldown_days`` sessions have passed since the last fill with
  no new tier.
"""

from __future__ import annotations

from collections.abc import Sequence
from decimal import Decimal

from dipbuyer.domain.enums import CycleAction, CycleEndReason, TriggerType
from dipbuyer.domain.models import CycleView, Frozen, IndicatorSnapshot, RuleParams
from dipbuyer.domain.money import HUNDRED, round_to_cent

__all__ = ["EngineResult", "condition_met", "evaluate", "limit_price_for"]

TWO_HUNDRED = Decimal(200)


class EngineResult(Frozen):
    indicators: IndicatorSnapshot
    condition_met: bool
    consecutive_met: int
    triggered: bool
    cycle_action: CycleAction
    close_reason: CycleEndReason | None = None
    cycle_ref_high: Decimal | None = None
    """``ref_high`` of the active cycle, or of the proposed new cycle when OPEN."""
    tier_to_fill: int | None = None
    notional: Decimal | None = None
    limit_price: Decimal | None = None
    reason: str


def condition_met(rule: RuleParams, ind: IndicatorSnapshot) -> bool:
    match rule.trigger_type:
        case TriggerType.PULLBACK_FROM_HIGH:
            return ind.pullback_pct is not None and ind.pullback_pct >= rule.tiers[0].drop_pct
        case TriggerType.RSI_OVERSOLD:
            return (
                ind.rsi14 is not None
                and rule.rsi_threshold is not None
                and ind.rsi14 <= rule.rsi_threshold
            )
        case TriggerType.BELOW_MA:
            return ind.sma_rule is not None and ind.last_price < ind.sma_rule


def limit_price_for(rule: RuleParams, last: Decimal) -> Decimal:
    return round_to_cent(last * (1 + rule.limit_offset_pct / HUNDRED))


def _deepest_tier(
    rule: RuleParams, ref_high: Decimal, last: Decimal, filled: Sequence[int], triggered: bool
) -> int | None:
    drop = (ref_high - last) / ref_high * HUNDRED
    # Tiers at or below the deepest filled tier are consumed (skipped tiers never
    # back-fill after a deeper fill).
    floor = max(filled, default=-1)
    eligible = [i for i, t in enumerate(rule.tiers) if i > floor and drop >= t.drop_pct]
    if (
        not eligible
        and triggered
        and rule.trigger_type is not TriggerType.PULLBACK_FROM_HIGH
        and not filled
    ):
        eligible = [0]
    return max(eligible) if eligible else None


def evaluate(
    rule: RuleParams,
    indicators: IndicatorSnapshot,
    cycle: CycleView | None,
    recent_evaluations: Sequence[bool],
) -> EngineResult:
    met = condition_met(rule, indicators)
    consecutive = 0
    if met:
        consecutive = 1
        for prior in reversed(recent_evaluations):
            if not prior:
                break
            consecutive += 1
    triggered = met and consecutive >= rule.confirm_evals
    last = indicators.last_price

    def result(
        action: CycleAction,
        reason: str,
        *,
        close_reason: CycleEndReason | None = None,
        ref_high: Decimal | None = None,
        tier: int | None = None,
    ) -> EngineResult:
        return EngineResult(
            indicators=indicators,
            condition_met=met,
            consecutive_met=consecutive,
            triggered=triggered,
            cycle_action=action,
            close_reason=close_reason,
            cycle_ref_high=ref_high,
            tier_to_fill=tier,
            notional=rule.tiers[tier].amount_usd if tier is not None else None,
            limit_price=limit_price_for(rule, last) if tier is not None else None,
            reason=reason,
        )

    if cycle is None:
        if not triggered:
            why = "condition met, awaiting confirmation" if met else "condition not met"
            return result(CycleAction.NONE, why)
        ref_high = indicators.ref_high
        if ref_high is None or ref_high <= 0:
            return result(CycleAction.NONE, "triggered but no high_n available")
        tier = _deepest_tier(rule, ref_high, last, (), triggered)
        if tier is None:
            return result(CycleAction.NONE, "triggered but no tier eligible from high_n")
        return result(
            CycleAction.OPEN,
            f"open cycle at ref_high {ref_high}, tier {tier + 1}",
            ref_high=ref_high,
            tier=tier,
        )

    recover_level = cycle.ref_high * (1 - rule.tiers[0].drop_pct / TWO_HUNDRED)
    if last >= recover_level:
        return result(
            CycleAction.CLOSE,
            f"recovered: last {last} >= {round_to_cent(recover_level)}",
            close_reason=CycleEndReason.RECOVERED,
            ref_high=cycle.ref_high,
        )
    tier = _deepest_tier(rule, cycle.ref_high, last, cycle.tiers_filled, triggered)
    if tier is not None:
        return result(
            CycleAction.NONE,
            f"tier {tier + 1} eligible in active cycle",
            ref_high=cycle.ref_high,
            tier=tier,
        )
    if cycle.sessions_since_last_fill >= rule.cooldown_days:
        return result(
            CycleAction.CLOSE,
            f"cooldown expired after {cycle.sessions_since_last_fill} sessions",
            close_reason=CycleEndReason.COOLDOWN_EXPIRED,
            ref_high=cycle.ref_high,
        )
    return result(CycleAction.NONE, "active cycle, no new tier", ref_high=cycle.ref_high)
