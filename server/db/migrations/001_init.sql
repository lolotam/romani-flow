-- Core schema for the ROMANI Flow self-hosted backend.
-- Mirrors the entity shapes the SPA already consumes, with the additional columns
-- the UI writes but the legacy TypeScript interfaces never declared.

CREATE TABLE IF NOT EXISTS companies (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  name_ar     TEXT NOT NULL DEFAULT '',
  description TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ministries (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  name_ar    TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS document_types (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  name_ar    TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS positions (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  name_ar    TEXT NOT NULL DEFAULT '',
  value      TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS employees (
  id                         TEXT PRIMARY KEY,
  company_id                 TEXT REFERENCES companies(id) ON DELETE SET NULL,
  name                       TEXT NOT NULL,
  phone                      TEXT,
  mobile_no                  TEXT,
  email                      TEXT,
  hire_date                  TEXT,
  birth_date                 TEXT,
  civil_id_no                TEXT,
  residency_expiry_date      TEXT,
  position                   TEXT,
  position_id                TEXT REFERENCES positions(id) ON DELETE SET NULL,
  is_active                  INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  driving_license            INTEGER NOT NULL DEFAULT 0 CHECK (driving_license IN (0, 1)),
  driving_license_expiry_date TEXT,
  photo_path                 TEXT,
  created_at                 TEXT NOT NULL,
  updated_at                 TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS documents (
  id              TEXT PRIMARY KEY,
  title           TEXT NOT NULL,
  file_name       TEXT,
  file_path       TEXT,
  file_size       INTEGER,
  mime_type       TEXT,
  status          TEXT NOT NULL DEFAULT 'valid'
                    CHECK (status IN ('valid', 'expiring_soon', 'expired')),
  issue_date      TEXT,
  expiry_date     TEXT,
  notes           TEXT,
  employee_id     TEXT REFERENCES employees(id) ON DELETE SET NULL,
  company_id      TEXT REFERENCES companies(id) ON DELETE SET NULL,
  document_type_id TEXT NOT NULL REFERENCES document_types(id) ON DELETE RESTRICT,
  ministry_id     TEXT REFERENCES ministries(id) ON DELETE SET NULL,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS admin_users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'admin',
  is_active     INTEGER NOT NULL DEFAULT 1,
  last_login_at TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS email_log (
  id                TEXT PRIMARY KEY,
  kind              TEXT NOT NULL,
  recipients        TEXT NOT NULL,
  subject           TEXT,
  status            TEXT NOT NULL,
  error             TEXT,
  attachment_count  INTEGER NOT NULL DEFAULT 0,
  attachment_bytes  INTEGER NOT NULL DEFAULT 0,
  trigger_source    TEXT,
  details           TEXT,
  created_at        TEXT NOT NULL
);
