-- Phone as headset (D4): a laptop shows a code, the rep's phone (signed in
-- to the same account) joins with it and carries the call's sound while the
-- laptop shows the script. The phone checks in every second or so; if it
-- stops, its call is ended so nothing is billed for a call nobody hears.

-- +goose Up
-- +goose StatementBegin

CREATE TABLE pairings (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- sha256 of the 6-digit code with the pairing's salt; the code itself is
    -- never stored.
    code_hash     TEXT NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at    TIMESTAMPTZ NOT NULL,
    wrong_tries   INTEGER NOT NULL DEFAULT 0,
    joined_at     TIMESTAMPTZ,
    phone_name    TEXT NOT NULL DEFAULT '',
    phone_seen_at TIMESTAMPTZ,
    muted         BOOLEAN NOT NULL DEFAULT false,
    ended_at      TIMESTAMPTZ,
    CONSTRAINT pairings_phone_name CHECK (char_length(phone_name) <= 60)
);

CREATE UNIQUE INDEX pairings_one_open_idx ON pairings(user_id) WHERE ended_at IS NULL;

ALTER TABLE calls ADD COLUMN pairing_id UUID REFERENCES pairings(id) ON DELETE SET NULL;
CREATE INDEX calls_pairing_idx ON calls(pairing_id) WHERE pairing_id IS NOT NULL;

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin

DROP INDEX IF EXISTS calls_pairing_idx;
ALTER TABLE calls DROP COLUMN IF EXISTS pairing_id;
DROP TABLE IF EXISTS pairings;

-- +goose StatementEnd
