# Dialer

A low-cost web dialer for beginner cold-callers in Nigeria, Ghana and Kenya who call leads in the US and Canada.

Reps upload a lead list and a script, rent a US or Canada number, and call from the browser. The app logs every result, builds a follow-up list, and charges each call from a prepaid balance.

## Quick start (local)

```bash
# Prerequisites: Docker, Go 1.23+, Node 20+, pnpm 9+
docker compose up -d          # Postgres + Valkey
cd services/api && go run ./cmd/api   # API server on :8080
cd apps/web && pnpm dev               # React app on :5173
```

## Repo layout

```
apps/web/          React app (laptop + phone PWA)
apps/admin/        Admin console
services/api/      Go monolith (api, dialer, worker processes)
packages/ui/       Design tokens + component CSS (dialer.css)
packages/api-client/ TypeScript client from openapi.yaml
api/openapi.yaml   Single API contract
design/boards/     43 canvas HTML boards
infra/             docker-compose, Caddyfile, backup scripts
docs/              Build plan, plans spec, ADRs, runbooks
```

## Plans

| | Free | Starter | Pro |
|---|---|---|---|
| Monthly fee | $0 | $10 × 3 mo, then $15 | $21 × 3 mo, then $35 |
| Call rate | cost × 2.5 | cost × 2 | cost × 1.7 |
| Dials/day | 30 | 120 (500 after ID) | No limit |
| Auto-dial | No | Yes | Yes |
| Recording | No | No | Yes |

## Tech stack

- **Frontend**: React 18, TypeScript, Vite, React Router, TanStack Query, Zustand, Telnyx WebRTC SDK
- **Backend**: Go 1.23+, chi, pgx + sqlc, goose, River
- **Database**: PostgreSQL 16
- **Cache / live state**: Valkey 8
- **Calling**: Telnyx (WebRTC + numbers)
- **Payments**: Paystack (NG/GH/KE) + Stripe
- **Proxy**: Caddy (TLS)

## Conventions

- Main branch is always deployable. One branch per task, merged by PR with passing checks.
- Every database change is a migration (`goose` in `services/api/migrations/`).
- Money is never a float. All amounts are integers in micro-dollars (1 dollar = 1,000,000).
- Every external call (Telnyx, Paystack, Stripe, Smile ID) goes through one adapter in `internal/telephony`, `internal/billing`, etc., with a fake version for tests.
