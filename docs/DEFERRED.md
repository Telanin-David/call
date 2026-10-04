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
- [ ] Calls: set `TELNYX_PUBLIC_KEY` (from the Telnyx portal; call webhooks are
      refused without it) and point the voice connection's webhook at
      `https://<api>/webhooks/telnyx`. In Telnyx's outbound voice profile, allow
      only the countries we sell, as a second lock behind the server's checks.
      Run `cmd/dialer` next to the api: it tops up holds each minute and ends
      calls when the money runs out.
- [ ] The call screen dials through a fake browser phone in development
      (`apps/web/src/lib/phone.ts`): no sound, the lead "picks up" after 3
      seconds. D3 part 5 adds Telnyx's browser phone there; the server side
      (checks, holds, billing, events) is already the real one.
- [ ] Phone as headset: the linked phone page (`/link`) dials with the same
      browser phone as the laptop. With Telnyx keys, try a call through a real
      phone, mute from both sides, and lock the phone mid-call (the call must
      end within 15 seconds).
- [ ] Incoming calls (a lead calling a rep's number back): numbers must sit on
      the voice connection whose webhook is `/webhooks/telnyx`. The server
      sends a call that should ring the rep to their browser phone with
      Telnyx's `transfer` action to `sip:<sip_username>@sip.telnyx.com`
      (`internal/telephony/calls.go`, `Ring`). With keys, check: the browser
      phone rings while the app is open on any screen; Answer in the app
      answers it there; the events after a transfer find the call (by its
      client state or call control id); "Not now" and the 30-second limit
      hang up the caller. In development, `POST /dev/incoming` plays a call in.
- [ ] Decide what answering a call back costs. Today it is the price of
      calling that number (the plan's rate), held a minute ahead like a call
      out. Telnyx charges us for incoming minutes too (about $0.0032/min plus
      the browser leg), so this keeps a margin. Free reps never pay: their
      call backs are missed calls only.
- [ ] A browser tab hidden for over 5 minutes checks in about once a minute
      (Chrome slows its timers), so the rep shows as away and call backs go
      to Follow-ups. Fine for a web app; the phone app (later) can use push.
- [ ] Call recordings (Pro): with keys, check that `record_start` works on calls
      placed from the browser phone and on call backs, that Telnyx sends
      `call.recording.saved` to `/webhooks/telnyx`, and that the worker copies
      the file within its 10-minute download window. Telnyx also keeps its
      own copy: set its recording storage to delete them (or delete each after
      the copy) so recordings only live in our storage.
- [ ] File storage: create a private Cloudflare R2 bucket and an API token
      for it, and set `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY` and
      `S3_SECRET_KEY`. Without them, recording is off outside development.
      R2 encrypts files at rest. The signing code was checked against AWS's
      own library (botocore), not against R2 itself: try one upload, play,
      download and delete. Run `cmd/worker`: it copies recordings and deletes
      them after 90 days.
- [ ] Decide whether recording costs reps extra. Today it is included in Pro
      (Telnyx charges about $0.002/min, plus R2 storage).
- [ ] Recording consent: the owner chose "the rep says it". Recording is off
      until a Pro rep agrees in Settings to say "Just so you know, this call
      may be recorded." at the start of every call, and the call screen shows
      that line on every recorded call. The app can't check the rep said it.
      Part of the lawyer's review (all-party consent states).
- [ ] Confirm Telnyx's monthly price for a US/Canada local number. The
      `numbers.Cost` constant ($1.00) must match it: reps pay it × 1.5, and
      numbers that cost more are not offered.

## ID check (Smile ID)

- [ ] Set `SMILEID_PARTNER_ID`, `SMILEID_API_KEY` and `SMILEID_CALLBACK_URL`
      (`https://<api>/webhooks/smileid`). Without the keys the ID check is off
      outside development. `SMILEID_SANDBOX` stays `true` until launch.
- [ ] With the sandbox key, run one check end to end and confirm the result
      codes: the adapter treats `0810` (document verified) as approved and any
      other finished code as a rejection (`internal/kyc/smileid.go`). The
      request format and signature follow Smile ID's official JavaScript
      library; their docs site was not reachable while building.
- [ ] Checks whose name doesn't match the account wait for a person: the admin
      console (D6) needs a screen to approve or reject them.

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
