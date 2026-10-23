# Decisions

Choices made where the spec was silent or ambiguous, and every deviation from it.

## Repository and tooling

1. **Location.** This repository is the spec's `dip-buyer/` root, laid out exactly as spec §3.
   It was first developed in `kalabafex/list-detail` (under `dip-buyer/`) and moved here
   with its history.
2. **Python.** `requires-python >= 3.12`. The Docker image uses 3.12; development and tests
   ran on 3.13.
3. **`justfile`**, not a Makefile. Extra recipes: `down`, `logs`, `check-backend`,
   `check-api`, `check-frontend`, `gen-api-live`, `dev-api`, `dev-worker`, `dev-web`.
4. **Alpaca HTTP stubs use `responses`, not `respx`.** `alpaca-py` is built on `requests`;
   `respx` only intercepts `httpx`. Alpaca tests therefore use `responses`. `respx` is used
   for the `httpx` clients (ntfy, heartbeat).
5. **OpenAPI type generation.** `just gen-api` exports the schema with
   `python -m dipbuyer.cli openapi` (no DB, no secrets). This is the same document the
   running server serves at `/api/openapi.json`. `just gen-api-live` reads it from a running
   backend instead. Two layers of staleness check:
   * `just check-api` diffs a fresh export against the committed `frontend/openapi.json`;
   * `npm run build` runs `check-api` first, which regenerates `schema.d.ts` from
     `openapi.json` and fails on any difference.
6. **Dockerfile** installs `uv` with `pip` instead of copying it from `ghcr.io`. It is more
   portable and behaves the same.
7. **`.env.example`.** Comments sit on their own lines. Docker Compose treats `KEY=   # note`
   as the literal value `# note`, which would break empty optional settings such as
   `HEARTBEAT_URL`. Extra optional variables: `SESSION_COOKIE_SECURE`, `DRY_RUN`, `LOG_LEVEL`.
   `just hash-pw` prints the hash wrapped in single quotes because argon2 hashes contain `$`.
8. **Ports** bind to `127.0.0.1` (API 8000, web 8080). Remote access is meant to go through
   Tailscale or Cloudflare Access. nginx in the `web` container proxies `/api` to the API, so
   the browser uses same-origin requests.

## Indicators

9. **Numeric types.** `high_n`, `sma` and `pullback_pct` are exact `Decimal`. `rsi_wilder` is
   an oscillator, not money: it is computed with numpy `float64` and returned as `Decimal`
   rounded to 4 places. `pullback_pct` in snapshots is rounded to 4 places.
10. **Inputs.** `high_n` and the SMAs use completed daily bars only. RSI appends `last` as the
    provisional close of the current session. Otherwise RSI would never change intraday and
    `confirm_evals` would be meaningless for `RSI_OVERSOLD`.
11. **History window.** 420 calendar days of completed sessions (about 290 bars): enough for
    SMA200 and a 250-session lookback. The backtester uses the same trailing window, so RSI
    values match live.
12. **Reference tests.** Hand-computed cases (period-3 RSI worked by hand, SMA, high_n), plus
    Wilder's published 14-period example. The published table rounds its intermediate
    averages, so that test allows a tolerance of 0.1.

## Engine semantics

13. **Confirmation.** `recent_evaluations` is the caller-selected list of prior
    `condition_met` flags. Live, this is the same NY session (up to 20); in the backtest it is
    prior sessions. The engine counts trailing `True`s plus the current evaluation.
14. **Cycles open only with an order.** The engine *proposes* `OPEN`. The worker persists the
    cycle only when risk returns `ORDER` (and the backtester mirrors this). A trigger that risk
    skips (trend filter, caps, cooldown, ...) leaves no cycle behind; it re-proposes on later
    evaluations with a fresh `high_n`.
15. **RSI_OVERSOLD / BELOW_MA.** When the trigger fires, tier 1 is eligible regardless of
    pullback. Deeper tiers, and tier 1 when the trigger is not currently firing, need the
    pullback from the cycle's `ref_high` (the `high_n` at cycle open) to reach their
    `drop_pct`. If the trigger fires while the pullback already meets a deeper tier, the
    deepest such tier is bought (no stacking).
