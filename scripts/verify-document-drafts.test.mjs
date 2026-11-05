import test from 'node:test';
import assert from 'node:assert/strict';
import { reminderApi } from './fixtures/whatsapp-api.mjs';
import { signSession } from '../server/middleware/auth.ts';
import { ApiRequestError } from '../src/lib/api/http.ts';
import { DocumentDraftSession, draftValues } from '../src/lib/documentDraftSession.ts';
import { createDocumentPreview } from '../src/lib/documentPreview.ts';
import { createServer } from 'vite';
import { employeeDocumentDraft } from '../src/lib/documentFormDrafts.ts';
import { createDocumentSchema } from '../src/components/documents/documentFormSchema.ts';

test('actual form preview components render authenticated PDF/image sources and keep fixed company selection disabled', async () => {
  const vite = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom', logLevel: 'error' });
  try {
    const { previewMarkup, companyMarkup, emptyPreviewMarkup } = await vite.ssrLoadModule('/scripts/fixtures/document-preview-render.tsx');
    const pdf = previewMarkup('application/pdf', 'synthetic.pdf');
    assert.match(pdf, /<iframe/); assert.match(pdf, /\/api\/files\/synthetic-document\/preview/);
    assert.match(pdf, /rel="noopener noreferrer"/);
    const image = previewMarkup('image/png', 'synthetic.png');
    assert.match(image, /<img/); assert.match(image, /object-contain/);
    const unsupported = previewMarkup('text/html', 'synthetic.html');
    assert.doesNotMatch(unsupported, /<iframe|<img/);
    assert.match(companyMarkup(), /role="combobox"[^>]*disabled/);
    assert.match(emptyPreviewMarkup(), /لم يتم اختيار ملف/);
    assert.match(emptyPreviewMarkup(), /اختر ملف PDF/);
    assert.doesNotMatch(emptyPreviewMarkup(), /\?\?/);
    assert.match(pdf, /افتح الملف في تبويب جديد/);
  } finally { await vite.close(); }
});

test('empty first-write references cannot revive text after business erase', () => reminderApi(async f => {
  const api = transport(f), initial = (await api(url('new'))).data;
  assert.equal(initial.values, null); assert.equal(initial.revision, 'none');
  assert.equal((await f.request('/api/backup/erase', { method: 'POST', body: {} })).status, 200);
  assert.equal((await api(url('new'), { method: 'PUT', body: { revision: initial.revision, values: { notes: 'Before erase' } } })).error.code, 'draft_conflict');
  const fresh = (await api(url('new'))).data;
  assert.notEqual(fresh.revision, initial.revision);
  assert.equal((await api(url('new'), { method: 'PUT', body: { revision: fresh.revision, values: { notes: 'New session after erase' } } })).error, null);
}));

test('failed loads and conflicts allow explicit close without changing the saved server draft', () => reminderApi(async f => {
  const api = transport(f), states = [];
  const failed = new DocumentDraftSession('employee:missing', () => {}, state => states.push(state), api);
  await assert.rejects(failed.flush());
  assert.equal(await failed.close(() => false), false);
  assert.equal(await failed.close(() => true), true);
  assert.ok(states.includes('failed'));
  const session = new DocumentDraftSession('new', () => {}, state => states.push(state), api);
  await session.flush(); session.change({ notes: 'My draft' }); await session.flush();
  const snapshot = (await api(url('new'))).data;
  await api(url('new'), { method: 'PUT', body: { revision: snapshot.revision, values: { notes: 'Other device' } } });
  session.change({ notes: 'Local unsaved change' }); await assert.rejects(session.flush());
  assert.equal(await session.close(() => false), false);
  assert.equal(await session.close(() => true), true);
  assert.equal((await api(url('new'))).data.values.notes, 'Other device');
}));

test('concurrent discard clicks share one delete and do not manufacture a conflict', () => reminderApi(async f => {
  const api = transport(f); let release, deletes = 0;
  const gate = new Promise(resolve => { release = resolve; });
  const states = [];
  const session = new DocumentDraftSession('new', () => {}, state => states.push(state), async (path, options) => {
    if (options?.method === 'DELETE') { deletes++; const result = await api(path, options); await gate; return result; }
    return api(path, options);
  });
  await session.flush(); session.change({ notes: 'Discard me' }); await session.flush();
  const first = session.discard(), second = session.discard();
  assert.equal(first, second); assert.equal(states.at(-1), 'saving');
  release(); await Promise.all([first, second]);
  assert.equal(deletes, 1); assert.equal(states.at(-1), 'saved');
  assert.equal((await api(url('new'))).data.values, null); session.dispose();
}));

