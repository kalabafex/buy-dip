# Dip Buyer developer commands. Requires: docker, uv, node/npm, just >= 1.38.
# Recipes avoid shell-specific syntax so they run under sh (Linux/macOS) and PowerShell (Windows).

set windows-shell := ["powershell.exe", "-NoLogo", "-NoProfile", "-Command"]

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
[working-directory: 'backend']
migrate:
    uv run alembic upgrade head

# backend tests (integration tests use Testcontainers, or TEST_DATABASE_URL if set)
[working-directory: 'backend']
test *ARGS:
    uv run pytest {{ARGS}}

# full lint/type/test/build
check: check-backend check-api check-frontend

[working-directory: 'backend']
check-backend:
    uv run ruff format --check src tests
    uv run ruff check src tests
    uv run pyright
    uv run pytest -q

# fail if frontend/openapi.json is stale (the frontend build checks schema.d.ts against it)
[working-directory: 'backend']
check-api:
    uv run python -m dipbuyer.cli openapi --check ../frontend/openapi.json

[working-directory: 'frontend']
check-frontend:
    npm ci --no-audit --no-fund
    npm run typecheck
    npm run lint
    npm run build

# regenerate frontend API types from the backend's OpenAPI schema
gen-api: _export-openapi _gen-types

# same as gen-api, but read the schema from a running backend
gen-api-live URL="http://localhost:8000": (_fetch-openapi URL) _gen-types

[working-directory: 'backend']
_export-openapi:
    uv run python -m dipbuyer.cli openapi --out ../frontend/openapi.json

[working-directory: 'backend']
_fetch-openapi URL:
    uv run python -m dipbuyer.cli openapi --from-url {{URL}} --out ../frontend/openapi.json

[working-directory: 'frontend']
_gen-types:
    npm run gen-api

# prompt for a password and print its argon2 hash
[working-directory: 'backend']
hash-pw:
    uv run python -m dipbuyer.cli hash-pw

# print a new TOTP secret and otpauth URL
[working-directory: 'backend']
gen-totp:
    uv run python -m dipbuyer.cli gen-totp

# CLI backtest with default rule params, e.g. `just backtest LITE 2022-01-01 2025-12-31`
[working-directory: 'backend']
backtest SYMBOL START END *ARGS:
    uv run python -m dipbuyer.cli backtest {{SYMBOL}} {{START}} {{END}} {{ARGS}}

# run the API and worker locally against DATABASE_URL (no Docker)
[working-directory: 'backend']
dev-api:
    uv run uvicorn dipbuyer.api.main:app --reload --port 8000

[working-directory: 'backend']
dev-worker:
    uv run python -m dipbuyer.worker

[working-directory: 'frontend']
dev-web:
    npm run dev
