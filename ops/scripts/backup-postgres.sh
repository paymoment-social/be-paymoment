#!/usr/bin/env bash
set -euo pipefail

root_dir=/opt/paymoment
backup_dir=/var/backups/paymoment/postgres
compose_file="$root_dir/current/be-paymonent/ops/docker-compose.infra.yml"
timestamp=$(date -u +%Y%m%dT%H%M%SZ)

install -d -m 0750 "$backup_dir"
docker compose --env-file /etc/paymoment/infra.env -f "$compose_file" exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom' | gzip > "$backup_dir/paymoment-$timestamp.dump.gz"
find "$backup_dir" -type f -name 'paymoment-*.dump.gz' -mtime +14 -delete
