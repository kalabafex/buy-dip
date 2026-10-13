from __future__ import annotations

import datetime as dt
import threading
import time
import uuid
from decimal import Decimal as D

import pytest
from sqlalchemy import func, select
from sqlalchemy.orm import Session, sessionmaker

from dipbuyer.broker import FakeBroker
from dipbuyer.domain.enums import OrderStatus
from dipbuyer.domain.models import AssetInfo
from dipbuyer.domain.models import Clock as BrokerClock
from dipbuyer.persistence import repo
from dipbuyer.persistence.lock import try_advisory_lock
from dipbuyer.persistence.models import (
    AccountSnapshotRow,
    DipCycleRow,
    EvaluationRow,
    OrderIntentRow,
    PositionSnapshotRow,
)
from dipbuyer.worker.loop import TickOutcome
from tests.helpers import make_bars, rule
from tests.integration.conftest import World, add_rule, set_settings


def intents(sf: sessionmaker[Session]) -> list[OrderIntentRow]:
    with sf() as s:
        return list(s.scalars(select(OrderIntentRow).order_by(OrderIntentRow.created_at)))


def evals(sf: sessionmaker[Session]) -> list[EvaluationRow]:
    with sf() as s:
        return list(s.scalars(select(EvaluationRow).order_by(EvaluationRow.id)))


def cycles(sf: sessionmaker[Session]) -> list[DipCycleRow]:
    with sf() as s:
        return list(s.scalars(select(DipCycleRow)))


def test_order_after_confirmation_then_open_order_skip(world: World) -> None:
    add_rule(world.sf, rule(symbol="SPY", confirm_evals=2, max_position_usd=D(2000)))
    loop = world.loop()
    assert loop.tick(force=True) is TickOutcome.RAN
    [e1] = evals(world.sf)
    assert e1.condition_met and e1.consecutive_met == 1 and e1.decision == "NO_TRIGGER"
    assert not intents(world.sf)

    world.clock.advance(5)
    assert loop.tick() is TickOutcome.RAN
    e2 = evals(world.sf)[-1]
    assert e2.decision == "ORDER" and e2.consecutive_met == 2 and e2.tier_hit == 0
    [it] = intents(world.sf)
    assert it.status == "SUBMITTED"
    assert it.notional_usd == D(100)
    assert it.limit_price == D("94.28")
    assert it.qty == D("1.060670")
    assert list(world.broker.orders) == [str(it.id)]  # client_order_id == intent.id
    [cyc] = cycles(world.sf)
    assert cyc.state == "ACTIVE" and cyc.tiers_filled == [0] and cyc.ref_high == D(100)
    assert any(t.startswith("Order submitted") for t, _, _ in world.notifier.sent)

    world.clock.advance(5)
    loop.tick()
    assert evals(world.sf)[-1].decision == "NO_TRIGGER"  # tier 1 taken, tier 2 not reached
    world.md.last["SPY"] = D("89")
    world.clock.advance(5)
    loop.tick()
    assert evals(world.sf)[-1].decision == "SKIP_OPEN_ORDER"  # tier 1 order still working
    assert len(intents(world.sf)) == 1
    with world.sf() as s:
        assert s.scalar(select(func.count()).select_from(AccountSnapshotRow)) == 4


def test_reconciler_fill_and_deeper_tier(world: World) -> None:
    add_rule(world.sf)
    loop = world.loop()
    loop.tick(force=True)
    [it] = intents(world.sf)
    world.broker.fill(str(it.id), D("94.10"))
    world.md.last["SPY"] = D("89")
    world.clock.advance(5)
    loop.tick()
    rows = intents(world.sf)
    assert rows[0].status == "FILLED"
    assert rows[0].filled_qty == D("1.060670")
    assert rows[0].filled_avg_price == D("94.10")
    assert any(t.startswith("Filled SPY") for t, _, _ in world.notifier.sent)
    # position snapshot reflects the fill; tier 2 placed in the same cycle
    assert rows[1].tier_index == 1 and rows[1].cycle_id == rows[0].cycle_id
    [cyc] = cycles(world.sf)
    assert cyc.tiers_filled == [0, 1]
    with world.sf() as s:
        assert s.scalar(select(func.count()).select_from(PositionSnapshotRow)) == 1


