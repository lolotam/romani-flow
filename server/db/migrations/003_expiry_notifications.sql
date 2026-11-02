-- Tracks which reminder interval has already been sent for each item, so a daily
-- cron run never sends the same notice twice.

CREATE TABLE IF NOT EXISTS expiry_notifications (
  id            TEXT PRIMARY KEY,
  item_type     TEXT NOT NULL,
  item_id       TEXT NOT NULL,
  interval_days INTEGER NOT NULL,
  notified_at   TEXT NOT NULL,
  UNIQUE (item_type, item_id, interval_days)
);

CREATE INDEX IF NOT EXISTS idx_expiry_notifications_item ON expiry_notifications(item_type, item_id);
