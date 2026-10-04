-- Numbers (D3): rented US and Canada numbers. A row stays after the number
-- is released, because calls point at it. Cancelling keeps the number until
-- the end of the month paid for (cancel_on), and an unpaid renewal starts
-- the same grace period as plans (renewal_failed_at).

-- +goose Up
-- +goose StatementBegin

ALTER TABLE numbers
    ADD COLUMN country TEXT NOT NULL DEFAULT 'US',
    ADD COLUMN cancel_on DATE,
    ADD COLUMN renewal_failed_at TIMESTAMPTZ,
    ADD COLUMN released_at TIMESTAMPTZ,
    ADD CONSTRAINT numbers_e164 CHECK (number ~ '^\+1[2-9][0-9]{9}$'),
    ADD CONSTRAINT numbers_country CHECK (country IN ('US', 'CA')),
    ADD CONSTRAINT numbers_money CHECK (monthly_cost >= 0 AND monthly_price > 0);

-- A number belongs to one rep at a time, and each rep has one default.
CREATE UNIQUE INDEX numbers_live_idx ON numbers(number) WHERE released_at IS NULL;
CREATE UNIQUE INDEX numbers_default_idx ON numbers(user_id) WHERE is_default AND released_at IS NULL;
CREATE INDEX numbers_due_idx ON numbers(renews_at) WHERE released_at IS NULL;

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin

-- Without released_at, released numbers would look rented again, so undoing
-- this drops their rows (and with them the record of numbers given back).
DELETE FROM numbers WHERE released_at IS NOT NULL;
DROP INDEX IF EXISTS numbers_due_idx;
DROP INDEX IF EXISTS numbers_default_idx;
DROP INDEX IF EXISTS numbers_live_idx;
ALTER TABLE numbers
    DROP CONSTRAINT IF EXISTS numbers_money,
    DROP CONSTRAINT IF EXISTS numbers_country,
    DROP CONSTRAINT IF EXISTS numbers_e164,
    DROP COLUMN released_at,
    DROP COLUMN renewal_failed_at,
    DROP COLUMN cancel_on,
    DROP COLUMN country;

-- +goose StatementEnd
