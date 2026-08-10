#!/usr/bin/env bash
set -euo pipefail

source_dir=$(cd "$(dirname "$0")/../.." && pwd)
test_dir=/tmp/paymoment-phase4-db-test
archive=/tmp/paymoment-phase4-db-test.tar.gz
test_db=paymoment_phase4_test
postgres_container=paymoment-infra-postgres-1
infra_env=/etc/paymoment/infra.env
docker_network=paymoment-infra_default

cleanup() {
  docker exec "$postgres_container" sh -lc 'psql -U "$POSTGRES_USER" -d postgres -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS paymoment_phase4_test WITH (FORCE);"' >/dev/null 2>&1 || true
  rm -rf -- "$test_dir"
  rm -f -- "$archive"
}
trap cleanup EXIT INT TERM

test -f "$infra_env"
test ! -e "$test_dir"
tar --exclude=node_modules --exclude=.git --exclude='.env*' -czf "$archive" -C "$source_dir" .
mkdir -p "$test_dir"
tar -xzf "$archive" -C "$test_dir"

set -a
. "$infra_env"
set +a
docker exec "$postgres_container" sh -lc 'psql -U "$POSTGRES_USER" -d postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE paymoment_phase4_test;"'
database_url="postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/${test_db}"
printf 'DATABASE_URL=%s\n' "$database_url" > "$test_dir/.env"

docker run --rm --network "$docker_network" -v "$test_dir:/app" -w /app oven/bun:1.3.5-alpine bun install --frozen-lockfile
docker run --rm --network "$docker_network" -v "$test_dir:/app" -w /app -e DATABASE_URL="$database_url" oven/bun:1.3.5-alpine bun run db:migrate
docker run --rm --network "$docker_network" -v "$test_dir:/app" -w /app -e DATABASE_URL="$database_url" oven/bun:1.3.5-alpine bun run db:seed
docker run --rm --network "$docker_network" -v "$test_dir:/app" -w /app -e RUN_DB_INTEGRATION=1 -e DATABASE_URL="$database_url" oven/bun:1.3.5-alpine bun test src/modules/discover/phase4.integration.test.ts
echo "Phase 4 PostgreSQL integration verification passed."