test('a document-save CAS conflict is visible and retains the prepared local values', () => reminderApi(async f => {
  const api = transport(f), states = [], session = new DocumentDraftSession('new', () => {}, state => states.push(state), api);
  const prepared = await session.prepare({ notes: 'Prepared local values' });
  await api(url('new'), { method: 'PUT', body: { revision: prepared.revision, values: { notes: 'Newer device' } } });
  const response = await f.request('/api/documents', { method: 'POST', body: { title: 'Conflict', employee_id: f.employee.id, document_type_id: f.type.id, expiry_date: '2029-01-01', draft: { ...prepared, account: 'admin' } } });
  assert.equal(response.status, 409);
  session.resume(new ApiRequestError(response.json.error.message, response.json.error.code, 409));
  assert.equal(states.at(-1), 'conflict'); await assert.rejects(session.flush());
  assert.equal(await session.close(() => false), false);
  assert.equal((await api(url('new'))).data.values.notes, 'Newer device');
  session.dispose();
}));

test('custom entity limit is shared by the draft API and form; empty draft keeps filename title', () => reminderApi(async f => {
  const api = transport(f), values = { ...fields, beneficiary_type: 'company', company_id: f.company.id, ministry_id: 'other', entity_name: 'x'.repeat(100), document_type_id: f.type.id };
  const schema = createDocumentSchema(key => key);
  assert.equal(schema.safeParse({ ...values, issue_date: new Date(2028, 1, 29), expiry_date: new Date(2029, 0, 1) }).success, true);
  assert.equal(schema.safeParse({ ...values, entity_name: 'x'.repeat(101), issue_date: new Date(2028, 1, 29), expiry_date: new Date(2029, 0, 1) }).success, false);
  const saved = await api(url('new'), { method: 'PUT', body: { revision: 'none', values } });
  assert.equal(saved.error, null);
  assert.equal((await api(url('new'), { method: 'PUT', body: { revision: saved.data.revision, values: { ...values, entity_name: 'x'.repeat(101) } } })).error.code, 'invalid_draft');
  assert.equal(employeeDocumentDraft(null, 'work.permit.pdf').title, 'work.permit');
  assert.equal(employeeDocumentDraft({ title: 'Edited title' }, 'upload.pdf').title, 'Edited title');
}));

test('local PDF/image preview retains original bytes and releases URLs without accepting active content', async () => {
  for (const [type, name] of [['application/pdf', 'test.pdf'], ['image/jpeg', 'test.jpg'], ['image/png', 'test.png']]) {
    const bytes = new Uint8Array([37, 80, 68, 70, 0, 10, 255]);
    const file = new File([bytes], name, { type });
    const preview = createDocumentPreview(file);
    assert.equal(preview.file, file); assert.match(preview.url, /^blob:/);
    assert.deepEqual(new Uint8Array(await (await fetch(preview.url)).arrayBuffer()), bytes);
    preview.release(); await assert.rejects(fetch(preview.url));
  }
  for (const type of ['text/html', 'image/svg+xml', 'application/javascript', '']) assert.equal(createDocumentPreview(new File(['invalid'], 'x', { type })), null);
});

function transport(f, account = 'admin', gate) {
  return async (url, options = {}) => {
    const role = account === 'viewer' ? 'viewer' : 'admin';
    const cookie = f.config.cookieName + '=' + signSession(f.config, { id: account, role, name: 'Synthetic', email: account + '@example.invalid' });
    const response = await fetch(f.base + url, { method: options.method ?? 'GET', headers: { cookie, 'x-draft-account': account, 'content-type': 'application/json' }, body: options.body === undefined ? undefined : JSON.stringify(options.body) });
    const envelope = await response.json();
    if (gate) await gate(options.method ?? 'GET');
    return { data: envelope.data, error: envelope.error ? new ApiRequestError(envelope.error.message, envelope.error.code, response.status) : null };
  };
}

const url = scope => '/api/document-drafts/' + encodeURIComponent(scope);
const ref = (scope, revision) => ({ scope, revision, account: 'admin' });
const fields = { title: 'Unfinished synthetic', beneficiary_type: 'employee', issue_date: '2028-02-29', expiry_date: '2029-01-01', notes: 'Private unfinished note' };

