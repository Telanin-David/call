-- Top-ups: one payments row per checkout. `provider_ref` is our own
-- reference, sent to the provider and echoed back in its webhook.
-- `credited_microdollars` is what the ledger gets once the payment succeeds.

-- +goose Up
-- +goose StatementBegin

ALTER TABLE payments
    ADD CONSTRAINT payments_provider_known CHECK (provider IN ('paystack', 'stripe', 'fake')),
    ADD CONSTRAINT payments_currency_upper CHECK (currency = upper(currency));

CREATE INDEX payments_user_idx ON payments(user_id, created_at DESC);

-- Entries written in one transaction (a plan fee and its call charge) got
-- the same NOW(), so statements listed them in random order. The real clock
-- time keeps them in the order they happened.
ALTER TABLE ledger_entries ALTER COLUMN created_at SET DEFAULT clock_timestamp();

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin

ALTER TABLE ledger_entries ALTER COLUMN created_at SET DEFAULT NOW();
DROP INDEX IF EXISTS payments_user_idx;
ALTER TABLE payments
    DROP CONSTRAINT IF EXISTS payments_currency_upper,
    DROP CONSTRAINT IF EXISTS payments_provider_known;

-- +goose StatementEnd
