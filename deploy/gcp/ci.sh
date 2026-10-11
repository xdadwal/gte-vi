#!/bin/bash
# Docker isolation keeps browser fixtures and integration tests off production.
set -euo pipefail
suffix=${BUILD_ID:-local-$$}
network=gte-ci-$suffix
db=gte-ci-db-$suffix
redis=gte-ci-redis-$suffix
cleanup() {
  docker rm -f "$db" "$redis" >/dev/null 2>&1 || true
  docker network rm "$network" >/dev/null 2>&1 || true
}
trap cleanup EXIT
docker network create "$network" >/dev/null
docker run -d --name "$db" --network "$network" --network-alias gte-ci-db \
  -e POSTGRES_USER=gte -e POSTGRES_PASSWORD=ci-only -e POSTGRES_DB=gte_test \
  postgis/postgis:17-3.5 >/dev/null
docker run -d --name "$redis" --network "$network" --network-alias gte-ci-redis redis:8-alpine >/dev/null
docker build -f deploy/gcp/Dockerfile.ci -t "gte-ci:$suffix" .
docker run --rm --shm-size=1g --network "$network" "gte-ci:$suffix"