16. **No back-filling.** Once tier *i* is filled in a cycle, tiers shallower than *i* are
    consumed. "Fill only the deepest one (do not stack)" also covers later evaluations: if
    tier 2 was bought directly, the cycle never later buys tier 1.
17. **Precedence in an active cycle:** (1) recovery close, (2) a new tier, (3) cooldown-expiry
    close. A cycle that closes does not reopen in the same evaluation; a new cycle can open on
    the next one.
18. **Cooldown counting.** `sessions_since_last_fill` counts NYSE sessions that started after
    the fill's NY date and have closed by now. A cycle with no fills counts from `started_at`.
    `cooldown_days = 0` closes a cycle as soon as an evaluation yields no new tier.
    Risk check 7 (`SKIP_COOLDOWN`) applies only to new cycles and uses the last fill of the
    most recent closed cycle.
19. **`limit_price`** is `round_to_cent(last * (1 + offset/100))` with ROUND_HALF_UP.

## Risk

20. **Position value** = cost basis (broker `qty × avg_entry_price`) for the symbol, plus the
    notional of open intents for the symbol in the current mode. Market value is not used: it
    shrinks during a dip, so the cap would stop bounding dollars deployed. In the backtester
    it is the cost of fills.
21. **Spend windows** use `OrderIntent.created_at`, are filtered by mode, and run from NY
    midnight (day) and Monday NY midnight (ISO week).
22. **Sizing.** `qty = floor(notional / limit, 6 dp)` for fractionable assets, otherwise whole
    shares. A quantity below the minimum gives `SKIP_QTY_ZERO`. Alpaca's docs confirm
    fractional limit orders with `time_in_force=day` for assets with `fractionable=true`; this
    is checked per symbol via `get_asset`. A symbol that is not tradable at order time also
    gets `SKIP_QTY_ZERO`, with a reason saying so.
23. **Extra decisions:** `SKIP_QTY_ZERO` (spec §9), `SKIP_NO_DATA` (bars or latest trade
    unavailable), `SKIP_DRY_RUN` (milestone 6 `DRY_RUN=true`).

## Worker and broker

24. **Scheduling.** The trading job fires every minute; the loop skips unless
    `evaluation_interval_minutes` has elapsed since `worker_status.last_tick_at`, so interval
    changes need no restart. Daily summary: cron 16:15 America/New_York, Mon to Fri, skipped
    on holidays and sent at most once per day. Backtest runner: every 10 s, claiming rows with
    `FOR UPDATE SKIP LOCKED`.
25. **Advisory lock.** A session-level `pg_try_advisory_lock` on a dedicated connection, held
    for the whole tick.
26. **Kill switch.** Turning it on through the API sets `kill_switch_cancel_pending`. The
    worker's next tick calls `cancel_all_open()` once and clears the flag. The switch is read
    at the start of each tick and re-read (along with the trading mode) right before each
    `OrderIntent` is created.
27. **Market closed or exclusion window → return before reconciling** (per spec). The daily
    summary job reconciles at 16:15 so end-of-day fills and expiries are reported the same
    day.
28. **Provisional tier marks.** On `SUBMITTED` the tier is added to `tiers_filled` and
    `last_fill_at` is set to the submission time. When an order ends canceled, expired or
    rejected with nothing filled, the tier is removed again; `last_fill_at` is not reverted,
    which only delays cooldown.
29. **Partial fill then cancel/expire** is recorded as `FILLED` with the actual `filled_qty`,
    and the tier stays filled.
30. **Orphaned `PENDING` intents** (crash between commit and submit) are looked up by
    `client_order_id`. If found they are adopted; if not found after 2 minutes they become
    `FAILED`. They are never resubmitted automatically.
31. **SDK retries.** `alpaca-py` retries 429/504 internally. The client used for writes is
    limited to 429 (the request was not processed), so a 504 on submit goes through
    `submit_idempotent`'s lookup-before-resubmit path. Alpaca also rejects duplicate
    `client_order_id`s.
