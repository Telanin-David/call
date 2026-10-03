-- Codes for confirming an email (a link), confirming a phone (6 digits by
-- SMS or WhatsApp) and resetting a password (6 digits). Only a keyed hash of
-- each code is stored.

-- +goose Up
-- +goose StatementBegin

CREATE TYPE code_purpose AS ENUM ('email_confirm', 'phone_confirm', 'password_reset');

CREATE TABLE auth_codes (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    purpose    code_purpose NOT NULL,
    channel    TEXT NOT NULL CHECK (channel IN ('email', 'sms', 'whatsapp')),
    code_hash  TEXT NOT NULL,
    attempts   INTEGER NOT NULL DEFAULT 0,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at    TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX auth_codes_user_idx ON auth_codes(user_id, purpose, created_at DESC);
-- Email links are looked up by their token alone.
CREATE UNIQUE INDEX auth_codes_email_token_idx ON auth_codes(code_hash) WHERE purpose = 'email_confirm';

-- One account per person: one per email (any case) and one per phone.
CREATE UNIQUE INDEX users_email_lower_idx ON users(lower(email));
CREATE UNIQUE INDEX users_phone_idx ON users(phone);

CREATE INDEX sessions_user_idx ON sessions(user_id);

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin

DROP INDEX IF EXISTS sessions_user_idx;
DROP INDEX IF EXISTS users_phone_idx;
DROP INDEX IF EXISTS users_email_lower_idx;
DROP TABLE IF EXISTS auth_codes;
DROP TYPE IF EXISTS code_purpose;

-- +goose StatementEnd
