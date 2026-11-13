-- Workspaces: the isolation boundary between users (spec 2026-11-12, plan P1).
--
-- Every tenant row gets a workspace_id. The column is added without a default
-- and guarded by triggers instead: a code path that forgets the workspace must
-- fail loudly, never land silently in someone else's workspace. Existing data
-- belongs to the legacy workspace that Romani will claim after the Clerk switch.

CREATE TABLE workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
  clerk_org_id TEXT UNIQUE,
  legacy_claim_email TEXT,
  quota_storage_bytes INTEGER NOT NULL DEFAULT 1073741824,
  quota_documents INTEGER NOT NULL DEFAULT 2000,
  quota_whatsapp_monthly INTEGER NOT NULL DEFAULT 500,
  quota_members INTEGER NOT NULL DEFAULT 5,
  suspended_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT INTO workspaces (id, name, created_at, updated_at)
VALUES ('ws_legacy', 'Romani', strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'));

-- Settings that belong to one workspace. Platform keys (scheduler time,
-- seed marker, erase locks) stay in `settings`.
CREATE TABLE workspace_settings (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, key)
);

INSERT INTO workspace_settings (workspace_id, key, value, updated_at)
SELECT 'ws_legacy', key, value, updated_at FROM settings
 WHERE key IN (
   'email.enabled', 'email.recipients', 'email.cc', 'email.from_name', 'email.language',
   'email.notification_intervals', 'email.last_sent_at', 'email.last_result',
   'expiry_warning_days', 'cron.enabled', 'cron.days', 'cron.include_employees',
   'cron.include_documents', 'cron.last_run_at', 'cron.last_run_result', 'cron.last_run_date',
   'reminders.dismissed', 'reminders.pinned',
   'ai_extraction.enabled', 'ai_extraction.provider', 'ai_extraction.model',
   'whatsapp.enabled', 'whatsapp.language', 'whatsapp.last_enqueue_date',
   'document_drafts.epoch'
 );

-- Moved, not copied: a stale platform copy could otherwise be read by mistake.
DELETE FROM settings
 WHERE key IN (
   'email.enabled', 'email.recipients', 'email.cc', 'email.from_name', 'email.language',
   'email.notification_intervals', 'email.last_sent_at', 'email.last_result',
   'expiry_warning_days', 'cron.enabled', 'cron.days', 'cron.include_employees',
   'cron.include_documents', 'cron.last_run_at', 'cron.last_run_result', 'cron.last_run_date',
   'reminders.dismissed', 'reminders.pinned',
   'ai_extraction.enabled', 'ai_extraction.provider', 'ai_extraction.model',
   'whatsapp.enabled', 'whatsapp.language', 'whatsapp.last_enqueue_date',
   'document_drafts.epoch'
 );

-- Membership for the current login. Clerk organizations replace it in P2.
ALTER TABLE admin_users ADD COLUMN workspace_id TEXT REFERENCES workspaces(id);

ALTER TABLE companies ADD COLUMN workspace_id TEXT REFERENCES workspaces(id);
ALTER TABLE ministries ADD COLUMN workspace_id TEXT REFERENCES workspaces(id);
ALTER TABLE document_types ADD COLUMN workspace_id TEXT REFERENCES workspaces(id);
ALTER TABLE positions ADD COLUMN workspace_id TEXT REFERENCES workspaces(id);
ALTER TABLE employees ADD COLUMN workspace_id TEXT REFERENCES workspaces(id);
ALTER TABLE documents ADD COLUMN workspace_id TEXT REFERENCES workspaces(id);
ALTER TABLE email_log ADD COLUMN workspace_id TEXT REFERENCES workspaces(id);
ALTER TABLE expiry_notifications ADD COLUMN workspace_id TEXT REFERENCES workspaces(id);
ALTER TABLE pending_uploads ADD COLUMN workspace_id TEXT REFERENCES workspaces(id);
ALTER TABLE form_defaults ADD COLUMN workspace_id TEXT REFERENCES workspaces(id);
ALTER TABLE document_drafts ADD COLUMN workspace_id TEXT REFERENCES workspaces(id);
ALTER TABLE whatsapp_jobs ADD COLUMN workspace_id TEXT REFERENCES workspaces(id);
ALTER TABLE whatsapp_attempts ADD COLUMN workspace_id TEXT REFERENCES workspaces(id);
-- Internal cleanup queue: rows written before this migration stay unattributed.
ALTER TABLE upload_cleanup_queue ADD COLUMN workspace_id TEXT REFERENCES workspaces(id);

