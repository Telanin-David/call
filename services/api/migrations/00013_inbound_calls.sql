-- Incoming calls (D4): a lead calls one of the rep's numbers back. On
-- Starter and Pro, a rep who has the app open sees an alert and can answer;
-- otherwise it is a missed call, and the lead goes to the top of
-- Follow-ups. For an incoming call, to_number is the caller's number (the
-- lead's, as for a call out).

-- +goose Up
-- +goose StatementBegin

-- When the rep's app last checked for incoming calls: "online" for the alert.
ALTER TABLE users ADD COLUMN seen_at TIMESTAMPTZ;

-- Booked by the rep after a call, or made by a missed call.
ALTER TABLE followups
    ADD COLUMN kind TEXT NOT NULL DEFAULT 'booked',
    ADD CONSTRAINT followups_kind CHECK (kind IN ('booked', 'missed_call'));

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin

ALTER TABLE followups DROP CONSTRAINT IF EXISTS followups_kind, DROP COLUMN kind;
ALTER TABLE users DROP COLUMN seen_at;

-- +goose StatementEnd
