# Dip Buyer

A personal, single-user, rules-based "buy the dip" system. You configure rules in a web
dashboard. A separate worker evaluates them during US market hours and places **limit buy**
orders through Alpaca. It runs in **paper trading** mode by default.

* `backend/`: Python 3.12+ (FastAPI API, APScheduler worker, SQLAlchemy/Alembic, alpaca-py)
* `frontend/`: React + TypeScript (Vite, TanStack Query, Tailwind, lightweight-charts)
* `docker-compose.yml`: `db`, `api`, `worker`, `web`
* `DECISIONS.md`: every interpretation of, and deviation from, the spec

Only the worker submits orders. The browser never sees broker keys.

## Setup

Requirements: Docker (with compose), [`uv`](https://docs.astral.sh/uv/), Node 22, and
[`just`](https://github.com/casey/just) (`uv tool install rust-just` works).

```sh
cp .env.example .env
cd backend && uv sync && cd ..
just hash-pw     # paste the APP_ADMIN_PASSWORD_HASH='...' line into .env (keep the quotes)
just gen-totp    # set APP_TOTP_SECRET; add the otpauth URL to your authenticator app
just gen-secret  # paste the SESSION_SECRET=... line into .env
# add your Alpaca *paper* key id and secret
just up          # builds and starts db, api (runs migrations), worker, web
```

Open <http://localhost:8080> and log in with username, password and TOTP code.
`http://localhost:8000/api/health` should report `"db": true`.

For remote access, put port 8080 behind Tailscale or Cloudflare Access **over HTTPS**
(Cloudflare Access, or `tailscale serve` with HTTPS). The session cookie is `Secure`,
and browsers only make an exception for `http://localhost`. Both ports bind
to 127.0.0.1 only. The app still enforces its own login.

### Environment variables

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | SQLAlchemy URL (`postgresql+psycopg://…`). In compose the host is `db`. |
| `ALPACA_PAPER_KEY_ID`, `ALPACA_PAPER_SECRET` | Paper trading and market data keys. |
| `ALPACA_LIVE_KEY_ID`, `ALPACA_LIVE_SECRET` | Live keys. Read only when the trading mode is LIVE. |
| `ALPACA_DATA_FEED` | `iex` (free plan) or `sip` (paid). |
| `APP_ADMIN_USERNAME` | Login username. |
| `APP_ADMIN_PASSWORD_HASH` | argon2 hash from `just hash-pw`, single-quoted. |
| `APP_TOTP_SECRET` | Base32 TOTP secret from `just gen-totp`. |
| `SESSION_SECRET` | ≥ 32 random characters; signs the session cookie. |
| `NTFY_TOPIC_URL` | ntfy topic URL for alerts. Leave empty to disable alerts. |
| `HEARTBEAT_URL` | Pinged on every market-hours tick (e.g. healthchecks.io). |
| `CORS_ORIGIN` | Allowed browser origin for the Vite dev server (`http://localhost:5173`). |
| `SESSION_COOKIE_SECURE` | Default `true`. Browsers accept Secure cookies on `http://localhost`. |
| `DRY_RUN` | `true`: the worker evaluates and logs but never submits orders. |
| `LOG_LEVEL` | Default `INFO`. Logs are JSON on stdout, with secrets redacted. |

## Development

```sh
just test                 # backend tests; integration tests start Postgres via Testcontainers
TEST_DATABASE_URL=postgresql+psycopg://u:p@localhost/db just test   # or reuse a database
just check                # ruff, pyright (strict core), pytest, API-type freshness, frontend typecheck/lint/build
just gen-api              # regenerate frontend/openapi.json and src/api/schema.d.ts after API changes
just backtest LITE 2022-01-01 2025-12-31            # rule vs monthly-DCA metrics (needs Alpaca keys)
just backtest SYNTH 2021-01-01 2023-12-29 --csv tests/fixtures/SYNTH_daily.csv   # offline
```

Without Docker: point `DATABASE_URL` at a Postgres 16 instance, run `just migrate`, then run
`just dev-api`, `just dev-worker` and `just dev-web` (Vite on :5173 proxies `/api` to :8000).

Backend layout: `domain`, `indicators`, `engine` and `risk` are pure (no I/O) and are reused
unchanged by `backtest`. `broker` holds the `BrokerClient` protocol, `AlpacaBroker` and
`FakeBroker`. `worker/loop.py` holds the trading loop, reconciler and daily summary.

## How it trades

Each tick (every `evaluation_interval_minutes`, during NYSE hours, outside the open/close
exclusion windows), the worker:

1. takes a Postgres advisory lock (a second runner skips the tick);
2. pings the heartbeat and reads settings. If the kill switch is on, it cancels open orders
   once and stops;
3. reconciles open orders with Alpaca and snapshots the account and positions;
4. for each enabled rule: loads cached daily bars and the latest trade, computes
   indicators, runs the engine (trigger, confirmation, dip cycle, tier) and the risk checks,
   and records an `Evaluation`;
5. for an `ORDER`: re-checks the kill switch, commits a `PENDING` `OrderIntent`, then
   submits a DAY limit buy with `client_order_id = intent.id`. On a timeout or 5xx it looks
   the order up before ever resubmitting.

Alerts go to ntfy: order submitted, filled, rejected or failed, cap reached, worker
exception, kill switch, mode change, and a 16:15 ET daily summary.

## Operating procedures

**Going live.** Run in PAPER mode first, ideally with `DRY_RUN=true` for a few sessions, and
review the evaluation log. To switch: add the live keys to `.env`, then
`docker compose up -d` (this restarts api and worker). In Settings → Mode, re-authenticate
(password + TOTP) and type `LIVE`. The header badge turns red. Switch back to PAPER from the
same place.

**Emergency stop.** Turn on the kill switch in the header (any page). Open orders are
canceled on the worker's next tick, within about a minute, and no new orders are placed.
Turning it off requires re-authentication. To stop everything at once:
`docker compose stop worker`.

**Health.** Watch the dashboard's "last heartbeat" card and your `HEARTBEAT_URL` monitor.
Worker exceptions also trigger ntfy alerts. Logs: `just logs worker`.

**After a stock split.** Cached bars are split-adjusted as of when they were fetched. Delete
the symbol's cache so it is refetched:
`docker compose exec db psql -U dipbuyer -c "DELETE FROM bars_daily WHERE symbol='XYZ'"`.

**Backups.** All state is in Postgres:
`docker compose exec db pg_dump -U dipbuyer dipbuyer > backup.sql`.

**Rotating credentials.** Change `.env` and run `docker compose up -d`. A new
`SESSION_SECRET` logs everyone out.

**Migrations.** The api container runs `alembic upgrade head` on start. To run them by hand:
`docker compose exec api alembic upgrade head`.

## Scope

Buys only. There is no selling or exit automation, and no options, shorting, margin,
crypto, multiple users or accounts, intraday-bar strategies, or public signup.

## Windows

The justfile runs recipes with PowerShell on Windows (`just` ≥ 1.38). Docker Desktop must be
running for `just up` and for the integration tests. `.gitattributes` keeps LF line endings
in the checkout, so formatting checks behave the same on every OS. Recipes call Python tools
as `python -m <tool>` rather than through the `.exe` launchers in `.venv\Scripts`, which
Windows Smart App Control / App Control policies may block ("An Application Control policy
has blocked this file"). Do the same when running a tool by hand, e.g.
`uv run python -m pytest`.
