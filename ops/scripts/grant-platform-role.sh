#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "Usage: bash ops/scripts/grant-platform-role.sh --email USER_EMAIL --role moderator|admin [--granted-by ADMIN_EMAIL]" >&2
  exit 64
}

email=""
role=""
granted_by=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --email) email="${2:-}"; shift 2 ;;
    --role) role="${2:-}"; shift 2 ;;
    --granted-by) granted_by="${2:-}"; shift 2 ;;
    *) usage ;;
  esac
done

[[ "$email" == *"@"* ]] || usage
[[ "$role" == "moderator" || "$role" == "admin" ]] || usage

infra_env="${PAYMOMENT_INFRA_ENV:-/etc/paymoment/infra.env}"
[[ -r "$infra_env" ]] || { echo "Cannot read the protected infrastructure environment file." >&2; exit 1; }

set -a
# shellcheck disable=SC1090
source "$infra_env"
set +a

compose_file="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/docker-compose.infra.yml"
query="WITH target AS (SELECT id FROM users WHERE lower(email) = lower(:'email')), grantor AS (SELECT id FROM users WHERE lower(email) = lower(:'granted_by')) INSERT INTO user_roles (user_id, role, granted_by_id) SELECT target.id, :'role'::user_role, NULLIF((SELECT id FROM grantor), NULL) FROM target ON CONFLICT (user_id, role) DO NOTHING RETURNING user_id, role;"

result="$(docker compose --env-file "$infra_env" -f "$compose_file" exec -T postgres psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -v email="$email" -v role="$role" -v granted_by="$granted_by" -c "$query")"
if [[ -z "$result" ]]; then
  echo "No role was granted. Confirm the target user exists and does not already have this role." >&2
  exit 1
fi
echo "Role granted successfully."
