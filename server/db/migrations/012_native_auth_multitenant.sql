-- Migration 012: Native multi-tenant isolation, workspace SMTP, and workspace WhatsApp instances.

-- 1. Workspace SMTP settings table for per-tenant email isolation
CREATE TABLE IF NOT EXISTS workspace_smtp_settings (
  workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  host TEXT NOT NULL,
  port INTEGER NOT NULL DEFAULT 587,
  secure INTEGER NOT NULL DEFAULT 0 CHECK (secure IN (0, 1)),
  user TEXT NOT NULL,
  pass TEXT NOT NULL,
  from_address TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- 2. Workspace WhatsApp instances table for per-tenant Evolution instance routing
CREATE TABLE IF NOT EXISTS workspace_whatsapp_instances (
  workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  instance_name TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Register default instance for the legacy Romani workspace
INSERT OR IGNORE INTO workspace_whatsapp_instances (workspace_id, instance_name, created_at, updated_at)
VALUES ('ws_legacy', 'romani', strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'));
