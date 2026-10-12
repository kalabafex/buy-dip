# Dip Buyer developer commands. Requires: docker, uv, node/npm, just.

backend := "backend"
frontend := "frontend"

default:
    @just --list

# docker compose up (db, api, worker, web)
up:
    docker compose up -d --build

down:
    docker compose down

logs *ARGS:
    docker compose logs -f {{ARGS}}

# alembic upgrade head (uses DATABASE_URL; inside compose: `docker compose exec api alembic upgrade head`)
migrate:
    cd {{backend}} && uv run alembic upgrade head

# backend tests (integration tests use Testcontainers, or TEST_DATABASE_URL if set)
test *ARGS:
    cd {{backend}} && uv run pytest {{ARGS}}

# full lint/type/test/build
check: check-backend check-api check-frontend

check-backend:
    cd {{backend}} && uv run ruff format --check src tests
    cd {{backend}} && uv run ruff check src tests
    cd {{backend}} && uv run pyright
    cd {{backend}} && uv run pytest -q

# fail if the committed OpenAPI schema / generated TS types are stale
check-api:
    cd {{backend}} && uv run python -m dipbuyer.cli openapi --out /tmp/dipbuyer-openapi.json
    diff -u {{frontend}}/openapi.json /tmp/dipbuyer-openapi.json || (echo "API types out of date: run 'just gen-api'" && exit 1)

check-frontend:
    cd {{frontend}} && npm ci --no-audit --no-fund
    cd {{frontend}} && npm run typecheck
    cd {{frontend}} && npm run lint
    cd {{frontend}} && npm run build

# regenerate frontend API types from the backend's OpenAPI schema
gen-api:
    cd {{backend}} && uv run python -m dipbuyer.cli openapi --out ../{{frontend}}/openapi.json
    cd {{frontend}} && npm run gen-api

# same as gen-api, but read the schema from a running backend
gen-api-live URL="http://localhost:8000":
    curl -fsS {{URL}}/api/openapi.json | python3 -m json.tool --sort-keys --indent 2 > {{frontend}}/openapi.json
    cd {{frontend}} && npm run gen-api

# prompt for a password and print its argon2 hash
hash-pw:
    cd {{backend}} && uv run python -m dipbuyer.cli hash-pw

# print a new TOTP secret and otpauth URL
gen-totp:
    cd {{backend}} && uv run python -m dipbuyer.cli gen-totp

# CLI backtest with default rule params, e.g. `just backtest LITE 2022-01-01 2025-12-31`
backtest SYMBOL START END *ARGS:
    cd {{backend}} && uv run python -m dipbuyer.cli backtest {{SYMBOL}} {{START}} {{END}} {{ARGS}}

# run the API and worker locally against DATABASE_URL (no Docker)
dev-api:
    cd {{backend}} && uv run uvicorn dipbuyer.api.main:app --reload --port 8000

dev-worker:
    cd {{backend}} && uv run python -m dipbuyer.worker

dev-web:
    cd {{frontend}} && npm run dev