def test_reconciler_expired_unmarks_tier(world: World) -> None:
    add_rule(world.sf)
    loop = world.loop()
    loop.tick(force=True)
    [it] = intents(world.sf)
    world.broker.expire(str(it.id))
    with world.sf() as s:
        cyc_before = s.scalars(select(DipCycleRow)).one()
        assert cyc_before.tiers_filled == [0]
    assert loop.reconcile_open_orders(world.broker, repo.TradingMode.PAPER) == 1
    assert intents(world.sf)[0].status == "EXPIRED"
    [cyc] = cycles(world.sf)
    assert cyc.tiers_filled == []
    # the tier can be bought again
    world.clock.advance(5)
    loop.tick()
    assert [r.status for r in intents(world.sf)] == ["EXPIRED", "SUBMITTED"]


def test_partial_fill_then_expire_counts_as_filled(world: World) -> None:
    add_rule(world.sf)
    loop = world.loop()
    loop.tick(force=True)
    [it] = intents(world.sf)
    world.broker.fill(str(it.id), D(94), qty=D("0.5"))
    world.broker.expire(str(it.id))
    loop.reconcile_open_orders(world.broker, repo.TradingMode.PAPER)
    [it] = intents(world.sf)
    assert it.status == "FILLED" and it.filled_qty == D("0.5")
    assert cycles(world.sf)[0].tiers_filled == [0]


def test_kill_switch_cancels_once_and_blocks(world: World) -> None:
    add_rule(world.sf)
    loop = world.loop()
    loop.tick(force=True)
    [it] = intents(world.sf)
    set_settings(world.sf, kill_switch=True, kill_switch_cancel_pending=True)
    world.clock.advance(5)
    assert loop.tick() is TickOutcome.KILL_SWITCH
    assert world.broker.orders[str(it.id)].status is OrderStatus.CANCELED
    with world.sf() as s:
        assert repo.get_settings_row(s).kill_switch_cancel_pending is False
    world.clock.advance(5)
    assert loop.tick() is TickOutcome.KILL_SWITCH
    assert len(intents(world.sf)) == 1
    assert sum(1 for t, _, _ in world.notifier.sent if t == "Kill switch active") == 1


class KillDuringTick(FakeBroker):
    """Flips the kill switch after risk passed but before submission."""

    sf: sessionmaker[Session] | None = None

    def get_asset(self, symbol: str) -> AssetInfo | None:
        if self.sf is not None:
            set_settings(self.sf, kill_switch=True)
        return super().get_asset(symbol)


def test_kill_switch_rechecked_immediately_before_submit(world: World) -> None:
    add_rule(world.sf)
    broker = KillDuringTick(cash=D(10_000), now=world.clock.now)
    broker.sf = world.sf
    world.loop(broker=broker).tick(force=True)
    assert evals(world.sf)[-1].decision == "ORDER"
    assert not intents(world.sf)
    assert broker.submit_calls == 0


def test_dry_run_skips_submission(world: World) -> None:
    add_rule(world.sf)
    world.loop(dry_run=True).tick(force=True)
    [e] = evals(world.sf)
    assert e.decision == "SKIP_DRY_RUN" and e.reason.startswith("[dry run]")
    assert not intents(world.sf) and not world.broker.orders and not cycles(world.sf)


def test_market_closed_and_exclusion_window(world: World) -> None:
    add_rule(world.sf)
    world.clock.now = dt.datetime(2025, 6, 14, 15, tzinfo=dt.UTC)  # Saturday
    assert world.loop().tick(force=True) is TickOutcome.MARKET_CLOSED
    world.clock.now = dt.datetime(2025, 6, 10, 13, 40, tzinfo=dt.UTC)  # 09:40 ET
    assert world.loop().tick(force=True) is TickOutcome.MARKET_CLOSED
    assert not evals(world.sf)
    with world.sf() as s:
        status = repo.get_worker_status(s)
        assert status.last_heartbeat_at == world.clock.now  # in market hours


def test_interval_gating(world: World) -> None:
    add_rule(world.sf)
    loop = world.loop()
    assert loop.tick() is TickOutcome.RAN
    world.clock.advance(2)
    assert loop.tick() is TickOutcome.NOT_DUE
    world.clock.advance(3)
    assert loop.tick() is TickOutcome.RAN


