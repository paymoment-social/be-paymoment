# PayMoment API

Standalone Hono API running on Bun.

## Local run

The API reads its environment variables from `be-paymonent/.env`. Run these commands
from this folder:

```bash
bun install
bun run dev
```

Health check: `GET http://localhost:8787/health`

Google OAuth callback: `http://localhost:8787/api/v1/auth/google/callback`

For production, copy `.env.example` to `.env`, fill in the values, and run `bun run start`.
