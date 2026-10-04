# Deferred to final setup

Items from **D0 — Foundations** that were held back on purpose: they need
accounts, servers or decisions that only make sense close to launch. Check
this list at the start of D6 (admin and launch prep), before any real money or
real calls go through.

## Servers and deploys

- [ ] Staging VPS (for example Hetzner) with Caddy and automatic HTTPS.
- [ ] Automatic deploy to staging on every push to `main`; production on approval.
- [ ] Domain and DNS (Cloudflare), R2 storage for recordings.
- [ ] Sentry for error tracking.
- [ ] D0 "done when": a hello page and `/health` run on staging, deployed by a push.

Today the front end runs on Vercel (preview builds per pull request). That is
fine for checking screens but is not the production plan.

## Calling provider

- [ ] Telnyx vs Twilio vs Plivo price check, written up, provider confirmed.
- [ ] Replace the placeholder rate card from migration `00002`
      (`US/CA`, prefix `1`, cost 10,000 µ$/min = $0.01) with the confirmed
      provider's real per-minute costs, as a new migration. Every plan price
      is that cost × the plan multiplier, so this sets what reps pay.
- [ ] Set `TELNYX_API_KEY` and `TELNYX_CONNECTION_ID` (the voice connection
      new numbers join). Without the key, renting numbers is off outside
      development. The Telnyx adapter was built from Telnyx's documented API
      and tested against a stand-in; try one real search, rent and cancel.
- [ ] Confirm Telnyx's monthly price for a US/Canada local number. The
      `numbers.Cost` constant ($1.00) must match it: reps pay it × 1.5, and
      numbers that cost more are not offered.

## API contract

- [ ] Generate the Go server and the TypeScript client from `api/openapi.yaml`
      (`make gen`) and use them, instead of hand-written handlers and types.

## Before launch

- [ ] Set `VITE_API_URL` on the production build (e.g. `https://api.dialer.app`)
      and the same site in the API's `WEB_ORIGINS`. Without it the web app
      stays in demo mode with fake data.
- [ ] Set `VITE_DEV_TOOLS=false` on the production build. This hides the Dev
      button, plan switcher, Simulate menu and the `/screens` page.
- [ ] Check the web app on a real iPhone and a real Android phone (install to
      home screen, microphone permission, calling over mobile data).

## Accounts the owner provides

| Needed for | Account |
| --- | --- |
| D2 top-ups | Paystack and Stripe test keys, then live keys |
| D2 sign-up codes | Email and SMS service |
| D3 calling | Telnyx (or the provider chosen above) |
| D4 ID check | Smile ID |
| D5 transcripts and summaries | Transcript and AI service |
| D6 launch | Lawyer review of terms, privacy and calling rules |
