# Plans Spec

## Plan tiers

| | Free | Starter | Pro |
|---|---|---|---|
| Monthly fee | $0 forever | $10 × 3 months, then $15 | $21 × 3 months, then $35 |
| Call rate | provider cost × 2.5 | provider cost × 2 | provider cost × 1.7 |
| Dials per day | 30 | 120 (500 after ID check) | No limit |
| Calling | Tap to call each lead | Auto-dial the list | Auto-dial |
| Script on screen | First 2 months | Always | Always |
| Phone and laptop linked | No | Yes | Yes |
| Callback alerts | No | Yes | Yes |
| Recording + transcripts | No | No | Yes |
| Multi-dial (2 lines) | No | No | After ID check and approval |

## Account rules (all plans)

- One account per person.
- The card name must match the account name.
- New-account daily dials: 50 → 25 → 10 for the first 3 days (until ID check).
- Each phone number can be called at most 3 times.
- Premium-rate numbers (900, 976, 1-900, etc.) are never dialled.
- DNC numbers are skipped silently; the rep sees "Skipped (DNC)".
- Calls outside the US and Canada have a daily cap of $3 for unverified reps.

## Intro pricing

Intro pricing applies to first-time subscribers only (open decision 9: whether returning reps get it again).

## Balance rules

- All amounts in micro-dollars. 1 USD = 1,000,000 micro-dollars.
- Balance = sum of all ledger entries for the user. Never stored as one number.
- Call hold: 1 minute worth of the call's rate is held before dialling. Hold is topped up each minute.
- Charge: per second at call end. Unused hold is released immediately.
- Low balance alert at $5 (open decision 7).
- If balance runs to zero mid-call, rep gets a 30-second warning, then the call ends.

## Open decisions

1. Free plan daily dials: 30 (confirmed by screens).
2. New-account limits — do they apply to Starter too?
3. Same-number cap: 3 or 4 tries.
4. What happens when balance can't cover plan fee or number renewal: suggested 3-day warning then drop to Free / pause number. *Built with this default for plans (`plans.GraceDays`); numbers come in D3.*
5. International cap for unverified reps: $3 or $5 a day (screens use $3).
6. How long recordings are kept (screens use 90 days).
7. Low-balance alert level (screens use $5).
8. Calls go out from closest number, or rep always picks.
9. Do returning reps get the intro price again after moving to Free? *Built as no (`users.intro_used`); one line to change.*
10. Brand name and logo (needed before D6).