test('draft API isolates accounts/contexts, validates metadata and keeps CAS tombstones after discard', () => reminderApi(async f => {
  f.db.prepare("INSERT INTO admin_users(id,email,name,role,password_hash,created_at,updated_at) VALUES('admin2','admin2@example.invalid','Synthetic','admin','unused','x','x')").run();
  const a = transport(f), b = transport(f, 'admin2'), scope = 'employee:' + f.employee.id;
  assert.equal((await a(url(scope))).data.revision, 'none');
  const saved = await a(url(scope), { method: 'PUT', body: { revision: 'none', values: { ...fields, employee_id: f.employee.id } } });
  assert.equal(saved.error, null);
  assert.equal((await b(url(scope))).data.values, null);
  assert.equal((await a(url('new'))).data.values, null);
  const restored = (await a(url(scope))).data;
  assert.equal(restored.values.issue_date, '2028-02-29'); assert.equal(restored.values.employee_id, f.employee.id);
  for (const invalid of [{ upload_id: 'not-allowed' }, { expiry_date: '2027-02-29' }, { notes: 'x'.repeat(5001) }, { employee_id: 'missing' }]) {
    assert.equal((await a(url(scope), { method: 'PUT', body: { revision: saved.data.revision, values: invalid } })).error.status, 400);
  }
  assert.equal((await a(url(scope), { method: 'PUT', body: { revision: 'none', values: fields } })).error.code, 'draft_conflict');
  assert.equal((await transport(f, 'viewer')(url(scope))).error.status, 403);
  assert.equal((await f.request(url(scope), { headers: { 'x-draft-account': 'admin2' } })).status, 409);
  assert.equal((await f.request(url(scope), { role: null })).status, 401);
  const removed = await a(url(scope), { method: 'DELETE', body: { revision: saved.data.revision } });
  assert.equal(removed.error, null); assert.equal((await a(url(scope))).data.values, null);
  assert.notEqual(removed.data.revision, 'none');
  assert.equal((await a(url(scope), { method: 'PUT', body: { revision: saved.data.revision, values: fields } })).error.code, 'draft_conflict');
  assert.equal((await a(url(scope), { method: 'PUT', body: { revision: 'none', values: fields } })).error.code, 'draft_conflict');
  assert.equal(f.calls.length, 0);
}));

test('document save clears the exact revision atomically; stale create/update preserve rows and staged uploads', () => reminderApi(async f => {
  const api = transport(f), scope = 'employee:' + f.employee.id;
  const saved = await api(url(scope), { method: 'PUT', body: { revision: 'none', values: fields } });
  const newer = await api(url(scope), { method: 'PUT', body: { revision: saved.data.revision, values: { ...fields, notes: 'Newer device' } } });
  const file = await f.storage.save(Buffer.from('%PDF-1.4\nSynthetic draft attachment'), 'draft.pdf', 'application/pdf');
  const staged = f.documents.registerUpload({ fileName: file.fileName, filePath: file.relativePath, fileSize: file.size, mimeType: file.mimeType });
  const payload = { title: 'Synthetic completed', employee_id: f.employee.id, document_type_id: f.type.id, expiry_date: '2029-01-01', upload_id: staged.uploadId };
  const count = f.db.prepare('SELECT count(*) n FROM documents').get().n;
  assert.equal((await f.request('/api/documents', { method: 'POST', body: { ...payload, draft: ref(scope, saved.data.revision) } })).status, 409);
  assert.equal(f.db.prepare('SELECT count(*) n FROM documents').get().n, count);
  assert.ok(f.documents.resolveUpload(staged.uploadId));
  const result = await f.request('/api/documents', { method: 'POST', body: { ...payload, draft: ref(scope, newer.data.revision) } });
  assert.equal(result.status, 201); assert.equal((await api(url(scope))).data.values, null);
  assert.equal(f.documents.resolveUpload(staged.uploadId), null);
  assert.equal((await api(url(scope), { method: 'PUT', body: { revision: newer.data.revision, values: fields } })).error.code, 'draft_conflict');
  const id = result.json.data[0].id, editScope = 'edit:' + id;
  const edit = await api(url(editScope), { method: 'PUT', body: { revision: 'none', values: { notes: 'edit draft' } } });
  const updated = await api(url(editScope), { method: 'PUT', body: { revision: edit.data.revision, values: { notes: 'newer edit' } } });
  assert.equal((await f.request('/api/documents/' + id, { method: 'PATCH', body: { title: 'Should roll back', draft: ref(editScope, edit.data.revision) } })).status, 409);
  assert.equal(f.db.prepare('SELECT title FROM documents WHERE id=?').get(id).title, payload.title);
  assert.equal((await f.request('/api/documents/' + id, { method: 'PATCH', body: { notes: 'Saved', draft: ref(editScope, updated.data.revision) } })).status, 200);
  assert.equal((await api(url(editScope))).data.values, null);
  assert.equal(f.calls.length, 0);
}));