32. **Modes.** Open intents and reconciliation are per mode. After a mode switch, the other
    mode's open orders are reconciled only when that mode is active again; live keys are never
    read in PAPER mode. Switching to LIVE also requires live keys to be configured (409
    otherwise).
33. **Data.** Daily bars are split-adjusted (`Adjustment.SPLIT`) and cached in `bars_daily`.
    Only sessions before the earliest or after the latest cached bar are fetched, and the
    head is requested at most once per process. Interior gaps (halts) are not refetched.
    After a split, delete the symbol's cached bars (see README). With `ALPACA_DATA_FEED=iex`
    (free plan) bars and trades are IEX-only; historical requests are limited to 200/min.
34. **The API reads from Alpaca but never trades.** It uses `get_asset` for symbol
    validation and market data for preview and chart. Keys stay server-side; the browser
    only talks to `/api`.
35. **Cap-reached alerts** are sent once per decision type per NY day per worker process.

## API

36. **Additions:** `GET /api/auth/me`, `POST /api/rules/preview` (unsaved params, for the
    create form), `GET /api/backtests` (recent list), `rule_id` filter on `/orders`,
    `triggered_only` filter on `/evaluations`, and `spend_today`, `spend_week`,
    `live_keys_configured` in `GET /settings`. Pagination is `limit`/`offset`, returning
    `{items,total,limit,offset}`. `GET /account` returns `null` before the first snapshot.
37. **Sessions.** Starlette's signed cookie session (`itsdangerous`): 12 h, HttpOnly,
    SameSite=Strict, Secure (configurable only for tests and local http). Elevation lasts
    5 min and is stored in the session.
38. **TOTP.** Codes are accepted within ±1 step. A step is consumed only when the password is
    also correct, and a consumed step cannot be replayed. Replay state and the `/auth/*` rate
    limit (10 requests/min per IP) are in memory, which is fine for one API process.
39. **Settings PUT** covers caps, interval and windows. Mode and kill switch have their own
    endpoints. Weekly cap must be ≥ daily cap. Kill-switch, mode and settings changes go to
    an `audit_log` table.
40. **Rules.** DELETE is a soft delete that also disables the rule. Changing a rule's symbol is
    refused (409) while it has an active cycle or open order.
