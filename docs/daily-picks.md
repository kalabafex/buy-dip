# Daily picks

Every trading day the worker publishes **3 intraday picks** from the S&P 500, each with an
exact plan (when to buy, at what limit, the profit target, the stop loss and the latest exit
time), a **projected move** with a likely range, a **certainty** percentage, and a saved,
itemized explanation of why the engine chose it. With auto-trade on (paper account only), it places
and manages the trades itself and records what actually happened.

**Nothing here predicts the future.** Expected returns are averages of past occurrences of
the same setup. Individual days will often lose. The app records the plan's outcome and the
actual fills every day so you can judge the picks on live results, not just backtests.

## Timeline (New York time; half-days use the early close)

| Time | What happens |
|---|---|
| Weekly (off-hours) | **Calibration**: ~5 years of daily bars for the universe are downloaded and every setup × exit combination is backtested (see below). |
| 08:50 | Completed daily bars for all ~500 stocks are refreshed. |
| **09:35** | **Picks published.** Today's opens are read from a market snapshot, the setups that fire are ranked, and the top 3 are stored (plus the ~30 best runners-up as shadow candidates) and sent as an alert. With auto-trade on, one bracket order is placed per tradeable pick: a limit buy (DAY) with a take-profit limit and a stop-loss stop. |
| every minute | Fills are reconciled; target/stop exits are recorded. |
| **15:55** | **Forced exit.** Unfilled entries and the remaining exit leg are cancelled, and whatever is still held is sold at market. Nothing is held overnight. |
| 16:15 | Each pick's **plan return** (what following the plan returned, from the day's OHLC) and **realized return** (from actual fills) are recorded, and a results alert is sent. |

No new picks are published later than 15:25; no entries are submitted later than 10:05.

## Setups

| Setup | Fires when (decided at the open) |
|---|---|
| Gap-down reversal | Opens 1–8% below yesterday's close while above its 200-day average. |
| Gap-up momentum | Opens 1–5% above yesterday's close while above its 50-day average. |
| Short-term oversold (RSI-2) | 2-day RSI < 10, above its 200-day average, quiet open (gap < 2%). |
| Pullback in an uptrend | Three down closes in a row, 50-day average above the 200-day. |
| 20-day breakout | Closed at a 20-day high yesterday and opens 0–5% higher. |

Each setup is tested with targets and stops of 0.5 or 1.0 × the stock's 14-day average true
range (ATR), or none (exit at the close): 9 combinations.

## How returns are calculated

* **Simulation:** entry at the open + 5 bps slippage; exit at the target (limit), the stop
  (− 5 bps), or the close (− 5 bps). Daily bars do not show whether the high or the low came
  first, so when both the target and the stop are inside the day's range **the stop is
  assumed to hit first** (conservative).
* **Calibration:** for each setup, the exit combination with the best average return on the
  first 2/3 of the history is chosen, then checked on the last 1/3. A setup is **validated**
  only if that later period's average return is positive with a t-statistic ≥ 2 over at
  least 100 trades. Unvalidated setups can still appear in the list (marked "watch"), but
  are never traded.
* **Expected return** of a pick = the stock's own history with that setup blended with the
  setup's average across all stocks: `(n·stock_mean + 20·setup_mean) / (n + 20)`, where `n`
  is the stock's number of past occurrences. The win rate is blended the same way.
* **Ranking:** best setup per stock, validated setups first, then by expected return.

## Projected move, certainty and the engine

For every setup that fires, the engine computes:

* **Base**: the stock's own history with the setup blended with the setup's average across
  all stocks, `(n·stock + 20·setup) / (n + 20)`.
* **Feature adjustment**: per setup, a ridge regression on 8 features (opening gap, ATR %,
  2-day RSI, distance from the 50- and 200-day averages, down-day streak, yesterday's volume
  vs its 20-day average, distance from the 20-day high), fitted on the training years and
  **used only if it beats the plain average on the validation years**. Each feature's
  contribution (coefficient × standardized value) is saved.
* **Projected move** = (base + adjustment) × the setup's weekly-review multiplier. The likely
  range is the middle 50% of past outcomes for the setup, centred on the projection.
* **Certainty** = probability that following the plan ends positive: a logistic model per
  setup (again only if it beats the base rate on validation) blended with the stock's own
  win rate, then passed through the weekly-review calibration.
* **Ranking**: validated and not suspended setups first, then projected move, then
  certainty; one setup per stock; top 3.

**Saved reasons.** Each pick and each shadow candidate stores its explanation: the setup and
the actual numbers that triggered it, the setup's validated history, the stock's own
history, the feature contributions, any weekly-review scaling or suspension, the exit
choice, and how certainty was computed. They are shown on the pick cards.

## Weekly review

Every weekend (or Friday after the close) the worker compares predictions with outcomes for
all scored candidates of the last 8 weeks (picks and runners-up, ~150 per week) and
publishes a new engine version if the evidence justifies a change:

| Check | Change (bounded, partial steps) | Evidence needed |
|---|---|---|
| A setup's projections run hot or cold | multiplier moves 30% of the way to realized / projected, within 0-1.5 | ≥ 20 candidates of that setup |
| A setup loses money live | suspended from picks (still tracked); reinstated when it recovers | ≥ 30 candidates, t ≤ −2 |
| Certainty is miscalibrated | certainty recalibration (logistic on the raw certainty) moves halfway to the fit | ≥ 60 candidates |

Each review stores the week's and the 8-week comparison (projected vs realized, bias,
direction hit rate, certainty vs actual win rate by bucket, per-setup results) and every
change with its reason. The Engine page shows versions and reviews; "Review now" runs one
immediately.

## Trading rules

* Auto-trade is **off by default** and runs **only in PAPER mode**; the kill switch blocks
  new entries (exits still run).
* Size = whole shares of `notional per pick ÷ entry limit` (bracket orders cannot be
  fractional). A pick is "watch only" if one share costs more than the budget, if its setup
  is not validated, or if its expected return is below the minimum in settings.
* Entry limit = today's open + 0.3%. If the price has run away, the order may not fill.
* Accounts under $25,000 are limited to 3 day trades per 5 business days (pattern day trader
  rule). Alpaca paper accounts start with $100,000, so this does not bite on paper.

## Data notes

* Alpaca's free plan uses the IEX feed: opens and daily bars reflect IEX trades only, which
  can differ slightly from the consolidated tape.
* The universe is the bundled S&P 500 list (`backend/src/dipbuyer/picks/data/sp500.csv`).
  `just refresh-universe` downloads the current list; rebuild afterwards (`just up`).
* `just calibrate-picks` (or the button on the Daily picks page) queues a recalibration.
