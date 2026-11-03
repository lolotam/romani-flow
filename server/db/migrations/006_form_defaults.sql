-- One last successful submission per account and form, shared across devices.
CREATE TABLE form_defaults (
  user_id TEXT NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  form_key TEXT NOT NULL,
  source_id TEXT NOT NULL,
  values_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, form_key)
);

-- Removing a record also removes retained personal data from every account's defaults.
CREATE TRIGGER clear_employee_defaults AFTER DELETE ON employees BEGIN
  DELETE FROM form_defaults WHERE form_key='employees' AND source_id=OLD.id;
END;
CREATE TRIGGER clear_document_defaults AFTER DELETE ON documents BEGIN
  DELETE FROM form_defaults WHERE form_key='documents' AND source_id=OLD.id;
END;
CREATE TRIGGER clear_company_defaults AFTER DELETE ON companies BEGIN
  DELETE FROM form_defaults WHERE form_key='companies' AND source_id=OLD.id;
END;
CREATE TRIGGER clear_position_defaults AFTER DELETE ON positions BEGIN
  DELETE FROM form_defaults WHERE form_key='positions' AND source_id=OLD.id;
END;
CREATE TRIGGER clear_ministry_defaults AFTER DELETE ON ministries BEGIN
  DELETE FROM form_defaults WHERE form_key='ministries' AND source_id=OLD.id;
END;
CREATE TRIGGER clear_document_type_defaults AFTER DELETE ON document_types BEGIN
  DELETE FROM form_defaults WHERE form_key='document_types' AND source_id=OLD.id;
END;
