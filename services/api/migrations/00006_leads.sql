-- Leads (D3): lists can be tied to a script, lists of numbers outside the US
-- and Canada are kept apart, and every phone is stored in E.164 form.

-- +goose Up
-- +goose StatementBegin

ALTER TABLE lead_lists
    ADD COLUMN script_id UUID REFERENCES scripts(id) ON DELETE SET NULL,
    ADD COLUMN region TEXT NOT NULL DEFAULT 'us_ca',
    ADD CONSTRAINT lead_lists_region CHECK (region IN ('us_ca', 'abroad')),
    ADD CONSTRAINT lead_lists_name CHECK (char_length(name) BETWEEN 1 AND 80);

CREATE INDEX lead_lists_user_idx ON lead_lists(user_id, created_at DESC);

ALTER TABLE leads
    ADD COLUMN email TEXT NOT NULL DEFAULT '',
    ADD CONSTRAINT leads_phone_e164 CHECK (phone ~ '^\+[1-9][0-9]{7,14}$');

-- A number appears once per list; uploads also keep it to one list per rep.
CREATE UNIQUE INDEX leads_list_phone_idx ON leads(list_id, phone);

ALTER TABLE dnc_entries
    ADD CONSTRAINT dnc_phone_e164 CHECK (phone ~ '^\+[1-9][0-9]{7,14}$');

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin

ALTER TABLE dnc_entries DROP CONSTRAINT IF EXISTS dnc_phone_e164;
DROP INDEX IF EXISTS leads_list_phone_idx;
ALTER TABLE leads
    DROP CONSTRAINT IF EXISTS leads_phone_e164,
    DROP COLUMN email;
DROP INDEX IF EXISTS lead_lists_user_idx;
ALTER TABLE lead_lists
    DROP CONSTRAINT IF EXISTS lead_lists_name,
    DROP CONSTRAINT IF EXISTS lead_lists_region,
    DROP COLUMN region,
    DROP COLUMN script_id;

-- +goose StatementEnd
