-- Call recordings (D5, Pro). A rep turns recording on in Settings and agrees
-- to tell every lead at the start that the call may be recorded; until then
-- nothing is recorded. The provider records an answered call; after it
-- ends, the worker copies the file into our storage, where it is kept 90
-- days and reached only through links that expire in minutes.
--
-- A recording's life: recording (call going) → saved (the provider has the
-- file) → stored (copied to our storage) → deleted (by the rep, or after 90
-- days). failed: the copy gave up.

-- +goose Up
-- +goose StatementBegin

-- When the rep agreed to tell leads; NULL means recording is off.
ALTER TABLE users ADD COLUMN recording_agreed_at TIMESTAMPTZ;

ALTER TABLE recordings RENAME COLUMN file_url TO storage_key;
ALTER TABLE recordings
    ALTER COLUMN storage_key DROP NOT NULL,
    ADD COLUMN status TEXT NOT NULL DEFAULT 'recording',
    -- The provider's download address, which works for a few minutes; cleared once copied.
    ADD COLUMN source_url TEXT,
    ADD COLUMN content_type TEXT NOT NULL DEFAULT '',
    ADD COLUMN bytes BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN tries INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN stored_at TIMESTAMPTZ,
    ADD COLUMN deleted_at TIMESTAMPTZ,
    ADD CONSTRAINT recordings_status CHECK (status IN ('recording', 'saved', 'stored', 'failed', 'deleted'));

CREATE INDEX recordings_saved_idx ON recordings(created_at) WHERE status = 'saved';
CREATE INDEX recordings_stored_idx ON recordings(stored_at) WHERE status = 'stored';

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin

DROP INDEX IF EXISTS recordings_stored_idx;
DROP INDEX IF EXISTS recordings_saved_idx;
-- file_url was required: rows without a file can't go back.
DELETE FROM recordings WHERE storage_key IS NULL;
ALTER TABLE recordings
    DROP CONSTRAINT IF EXISTS recordings_status,
    DROP COLUMN deleted_at,
    DROP COLUMN stored_at,
    DROP COLUMN tries,
    DROP COLUMN bytes,
    DROP COLUMN content_type,
    DROP COLUMN source_url,
    DROP COLUMN status,
    ALTER COLUMN storage_key SET NOT NULL;
ALTER TABLE recordings RENAME COLUMN storage_key TO file_url;
ALTER TABLE users DROP COLUMN recording_agreed_at;

-- +goose StatementEnd
