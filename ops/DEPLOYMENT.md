# PayMoment VPS release

The backend repository owns the deploy-time infrastructure files in this directory. Clone the verified backend and frontend tags into `/opt/paymoment/releases/<tag>/be-paymonent` and `/opt/paymoment/releases/<tag>/fe-paymoment`, then point `/opt/paymoment/current` at that release directory.

Keep `/etc/paymoment/infra.env`, `/etc/paymoment/api.env`, and `/etc/paymoment/web.env` root-owned with mode `0600`. Copy `.env.infra.example` only as a template; never commit real credentials.

## Runtime prerequisites

Install Docker, Caddy, Node.js 24, and Bun 1.3.5 before installing the units.
The `paymoment` service account must be able to execute the fixed paths used by
systemd; verify these commands as root after installing the runtimes:

```bash
node --version
corepack enable
corepack prepare pnpm@11.3.0 --activate
pnpm_bin="$(command -v pnpm)"; test "$pnpm_bin" = /usr/local/bin/pnpm || ln -sf "$pnpm_bin" /usr/local/bin/pnpm
bun_bin="$(command -v bun)"; test "$bun_bin" = /usr/local/bin/bun || ln -sf "$bun_bin" /usr/local/bin/bun
/usr/local/bin/pnpm --version
/usr/local/bin/bun --version
```

Use only the verified Bun 1.3.5 release and pnpm 11.3.0. The release
preflight checks these exact executable paths before any service restart.

## Prepare an immutable release

After cloning the exact frontend and backend tags into one release directory,
install and build as the service user. Do not build from `/opt/paymoment/current`
until it has been repointed to the new immutable release:

```bash
release=/opt/paymoment/releases/<tag>
sudo -u paymoment /usr/local/bin/bun install --frozen-lockfile --cwd "$release/be-paymonent"
sudo -u paymoment /usr/local/bin/pnpm install --frozen-lockfile --dir "$release/fe-paymoment"
sudo -u paymoment /usr/local/bin/pnpm --dir "$release/fe-paymoment" build
ln -sfn "$release" /opt/paymoment/current
```

The frontend has a safe production API fallback to `https://api.paymom3nts.xyz`.
Do not put server secrets in a frontend build environment.

```bash
docker compose --env-file /etc/paymoment/infra.env -f /opt/paymoment/current/be-paymonent/ops/docker-compose.infra.yml up -d
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
bash /opt/paymoment/current/be-paymonent/ops/scripts/preflight-release.sh
systemctl daemon-reload
systemctl restart paymoment-api paymoment-web
curl --fail https://api.paymom3nts.xyz/health
curl --fail https://mcp.paymom3nts.xyz/.well-known/oauth-authorization-server
```

Install `Caddyfile` at `/etc/caddy/Caddyfile` and the unit files in `systemd/` at `/etc/systemd/system/`. The backup unit calls `scripts/backup-postgres.sh` from the immutable current release. Rollback means repointing `/opt/paymoment/current` at the preceding verified release and restarting API and web services.

Before the production release, run `bash ops/scripts/verify-phase4-vps.sh` from the backend release. It creates and destroys its own PostgreSQL database and validates FTS, feed ranking, moderation, and viewer visibility without touching production data.

## Granting staff roles

Staff roles are never granted through the public API. A VPS operator with access to
the root-owned infrastructure environment may grant a role only after the person
has signed in once, so their user row exists:

```bash
cd /opt/paymoment/current/be-paymonent
sudo bash ops/scripts/grant-platform-role.sh --email moderator@example.com --role moderator --granted-by admin@example.com
```

The command uses the private PostgreSQL Compose service and prints no database
credentials or user IDs. It is idempotent; an existing role is left unchanged.
