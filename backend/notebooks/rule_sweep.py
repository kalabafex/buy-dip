"""Parameter sweep for Dip Buyer rules on S&P 500 index closes (skfolio data, 1990-2022).

Each rule is backtested over rolling 3-year windows; the score is its return on invested
dollars minus that of the monthly-DCA baseline investing the same dollars.
"""
from __future__ import annotations

import csv, datetime as dt, itertools, json, statistics, sys
from concurrent.futures import ProcessPoolExecutor
from decimal import Decimal as D

from dipbuyer.backtest import run_backtest
from dipbuyer.domain.models import Bar, GlobalSettingsModel, RuleParams, Tier

DATA = "data/sp500_index.csv"  # see docs/rule-research.md
SETTINGS = GlobalSettingsModel(max_daily_spend_usd=D(100000), max_weekly_spend_usd=D(100000))


def load(path: str, col: str, sym: str) -> list[Bar]:
    rows = list(csv.DictReader(open(path)))
    bars, prev = [], None
    for r in rows:
        if not r[col]:
            continue
        c = D(r[col]).quantize(D("0.01"))
        o = prev if prev is not None else c
        bars.append(Bar(symbol=sym, session_date=dt.date.fromisoformat(r["Date"]), open=o,
                        high=max(o, c), low=min(o, c), close=c, volume=D(0)))
        prev = c
    return bars


def windows(start_year: int, end_year: int, length: int = 3) -> list[tuple[dt.date, dt.date]]:
    return [(dt.date(y, 1, 1), dt.date(y + length - 1, 12, 31)) for y in range(start_year, end_year - length + 2)]


def make_rule(cfg: dict) -> RuleParams:
    drops = cfg["drops"]
    amts = [D(100) * (i + 1) for i in range(len(drops))]  # 100, 200, 300 ...
    return RuleParams(
        symbol="SPX", enabled=True, trigger_type=cfg["trigger"], lookback_days=cfg["lookback"],
        tiers=[Tier(drop_pct=D(d), amount_usd=a) for d, a in zip(drops, amts)],
        rsi_threshold=D(cfg["rsi"]) if cfg.get("rsi") else None, ma_period=cfg.get("ma"),
        trend_filter=cfg["trend"], confirm_evals=cfg["confirm"], max_position_usd=D(10**9),
        cooldown_days=cfg["cooldown"], limit_offset_pct=D("0.3"))


def evaluate(args):
    cfg, bars, wins = args
    rule = make_rule(cfg)
    edges, buys, invested, cost_adv = [], [], [], []
    for s, e in wins:
        r = run_backtest(rule, bars, s, e, D(10**7), SETTINGS)
        if r.rule.total_invested <= 0:
            edges.append(None); buys.append(0); invested.append(0); continue
        edges.append(float(r.rule.return_pct - r.baseline.return_pct))
        buys.append(r.rule.num_buys); invested.append(float(r.rule.total_invested))
        cost_adv.append(float((r.baseline.avg_cost - r.rule.avg_cost) / r.baseline.avg_cost * 100))
    got = [x for x in edges if x is not None]
    return {
        "cfg": cfg,
        "windows_with_buys": len(got), "windows": len(wins),
        "win_rate": sum(1 for x in got if x > 0) / len(got) if got else 0,
        "median_edge": statistics.median(got) if got else 0,
        "mean_edge": statistics.mean(got) if got else 0,
        "worst_edge": min(got) if got else 0,
        "median_cost_adv": statistics.median(cost_adv) if cost_adv else 0,
        "avg_buys": statistics.mean(buys), "avg_invested": statistics.mean(invested),
    }


def grid():
    for trigger, lookback, drops, trend, confirm, cooldown in itertools.product(
        ["PULLBACK_FROM_HIGH"], [20, 50, 120, 250],
        [(3, 6, 10), (5, 10, 15), (5, 10, 20), (7, 14, 21), (10, 20, 30), (4, 8, 12, 16, 20)],
        ["NONE", "ABOVE_200DMA"], [1, 2], [0, 5, 15],
    ):
        yield dict(trigger=trigger, lookback=lookback, drops=drops, trend=trend, confirm=confirm, cooldown=cooldown)
    for rsi, drops, trend, confirm, cooldown in itertools.product(
        [25, 30, 35], [(5, 10, 20), (3, 6, 10)], ["NONE", "ABOVE_200DMA"], [1, 2], [0, 5, 15]):
        yield dict(trigger="RSI_OVERSOLD", rsi=rsi, lookback=50, drops=drops, trend=trend, confirm=confirm, cooldown=cooldown)
    for ma, drops, trend, confirm, cooldown in itertools.product(
        [50, 100, 200], [(5, 10, 20), (3, 6, 10)], ["NONE", "ABOVE_200DMA"], [1, 2], [0, 5, 15]):
        yield dict(trigger="BELOW_MA", ma=ma, lookback=50, drops=drops, trend=trend, confirm=confirm, cooldown=cooldown)


if __name__ == "__main__":
    period = sys.argv[1]  # "in" or "out"
    bars = load(DATA, "SP500", "SPX")
    wins = windows(1992, 2008) if period == "in" else windows(2009, 2022)
    cfgs = list(grid())
    with ProcessPoolExecutor(4) as ex:
        res = list(ex.map(evaluate, [(c, bars, wins) for c in cfgs], chunksize=4))
    json.dump(res, open(f"res_{period}.json", "w"), default=str)
    print(len(res), "configs")
