-- Clerk identities are platform records, not tenant rows. The local id keeps
-- request ownership stable while clerk_user_id remains the external identity.
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  clerk_user_id TEXT UNIQUE NOT NULL,
  email TEXT,
  email_verified INTEGER NOT NULL DEFAULT 0 CHECK (email_verified IN (0, 1)),
  name TEXT,
  deleted_at TEXT,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);

-- A provider delivery may be retried. Recording its id before the side effects
-- commit makes a replay a no-op instead of a second provisioning or deletion.
CREATE TABLE clerk_webhook_events (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  received_at TEXT NOT NULL
);

-- workspaces.clerk_org_id and its UNIQUE constraint already exist in 010.

-- Ownership ids used to point only at admin_users. Clerk users have their own
-- table now, so these three ownership columns become provider-neutral TEXT.
-- Existing legacy ids and rows remain valid; workspace scoping is unchanged.
-- SQLite validates triggers on other tables during DROP, so remove and restore them.
DROP TRIGGER clear_employee_defaults;
DROP TRIGGER clear_document_defaults;
DROP TRIGGER clear_company_defaults;
DROP TRIGGER clear_position_defaults;
DROP TRIGGER clear_ministry_defaults;
DROP TRIGGER clear_document_type_defaults;
DROP TRIGGER invalidate_employee_drafts;
DROP TRIGGER invalidate_company_drafts;
DROP TRIGGER invalidate_document_drafts;

CREATE TABLE form_defaults_v2 (
  user_id TEXT NOT NULL,
  form_key TEXT NOT NULL,
  source_id TEXT NOT NULL,
  values_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  PRIMARY KEY (workspace_id, user_id, form_key)
);
INSERT INTO form_defaults_v2 (user_id, form_key, source_id, values_json, updated_at, workspace_id)
SELECT user_id, form_key, source_id, values_json, updated_at, workspace_id FROM form_defaults;
DROP TABLE form_defaults;
ALTER TABLE form_defaults_v2 RENAME TO form_defaults;
CREATE TRIGGER ws_required_form_defaults_i BEFORE INSERT ON form_defaults WHEN NEW.workspace_id IS NULL BEGIN SELECT RAISE(ABORT, 'workspace_required'); END;
CREATE TRIGGER ws_required_form_defaults_u BEFORE UPDATE OF workspace_id ON form_defaults WHEN NEW.workspace_id IS NULL BEGIN SELECT RAISE(ABORT, 'workspace_required'); END;
CREATE TRIGGER clear_employee_defaults AFTER DELETE ON employees BEGIN DELETE FROM form_defaults WHERE form_key='employees' AND source_id=OLD.id; END;
CREATE TRIGGER clear_document_defaults AFTER DELETE ON documents BEGIN DELETE FROM form_defaults WHERE form_key='documents' AND source_id=OLD.id; END;
CREATE TRIGGER clear_company_defaults AFTER DELETE ON companies BEGIN DELETE FROM form_defaults WHERE form_key='companies' AND source_id=OLD.id; END;
CREATE TRIGGER clear_position_defaults AFTER DELETE ON positions BEGIN DELETE FROM form_defaults WHERE form_key='positions' AND source_id=OLD.id; END;
CREATE TRIGGER clear_ministry_defaults AFTER DELETE ON ministries BEGIN DELETE FROM form_defaults WHERE form_key='ministries' AND source_id=OLD.id; END;
CREATE TRIGGER clear_document_type_defaults AFTER DELETE ON document_types BEGIN DELETE FROM form_defaults WHERE form_key='document_types' AND source_id=OLD.id; END;

CREATE TABLE document_drafts_v2 (
  user_id TEXT NOT NULL,
  scope TEXT NOT NULL,
  revision TEXT NOT NULL,
  values_json TEXT,
  updated_at TEXT NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  PRIMARY KEY (workspace_id, user_id, scope)
);
INSERT INTO document_drafts_v2 (user_id, scope, revision, values_json, updated_at, workspace_id)
SELECT user_id, scope, revision, values_json, updated_at, workspace_id FROM document_drafts;
DROP TABLE document_drafts;
ALTER TABLE document_drafts_v2 RENAME TO document_drafts;
CREATE INDEX document_drafts_scope ON document_drafts(scope);
CREATE INDEX document_drafts_workspace_scope ON document_drafts(workspace_id, scope);
CREATE INDEX document_drafts_employee ON document_drafts(json_extract(values_json,'$.employee_id'));
CREATE INDEX document_drafts_company ON document_drafts(json_extract(values_json,'$.company_id'));
CREATE TRIGGER ws_required_document_drafts_i BEFORE INSERT ON document_drafts WHEN NEW.workspace_id IS NULL BEGIN SELECT RAISE(ABORT, 'workspace_required'); END;
CREATE TRIGGER ws_required_document_drafts_u BEFORE UPDATE OF workspace_id ON document_drafts WHEN NEW.workspace_id IS NULL BEGIN SELECT RAISE(ABORT, 'workspace_required'); END;
CREATE TRIGGER invalidate_employee_drafts AFTER DELETE ON employees BEGIN
  UPDATE document_drafts SET values_json=NULL, revision=lower(hex(randomblob(16))), updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
  WHERE scope='employee:' || OLD.id OR json_extract(values_json,'$.employee_id')=OLD.id;
END;
CREATE TRIGGER invalidate_company_drafts AFTER DELETE ON companies BEGIN
  UPDATE document_drafts SET values_json=NULL, revision=lower(hex(randomblob(16))), updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
  WHERE scope='company:' || OLD.id OR json_extract(values_json,'$.company_id')=OLD.id;
END;
CREATE TRIGGER invalidate_document_drafts AFTER DELETE ON documents BEGIN
  UPDATE document_drafts SET values_json=NULL, revision=lower(hex(randomblob(16))), updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
  WHERE scope='edit:' || OLD.id;
END;

CREATE TABLE pending_uploads_v2 (
  id TEXT PRIMARY KEY,
  file_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  mime_type TEXT NOT NULL,
  created_at TEXT NOT NULL,
  draft_user_id TEXT,
  draft_scope TEXT,
  workspace_id TEXT REFERENCES workspaces(id)
);
INSERT INTO pending_uploads_v2 (id, file_name, file_path, file_size, mime_type, created_at, draft_user_id, draft_scope, workspace_id)
SELECT id, file_name, file_path, file_size, mime_type, created_at, draft_user_id, draft_scope, workspace_id FROM pending_uploads;
DROP TABLE pending_uploads;
ALTER TABLE pending_uploads_v2 RENAME TO pending_uploads;
CREATE INDEX idx_pending_uploads_created ON pending_uploads(created_at);
CREATE INDEX idx_pending_uploads_ws ON pending_uploads(workspace_id, created_at);
CREATE TRIGGER ws_required_pending_uploads_i BEFORE INSERT ON pending_uploads WHEN NEW.workspace_id IS NULL BEGIN SELECT RAISE(ABORT, 'workspace_required'); END;
CREATE TRIGGER ws_required_pending_uploads_u BEFORE UPDATE OF workspace_id ON pending_uploads WHEN NEW.workspace_id IS NULL BEGIN SELECT RAISE(ABORT, 'workspace_required'); END;