def test_orphaned_pending_intents(world: World) -> None:
    rule_id = add_rule(world.sf)
    lost, landed = uuid.uuid4(), uuid.uuid4()
    with world.sf.begin() as s:
        cyc = DipCycleRow(
            id=uuid.uuid4(),
            rule_id=rule_id,
            state="ACTIVE",
            ref_high=D(100),
            tiers_filled=[],
            started_at=world.clock.now,
        )
        s.add(cyc)
        s.flush()
        for iid in (lost, landed):
            s.add(
                OrderIntentRow(
                    id=iid,
                    rule_id=rule_id,
                    cycle_id=cyc.id,
                    symbol="SPY",
                    tier_index=0,
                    mode="PAPER",
                    notional_usd=D(100),
                    qty=D(1),
                    limit_price=D(94),
                    status="PENDING",
                    created_at=world.clock.now - dt.timedelta(minutes=5),
                    updated_at=world.clock.now,
                )
            )
    # Simulate a crash after the broker accepted ``landed`` but before we recorded it.
    with world.sf() as s:
        world.broker.submit_limit_buy(repo.intent_from_row(s.get_one(OrderIntentRow, landed)))
    world.loop().reconcile_open_orders(world.broker, repo.TradingMode.PAPER)
    by_id = {r.id: r for r in intents(world.sf)}
    assert by_id[lost].status == "FAILED"
    assert by_id[landed].status == "SUBMITTED" and by_id[landed].broker_order_id
    assert cycles(world.sf)[0].tiers_filled == [0]
    assert world.broker.submit_calls == 1


class SlowClockBroker(FakeBroker):
    def get_clock(self) -> BrokerClock:
        time.sleep(0.5)
        return super().get_clock()


