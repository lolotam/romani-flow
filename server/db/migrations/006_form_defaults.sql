-- One last successful submission per account and form, shared across devices.
CREATE TABLE form_defaults (
  user_id TEXT NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  form_key TEXT NOT NULL,
  values_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, form_key)
);
