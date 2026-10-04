-- Scripts (D3): one name per rep, parts kept as a JSON array of
-- {"title", "body"}, and when each was last changed.

-- +goose Up
-- +goose StatementBegin

ALTER TABLE scripts
    ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ADD CONSTRAINT scripts_name CHECK (char_length(name) BETWEEN 1 AND 80),
    ADD CONSTRAINT scripts_parts_array CHECK (jsonb_typeof(parts) = 'array');

CREATE UNIQUE INDEX scripts_user_name_idx ON scripts(user_id, lower(name));
CREATE INDEX lead_lists_script_idx ON lead_lists(script_id);

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin

DROP INDEX IF EXISTS lead_lists_script_idx;
DROP INDEX IF EXISTS scripts_user_name_idx;
ALTER TABLE scripts
    DROP CONSTRAINT IF EXISTS scripts_parts_array,
    DROP CONSTRAINT IF EXISTS scripts_name,
    DROP COLUMN updated_at;

-- +goose StatementEnd
