import { randomUUID } from 'node:crypto';
import type { Db } from '../db/connection.js';
import { RepositoryError, type Row } from './base.js';
import { normalizeDate } from '../utils/dates.js';

export interface DraftReference { scope: string; revision: string; account?: string }
const LIMITS: Record<string, number> = { title: 120, beneficiary_type: 8, company_id: 128, employee_id: 128,
  document_type_id: 128, ministry_id: 128, entity_name: 100, notes: 5000, issue_date: 10, expiry_date: 10 };
const REFERENCES: Record<string, string> = { company_id: 'companies', employee_id: 'employees', document_type_id: 'document_types', ministry_id: 'ministries' };

function invalid(): never { throw new RepositoryError('Invalid document draft.', 'invalid_draft', 400); }

/** Only account-owned document contexts are supported; URL scope never selects an account. */
export function validateDraftScope(db: Db, scope: string): void {
  if (scope === 'new') return;
  const match = /^(employee|company|edit):([A-Za-z0-9_-]{1,100})$/.exec(scope);
  if (!match) invalid();
  const table = { employee: 'employees', company: 'companies', edit: 'documents' }[match[1]]!;
  if (!db.prepare(`SELECT id FROM ${table} WHERE id=?`).get(match[2])) {
    throw new RepositoryError('Draft context no longer exists.', 'not_found', 404);
  }
}

export function draftReference(value: unknown): DraftReference {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  const row = value as Row;
  if (Object.keys(row).some(key => !['scope', 'revision', 'account'].includes(key)) || typeof row.scope !== 'string' ||
      typeof row.revision !== 'string' || !/^(none|[a-f0-9-]{32,36})$/.test(row.revision)) invalid();
  if (row.account !== undefined && typeof row.account !== 'string') invalid();
  return { scope: row.scope, revision: row.revision, account: row.account as string | undefined };
}

/** Keep field values only: files, upload ids, server paths and arbitrary metadata are rejected. */
export function validateDraftValues(db: Db, raw: unknown): Row {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Buffer.byteLength(JSON.stringify(raw)) > 16384) invalid();
  const values: Row = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!Object.hasOwn(LIMITS, key) || (value !== null && typeof value !== 'string') ||
        (typeof value === 'string' && value.length > LIMITS[key])) invalid();
    if (key === 'beneficiary_type' && value !== 'employee' && value !== 'company') invalid();
    if (key.endsWith('_date') && value && normalizeDate(value) !== value) invalid();
    if (REFERENCES[key] && value && !(key === 'ministry_id' && value === 'other') &&
        !db.prepare(`SELECT id FROM ${REFERENCES[key]} WHERE id=?`).get(String(value))) invalid();
    values[key] = value;
  }
  return values;
}

export function readDraft(db: Db, userId: string, scope: string): { revision: string; values: Row | null } {
  validateDraftScope(db, scope);
  const row = db.prepare('SELECT revision,values_json FROM document_drafts WHERE user_id=? AND scope=?').get(userId, scope);
  const values: Row | null = row?.values_json ? JSON.parse(String(row.values_json)) as Row : null;
  if (values) for (const [field, table] of Object.entries(REFERENCES)) {
    if (values[field] && !(field === 'ministry_id' && values[field] === 'other') &&
        !db.prepare(`SELECT id FROM ${table} WHERE id=?`).get(String(values[field]))) values[field] = '';
  }
  return { revision: row ? String(row.revision) : 'none', values };
}

/** A tombstone preserves the CAS version after discard/save, rejecting late autosaves. */
export function writeDraft(db: Db, userId: string, ref: DraftReference, values: Row | null): string {
  validateDraftScope(db, ref.scope);
  if (values && ref.scope.startsWith('employee:')) values = { ...values, beneficiary_type: 'employee', employee_id: ref.scope.slice(9), company_id: '' };
  if (values && ref.scope.startsWith('company:')) values = { ...values, beneficiary_type: 'company', company_id: ref.scope.slice(8), employee_id: '' };
  const revision = randomUUID(), now = new Date().toISOString();
  const json = values === null ? null : JSON.stringify(values);
  const changes = ref.revision === 'none'
    ? db.prepare('INSERT INTO document_drafts(user_id,scope,revision,values_json,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(user_id,scope) DO NOTHING')
      .run(userId, ref.scope, revision, json, now).changes
    : db.prepare('UPDATE document_drafts SET revision=?,values_json=?,updated_at=? WHERE user_id=? AND scope=? AND revision=?')
      .run(revision, json, now, userId, ref.scope, ref.revision).changes;
  if (!changes) throw new RepositoryError('A newer draft exists. Reload before continuing.', 'draft_conflict', 409);
  return revision;
}

/** Called inside the document transaction; a conflict rolls back metadata and upload claim too. */
export function finishDraft(db: Db, userId: string, raw: unknown, row: Row, documentId?: string): void {
  if (raw === undefined) return;
  const ref = draftReference(raw);
  if (ref.account !== userId) throw new RepositoryError('Draft account changed.', 'draft_conflict', 409);
  const expected = documentId ? `edit:${documentId}` : ref.scope;
  if (ref.scope !== expected || (!documentId && ref.scope !== 'new' && ref.scope !== `employee:${row.employee_id}` && ref.scope !== `company:${row.company_id}`)) invalid();
  writeDraft(db, userId, ref, null);
}
