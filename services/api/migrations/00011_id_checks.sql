-- ID checks (D4): a rep sends a photo of their ID and a selfie; Smile ID
-- checks them. One check runs at a time per rep. An approved check lifts
-- the new-account limits (Starter: 120 to 500 dials a day).

-- +goose Up
-- +goose StatementBegin

ALTER TABLE verifications
    ADD COLUMN country TEXT NOT NULL DEFAULT '',
    ADD COLUMN reason TEXT NOT NULL DEFAULT '',
    -- Approved by the provider but the name on the ID doesn't match the
    -- account: it waits for a person (the admin console, D6).
    ADD COLUMN needs_review BOOLEAN NOT NULL DEFAULT false,
    -- When the provider was last asked for the result.
    ADD COLUMN checked_at TIMESTAMPTZ,
    ADD CONSTRAINT verifications_country CHECK (country = '' OR country ~ '^[A-Z]{2}$');

CREATE UNIQUE INDEX verifications_one_pending_idx ON verifications(user_id) WHERE status = 'pending';
CREATE INDEX verifications_user_idx ON verifications(user_id, created_at DESC);

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin

DROP INDEX IF EXISTS verifications_user_idx;
DROP INDEX IF EXISTS verifications_one_pending_idx;
ALTER TABLE verifications
    DROP CONSTRAINT IF EXISTS verifications_country,
    DROP COLUMN IF EXISTS checked_at,
    DROP COLUMN IF EXISTS needs_review,
    DROP COLUMN IF EXISTS reason,
    DROP COLUMN IF EXISTS country;

-- +goose StatementEnd
