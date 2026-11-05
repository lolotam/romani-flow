-- Private unfinished metadata. Tombstones retain revision history against stale clients.
CREATE TABLE document_drafts (
  user_id TEXT NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  scope TEXT NOT NULL,
  revision TEXT NOT NULL,
  values_json TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(user_id, scope)
);

-- Deletion triggers use scope and JSON references without scanning every draft.
CREATE INDEX document_drafts_scope ON document_drafts(scope);
CREATE INDEX document_drafts_employee ON document_drafts(json_extract(values_json,'$.employee_id'));
CREATE INDEX document_drafts_company ON document_drafts(json_extract(values_json,'$.company_id'));

-- Tracks failed removal even if the original pending-upload insertion failed.
CREATE TABLE upload_cleanup_queue (
  file_path TEXT PRIMARY KEY,
  created_at TEXT NOT NULL
);

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