def test_concurrent_loops_place_exactly_one_order(world: World) -> None:
    add_rule(world.sf)
    broker = SlowClockBroker(cash=D(10_000), now=world.clock.now)
    loops = [world.loop(broker=broker), world.loop(broker=broker)]
    barrier = threading.Barrier(2)
    outcomes: list[TickOutcome] = []

    def run(i: int) -> None:
        barrier.wait()
        outcomes.append(loops[i].tick(force=True))

    threads = [threading.Thread(target=run, args=(i,)) for i in range(2)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert sorted(outcomes) == sorted([TickOutcome.RAN, TickOutcome.LOCKED])
    assert len(broker.orders) == 1
    assert len(intents(world.sf)) == 1


def test_submit_timeout_then_retry_produces_one_broker_order(world: World) -> None:
    add_rule(world.sf)
    world.broker.submit_failures = ["timeout_after_accept"]
    world.loop().tick(force=True)
    [it] = intents(world.sf)
    assert it.status == "SUBMITTED"
    assert world.broker.submit_calls == 1 and len(world.broker.orders) == 1


def test_submit_lost_then_resubmitted_once(world: World) -> None:
    add_rule(world.sf)
    world.broker.submit_failures = ["timeout_before_accept"]
    world.loop().tick(force=True)
    [it] = intents(world.sf)
    assert it.status == "SUBMITTED"
    assert world.broker.submit_calls == 2 and len(world.broker.orders) == 1


def test_submit_failure_marks_failed_and_alerts(world: World) -> None:
    add_rule(world.sf)
    world.broker.submit_failures = ["timeout_before_accept", "timeout_before_accept"]
    world.loop().tick(force=True)
    [it] = intents(world.sf)
    assert it.status == "FAILED" and it.error
    assert cycles(world.sf)[0].tiers_filled == []
    assert any(p == "high" and t.startswith("Order failed") for t, _, p in world.notifier.sent)


def test_rejected_order(world: World) -> None:
    add_rule(world.sf)
    world.broker.submit_failures = ["reject"]
    world.loop().tick(force=True)
    assert intents(world.sf)[0].status == "REJECTED"


def test_daily_cap_skip_and_alert_once(world: World) -> None:
    add_rule(world.sf)
    set_settings(world.sf, max_daily_spend_usd=D(50))
    loop = world.loop()
    loop.tick(force=True)
    world.clock.advance(5)
    loop.tick()
    assert [e.decision for e in evals(world.sf)] == ["SKIP_DAILY_CAP", "SKIP_DAILY_CAP"]
    assert sum(1 for t, _, _ in world.notifier.sent if t == "Spend cap reached") == 1


def test_cycle_closes_on_recovery(world: World) -> None:
    add_rule(world.sf)
    loop = world.loop()
    loop.tick(force=True)
    [it] = intents(world.sf)
    world.broker.fill(str(it.id), D(94))
    world.md.last["SPY"] = D("99")
    world.clock.advance(5)
    loop.tick()
    [cyc] = cycles(world.sf)
    assert cyc.state == "CLOSED" and cyc.end_reason == "RECOVERED"


def test_symbol_not_tradable_is_skipped(world: World) -> None:
    add_rule(world.sf)
    world.broker.assets["SPY"] = AssetInfo(symbol="SPY", tradable=False, fractionable=True)
    world.loop().tick(force=True)
    assert evals(world.sf)[-1].decision == "SKIP_QTY_ZERO"
    assert not intents(world.sf)


def test_missing_market_data_records_skip(world: World) -> None:
    add_rule(world.sf, rule(symbol="NODATA", max_position_usd=D(1000)))
    world.loop().tick(force=True)
    [e] = evals(world.sf)
    assert e.decision == "SKIP_NO_DATA"


def test_one_bad_rule_does_not_stop_others(world: World) -> None:
    add_rule(world.sf, rule(symbol="NODATA", max_position_usd=D(1000)))
    add_rule(world.sf)
    world.loop().tick(force=True)
    assert len(intents(world.sf)) == 1


def test_daily_summary_once_per_day(world: World) -> None:
    add_rule(world.sf)
    loop = world.loop()
    loop.tick(force=True)
    world.clock.now = dt.datetime(2025, 6, 10, 20, 15, tzinfo=dt.UTC)
    body = loop.daily_summary()
    assert body is not None and "Orders today: 1" in body
    assert loop.daily_summary() is None
    assert sum(1 for t, _, _ in world.notifier.sent if "daily summary" in t) == 1


def test_bar_cache_fetches_only_missing_sessions(world: World) -> None:
    from dipbuyer.data.bars import BarService

    svc = BarService(world.md)
    with world.sf.begin() as s:
        bars, last = svc.load(s, "SPY", dt.date(2025, 6, 10))
        assert len(bars) > 200 and last == D(94)
    calls = world.md.bar_calls
    with world.sf.begin() as s:
        svc.load(s, "SPY", dt.date(2025, 6, 10))
    assert world.md.bar_calls == calls  # fully cached
    # next day: only the new session is requested
    world.md.add_bars(make_bars("SPY", ["95"], dt.date(2025, 6, 10)))
    with world.sf.begin() as s:
        bars, _ = svc.load(s, "SPY", dt.date(2025, 6, 11))
    assert world.md.bar_calls == calls + 1
    assert bars[-1].session_date == dt.date(2025, 6, 10)


def test_advisory_lock_is_exclusive(world: World) -> None:
    with try_advisory_lock(world.engine) as a:
        assert a
        with try_advisory_lock(world.engine) as b:
            assert not b
    with try_advisory_lock(world.engine) as c:
        assert c


def test_logs_once_when_no_rules_enabled(world: World, caplog: pytest.LogCaptureFixture) -> None:
    caplog.set_level("INFO", logger="dipbuyer.worker.loop")
    loop = world.loop()
    loop.tick(force=True)
    world.clock.advance(5)
    loop.tick(force=True)
    msgs = [r.getMessage() for r in caplog.records]
    assert sum("no enabled rules" in m for m in msgs) == 1


def test_logs_once_when_kill_switch_on(world: World, caplog: pytest.LogCaptureFixture) -> None:
    caplog.set_level("INFO", logger="dipbuyer.worker.loop")
    add_rule(world.sf)
    set_settings(world.sf, kill_switch=True)
    loop = world.loop()
    loop.tick(force=True)
    loop.tick(force=True)
    msgs = [r.getMessage() for r in caplog.records]
    assert sum("kill switch is on" in m for m in msgs) == 1
