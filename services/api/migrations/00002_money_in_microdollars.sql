-- Money is never a float (CLAUDE.md rule 1). This migration moves the last
-- cents and decimal columns to integer micro-dollars (1 USD = 1,000,000) and
-- adds the holds a call places on the balance while it runs.

-- +goose Up
-- +goose StatementBegin

-- Plans: fees in micro-dollars, call-rate multiplier as a whole percentage
-- (250 = ×2.5) so price arithmetic stays in integers.
ALTER TABLE plans
    ADD COLUMN monthly_fee_microdollars BIGINT,
    ADD COLUMN intro_fee_microdollars   BIGINT,
    ADD COLUMN rate_multiplier_pct      INTEGER;

UPDATE plans SET
    monthly_fee_microdollars = monthly_fee_cents::BIGINT * 10000,
    intro_fee_microdollars   = intro_fee_cents::BIGINT * 10000,
    rate_multiplier_pct      = ROUND(call_rate_multiplier * 100)::INTEGER;

ALTER TABLE plans
    ALTER COLUMN monthly_fee_microdollars SET NOT NULL,
    ALTER COLUMN intro_fee_microdollars   SET NOT NULL,
    ALTER COLUMN rate_multiplier_pct      SET NOT NULL,
    ADD CONSTRAINT plans_fees_not_negative CHECK (monthly_fee_microdollars >= 0 AND intro_fee_microdollars >= 0),
    ADD CONSTRAINT plans_multiplier_at_least_cost CHECK (rate_multiplier_pct >= 100),
    DROP COLUMN monthly_fee_cents,
    DROP COLUMN intro_fee_cents,
    DROP COLUMN call_rate_multiplier;

-- Payments: what the provider charged, in its own minor unit (cents, kobo,
-- pesewas), and what we credited to the ledger in micro-dollars.
ALTER TABLE payments RENAME COLUMN amount_cents TO provider_amount_minor;
ALTER TABLE payments
    ALTER COLUMN provider_amount_minor TYPE BIGINT,
    ADD COLUMN credited_microdollars BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ADD CONSTRAINT payments_status_known CHECK (status IN ('pending', 'succeeded', 'failed')),
    ADD CONSTRAINT payments_amounts_not_negative CHECK (provider_amount_minor >= 0 AND credited_microdollars >= 0);

-- Ledger: an entry always moves money.
ALTER TABLE ledger_entries ADD CONSTRAINT ledger_entries_amount_not_zero CHECK (amount_microdollars <> 0);

-- Holds: money set aside while a call runs. The hold itself is written to the
-- ledger as negative 'hold' entries; settling writes a 'release' for the full
-- hold and a 'call' charge for the exact seconds used.
CREATE TYPE hold_status AS ENUM ('open', 'settled', 'released');

CREATE TABLE holds (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    ref_id              UUID,
    amount_microdollars BIGINT NOT NULL CHECK (amount_microdollars > 0),
    status              hold_status NOT NULL DEFAULT 'open',
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    closed_at           TIMESTAMPTZ
);

CREATE INDEX holds_open_idx ON holds(user_id) WHERE status = 'open';

-- Users: when the rules were accepted, and whether the intro price was used
-- (open decision 9: returning reps do not get it again by default).
ALTER TABLE users
    ADD COLUMN rules_accepted_at TIMESTAMPTZ,
    ADD COLUMN intro_used BOOLEAN NOT NULL DEFAULT false;

-- Provider cost for calls to the US and Canada. Placeholder until the D0
-- price check confirms the provider (see docs/DEFERRED.md).
INSERT INTO rate_cards (country, prefix, cost_per_min) VALUES ('US/CA', '1', 10000);

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin

DELETE FROM rate_cards WHERE prefix = '1' AND cost_per_min = 10000;

ALTER TABLE users DROP COLUMN intro_used, DROP COLUMN rules_accepted_at;

DROP TABLE IF EXISTS holds;
DROP TYPE IF EXISTS hold_status;

ALTER TABLE ledger_entries DROP CONSTRAINT IF EXISTS ledger_entries_amount_not_zero;

ALTER TABLE payments
    DROP CONSTRAINT IF EXISTS payments_amounts_not_negative,
    DROP CONSTRAINT IF EXISTS payments_status_known,
    DROP COLUMN updated_at,
    DROP COLUMN credited_microdollars;
ALTER TABLE payments ALTER COLUMN provider_amount_minor TYPE INTEGER;
ALTER TABLE payments RENAME COLUMN provider_amount_minor TO amount_cents;

ALTER TABLE plans
    ADD COLUMN monthly_fee_cents    INTEGER,
    ADD COLUMN intro_fee_cents      INTEGER,
    ADD COLUMN call_rate_multiplier NUMERIC(4,2);
UPDATE plans SET
    monthly_fee_cents    = (monthly_fee_microdollars / 10000)::INTEGER,
    intro_fee_cents      = (intro_fee_microdollars / 10000)::INTEGER,
    call_rate_multiplier = rate_multiplier_pct / 100.0;
ALTER TABLE plans
    ALTER COLUMN monthly_fee_cents SET NOT NULL,
    ALTER COLUMN intro_fee_cents SET NOT NULL,
    ALTER COLUMN call_rate_multiplier SET NOT NULL,
    DROP CONSTRAINT IF EXISTS plans_multiplier_at_least_cost,
    DROP CONSTRAINT IF EXISTS plans_fees_not_negative,
    DROP COLUMN rate_multiplier_pct,
    DROP COLUMN intro_fee_microdollars,
    DROP COLUMN monthly_fee_microdollars;

-- +goose StatementEnd
