import { insertRow } from '../../server/repositories/base.ts';
import { createWorkspace } from '../../server/repositories/workspaces.ts';

export const LEG = { workspaceId: 'ws_legacy' }, B = { workspaceId: 'ws_b' };
export const today = () => new Date().toISOString().slice(0, 10);

/** Adds workspace B with its own administrator (`admin-b`), legacy's default settings and one document due today. */
export function addWorkspaceB(f) {
  createWorkspace(f.db, { id: B.workspaceId, name: 'Tenant B' });
  f.db.prepare("INSERT INTO admin_users(workspace_id,id,email,name,role,password_hash,created_at,updated_at) VALUES('ws_b','admin-b','admin-b@example.invalid','Synthetic B','admin','not-a-login-fixture','2026-01-01','2026-01-01')").run();
  // B starts from legacy's defaults, including whatsapp.enabled: only the D9 gate keeps it off the instance.
  f.db.prepare("INSERT INTO workspace_settings(workspace_id,key,value,updated_at) SELECT 'ws_b',key,value,updated_at FROM workspace_settings WHERE workspace_id='ws_legacy'").run();
  const company = insertRow(f.db, B, 'companies', { name: 'Tenant B company' });
  const type = insertRow(f.db, B, 'document_types', { name: 'Tenant B type' });
  const employee = insertRow(f.db, B, 'employees', { name: 'Tenant B employee', company_id: company.id, mobile_no: '+99900000099' });
  const document = insertRow(f.db, B, 'documents', { title: 'Tenant B doc', employee_id: employee.id, document_type_id: type.id, expiry_date: today() });
  return { company, type, employee, document };
}

/** A request signed in as workspace B's administrator. */
export const asB = (f, url, options = {}) => f.request(url, { ...options, user: 'admin-b' });
