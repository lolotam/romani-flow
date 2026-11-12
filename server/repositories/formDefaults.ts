import type { Db } from '../db/connection.js';
import { existsInScope, type Row, type Scope } from './base.js';

// Explicit form fields only: never retain attachments, new record ids, audit fields or credentials.
const FIELDS: Record<string, readonly string[]> = {
  employees: ['name', 'email', 'position', 'hire_date', 'birth_date', 'civil_id_no',
    'residency_expiry_date', 'driving_license', 'driving_license_expiry_date', 'company_id', 'is_active'],
  documents: ['title', 'company_id', 'employee_id', 'document_type_id', 'ministry_id', 'notes'],
  companies: ['name', 'name_ar', 'description'],
  positions: ['name', 'name_ar', 'value'],
  ministries: ['name', 'name_ar'],
  document_types: ['name', 'name_ar'],
};

const REFERENCES: Record<string, string> = {
  company_id: 'companies', employee_id: 'employees', document_type_id: 'document_types', ministry_id: 'ministries',
};

export function supportsForm(key: string): boolean {
  return Object.hasOwn(FIELDS, key);
}

/** Called inside the creation transaction, so a rejected insertion never replaces defaults. */
export function rememberSubmission(db: Db, scope: Scope, userId: string, formKey: string, row: Row): void {
  if (!supportsForm(formKey)) return;
  const values = Object.fromEntries(FIELDS[formKey].filter(key => key in row).map(key => [key, row[key]]));
  db.prepare(`INSERT INTO form_defaults (workspace_id, user_id, form_key, source_id, values_json, updated_at) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(workspace_id, user_id, form_key) DO UPDATE SET source_id=excluded.source_id,
      values_json=excluded.values_json, updated_at=excluded.updated_at`)
    .run(scope.workspaceId, userId, formKey, String(row.id), JSON.stringify(values), new Date().toISOString());
}

/** The caller supplies the authenticated account, never a client-selected user id. */
export function readSubmission(db: Db, scope: Scope, userId: string, formKey: string): Row {
  const stored = db.prepare('SELECT values_json FROM form_defaults WHERE user_id=? AND form_key=? AND workspace_id=?')
    .get(userId, formKey, scope.workspaceId) as { values_json: string } | undefined;
  const values: Row = stored ? JSON.parse(stored.values_json) as Row : {};
  if (formKey === 'documents') { delete values.issue_date; delete values.expiry_date; delete values.document_number; }
  if (formKey === 'employees') {
    delete values.mobile_no;
    delete values.whatsapp_notifications_enabled;
  }
  if (formKey === 'employees' && values.position &&
      !db.prepare('SELECT id FROM positions WHERE value=? AND workspace_id=?').get(String(values.position), scope.workspaceId)) {
    delete values.position;
  }
  // A remembered reference that no longer exists in this workspace is dropped, never shown.
  for (const [key, table] of Object.entries(REFERENCES)) {
    if (values[key] && !existsInScope(db, scope, table, String(values[key]))) delete values[key];
  }
  return values;
}
