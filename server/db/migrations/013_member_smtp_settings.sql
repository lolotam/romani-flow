-- The relay of one member, and the member that sends the reminders of a workspace.
--
-- A member relay overrides the relay of the workspace for that member. The
-- workspace relay stays the default, and the platform relay is only used by the
-- legacy workspace while it has not retired it.
ALTER TABLE workspaces
  ADD COLUMN notification_sender_account_id TEXT REFERENCES admin_users(id) ON DELETE SET NULL;

CREATE TABLE member_smtp_settings (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  host TEXT NOT NULL,
  port INTEGER NOT NULL CHECK (port BETWEEN 1 AND 65535),
  secure INTEGER NOT NULL CHECK (secure IN (0, 1)),
  username TEXT NOT NULL,
  password_ciphertext TEXT NOT NULL,
  sender_address TEXT NOT NULL,
  sender_name TEXT,
  last_tested_at TEXT,
  last_test_status TEXT CHECK (last_test_status IN ('succeeded', 'failed') OR last_test_status IS NULL),
  last_test_error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, account_id)
);

CREATE INDEX idx_member_smtp_settings_account ON member_smtp_settings(account_id, workspace_id);
CREATE INDEX idx_workspaces_notification_sender ON workspaces(notification_sender_account_id);

-- The account that owns a relay belongs to the workspace that owns the relay.
CREATE TRIGGER member_smtp_account_in_workspace BEFORE INSERT ON member_smtp_settings
WHEN NOT EXISTS (SELECT 1 FROM admin_users WHERE id = NEW.account_id AND workspace_id = NEW.workspace_id)
BEGIN SELECT RAISE(ABORT, 'member_smtp_account_not_in_workspace'); END;

CREATE TRIGGER ws_required_member_smtp_i BEFORE INSERT ON member_smtp_settings
WHEN NEW.workspace_id IS NULL BEGIN SELECT RAISE(ABORT, 'workspace_required'); END;
CREATE TRIGGER ws_required_member_smtp_u BEFORE UPDATE OF workspace_id ON member_smtp_settings
WHEN NEW.workspace_id IS NULL BEGIN SELECT RAISE(ABORT, 'workspace_required'); END;
CREATE TRIGGER immutable_member_smtp_identity BEFORE UPDATE OF workspace_id, account_id ON member_smtp_settings
WHEN NEW.workspace_id != OLD.workspace_id OR NEW.account_id != OLD.account_id
BEGIN SELECT RAISE(ABORT, 'immutable_member_smtp_identity'); END;

-- The member that sends the reminders of a workspace belongs to that workspace.
CREATE TRIGGER ws_notification_sender_in_workspace BEFORE UPDATE OF notification_sender_account_id ON workspaces
WHEN NEW.notification_sender_account_id IS NOT NULL
 AND NOT EXISTS (SELECT 1 FROM admin_users WHERE id = NEW.notification_sender_account_id AND workspace_id = NEW.id)
BEGIN SELECT RAISE(ABORT, 'notification_sender_not_in_workspace'); END;