UPDATE admin_users SET workspace_id = 'ws_legacy';
UPDATE companies SET workspace_id = 'ws_legacy';
UPDATE ministries SET workspace_id = 'ws_legacy';
UPDATE document_types SET workspace_id = 'ws_legacy';
UPDATE positions SET workspace_id = 'ws_legacy';
UPDATE employees SET workspace_id = 'ws_legacy';
UPDATE documents SET workspace_id = 'ws_legacy';
UPDATE email_log SET workspace_id = 'ws_legacy';
UPDATE expiry_notifications SET workspace_id = 'ws_legacy';
UPDATE pending_uploads SET workspace_id = 'ws_legacy';
UPDATE form_defaults SET workspace_id = 'ws_legacy';
UPDATE document_drafts SET workspace_id = 'ws_legacy';
UPDATE whatsapp_jobs SET workspace_id = 'ws_legacy';
UPDATE whatsapp_attempts SET workspace_id = 'ws_legacy';
UPDATE upload_cleanup_queue SET workspace_id = 'ws_legacy';

-- The recipient phone was unique across the whole database, so a duplicate
-- error would reveal another workspace's recipient. It is unique per workspace now.
CREATE TABLE whatsapp_recipients_v2 (
  id TEXT PRIMARY KEY,
  workspace_id TEXT REFERENCES workspaces(id),
  label TEXT NOT NULL CHECK (length(trim(label)) BETWEEN 1 AND 100),
  phone TEXT NOT NULL CHECK (length(phone) BETWEEN 9 AND 16 AND phone GLOB '+[1-9]*'
    AND substr(phone, 2) NOT GLOB '*[^0-9]*'),
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (workspace_id, phone)
);
INSERT INTO whatsapp_recipients_v2 (id, workspace_id, label, phone, enabled, created_at, updated_at)
SELECT id, 'ws_legacy', label, phone, enabled, created_at, updated_at FROM whatsapp_recipients;
DROP TABLE whatsapp_recipients;
ALTER TABLE whatsapp_recipients_v2 RENAME TO whatsapp_recipients;

