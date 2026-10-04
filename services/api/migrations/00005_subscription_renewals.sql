-- Renewals: when a renewal can't be paid, the rep gets 3 days to top up
-- (open decision 4, suggested default) before moving to Free.
-- No subscriptions row means the rep is on Free.

-- +goose Up
-- +goose StatementBegin

ALTER TABLE subscriptions
    ADD COLUMN renewal_failed_at TIMESTAMPTZ,
    ADD CONSTRAINT subscriptions_paid_plan CHECK (plan_id <> 'free'),
    ADD CONSTRAINT subscriptions_change_differs CHECK (pending_downgrade IS NULL OR pending_downgrade <> plan_id);

CREATE INDEX subscriptions_due_idx ON subscriptions(next_renewal);

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin

DROP INDEX IF EXISTS subscriptions_due_idx;
ALTER TABLE subscriptions
    DROP CONSTRAINT IF EXISTS subscriptions_change_differs,
    DROP CONSTRAINT IF EXISTS subscriptions_paid_plan,
    DROP COLUMN renewal_failed_at;

-- +goose StatementEnd