test('entity deletion and business erase invalidate private drafts and reject old revisions', () => reminderApi(async f => {
  const api = transport(f);
  const one = await api(url('new'), { method: 'PUT', body: { revision: 'none', values: { ...fields, employee_id: f.employee.id } } });
  f.db.prepare('DELETE FROM employees WHERE id=?').run(f.employee.id);
  const cleared = (await api(url('new'))).data;
  assert.equal(cleared.values, null); assert.notEqual(cleared.revision, one.data.revision);
  const two = await api(url('new'), { method: 'PUT', body: { revision: cleared.revision, values: { notes: 'Unlinked private text' } } });
  assert.equal((await f.request('/api/backup/erase', { method: 'POST', body: {} })).status, 200);
  assert.equal((await api(url('new'))).data.values, null);
  assert.equal((await api(url('new'), { method: 'PUT', body: { revision: two.data.revision, values: { notes: 'Late write' } } })).error.code, 'draft_conflict');
}));

test('client sessions restore across devices, serialize pending input and block stale conflicts without retrying', () => reminderApi(async f => {
  const api = transport(f), scope = 'employee:' + f.employee.id;
  const restored = [], states = [];
  const first = new DocumentDraftSession(scope, value => restored.push(value), state => states.push(state), api);
  try {
    first.change(draftValues({ ...fields, issue_date: new Date(2028, 1, 29) }));
    await first.flush(); assert.equal(restored.length, 0);
    const second = new DocumentDraftSession(scope, value => restored.push(value), () => {}, api);
    try {
      await second.flush(); assert.equal(restored.at(-1).issue_date, '2028-02-29');
      first.change({ title: 'First newer edit' }); await first.flush();
      second.change({ title: 'Stale device edit' });
      await assert.rejects(second.flush(), error => error.code === 'draft_conflict');
      await assert.rejects(second.flush(), error => error.code === 'draft_conflict');
      assert.equal((await api(url(scope))).data.values.title, 'First newer edit');
      await first.discard(); assert.equal((await api(url(scope))).data.values, null);
      assert.equal(states.at(-1), 'saved');
    } finally { second.dispose(); }
  } finally { first.dispose(); }
}));

test('late load cannot replace typed input; commit prevents a prepared draft from reappearing', () => reminderApi(async f => {
  const api = transport(f), scope = 'new';
  await api(url(scope), { method: 'PUT', body: { revision: 'none', values: { notes: 'Old draft' } } });
  let release; const gate = new Promise(resolve => { release = resolve; });
  const restored = [];
  const session = new DocumentDraftSession(scope, value => restored.push(value), () => {}, transport(f, 'admin', method => method === 'GET' ? gate : undefined));
  try {
    session.change({ notes: 'Typed while loading' });
    const saving = session.flush(); release(); await saving;
    assert.equal(restored.length, 0); assert.equal((await api(url(scope))).data.values.notes, 'Typed while loading');
    const token = await session.prepare({ notes: 'Prepared' });
    await api(url(scope), { method: 'DELETE', body: { revision: token.revision } });
    session.committed(); session.change({ notes: 'Late change after success' }); await session.flush();
    assert.equal((await api(url(scope))).data.values, null);
  } finally { release(); session.dispose(); }
}));

test('closing during a delayed load flushes typed metadata against the real revision without applying a late restore', () => reminderApi(async f => {
  const api = transport(f), scope = 'new';
  await api(url(scope), { method: 'PUT', body: { revision: 'none', values: { notes: 'Previously saved' } } });
  let release; const gate = new Promise(resolve => { release = resolve; });
  const restored = [];
  const session = new DocumentDraftSession(scope, value => restored.push(value), () => {}, transport(f, 'admin', method => method === 'GET' ? gate : undefined));
  session.change({ notes: 'Last edit before close' }); session.dispose(true); release();
  await session.flush();
  assert.equal(restored.length, 0);
  assert.equal((await api(url(scope))).data.values.notes, 'Last edit before close');
}));