-- Fail closed: no tenant row may be written without its workspace.
-- Every tenant table is guarded twice: on insert and on update, so a row can
-- never be moved out of its workspace afterwards either.
CREATE TRIGGER ws_required_admin_users_i BEFORE INSERT ON admin_users WHEN NEW.workspace_id IS NULL BEGIN SELECT RAISE(ABORT, 'workspace_required'); END;
CREATE TRIGGER ws_required_admin_users_u BEFORE UPDATE OF workspace_id ON admin_users WHEN NEW.workspace_id IS NULL BEGIN SELECT RAISE(ABORT, 'workspace_required'); END;
CREATE TRIGGER ws_required_companies_i BEFORE INSERT ON companies WHEN NEW.workspace_id IS NULL BEGIN SELECT RAISE(ABORT, 'workspace_required'); END;
CREATE TRIGGER ws_required_companies_u BEFORE UPDATE OF workspace_id ON companies WHEN NEW.workspace_id IS NULL BEGIN SELECT RAISE(ABORT, 'workspace_required'); END;
CREATE TRIGGER ws_required_ministries_i BEFORE INSERT ON ministries WHEN NEW.workspace_id IS NULL BEGIN SELECT RAISE(ABORT, 'workspace_required'); END;
CREATE TRIGGER ws_required_ministries_u BEFORE UPDATE OF workspace_id ON ministries WHEN NEW.workspace_id IS NULL BEGIN SELECT RAISE(ABORT, 'workspace_required'); END;
CREATE TRIGGER ws_required_document_types_i BEFORE INSERT ON document_types WHEN NEW.workspace_id IS NULL BEGIN SELECT RAISE(ABORT, 'workspace_required'); END;
CREATE TRIGGER ws_required_document_types_u BEFORE UPDATE OF workspace_id ON document_types WHEN NEW.workspace_id IS NULL BEGIN SELECT RAISE(ABORT, 'workspace_required'); END;
CREATE TRIGGER ws_required_positions_i BEFORE INSERT ON positions WHEN NEW.workspace_id IS NULL BEGIN SELECT RAISE(ABORT, 'workspace_required'); END;
CREATE TRIGGER ws_required_positions_u BEFORE UPDATE OF workspace_id ON positions WHEN NEW.workspace_id IS NULL BEGIN SELECT RAISE(ABORT, 'workspace_required'); END;
CREATE TRIGGER ws_required_employees_i BEFORE INSERT ON employees WHEN NEW.workspace_id IS NULL BEGIN SELECT RAISE(ABORT, 'workspace_required'); END;
CREATE TRIGGER ws_required_employees_u BEFORE UPDATE OF workspace_id ON employees WHEN NEW.workspace_id IS NULL BEGIN SELECT RAISE(ABORT, 'workspace_required'); END;
CREATE TRIGGER ws_required_documents_i BEFORE INSERT ON documents WHEN NEW.workspace_id IS NULL BEGIN SELECT RAISE(ABORT, 'workspace_required'); END;
CREATE TRIGGER ws_required_documents_u BEFORE UPDATE OF workspace_id ON documents WHEN NEW.workspace_id IS NULL BEGIN SELECT RAISE(ABORT, 'workspace_required'); END;
CREATE TRIGGER ws_required_email_log_i BEFORE INSERT ON email_log WHEN NEW.workspace_id IS NULL BEGIN SELECT RAISE(ABORT, 'workspace_required'); END;
CREATE TRIGGER ws_required_email_log_u BEFORE UPDATE OF workspace_id ON email_log WHEN NEW.workspace_id IS NULL BEGIN SELECT RAISE(ABORT, 'workspace_required'); END;
CREATE TRIGGER ws_required_expiry_notifications_i BEFORE INSERT ON expiry_notifications WHEN NEW.workspace_id IS NULL BEGIN SELECT RAISE(ABORT, 'workspace_required'); END;
CREATE TRIGGER ws_required_expiry_notifications_u BEFORE UPDATE OF workspace_id ON expiry_notifications WHEN NEW.workspace_id IS NULL BEGIN SELECT RAISE(ABORT, 'workspace_required'); END;
CREATE TRIGGER ws_required_pending_uploads_i BEFORE INSERT ON pending_uploads WHEN NEW.workspace_id IS NULL BEGIN SELECT RAISE(ABORT, 'workspace_required'); END;
CREATE TRIGGER ws_required_pending_uploads_u BEFORE UPDATE OF workspace_id ON pending_uploads WHEN NEW.workspace_id IS NULL BEGIN SELECT RAISE(ABORT, 'workspace_required'); END;
CREATE TRIGGER ws_required_form_defaults_i BEFORE INSERT ON form_defaults WHEN NEW.workspace_id IS NULL BEGIN SELECT RAISE(ABORT, 'workspace_required'); END;
CREATE TRIGGER ws_required_form_defaults_u BEFORE UPDATE OF workspace_id ON form_defaults WHEN NEW.workspace_id IS NULL BEGIN SELECT RAISE(ABORT, 'workspace_required'); END;
CREATE TRIGGER ws_required_document_drafts_i BEFORE INSERT ON document_drafts WHEN NEW.workspace_id IS NULL BEGIN SELECT RAISE(ABORT, 'workspace_required'); END;
CREATE TRIGGER ws_required_document_drafts_u BEFORE UPDATE OF workspace_id ON document_drafts WHEN NEW.workspace_id IS NULL BEGIN SELECT RAISE(ABORT, 'workspace_required'); END;
CREATE TRIGGER ws_required_whatsapp_recipients_i BEFORE INSERT ON whatsapp_recipients WHEN NEW.workspace_id IS NULL BEGIN SELECT RAISE(ABORT, 'workspace_required'); END;
CREATE TRIGGER ws_required_whatsapp_recipients_u BEFORE UPDATE OF workspace_id ON whatsapp_recipients WHEN NEW.workspace_id IS NULL BEGIN SELECT RAISE(ABORT, 'workspace_required'); END;
CREATE TRIGGER ws_required_whatsapp_jobs_i BEFORE INSERT ON whatsapp_jobs WHEN NEW.workspace_id IS NULL BEGIN SELECT RAISE(ABORT, 'workspace_required'); END;
CREATE TRIGGER ws_required_whatsapp_jobs_u BEFORE UPDATE OF workspace_id ON whatsapp_jobs WHEN NEW.workspace_id IS NULL BEGIN SELECT RAISE(ABORT, 'workspace_required'); END;
CREATE TRIGGER ws_required_whatsapp_attempts_i BEFORE INSERT ON whatsapp_attempts WHEN NEW.workspace_id IS NULL BEGIN SELECT RAISE(ABORT, 'workspace_required'); END;
CREATE TRIGGER ws_required_whatsapp_attempts_u BEFORE UPDATE OF workspace_id ON whatsapp_attempts WHEN NEW.workspace_id IS NULL BEGIN SELECT RAISE(ABORT, 'workspace_required'); END;
CREATE TRIGGER ws_required_upload_cleanup_queue_i BEFORE INSERT ON upload_cleanup_queue WHEN NEW.workspace_id IS NULL BEGIN SELECT RAISE(ABORT, 'workspace_required'); END;
CREATE TRIGGER ws_required_upload_cleanup_queue_u BEFORE UPDATE OF workspace_id ON upload_cleanup_queue WHEN NEW.workspace_id IS NULL BEGIN SELECT RAISE(ABORT, 'workspace_required'); END;
CREATE TRIGGER ws_required_workspace_settings_i BEFORE INSERT ON workspace_settings WHEN NEW.workspace_id IS NULL BEGIN SELECT RAISE(ABORT, 'workspace_required'); END;
CREATE TRIGGER ws_required_workspace_settings_u BEFORE UPDATE OF workspace_id ON workspace_settings WHEN NEW.workspace_id IS NULL BEGIN SELECT RAISE(ABORT, 'workspace_required'); END;

-- Every tenant query filters by workspace first.
CREATE INDEX idx_admin_users_ws ON admin_users(workspace_id);
CREATE INDEX idx_companies_ws ON companies(workspace_id, name);
CREATE INDEX idx_ministries_ws ON ministries(workspace_id, name);
CREATE INDEX idx_document_types_ws ON document_types(workspace_id, name);
CREATE INDEX idx_positions_ws ON positions(workspace_id, name);
CREATE INDEX idx_employees_ws ON employees(workspace_id, name);
CREATE INDEX idx_documents_ws ON documents(workspace_id, created_at DESC);
CREATE INDEX idx_documents_ws_expiry ON documents(workspace_id, expiry_date);
CREATE INDEX idx_email_log_ws ON email_log(workspace_id, created_at DESC);
CREATE INDEX idx_expiry_notifications_ws ON expiry_notifications(workspace_id, item_type, item_id);
CREATE INDEX idx_pending_uploads_ws ON pending_uploads(workspace_id, created_at);
CREATE INDEX idx_whatsapp_jobs_ws ON whatsapp_jobs(workspace_id, state, next_attempt_at);
CREATE INDEX idx_whatsapp_attempts_ws ON whatsapp_attempts(workspace_id);
