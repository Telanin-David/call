-- +goose Up
-- A list can be deleted after its leads were called. The calls stay in the
-- rep's history with the number they went to; only the link to the lead goes.
-- Tries and do-not-call are counted by number, so deleting a list and
-- uploading it again does not reset them.
ALTER TABLE calls DROP CONSTRAINT calls_lead_id_fkey;
ALTER TABLE calls ADD CONSTRAINT calls_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE SET NULL;

-- +goose Down
ALTER TABLE calls DROP CONSTRAINT calls_lead_id_fkey;
ALTER TABLE calls ADD CONSTRAINT calls_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES leads(id);