41. **Money in JSON** is a string (pydantic's `Decimal` serialization). Inputs accept numbers
    or strings.
42. **SSE.** The worker and API publish with Postgres `NOTIFY dipbuyer_events`; the API
    `LISTEN`s and fans out to `/api/stream` subscribers. Events: `evaluation`, `order`,
    `settings`, plus `backtest` and an initial `hello`.

## Backtester

43. One evaluation per session at the close, at most one order per session. An order fills
    at the next session's open if `open ≤ limit`, at the open price; otherwise it expires and
    its tier is un-marked.
44. Queued backtests use the current spend caps from `GlobalSettings`, with the kill switch
    ignored. The CLI uses default caps (500/1500). The CLI's default rule: tiers
    -5%/$100, -10%/$200, -20%/$300; `max_position_usd` $5000; all other parameters at their
    §5 defaults (trend filter ABOVE_200DMA, confirm 2, cooldown 5).
45. **Baseline:** the dollars the rule actually deployed, split equally across the first
    session of each month in range and bought at that session's open (fractional, 6 dp).
    Return % = (final value − invested) / invested. Max drawdown is measured on total equity
    (cash + holdings).
46. **Determinism fixture:** `tests/fixtures/SYNTH_daily.csv`, generated by
    `scripts/gen_fixture.py` with a fixed seed. The golden output is in
    `SYNTH_backtest_golden.json`.

## Frontend

47. API tier indexes (`tier_index`, `tier_hit`, `tiers_filled`, `next_tier`) are 0-based. The
    backtest `trades[].tier` is 1-based. The UI shows every tier as T1, T2, ...
48. Error responses (401/403/404/409/429/503) are not declared in the OpenAPI schema; the
    client handles them by status code. Backtest `results` is a free-form JSON object that
    the UI validates at runtime with zod.
49. Account and position snapshots emit no SSE event. The dashboard polls them every 60 s
    and refreshes them on `order` events. The heartbeat card warns once the last heartbeat
    is more than 15 minutes old.
50. `POST /rules/preview` (unsaved edits) computes tier prices from the current N-day high,
    not from an active cycle's `ref_high`. The preview panel says so.

## Recommendations

51. `POST /api/recommendations` queues a per-symbol sweep that the worker runs (like
    backtests). The grid is 40 configurations from the families that held up in
    `docs/rule-research.md`, plus the app's default rule as a reference row. Each is
    backtested with the unchanged backtester on rolling 3-year windows (6-month step, after
    one year of warm-up). Windows are split chronologically: the first half is "selection",
    the second half "validation". Ranking is by the lower of the two win rates against
    monthly DCA (same dollars), then by the sum of median edges. Confidence: "strong" when
    both halves win ≥ 80% of windows with median edge ≥ 2 pts; "moderate" when ≥ 60% and
    positive. A rule that bought in fewer than 75% of windows is ranked as weak.
52. Each recommendation also carries one full-period backtest with a profit curve (rule vs
    DCA), run at the requested budget per dip and position cap (window scores use a fixed
    $600 ladder without a cap, so they compare rules rather than budgets). Over a long period a dip rule can trail DCA even while it wins most 3-year windows,
    because dip purchases happen later and compound for less time; the UI shows both.
53. Tier amounts are scaled so the ladder sums to `budget_per_dip_usd` (weights 1, 2, 3, ...).
    `POST /api/recommendations/{id}/apply` creates the chosen configuration as a disabled
    rule. Candidates run in a process pool (up to 4 workers).

## Daily picks

54. **Scope change requested by the user:** daily intraday picks with automated entries and
    exits. The spec's out-of-scope list (exit automation, intraday strategies) no longer
    applies to this feature. Auto-trade is limited to PAPER mode and is off by default.
55. Setups are evaluated on **daily OHLC bars** (not minute bars): entries are at the open
    (published 5 minutes after it), exits at a target/stop or the close. When both the
    target and the stop are inside a day's range the stop is assumed first. This keeps
    calibration cheap (seconds for 500 stocks × 5 years) and avoids downloading minute bars.
56. Calibration statistics use float64 (they are statistics, not money); prices sent to
    the broker and stored are Decimal.
57. A setup is traded only if its validation-period mean return is positive with t ≥ 2 over
    ≥ 100 trades, after choosing its exit on the training period. Per-stock history is
    shrunk toward the setup average with weight 20.
58. Orders are Alpaca bracket orders (OTO when only one of target/stop applies), whole
    shares, DAY time in force, `client_order_id = pick id`; the forced exit is a market sell
    with `client_order_id = <pick id>-exit`. Only the picks' own quantities are sold, so
    dip-buyer positions in the same symbol are untouched.
59. Picks run under their own advisory lock and are independent of the dip-buyer rules
    and spend caps; they have their own per-pick notional setting.

## Buy & hold comparison

60. Dip-buyer backtests and recommendations also show **buy & hold**: the same total dollars
    the rule deployed, bought at once at the first session's open and held to the end. It
    appears next to the rule and monthly DCA in the metrics, return tiles and charts. Results
    stored before it existed lack it and are shown without it. Daily picks are unchanged.

## Picks engine and weekly review

61. Three picks per day (was five). The ~30 best-scored candidates (one per stock) are also
    stored and scored after the close as shadow outcomes, so the weekly review learns from
    ~150 results a week instead of 15.
62. "Projected move" is the expected return of following the plan, after costs; "certainty"
    is the calibrated probability that it ends positive. Both come from per-setup ridge and
    logistic models on 8 features, each used only when it beats the plain average on the
    validation years; otherwise the historical averages are used.
63. The weekly review only changes bounded parameters (per-setup multipliers, suspensions,
    certainty calibration) in partial steps and with minimum evidence, to avoid chasing noise.
    The models themselves are refitted by the weekly calibration on refreshed history.
