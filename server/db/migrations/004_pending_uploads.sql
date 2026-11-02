-- Uploads are staged first and claimed later by the record that owns them.
-- A client therefore never writes a storage path directly; it sends the
-- `upload_id` it received and the server resolves the real file.

CREATE TABLE IF NOT EXISTS pending_uploads (
  id          TEXT PRIMARY KEY,
  file_name   TEXT NOT NULL,
  file_path   TEXT NOT NULL,
  file_size   INTEGER NOT NULL,
  mime_type   TEXT NOT NULL,
  created_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pending_uploads_created ON pending_uploads(created_at);
