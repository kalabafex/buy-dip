"""Property tests over arbitrary price paths (spec §15)."""

from __future__ import annotations

import datetime as dt
from collections import Counter, defaultdict
from decimal import Decimal as D

from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st

from dipbuyer.backtest import run_backtest
from dipbuyer.domain.enums import Decision, OrderStatus, TradingMode
from dipbuyer.domain.models import GlobalSettingsModel, RuleParams, Tier
from dipbuyer.engine import evaluate
from dipbuyer.risk import RiskContext, check
from tests.helpers import make_bars, snap

END = dt.date(2025, 6, 9)
WARMUP = 25


@st.composite
def price_paths(draw: st.DrawFn) -> list[D]:
    steps = draw(st.lists(st.integers(min_value=-60, max_value=40), min_size=15, max_size=90))
    price = D(100)
    out = [D(100)] * WARMUP
    for s in steps:  # daily move in tenths of a percent (-6% .. +4%)
        price = max(D("1.00"), (price * (1 + D(s) / 1000)).quantize(D("0.01")))
        out.append(price)
    return out


@st.composite
def rules(draw: st.DrawFn) -> RuleParams:
    n = draw(st.integers(min_value=1, max_value=4))
    drops = sorted(draw(st.sets(st.integers(min_value=1, max_value=40), min_size=n, max_size=n)))
    amounts = [D(draw(st.integers(min_value=10, max_value=400))) for _ in drops]
    total = sum(amounts, D(0))
    return RuleParams(
        symbol="PROP",
        enabled=True,
        lookback_days=draw(st.integers(min_value=5, max_value=20)),
        tiers=[Tier(drop_pct=D(d), amount_usd=a) for d, a in zip(drops, amounts, strict=True)],
        trend_filter="NONE",  # type: ignore[arg-type]
        confirm_evals=draw(st.integers(min_value=1, max_value=3)),
        max_position_usd=total + D(draw(st.integers(min_value=0, max_value=1500))),
        cooldown_days=draw(st.integers(min_value=0, max_value=5)),
        limit_offset_pct=D(draw(st.integers(min_value=0, max_value=20))) / 10,
    )


@st.composite
def caps(draw: st.DrawFn) -> GlobalSettingsModel:
    daily = D(draw(st.integers(min_value=0, max_value=600)))
    weekly = daily + D(draw(st.integers(min_value=0, max_value=1200)))
    return GlobalSettingsModel(max_daily_spend_usd=daily, max_weekly_spend_usd=weekly)


def _run(closes: list[D], r: RuleParams, s: GlobalSettingsModel):  # type: ignore[no-untyped-def]
    bars = make_bars("PROP", closes, END)
    return run_backtest(r, bars, bars[WARMUP].session_date, END, D(5000), s)


PROFILE = settings(max_examples=150, deadline=None, suppress_health_check=[HealthCheck.too_slow])


@PROFILE
@given(price_paths(), rules(), caps())
def test_caps_never_exceeded(closes: list[D], r: RuleParams, s: GlobalSettingsModel) -> None:
    res = _run(closes, r, s)
    placed_per_day: Counter[dt.date] = Counter()
    live_per_week: defaultdict[tuple[int, int], D] = defaultdict(lambda: D(0))
    cost = D(0)
    for t in res.trades:
        placed_per_day[t.placed_date] += 1
        assert t.notional <= s.max_daily_spend_usd
        if t.status is OrderStatus.FILLED:
            week = t.placed_date.isocalendar()[:2]
            live_per_week[week] += t.notional
            assert t.fill_price is not None
            cost += t.qty * t.fill_price
    assert all(n == 1 for n in placed_per_day.values())
    assert all(v <= s.max_weekly_spend_usd for v in live_per_week.values())
    assert cost <= r.max_position_usd
    assert D(res.rule.total_invested) <= r.max_position_usd


@PROFILE
@given(price_paths(), rules(), caps())
def test_tier_never_fills_twice_in_a_cycle(
    closes: list[D], r: RuleParams, s: GlobalSettingsModel
) -> None:
    res = _run(closes, r, s)
    filled = [(t.cycle_no, t.tier_index) for t in res.trades if t.status is OrderStatus.FILLED]
    assert len(filled) == len(set(filled))
    # Within a cycle, fills only go deeper (no back-filling skipped tiers).
    by_cycle: defaultdict[int, list[int]] = defaultdict(list)
    for c, tier in filled:
        by_cycle[c].append(tier)
    for tiers in by_cycle.values():
        assert tiers == sorted(tiers)


@PROFILE
@given(price_paths(), rules())
def test_no_orders_while_kill_switch_on(closes: list[D], r: RuleParams) -> None:
    res = _run(closes, r, GlobalSettingsModel(kill_switch=True))
    assert res.trades == []
    assert Decision.ORDER.value not in res.decisions


@settings(max_examples=300, deadline=None)
@given(
    last=st.integers(min_value=50, max_value=99),
    spend_today=st.integers(min_value=0, max_value=1000),
    spend_week=st.integers(min_value=0, max_value=3000),
    position=st.integers(min_value=0, max_value=2000),
    kill=st.booleans(),
)
def test_risk_check_respects_caps_and_kill_switch(
    last: int, spend_today: int, spend_week: int, position: int, kill: bool
) -> None:
    r = RuleParams(
        symbol="PROP",
        tiers=[Tier(drop_pct=D(1), amount_usd=D(100)), Tier(drop_pct=D(30), amount_usd=D(250))],
        trend_filter="NONE",  # type: ignore[arg-type]
        confirm_evals=1,
        max_position_usd=D(1000),
    )
    s = GlobalSettingsModel(kill_switch=kill)
    res = evaluate(r, snap(str(last), prior_close=D(last)), None, [])
    ctx = RiskContext(
        settings=s,
        mode=TradingMode.PAPER,
        calendar_open=True,
        broker_clock_open=True,
        in_exclusion_window=False,
        expected_prev_session=END,
        has_open_order=False,
        tiers_filled=(),
        sessions_since_prev_cycle_fill=None,
        spend_today=D(spend_today),
        spend_week=D(spend_week),
        position_value=D(position),
        buying_power=D(100_000),
        fractionable=True,
    )
    d = check(r, res, ctx)
    if d.place_order:
        assert not kill
        assert res.notional is not None
        assert D(spend_today) + res.notional <= s.max_daily_spend_usd
        assert D(spend_week) + res.notional <= s.max_weekly_spend_usd
        assert D(position) + res.notional <= r.max_position_usd
    if kill:
        assert d.decision in {Decision.SKIP_KILL_SWITCH, Decision.NO_TRIGGER}
