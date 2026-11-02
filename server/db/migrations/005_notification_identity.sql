-- The notification identity gains the expiry date and the recipient.
--
-- The expiry date makes a renewed document start a new notification cycle
-- instead of being blocked by the record of the previous one. The recipient
-- makes a rejected recipient retryable on its own, while the recipients that
-- accepted the message are never asked for it twice.

CREATE TABLE IF NOT EXISTS expiry_notifications_v2 (
  id            TEXT PRIMARY KEY,
  item_type     TEXT NOT NULL,
  item_id       TEXT NOT NULL,
  expiry_date   TEXT NOT NULL,
  interval_days INTEGER NOT NULL,
  recipient     TEXT NOT NULL,
  notified_at   TEXT NOT NULL,
  UNIQUE (item_type, item_id, expiry_date, interval_days, recipient)
);

-- The historical rows cannot be attributed to a recipient or to the expiry
-- date that was in force back then, so they are carried over with empty
-- values. They still suppress a duplicate for the same item and threshold.
INSERT OR IGNORE INTO expiry_notifications_v2
  (id, item_type, item_id, expiry_date, interval_days, recipient, notified_at)
SELECT id, item_type, item_id, '', interval_days, '', notified_at
  FROM expiry_notifications;

DROP TABLE expiry_notifications;

ALTER TABLE expiry_notifications_v2 RENAME TO expiry_notifications;

CREATE INDEX IF NOT EXISTS idx_expiry_notifications_item
  ON expiry_notifications(item_type, item_id);

-- The employee photo needs its own MIME type, because the photo is served
-- through the API instead of being written into the row.
ALTER TABLE employees ADD COLUMN photo_mime_type TEXT;
