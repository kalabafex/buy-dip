import sys, json, statistics
sys.path.insert(0, __import__("os").path.dirname(__file__))
from rule_sweep import load, windows, evaluate
from concurrent.futures import ProcessPoolExecutor
import csv
CFGS = {
 "RSI35_5-10-20_cf2_cd5": dict(trigger="RSI_OVERSOLD", rsi=35, lookback=50, drops=(5,10,20), trend="NONE", confirm=2, cooldown=5),
 "RSI35_3-6-10_cf2_cd0": dict(trigger="RSI_OVERSOLD", rsi=35, lookback=50, drops=(3,6,10), trend="NONE", confirm=2, cooldown=0),
 "PB20_4..20_cf2_cd15": dict(trigger="PULLBACK_FROM_HIGH", lookback=20, drops=(4,8,12,16,20), trend="NONE", confirm=2, cooldown=15),
 "DEFAULT_5-10-20_200dma": dict(trigger="PULLBACK_FROM_HIGH", lookback=20, drops=(5,10,20), trend="ABOVE_200DMA", confirm=2, cooldown=5),
}
path = "data/sp500_dataset.csv"
syms = next(csv.reader(open(path)))[1:]
jobs = []
for s in syms:
    bars = load(path, s, "SPX")
    for name, c in CFGS.items():
        jobs.append((name, s, (c, bars, windows(1995, 2022))))
with ProcessPoolExecutor(4) as ex:
    res = list(ex.map(evaluate, [j[2] for j in jobs], chunksize=2))
by = {}
for (name, s, _), r in zip(jobs, res):
    by.setdefault(name, []).append((s, r))
for name, lst in by.items():
    wr = [r["win_rate"] for _, r in lst]; me = [r["median_edge"] for _, r in lst]
    print(f"{name:24} stocks: median win_rate={statistics.median(wr):.2f} median edge={statistics.median(me):5.2f}  stocks with win_rate>=0.6: {sum(w>=0.6 for w in wr)}/{len(wr)}")
