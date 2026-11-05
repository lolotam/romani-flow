-- Private unfinished metadata. Tombstones retain revision history against stale clients.
CREATE TABLE document_drafts (
  user_id TEXT NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  scope TEXT NOT NULL,
  revision TEXT NOT NULL,
  values_json TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(user_id, scope)
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
