# Preset rule research

`just seed-rules` adds three preset rules (disabled). This page records how they were chosen.
**Backtests are not predictions; re-check on real data (below) before enabling anything.**

## Data and method

* **Data:** daily S&P 500 index closes and 20 large-cap stocks, 1990-2022, from the
  datasets bundled in the `skfolio` Python package
  (`skfolio/datasets/data/sp500_index.csv.gz` and `sp500_dataset.csv.gz`). Alpaca data
  was not available where the research ran. The data has closes only, so each session's
  open was approximated by the previous close; real fills will differ slightly.
* **Simulator:** the app's own backtester (same indicators, engine and risk code as live).
* **Score:** return on invested dollars minus that of the monthly-DCA baseline that
  invests the same dollars ("edge"), over rolling 3-year windows.
* **Selection:** about 1,000 parameter combinations (pullback / RSI / below-MA triggers,
  lookbacks, tier ladders, trend filter, confirmation, cooldown). Candidates were picked on
  1992-2008 windows and then checked on 2009-2022 windows they were not picked from, and
  on the 20 individual stocks (1995-2022).
* Scripts: `backend/notebooks/rule_sweep.py`, `backend/notebooks/rule_sweep_stocks.py`.

## Results (S&P 500, rolling 3-year windows)

| Rule | 1992-2008: beat DCA | median edge | 2009-2022: beat DCA | median edge | 20 stocks: median win rate / edge |
|---|---|---|---|---|---|
| RSI ≤ 35, tiers 5/10/20 %, confirm 2, cooldown 5, no trend filter (SPY, QQQ presets) | 93 % | +6.0 pts | 92 % | +11.4 pts | 85 % / +9.4 pts |
| Pullback from 20-day high, tiers 4/8/12/16/20 %, confirm 2, cooldown 15, no trend filter (VOO preset) | 80 % | +5.5 pts | 100 % | +10.3 pts | 85 % / +6.3 pts |
| App defaults: pullback 5/10/20 %, trend filter above 200-day MA | - | - | - | - | 25 % / -3.5 pts |

Longer single runs on the S&P 500:

| Period | Rule | Rule return on invested | DCA, same dollars |
|---|---|---|---|
| 2007-2012 | RSI preset | 36.5 % | 18.5 % |
| 2007-2012 | Pullback ladder | 40.2 % | 18.5 % |
| 2016-2022 | RSI preset | 31.5 % | 29.9 % |
| 2016-2022 | Pullback ladder | 26.0 % | 29.9 % |

## What this means

* The edge comes from a lower average cost. It is largest in choppy or falling markets and
  small (or negative) in smooth bull markets.
* **The 200-day trend filter hurt.** It blocks buying exactly when prices are well below
  their long-term average, which is when dip buying paid off. The presets use
  `trend_filter = NONE`. That also means they keep buying in a prolonged bear market (the
  worst 1992-2008 windows were in 2000-2002) until `max_position_usd` is reached.
* Dip rules leave cash idle between dips; "edge" compares returns on the dollars actually
  deployed, not total portfolio growth.
* QQQ was not in the data. Its preset reuses the S&P 500 parameters, which also held up on
  tech stocks (AAPL, MSFT, AMD).

## Re-check with your Alpaca data

```sh
just up
just seed-rules
```

Then in the dashboard, **Backtest** → choose each rule → e.g. 2016-01-01 to today → compare
with DCA. Or from the CLI (uses the app's default rule, not the presets):
`just backtest SPY 2016-01-01 2025-12-31`.
