-- +goose Up
-- +goose StatementBegin

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TYPE user_status AS ENUM ('pending', 'active', 'suspended');
CREATE TYPE kyc_status AS ENUM ('none', 'pending', 'approved', 'rejected');
CREATE TYPE plan_name AS ENUM ('free', 'starter', 'pro');
CREATE TYPE ledger_type AS ENUM ('topup', 'call', 'hold', 'release', 'number', 'plan', 'refund');
CREATE TYPE call_direction AS ENUM ('outbound', 'inbound');
CREATE TYPE call_device AS ENUM ('laptop', 'phone', 'linked');

-- Users

CREATE TABLE users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            TEXT NOT NULL,
    email           TEXT NOT NULL UNIQUE,
    phone           TEXT NOT NULL,
    password_hash   TEXT NOT NULL,
    country         TEXT NOT NULL,
    timezone        TEXT NOT NULL DEFAULT 'UTC',
    status          user_status NOT NULL DEFAULT 'pending',
    email_confirmed BOOLEAN NOT NULL DEFAULT false,
    phone_confirmed BOOLEAN NOT NULL DEFAULT false,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE sessions (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    device     TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE verifications (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider_ref TEXT,
    id_type      TEXT,
    name_on_id   TEXT,
    status       kyc_status NOT NULL DEFAULT 'none',
    result_at    TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Plans and billing

CREATE TABLE plans (
    id                   TEXT PRIMARY KEY,
    name                 plan_name NOT NULL,
    monthly_fee_cents    INTEGER NOT NULL,
    intro_months         INTEGER NOT NULL DEFAULT 0,
    intro_fee_cents      INTEGER NOT NULL DEFAULT 0,
    call_rate_multiplier NUMERIC(4,2) NOT NULL,
    dials_per_day        INTEGER,
    features             TEXT[] NOT NULL DEFAULT '{}'
);

INSERT INTO plans (id, name, monthly_fee_cents, intro_months, intro_fee_cents, call_rate_multiplier, dials_per_day, features) VALUES
('free',    'free',    0,    0, 0,    2.50, 30,   '{"script_first_2_months"}'),
('starter', 'starter', 1500, 3, 1000, 2.00, 120,  '{"auto_dial","script","phone_linked","callback_alerts"}'),
('pro',     'pro',     3500, 3, 2100, 1.70, NULL, '{"auto_dial","script","phone_linked","callback_alerts","recording","transcripts","summaries","multi_dial"}');

CREATE TABLE subscriptions (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE UNIQUE,
    plan_id          TEXT NOT NULL REFERENCES plans(id),
    started_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    intro_ends_at    TIMESTAMPTZ,
    next_renewal     DATE NOT NULL,
    pending_downgrade TEXT REFERENCES plans(id)
);

CREATE TABLE ledger_entries (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type                ledger_type NOT NULL,
    amount_microdollars BIGINT NOT NULL,
    description         TEXT NOT NULL DEFAULT '',
    idempotency_key     TEXT UNIQUE,
    ref_id              UUID,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX ledger_entries_user_idx ON ledger_entries(user_id, created_at DESC);

CREATE TABLE payments (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider        TEXT NOT NULL,
    provider_ref    TEXT NOT NULL UNIQUE,
    amount_cents    INTEGER NOT NULL,
    currency        TEXT NOT NULL DEFAULT 'USD',
    status          TEXT NOT NULL,
    card_last4      TEXT,
    card_name       TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE rate_cards (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    country        TEXT NOT NULL,
    prefix         TEXT NOT NULL,
    cost_per_min   BIGINT NOT NULL,
    started_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX rate_cards_prefix_idx ON rate_cards(prefix, started_at DESC);

-- Numbers

CREATE TABLE numbers (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    number          TEXT NOT NULL,
    city            TEXT NOT NULL DEFAULT '',
    provider_id     TEXT NOT NULL,
    monthly_cost    BIGINT NOT NULL,
    monthly_price   BIGINT NOT NULL,
    is_default      BOOLEAN NOT NULL DEFAULT false,
    renews_at       DATE NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX numbers_user_idx ON numbers(user_id);

-- Leads

CREATE TABLE lead_lists (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE leads (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    list_id     UUID NOT NULL REFERENCES lead_lists(id) ON DELETE CASCADE,
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    first_name  TEXT NOT NULL DEFAULT '',
    last_name   TEXT NOT NULL DEFAULT '',
    company     TEXT NOT NULL DEFAULT '',
    phone       TEXT NOT NULL,
    city        TEXT NOT NULL DEFAULT '',
    timezone    TEXT NOT NULL DEFAULT '',
    notes       TEXT NOT NULL DEFAULT '',
    attempts    INTEGER NOT NULL DEFAULT 0,
    status      TEXT NOT NULL DEFAULT 'new',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX leads_list_idx ON leads(list_id, status);
CREATE INDEX leads_phone_user_idx ON leads(user_id, phone);

CREATE TABLE dnc_entries (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    phone      TEXT NOT NULL,
    source     TEXT NOT NULL DEFAULT 'manual',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX dnc_user_phone_idx ON dnc_entries(user_id, phone);

CREATE TABLE scripts (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    parts      JSONB NOT NULL DEFAULT '[]',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Calls

CREATE TABLE calls (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    lead_id        UUID REFERENCES leads(id),
    from_number_id UUID REFERENCES numbers(id),
    direction      call_direction NOT NULL DEFAULT 'outbound',
    device         call_device NOT NULL DEFAULT 'laptop',
    telnyx_call_id TEXT,
    started_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    answered_at    TIMESTAMPTZ,
    ended_at       TIMESTAMPTZ,
    seconds        INTEGER,
    cost_microdollars BIGINT,
    outcome        TEXT,
    note           TEXT,
    voicemail      BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX calls_user_idx ON calls(user_id, started_at DESC);
CREATE INDEX calls_lead_idx ON calls(lead_id);

CREATE TABLE recordings (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    call_id             UUID NOT NULL REFERENCES calls(id) ON DELETE CASCADE UNIQUE,
    file_url            TEXT NOT NULL,
    seconds             INTEGER,
    transcript          TEXT,
    summary             TEXT,
    suggested_followup  DATE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE followups (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    lead_id    UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    due_at     TIMESTAMPTZ NOT NULL,
    reason     TEXT NOT NULL DEFAULT '',
    done       BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX followups_user_idx ON followups(user_id, due_at) WHERE done = false;

-- Fraud and audit

CREATE TABLE fraud_flags (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reason     TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE audit_log (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_id   UUID REFERENCES users(id),
    action     TEXT NOT NULL,
    target_id  UUID,
    target_type TEXT,
    meta       JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin

DROP TABLE IF EXISTS audit_log CASCADE;
DROP TABLE IF EXISTS fraud_flags CASCADE;
DROP TABLE IF EXISTS followups CASCADE;
DROP TABLE IF EXISTS recordings CASCADE;
DROP TABLE IF EXISTS calls CASCADE;
DROP TABLE IF EXISTS scripts CASCADE;
DROP TABLE IF EXISTS dnc_entries CASCADE;
DROP TABLE IF EXISTS leads CASCADE;
DROP TABLE IF EXISTS lead_lists CASCADE;
DROP TABLE IF EXISTS numbers CASCADE;
DROP TABLE IF EXISTS rate_cards CASCADE;
DROP TABLE IF EXISTS payments CASCADE;
DROP TABLE IF EXISTS ledger_entries CASCADE;
DROP TABLE IF EXISTS subscriptions CASCADE;
DROP TABLE IF EXISTS plans CASCADE;
DROP TABLE IF EXISTS verifications CASCADE;
DROP TABLE IF EXISTS sessions CASCADE;
DROP TABLE IF EXISTS users CASCADE;
DROP TYPE IF EXISTS call_device CASCADE;
DROP TYPE IF EXISTS call_direction CASCADE;
DROP TYPE IF EXISTS ledger_type CASCADE;
DROP TYPE IF EXISTS plan_name CASCADE;
DROP TYPE IF EXISTS kyc_status CASCADE;
DROP TYPE IF EXISTS user_status CASCADE;

-- +goose StatementEnd
