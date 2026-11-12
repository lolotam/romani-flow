import { randomUUID } from 'node:crypto';
import type { Db } from '../db/connection.js';
import { existsInScope, RepositoryError, type Row, type Scope } from './base.js';
import { normalizeDate } from '../utils/dates.js';
import { getString } from './settings.js';
import { documentNumber } from '../contracts/documentNumber.js';

export interface DraftReference { scope: string; revision: string; account?: string }
const LIMITS: Record<string, number> = { title: 120, beneficiary_type: 8, company_id: 128, employee_id: 128,
  document_type_id: 128, ministry_id: 128, entity_name: 100, notes: 5000, issue_date: 10, expiry_date: 10,
  document_number: 128 };
const REFERENCES: Record<string, string> = { company_id: 'companies', employee_id: 'employees', document_type_id: 'document_types', ministry_id: 'ministries' };

function invalid(): never { throw new RepositoryError('Invalid document draft.', 'invalid_draft', 400); }

/**
 * Only account-owned document contexts are supported; URL scope never selects an account.
 * `tenant` is the workspace; `scope` is the draft context (`new`, `employee:<id>`, …).
 */
export function validateDraftScope(db: Db, tenant: Scope, scope: string): void {
  if (scope === 'new') return;
  const match = /^(employee|company|edit):([A-Za-z0-9_-]{1,100})$/.exec(scope);
  if (!match) invalid();
  const table = { employee: 'employees', company: 'companies', edit: 'documents' }[match[1]]!;
  if (!existsInScope(db, tenant, table, match[2])) {
    throw new RepositoryError('Draft context no longer exists.', 'not_found', 404);
  }
}

export function draftReference(value: unknown): DraftReference {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  const row = value as Row;
  if (Object.keys(row).some(key => !['scope', 'revision', 'account'].includes(key)) || typeof row.scope !== 'string' ||
      typeof row.revision !== 'string' || !/^(none(?::[a-f0-9-]{32,36})?|[a-f0-9-]{32,36})$/.test(row.revision)) invalid();
  if (row.account !== undefined && typeof row.account !== 'string') invalid();
  return { scope: row.scope, revision: row.revision, account: row.account as string | undefined };
}

/** Keep field values only: files, upload ids, server paths and arbitrary metadata are rejected. */
export function validateDraftValues(db: Db, tenant: Scope, raw: unknown): Row {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Buffer.byteLength(JSON.stringify(raw)) > 16384) invalid();
  const values: Row = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!Object.hasOwn(LIMITS, key)) invalid();
    // The number keeps its own representation, so it is trimmed and validated
    // through the shared contract before the draft length limit applies.
    if (key === 'document_number') {
      const parsed = documentNumber.safeParse(value);
      if (!parsed.success) invalid();
      const number = parsed.data;
      if (number !== null && number.length > LIMITS[key]) invalid();
      values[key] = number;
      continue;
    }
    if ((value !== null && typeof value !== 'string') ||
        (typeof value === 'string' && value.length > LIMITS[key])) invalid();
    if (key === 'beneficiary_type' && value !== 'employee' && value !== 'company') invalid();
    if (key.endsWith('_date') && value && normalizeDate(value) !== value) invalid();
    if (REFERENCES[key] && value && !(key === 'ministry_id' && value === 'other') &&
        !existsInScope(db, tenant, REFERENCES[key], String(value))) invalid();
    values[key] = value;
  }
  return values;
}

export function readDraft(db: Db, tenant: Scope, userId: string, scope: string): { revision: string; values: Row | null } {
  validateDraftScope(db, tenant, scope);
  const row = db.prepare('SELECT revision,values_json FROM document_drafts WHERE user_id=? AND scope=? AND workspace_id=?')
    .get(userId, scope, tenant.workspaceId);
  const values: Row | null = row?.values_json ? JSON.parse(String(row.values_json)) as Row : null;
  if (values) for (const [field, table] of Object.entries(REFERENCES)) {
    if (values[field] && !(field === 'ministry_id' && values[field] === 'other') &&
        !existsInScope(db, tenant, table, String(values[field]))) values[field] = '';
  }
  return { revision: row ? String(row.revision) : emptyRevision(db, tenant), values };
}

function emptyRevision(db: Db, tenant: Scope): string {
  const epoch = getString(db, tenant, 'document_drafts.epoch', '0');
  return epoch === '0' ? 'none' : `none:${epoch}`;
}

/** A tombstone preserves the CAS version after discard/save, rejecting late autosaves. */
export function writeDraft(db: Db, tenant: Scope, userId: string, ref: DraftReference, values: Row | null): string {
  validateDraftScope(db, tenant, ref.scope);
  if (values && ref.scope.startsWith('employee:')) values = { ...values, beneficiary_type: 'employee', employee_id: ref.scope.slice(9), company_id: '' };
  if (values && ref.scope.startsWith('company:')) values = { ...values, beneficiary_type: 'company', company_id: ref.scope.slice(8), employee_id: '' };
  const revision = randomUUID(), now = new Date().toISOString();
  const json = values === null ? null : JSON.stringify(values);
  if (ref.revision.startsWith('none') && ref.revision !== emptyRevision(db, tenant)) {
    throw new RepositoryError('Draft predates business erase. Reload before continuing.', 'draft_conflict', 409);
  }
  const changes = ref.revision.startsWith('none')
    ? db.prepare('INSERT INTO document_drafts(workspace_id,user_id,scope,revision,values_json,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(workspace_id,user_id,scope) DO NOTHING')
      .run(tenant.workspaceId, userId, ref.scope, revision, json, now).changes
    : db.prepare('UPDATE document_drafts SET revision=?,values_json=?,updated_at=? WHERE user_id=? AND scope=? AND revision=? AND workspace_id=?')
      .run(revision, json, now, userId, ref.scope, ref.revision, tenant.workspaceId).changes;
  if (!changes) throw new RepositoryError('A newer draft exists. Reload before continuing.', 'draft_conflict', 409);
  return revision;
}

/** Called inside the document transaction; a conflict rolls back metadata and upload claim too. */
export function finishDraft(db: Db, tenant: Scope, userId: string, raw: unknown, row: Row, documentId?: string): void {
  if (raw === undefined) return;
  const ref = draftReference(raw);
  if (ref.account !== userId) throw new RepositoryError('Draft account changed.', 'draft_conflict', 409);
  const expected = documentId ? `edit:${documentId}` : ref.scope;
  if (ref.scope !== expected || (!documentId && ref.scope !== 'new' && ref.scope !== `employee:${row.employee_id}` && ref.scope !== `company:${row.company_id}`)) invalid();
  writeDraft(db, tenant, userId, ref, null);
}

/** Validate upload authority under the same coordinator used by erase, before file I/O. */
export function assertCurrentDraft(db: Db, tenant: Scope, userId: string, ref: DraftReference): void {
  if (ref.account !== userId || readDraft(db, tenant, userId, ref.scope).revision !== ref.revision) {
    throw new RepositoryError('Draft changed before upload.', 'draft_conflict', 409);
  }
}
