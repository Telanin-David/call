-- Calls (D3): each call's life (dialing → ringing → answered → ended), the
-- number it went to and the price agreed before dialling, the hold that
-- pays for it, and the outcome the rep saved. Reps get a Telnyx login for
-- the browser phone.

-- +goose Up
-- +goose StatementBegin

-- Calls from before this change are over: they start as 'ended', and only
-- new ones start as 'dialing'.
ALTER TABLE calls
    ADD COLUMN status TEXT NOT NULL DEFAULT 'ended',
    ADD COLUMN to_number TEXT NOT NULL DEFAULT '',
    ADD COLUMN price_per_min BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN hold_id UUID REFERENCES holds(id),
    ADD COLUMN low_balance_at TIMESTAMPTZ,
    ADD COLUMN hangup_cause TEXT NOT NULL DEFAULT '',
    ADD COLUMN outcome_at TIMESTAMPTZ,
    -- A random secret only the browser that started the call gets. Provider
    -- events carry it back, so nobody can tie their call to another's.
    ADD COLUMN client_state TEXT UNIQUE,
    ADD CONSTRAINT calls_status CHECK (status IN ('dialing', 'ringing', 'answered', 'ended')),
    ADD CONSTRAINT calls_outcome CHECK (outcome IS NULL OR outcome IN ('interested', 'callback', 'not_interested', 'no_answer', 'wrong_number', 'do_not_call'));

ALTER TABLE calls ALTER COLUMN status SET DEFAULT 'dialing';

CREATE UNIQUE INDEX calls_provider_idx ON calls(telnyx_call_id) WHERE telnyx_call_id IS NOT NULL;
-- One live call per rep, and a fast list of live calls for the minute ticker.
CREATE UNIQUE INDEX calls_one_live_idx ON calls(user_id) WHERE status <> 'ended';
CREATE INDEX calls_to_idx ON calls(user_id, to_number);

ALTER TABLE leads
    ADD CONSTRAINT leads_status CHECK (status IN ('new', 'called', 'callback', 'interested', 'done', 'dnc'));

ALTER TABLE users ADD COLUMN telnyx_credential_id TEXT;

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin

ALTER TABLE users DROP COLUMN telnyx_credential_id;
ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_status;
DROP INDEX IF EXISTS calls_to_idx;
DROP INDEX IF EXISTS calls_one_live_idx;
DROP INDEX IF EXISTS calls_provider_idx;
ALTER TABLE calls
    DROP CONSTRAINT IF EXISTS calls_outcome,
    DROP CONSTRAINT IF EXISTS calls_status,
    DROP COLUMN client_state,
    DROP COLUMN outcome_at,
    DROP COLUMN hangup_cause,
    DROP COLUMN low_balance_at,
    DROP COLUMN hold_id,
    DROP COLUMN price_per_min,
    DROP COLUMN to_number,
    DROP COLUMN status;

-- +goose StatementEnd
