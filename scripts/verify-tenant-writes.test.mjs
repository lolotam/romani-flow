import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { reminderApi } from './fixtures/whatsapp-api.mjs';
import { addWorkspaceB, asB, B, LEG, plantLegacyFiles } from './fixtures/workspace-b.mjs';

/**
 * Write inventory: every POST, PUT, PATCH and DELETE handler under `server/` is either
 * attempted by workspace B against legacy rows below, or listed with the reason it
 * touches no row another workspace owns. A new handler fails the first test until
 * someone decides how B is kept out of it.
 */

const WRITE_SOURCES = ['app.ts', ...fs.readdirSync('server/routes').map(file => 'routes/' + file), 'whatsapp/routes.ts', 'notifications/whatsapp/routes.ts', 'auth/webhook.ts'];

function writeHandlers() {
  const handlers = [];
  for (const file of WRITE_SOURCES) {
    const source = fs.readFileSync('server/' + file, 'utf8');
    for (const match of source.matchAll(/\b(?:router|app)\.(post|put|patch|delete)\(\s*'([^']*)'/g)) handlers.push(`${file} ${match[1].toUpperCase()} ${match[2]}`);
    // The drafts router registers PUT and DELETE in one loop.
    for (const match of source.matchAll(/router\[method\]\(\s*'([^']*)'/g)) handlers.push(`${file} PUT|DELETE ${match[1]}`);
  }
  return handlers;
}

const NO_FOREIGN_ROWS = {
  'routes/auth.ts POST /login': 'Signs in; the account row yields the workspace.',
  'routes/auth.ts POST /logout': 'Clears the caller\'s own session.',
  'app.ts PUT /api/cron/schedule': 'Platform gate proved in verify-tenant-isolation.',
  'routes/backup.ts POST /erase': 'Erases the caller\'s workspace; proved in verify-tenant-isolation.',
  'routes/settings.ts PUT /': 'Writes the caller\'s workspace_settings; proved in verify-tenant-isolation.',
  'routes/documentExtraction.ts POST /': 'The body carries the caller\'s images only, never a row id.',
  'routes/email.ts POST /test': 'Sends a test message to an address the caller types; no row id.',
  'routes/email.ts POST /expiry-report': 'Reports the caller\'s workspace only; the tick test proves the per-workspace report.',
  'routes/files.ts POST /upload': 'Stages new files into the caller\'s workspace; no row id.',
  'whatsapp/routes.ts POST /': 'Provider webhook without a session; carries no tenant rows.',
  'auth/webhook.ts POST /': 'Verified Clerk synchronization is covered by signature, replay and suspension tests in verify-clerk-auth.',
  'notifications/whatsapp/routes.ts POST /recipients': 'Refused for B in verify-tenant-isolation.',
};

const file = { buffer: Buffer.from('%PDF-1.4 synthetic'), originalname: 'tenant.pdf', mimetype: 'application/pdf' };
const asBDraft = (f, url, options = {}) => asB(f, url, { ...options, headers: { 'x-draft-account': 'admin-b', ...(options.headers ?? {}) } });

/** Each attempt runs as B and must answer `status` (and `code`, when given); `covers` names its handler. */
function attempts(ids) {
  const { doc, employee, company, type, bDoc, bCompany, bUpload, legacyUpload, draft } = ids;
  return [
    { covers: 'routes/documents.ts PATCH /:id', method: 'PATCH', url: `/api/documents/${doc}`, body: { title: 'Changed by B' }, status: 404 },
    { covers: 'routes/documents.ts DELETE /:id', method: 'DELETE', url: `/api/documents/${doc}`, status: 404 },
    { covers: 'routes/documents.ts POST /', method: 'POST', url: '/api/documents', body: { title: 'Points at legacy', employee_id: employee, document_type_id: type }, status: 404 },
    { covers: 'routes/documents.ts PATCH /:id', method: 'PATCH', url: `/api/documents/${bDoc}`, body: { employee_id: employee }, status: 404 },
    { covers: 'routes/resources.ts PATCH /:id', method: 'PATCH', url: `/api/employees/${employee}`, body: { name: 'Changed by B' }, status: 404 },
    { covers: 'routes/resources.ts PATCH /:id', method: 'PATCH', url: `/api/companies/${bCompany}`, body: { workspace_id: 'ws_legacy' }, status: 400, code: 'unknown_column' },
    { covers: 'routes/resources.ts DELETE /:id', method: 'DELETE', url: `/api/document-types/${type}`, status: 404 },
    { covers: 'routes/resources.ts POST /', method: 'POST', url: '/api/employees', body: { name: 'Points at legacy', company_id: company }, status: 404 },
    { covers: 'app.ts PUT /api/documents/:id/file', method: 'PUT', url: `/api/documents/${doc}/file`, body: { upload_id: bUpload }, status: 404 },
    { covers: 'app.ts DELETE /api/documents/:id/file', method: 'DELETE', url: `/api/documents/${doc}/file`, status: 404 },
    { covers: 'routes/files.ts PUT /employees/:employeeId/photo', method: 'PUT', url: `/api/files/employees/${employee}/photo`, status: 404 },
    { covers: 'routes/files.ts DELETE /employees/:employeeId/photo', method: 'DELETE', url: `/api/files/employees/${employee}/photo`, status: 404 },
    { covers: 'routes/files.ts POST /uploads/:uploadId/validate', method: 'POST', url: `/api/files/uploads/${legacyUpload}/validate`, body: { draft }, status: 404, code: 'invalid_upload' },
    // Abandoning an upload B cannot see is a no-op; the test checks the legacy upload survives.
    { covers: 'routes/files.ts DELETE /uploads/:uploadId', method: 'DELETE', url: `/api/files/uploads/${legacyUpload}`, body: { draft }, status: 200 },
    { covers: 'routes/documentDrafts.ts PUT|DELETE /:scope', method: 'PUT', url: '/api/document-drafts/new', body: { revision: draft.revision, values: { employee_id: employee } }, status: 400, code: 'invalid_draft', draftHeader: true },
    { covers: 'routes/documentDrafts.ts PUT|DELETE /:scope', method: 'DELETE', url: '/api/document-drafts/new', body: { revision: draft.revision }, status: 409, code: 'draft_workspace_mismatch', draftHeader: true, draftWorkspace: 'ws_legacy' },
    { covers: 'routes/documentDrafts.ts PUT|DELETE /:scope', method: 'PUT', url: `/api/document-drafts/employee:${employee}`, body: { revision: 'none', values: {} }, status: 404, draftHeader: true },
    { covers: 'routes/email.ts POST /send-documents', method: 'POST', url: '/api/email/send-documents', body: { document_ids: [doc], to: ['tenant-b@example.invalid'] }, status: 409, code: 'missing_files' },
    { covers: 'notifications/whatsapp/routes.ts PATCH /recipients/:id', method: 'PATCH', url: '/api/whatsapp/recipients/synthetic', body: { label: 'B' }, status: 404, code: 'whatsapp_unavailable' },
    { covers: 'notifications/whatsapp/routes.ts DELETE /recipients/:id', method: 'DELETE', url: '/api/whatsapp/recipients/synthetic', status: 404, code: 'whatsapp_unavailable' },
    { covers: 'notifications/whatsapp/routes.ts POST /jobs/:id/retry', method: 'POST', url: '/api/whatsapp/jobs/synthetic/retry', body: {}, status: 404, code: 'whatsapp_unavailable' },
    { covers: 'whatsapp/routes.ts POST /connect', method: 'POST', url: '/api/whatsapp/connect', body: {}, status: 404, code: 'whatsapp_unavailable' },
    { covers: 'whatsapp/routes.ts POST /disconnect', method: 'POST', url: '/api/whatsapp/disconnect', body: {}, status: 404, code: 'whatsapp_unavailable' },
  ];
}

test('every write handler is attempted by B or listed with its reason', () => {
  const attempted = attempts({ draft: {} }).map(attempt => attempt.covers);
  const covered = new Set([...attempted, ...Object.keys(NO_FOREIGN_ROWS)]);
  const handlers = writeHandlers();
  assert.deepEqual(handlers.filter(handler => !covered.has(handler)), [], 'decide how workspace B is kept out of these handlers');
  assert.deepEqual([...covered].filter(key => !handlers.includes(key)), [], 'inventory entries without a handler');
});

const legacyState = f => JSON.stringify(['companies', 'employees', 'documents', 'document_types']
  .map(table => f.db.prepare(`SELECT * FROM "${table}" WHERE workspace_id='ws_legacy' ORDER BY id`).all()));

test('no write lets B change, delete, reference or reach legacy rows and uploads', () => reminderApi(async f => {
  const b = addWorkspaceB(f); plantLegacyFiles(f);
  const [legacyUpload] = await f.documents.stageUploads(LEG, [file]);
  const [bUpload, bOwnUpload] = await f.documents.stageUploads(B, [file, file]);
  const { revision } = (await asBDraft(f, '/api/document-drafts/new')).json.data;
  const draft = { scope: 'new', revision, account: 'admin-b' };
  const before = legacyState(f);

  const ids = { doc: f.document.id, employee: f.employee.id, company: f.company.id, type: f.type.id, bDoc: b.document.id,
    bCompany: b.company.id, bUpload: bUpload.uploadId, legacyUpload: legacyUpload.uploadId, draft };
  for (const { method, url, body, status, code, draftHeader, draftWorkspace } of attempts(ids)) {
    const headers = draftWorkspace ? { 'x-draft-workspace': draftWorkspace } : undefined;
    const response = await (draftHeader ? asBDraft : asB)(f, url, { method, body, headers });
    const label = `${method} ${url} answered ${response.status}: ${JSON.stringify(response.json).slice(0, 160)}`;
    assert.equal(response.status, status, label);
    if (code) assert.equal(response.json.error.code, code, label);
    assert.equal(JSON.stringify(response.json).includes('وثيقة اختبار'), false, `${label} revealed the legacy title`);
  }

  assert.equal(legacyState(f), before, 'legacy rows are unchanged');
  assert.equal(f.db.prepare("SELECT workspace_id FROM companies WHERE id=?").get(b.company.id).workspace_id, 'ws_b');
  assert.equal(f.db.prepare("SELECT count(*) n FROM documents WHERE title='Points at legacy'").get().n, 0);
  assert.equal(f.db.prepare("SELECT count(*) n FROM employees WHERE name='Points at legacy'").get().n, 0);
  assert.equal(f.db.prepare('SELECT employee_id FROM documents WHERE id=?').get(b.document.id).employee_id, b.employee.id);
  assert.ok(f.db.prepare('SELECT 1 FROM pending_uploads WHERE id=?').get(legacyUpload.uploadId), 'the legacy upload is still pending');
  assert.ok(f.storage.exists(legacyUpload.filePath), 'the legacy upload file survives');

  // Controls: each refused write succeeds on the caller's own rows, so the refusals above are the boundary.
  assert.equal((await f.request(`/api/companies/${f.company.id}`, { method: 'PATCH', body: { name: 'Legacy edit' } })).status, 200);
  assert.equal((await asB(f, `/api/documents/${b.document.id}/file`, { method: 'PUT', body: { upload_id: bOwnUpload.uploadId } })).status, 200);
  assert.equal((await asB(f, `/api/files/employees/${b.employee.id}/photo`, { method: 'PUT' })).json.error.code, 'no_files');
  assert.equal((await asBDraft(f, '/api/document-drafts/new', { method: 'PUT', body: { revision, values: { employee_id: b.employee.id } } })).status, 200);
  const legacyDraft = (await f.request('/api/document-drafts/new', { headers: { 'x-draft-account': 'admin' } })).json.data;
  const validated = await f.request(`/api/files/uploads/${legacyUpload.uploadId}/validate`, { method: 'POST', body: { draft: { scope: 'new', revision: legacyDraft.revision, account: 'admin' } } });
  assert.equal(validated.status, 200, JSON.stringify(validated.json));
  const legacySend = await f.request('/api/email/send-documents', { method: 'POST', body: { document_ids: [f.document.id], to: ['legacy@example.invalid'] } });
  // The fixture has no SMTP, so legacy gets past the lookup that refuses B and fails only at sending.
  assert.equal(legacySend.json.error.code, 'send_failed');
}));

test('a draft of another workspace is refused, and a draft without the header is allowed', () => reminderApi(async f => {
  addWorkspaceB(f);
  const legacy = { 'x-draft-account': 'admin' };

  // The header names the workspace the form was created for.
  const refused = await f.request('/api/document-drafts/new', {
    method: 'PUT', headers: { ...legacy, 'x-draft-workspace': 'ws_b' }, body: { revision: 'none', values: { title: 'Cross workspace' } },
  });
  assert.equal(refused.status, 409, JSON.stringify(refused.json));
  assert.equal(refused.json.error.code, 'draft_workspace_mismatch');

  // The same draft with the workspace it belongs to is accepted.
  const accepted = await f.request('/api/document-drafts/new', {
    method: 'PUT', headers: { ...legacy, 'x-draft-workspace': 'ws_legacy' }, body: { revision: 'none', values: { title: 'Own workspace' } },
  });
  assert.equal(accepted.status, 200, JSON.stringify(accepted.json));

  // A client that sends no header at all keeps the old behaviour.
  const withoutHeader = await f.request('/api/document-drafts/new', {
    method: 'PUT', headers: legacy, body: { revision: accepted.json.data.revision, values: { title: 'No header' } },
  });
  assert.equal(withoutHeader.status, 200, JSON.stringify(withoutHeader.json));

  // B cannot delete a legacy draft, not even with the header of its own workspace.
  const legacyDraft = (await f.request('/api/document-drafts/new', { headers: legacy })).json.data;
  const deletedByB = await asBDraft(f, '/api/document-drafts/new', {
    method: 'DELETE', headers: { 'x-draft-workspace': 'ws_legacy' }, body: { revision: legacyDraft.revision },
  });
  assert.equal(deletedByB.status, 409, JSON.stringify(deletedByB.json));
  assert.equal(deletedByB.json.error.code, 'draft_workspace_mismatch');
  assert.ok(f.db.prepare("SELECT 1 FROM document_drafts WHERE workspace_id='ws_legacy' AND scope='new'").get(), 'the legacy draft survives');

  // The legacy administrator deletes its own draft.
  const deleted = await f.request('/api/document-drafts/new', {
    method: 'DELETE', headers: { ...legacy, 'x-draft-workspace': 'ws_legacy' }, body: { revision: legacyDraft.revision },
  });
  assert.equal(deleted.status, 200, JSON.stringify(deleted.json));
  assert.equal(f.db.prepare("SELECT values_json FROM document_drafts WHERE workspace_id='ws_legacy' AND scope='new'").get().values_json, null, 'the legacy draft is discarded');
}));
