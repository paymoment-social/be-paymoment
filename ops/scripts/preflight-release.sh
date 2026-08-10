#!/usr/bin/env bash
set -euo pipefail

release_root=${1:-/opt/paymoment/current}
ops_dir="$release_root/be-paymonent/ops"
infra_env=/etc/paymoment/infra.env
api_env=/etc/paymoment/api.env
web_env=/etc/paymoment/web.env

for command in docker caddy systemctl curl node; do command -v "$command" >/dev/null || { echo "Missing required command: $command" >&2; exit 1; }; done
for executable in /usr/local/bin/bun /usr/local/bin/pnpm; do test -x "$executable" || { echo "Missing required executable: $executable" >&2; exit 1; }; done
case "$(node --version)" in v24.*) ;; *) echo "Node.js 24 is required." >&2; exit 1 ;; esac
test "$(/usr/local/bin/bun --version)" = "1.3.5" || { echo "Bun 1.3.5 is required." >&2; exit 1; }
test "$(/usr/local/bin/pnpm --version)" = "11.3.0" || { echo "pnpm 11.3.0 is required." >&2; exit 1; }
for file in "$infra_env" "$api_env" "$web_env" "$ops_dir/docker-compose.infra.yml" "$ops_dir/Caddyfile"; do test -f "$file" || { echo "Missing required file: $file" >&2; exit 1; }; done

for file in "$infra_env" "$api_env" "$web_env"; do
  mode=$(stat -c '%a' "$file")
  test "$mode" = 600 || { echo "Expected mode 0600 for $file, found $mode" >&2; exit 1; }
done

docker compose --env-file "$infra_env" -f "$ops_dir/docker-compose.infra.yml" config --quiet
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
systemd-analyze verify "$ops_dir/systemd/paymoment-api.service" "$ops_dir/systemd/paymoment-web.service" "$ops_dir/systemd/paymoment-backup.service" "$ops_dir/systemd/paymoment-backup.timer"
curl --fail --silent --show-error https://api.paymom3nts.xyz/health >/dev/null
curl --fail --silent --show-error https://mcp.paymom3nts.xyz/.well-known/oauth-authorization-server >/dev/null
echo "PayMoment release preflight passed."
