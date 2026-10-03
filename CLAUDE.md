# CLAUDE.md — Rules for AI coding sessions

## Project overview

This is **Dialer**, a low-cost web dialer. Backend: Go. Frontend: TypeScript (React). No Supabase — own VPS.

## Critical rules

1. **Money is never a float.** All monetary values are integers in micro-dollars (1 USD = 1,000,000). The `ledger` package owns all balance arithmetic.

2. **One adapter per external service.** Telnyx lives in `internal/telephony`. Paystack/Stripe live in `internal/billing`. Smile ID in `internal/kyc`. Each has a real implementation and a `fake_*.go` for tests. Never call the external SDK directly from a handler.

3. **Every DB change is a migration.** Use `goose` in `services/api/migrations/`. Never `ALTER TABLE` manually in production.

4. **All routes are in `api/openapi.yaml`.** The TypeScript client in `packages/api-client/` is generated from it. Run `make gen` after editing the spec.

5. **Secrets live in environment files, never in the repo.** Use `.env.example` with placeholder values; the real `.env` is gitignored.

6. **Webhook handlers check provider signatures first**, before doing anything else.

7. **Security checks before every dial:** plan limits, new-account limits, 3-attempts-per-number cap, DNC list, premium-rate prefixes, balance hold. These live in `internal/calls` and run on the server — never trust the client.

## Code style

- Go: `gofmt`, standard library first, errors wrapped with `fmt.Errorf("...: %w", err)`.
- TypeScript: strict mode, no `any`. Prefer `unknown` and narrow.
- UI: React components + Tailwind CSS v4. Build screens from `@dialer/ui` components; use Tailwind utilities with the design tokens from `packages/ui/src/theme.css` (e.g. `bg-brand`, `text-muted`, `text-13`). No raw hex colours in screens when a token exists. No inline styles except dynamic values (widths, sizes computed at runtime).
- A pattern used on two or more screens belongs in `packages/ui`; one-off layout stays in the screen.
- Tests: table-driven in Go, Vitest in TypeScript. Every new package needs at least one test file.

## Directory guide

```
services/api/internal/platform/   db pool, cache client, config, logging, http helpers
services/api/internal/telephony/  Telnyx adapter (real + fake)
services/api/internal/billing/    Paystack + Stripe adapters
services/api/internal/ledger/     all money: balance, hold, charge, release
services/api/internal/calls/      call lifecycle, pre-dial checks
packages/ui/                      Tailwind theme (theme.css) + reusable React components — source of truth for design
design/boards/                    43 canvas HTML boards — reference only, do not edit
```

## Deliverables

- **D0 — Foundations** (current): repo structure, Docker Compose, CI, design tokens, OpenAPI stub.
- **D1 — Clickable front end**: all 43 boards as real React screens with fake data.
- **D2 — Accounts and money**: auth, wallet, plans, Paystack + Stripe.
- **D3 — Calling on Free**: numbers, leads, scripts, tap-to-call via Telnyx WebRTC.
- **D4 — Starter**: auto-dial, phone pairing, inbound callbacks, ID check.
- **D5 — Pro**: recording, transcripts, summaries, multi-dial.
- **D6 — Admin and launch prep**: admin console, monitoring, load test.
- **D7 — Beta**: 20–50 real reps for 4 weeks.

## Design tokens

The canonical tokens are in `packages/ui/src/theme.css` (Tailwind v4 `@theme`), with light and dark values as CSS variables. Brand color: `brand` = #ff6b1a (Tangerine). Font: Manrope (`font-sans`), Geist Mono (`font-mono`). Text sizes are named by pixel size (`text-13` = 13px). Flat UI — no glass, no neumorphism. Merge classes with `cn()` from `@dialer/ui`, never by string concatenation.
