"""Worker entrypoint: ``python -m dipbuyer.worker``."""

from __future__ import annotations

import logging
import signal
import sys
from types import FrameType

from apscheduler.schedulers.blocking import BlockingScheduler
from apscheduler.triggers.cron import CronTrigger

from dipbuyer.alerts import make_notifier, ping_heartbeat
from dipbuyer.broker import BrokerClient
from dipbuyer.broker.alpaca import AlpacaBroker
from dipbuyer.config import get_settings
from dipbuyer.data.bars import BarService
from dipbuyer.data.market_data import AlpacaMarketData
from dipbuyer.domain.enums import TradingMode
from dipbuyer.logging_setup import setup_logging
from dipbuyer.persistence.db import get_engine, make_session_factory
from dipbuyer.worker.backtest_runner import run_queued
from dipbuyer.worker.loop import TradingLoop
from dipbuyer.worker.picks_trader import PicksTrader
from dipbuyer.worker.recommendation_runner import run_queued as run_recommendations

log = logging.getLogger("dipbuyer.worker")


def main() -> None:
    env = get_settings()
    setup_logging(
        env.log_level,
        secrets=[
            env.alpaca_paper_secret.get_secret_value(),
            env.alpaca_live_secret.get_secret_value(),
        ],
    )
    engine = get_engine(env.database_url)
    sf = make_session_factory(engine)
    notifier = make_notifier(env.ntfy_topic_url)
    brokers: dict[TradingMode, BrokerClient] = {}
    services: dict[TradingMode, BarService] = {}

    def broker_factory(mode: TradingMode) -> BrokerClient:
        if mode not in brokers:
            key, secret = env.alpaca_keys(mode)  # live keys only read in LIVE mode
            brokers[mode] = AlpacaBroker(key, secret, mode)
        return brokers[mode]

    def bar_service_factory(mode: TradingMode) -> BarService:
        if mode not in services:
            key, secret = env.alpaca_keys(mode)
            services[mode] = BarService(AlpacaMarketData(key, secret, env.alpaca_data_feed))
        return services[mode]

    loop = TradingLoop(
        session_factory=sf,
        db_engine=engine,
        broker_factory=broker_factory,
        bar_service_factory=bar_service_factory,
        notifier=notifier,
        heartbeat=lambda: ping_heartbeat(env.heartbeat_url),
        dry_run=env.dry_run,
    )

    picks = PicksTrader(
        session_factory=sf,
        db_engine=engine,
        broker_factory=broker_factory,  # picks only ever trade with PAPER
        market_data_factory=lambda mode: bar_service_factory(mode).md,
        bar_service_factory=bar_service_factory,
        notifier=notifier,
    )

    def picks_job() -> None:
        try:
            picks.tick()
        except Exception as exc:
            log.exception("picks tick failed")
            notifier.send("Worker exception", f"daily picks: {exc}", priority="high")

    def calibration_job() -> None:
        try:
            picks.run_calibrations()
            picks.run_weekly_review()
        except Exception:
            log.exception("picks calibration/review runner failed")

    def trading_job() -> None:
        try:
            outcome = loop.tick()
            log.debug("tick", extra={"outcome": outcome.value})
        except Exception as exc:
            log.exception("trading tick failed")
            notifier.send("Worker exception", f"trading tick: {exc}", priority="high")

    def summary_job() -> None:
        try:
            loop.daily_summary()
        except Exception as exc:
            log.exception("daily summary failed")
            notifier.send("Worker exception", f"daily summary: {exc}", priority="high")

    def backtest_job() -> None:
        try:
            run_queued(sf, bar_service_factory)
        except Exception:
            log.exception("backtest runner failed")

    def recommendation_job() -> None:
        try:
            run_recommendations(sf, bar_service_factory)
        except Exception:
            log.exception("recommendation runner failed")

    sched = BlockingScheduler(timezone="UTC")
    # Runs every minute; the loop itself enforces evaluation_interval_minutes from settings.
    sched.add_job(trading_job, "interval", minutes=1, id="trading", max_instances=1, coalesce=True)
    sched.add_job(
        summary_job,
        CronTrigger(day_of_week="mon-fri", hour=16, minute=15, timezone="America/New_York"),
        id="summary",
        max_instances=1,
    )
    sched.add_job(backtest_job, "interval", seconds=10, id="backtests", max_instances=1)
    sched.add_job(picks_job, "interval", minutes=1, id="picks", max_instances=1, coalesce=True)
    sched.add_job(
        calibration_job, "interval", seconds=30, id="calibration", max_instances=1, coalesce=True
    )
    sched.add_job(recommendation_job, "interval", seconds=10, id="recommendations", max_instances=1)

    def shutdown(signum: int, _frame: FrameType | None) -> None:
        log.info("shutting down", extra={"signal": signum})
        sched.shutdown(wait=False)

    signal.signal(signal.SIGTERM, shutdown)
    signal.signal(signal.SIGINT, shutdown)
    if not all(env.alpaca_keys(TradingMode.PAPER)):
        log.warning("ALPACA_PAPER_KEY_ID/SECRET not set: market-hours ticks will fail")
    log.info("worker started", extra={"dry_run": env.dry_run})
    sched.start()


if __name__ == "__main__":
    main()
    sys.exit(0)
