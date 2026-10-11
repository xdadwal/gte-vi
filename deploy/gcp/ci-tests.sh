#!/bin/bash
# Runs inside the disposable CI container; never connects to deployed services.
set -euo pipefail
export TEST_DATABASE_URL='postgres://gte:ci-only@gte-ci-db:5432/gte_test?sslmode=disable'
export TEST_REDIS_URL='redis://gte-ci-redis:6379'
for attempt in $(seq 1 60); do
  if pg_isready -d "$TEST_DATABASE_URL" >/dev/null 2>&1; then break; fi
  sleep 1
done
pg_isready -d "$TEST_DATABASE_URL"
go test -race ./...
go vet ./...
npm test --prefix web
npm run build --prefix web
psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -c 'CREATE DATABASE gte;'
go build -o /tmp/gte-ci ./cmd/gte
APP_ENV=development DEV_AUTH_TOKEN=local-development-only \
  DATABASE_URL='postgres://gte:ci-only@gte-ci-db:5432/gte?sslmode=disable' \
  REDIS_URL="$TEST_REDIS_URL" /tmp/gte-ci > /tmp/gte-api.log 2>&1 &
api_pid=$!
npm run dev --prefix web > /tmp/gte-web.log 2>&1 &
web_pid=$!
trap 'kill "$api_pid" "$web_pid" 2>/dev/null || true' EXIT
for attempt in $(seq 1 60); do
  if curl --fail --silent http://127.0.0.1:8080/api/v1/health && \
     curl --fail --silent http://127.0.0.1:5173/ >/dev/null; then break; fi
  sleep 1
done
curl --fail --silent http://127.0.0.1:8080/api/v1/health
curl --fail --silent http://127.0.0.1:5173/ >/dev/null
(cd web && npx playwright test e2e/map.spec.ts e2e/hotspots.spec.ts e2e/settings.spec.ts e2e/alerts.spec.ts)
