ALTER TABLE employees ADD COLUMN whatsapp_notifications_enabled INTEGER NOT NULL DEFAULT 0
  CHECK (whatsapp_notifications_enabled IN (0, 1));

CREATE TABLE whatsapp_recipients (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL CHECK (length(trim(label)) BETWEEN 1 AND 100),
  phone TEXT NOT NULL UNIQUE CHECK (length(phone) BETWEEN 9 AND 16 AND phone GLOB '+[1-9]*'
    AND substr(phone, 2) NOT GLOB '*[^0-9]*'),
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Snapshot identities deliberately have no business-row foreign keys: audit survives deletion.
CREATE TABLE whatsapp_jobs (
  id TEXT PRIMARY KEY,
  instance TEXT NOT NULL,
  item_type TEXT NOT NULL CHECK (item_type IN ('document', 'employee_residency')),
  item_id TEXT NOT NULL,
  expiry_date TEXT NOT NULL,
  bucket INTEGER NOT NULL CHECK (bucket IN (0, 1, 7, 15, 30, 90)),
  recipient TEXT NOT NULL,
  recipient_label TEXT NOT NULL,
  audience TEXT NOT NULL CHECK (audience IN ('management', 'employee')),
  item_name TEXT NOT NULL,
  owner_name TEXT NOT NULL,
  text TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN
    ('pending', 'sending', 'provider_accepted', 'retryable_failed', 'permanent_failed', 'unknown', 'cancelled')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 4),
  next_attempt_at TEXT NOT NULL,
  provider_message_id TEXT,
  error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX whatsapp_current_identity ON whatsapp_jobs
  (instance, item_type, item_id, expiry_date, bucket, recipient) WHERE state != 'cancelled';
CREATE INDEX whatsapp_due_jobs ON whatsapp_jobs(state, next_attempt_at);

CREATE TABLE whatsapp_attempts (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES whatsapp_jobs(id) ON DELETE RESTRICT,
  attempt INTEGER NOT NULL,
  recipient TEXT NOT NULL,
  recipient_label TEXT NOT NULL,
  audience TEXT NOT NULL,
  item_name TEXT NOT NULL,
  owner_name TEXT NOT NULL,
  expiry_date TEXT NOT NULL,
  text TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN
    ('sending', 'provider_accepted', 'retryable_failed', 'permanent_failed', 'unknown')),
  error_code TEXT,
  provider_message_id TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  UNIQUE(job_id, attempt)
);
INSERT INTO settings(key,value,updated_at) VALUES ('whatsapp.enabled','false',strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  ON CONFLICT(key) DO NOTHING;
