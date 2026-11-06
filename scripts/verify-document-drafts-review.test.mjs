import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { reminderApi } from './fixtures/whatsapp-api.mjs';
import { DocumentDraftSession } from '../src/lib/documentDraftSession.ts';
import { setSetting } from '../server/repositories/settings.ts';
import { seedDatabase, writeSeedMarker } from '../server/db/seed.ts';
import { newDocumentDefaults } from '../src/lib/documentFormDrafts.ts';
import { fileAccept } from '../src/lib/fileAccept.ts';
import { signSession } from '../server/middleware/auth.ts';

const file = { buffer: Buffer.from('synthetic document'), originalname: 'fixture.pdf', mimetype: 'application/pdf' };
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const draftTransport = (f, pause) => async (url, options = {}) => {
  const response = await f.request(url, { ...options, headers: { 'x-draft-account': 'admin' } });
  await pause?.(options.method ?? 'GET');
  return response.json;
};

async function stageDraftFile(f, draft) {
  const body = new FormData();
  body.append('files', new Blob([file.buffer], { type: file.mimetype }), file.originalname);
  body.append('draft', JSON.stringify(draft));
  const cookie = f.config.cookieName + '=' + signSession(f.config, { id: 'admin', role: 'admin', name: 'Synthetic', email: 'admin@example.invalid' });
  const response = await fetch(f.base + '/api/files/upload', { method: 'POST', headers: { cookie }, body });
  assert.equal(response.status, 201);
  return (await response.json()).data[0].upload_id;
}

test('abandon validates draft owner/revision and removes only the selected unfinished attachment', () => reminderApi(async f => {
  const headers = { 'x-draft-account': 'admin' };
  const saved = await f.request('/api/document-drafts/new', { method: 'PUT', headers, body: { revision: 'none', values: { notes: 'first' } } });
  const old = { account: 'admin', scope: 'new', revision: saved.json.data.revision };
  const uploadId = await stageDraftFile(f, old), path = f.documents.resolveUpload(uploadId).filePath;
  const current = await f.request('/api/document-drafts/new', { method: 'PUT', headers, body: { revision: old.revision, values: { notes: 'current' } } });
  const draft = { ...old, revision: current.json.data.revision };
  const endpoint = '/api/files/uploads/' + uploadId;
  assert.equal((await f.request(endpoint, { method: 'DELETE', body: { draft: old } })).status, 409);
  assert.equal((await f.request(endpoint, { method: 'DELETE', role: 'viewer', body: { draft } })).status, 403);
  f.db.prepare("INSERT INTO admin_users(id,email,name,role,password_hash,created_at,updated_at) VALUES('admin2','admin2@example.invalid','Synthetic','admin','unused','x','x')").run();
  const cookie = f.config.cookieName + '=' + signSession(f.config, { id: 'admin2', role: 'admin', name: 'Synthetic', email: 'admin2@example.invalid' });
  const foreign = await fetch(f.base + endpoint, { method: 'DELETE', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ draft: { account: 'admin2', scope: 'new', revision: 'none' } }) });
  assert.equal(foreign.status, 403);
  assert.equal(f.storage.exists(path), true);
  assert.notEqual(f.documents.resolveUpload(uploadId), null);
  const abandoned = await f.request(endpoint, { method: 'DELETE', body: { draft } });
  assert.equal(abandoned.status, 200); assert.equal(abandoned.json.data.cleanupPending, false);
  assert.equal(f.documents.resolveUpload(uploadId), null); assert.equal(f.storage.exists(path), false);
  assert.equal((await f.request(endpoint, { method: 'DELETE', body: { draft } })).status, 200);
  assert.equal(f.db.prepare('SELECT count(*) n FROM documents').get().n, 1);
}));

test('abandon revokes a pending upload before failed unlink and can retry its tracked cleanup', t => reminderApi(async f => {
  const draft = { account: 'admin', scope: 'new', revision: 'none' };
  const uploadId = await stageDraftFile(f, draft), path = f.documents.resolveUpload(uploadId).filePath;
  const remove = t.mock.method(f.storage, 'remove', async () => { throw Error('Synthetic unlink failure'); });
  const endpoint = '/api/files/uploads/' + uploadId;
  const first = await f.request(endpoint, { method: 'DELETE', body: { draft } });
  assert.equal(first.status, 200); assert.equal(first.json.data.cleanupPending, true);
  assert.equal(f.documents.resolveUpload(uploadId), null);
  assert.equal(f.storage.exists(path), true);
  assert.equal(f.db.prepare('SELECT upload_id FROM upload_cleanup_queue WHERE file_path=?').get(path).upload_id, uploadId);
  const claim = await f.request('/api/documents/' + f.document.id + '/file', { method: 'PUT', body: { upload_id: uploadId } });
  assert.equal(claim.status, 404);
  remove.mock.restore();
  const retry = await f.request(endpoint, { method: 'DELETE', body: { draft } });
  assert.equal(retry.status, 200); assert.equal(retry.json.data.cleanupPending, false);
  assert.equal(f.storage.exists(path), false);
  assert.equal(f.db.prepare('SELECT count(*) n FROM upload_cleanup_queue').get().n, 0);
}));

test('empty private state still blocks legacy erase while current bootstrap is explicitly authorized', () => reminderApi(async f => {
  assert.equal(f.db.prepare("SELECT count(*) n FROM settings WHERE key='system.seed_version'").get().n, 0);
  assert.equal(f.db.prepare('SELECT count(*) n FROM document_drafts').get().n, 0);
  assert.equal(f.db.prepare('SELECT count(*) n FROM upload_cleanup_queue').get().n, 0);
  const none = (await f.request('/api/document-drafts/new', { headers: { 'x-draft-account': 'admin' } })).json.data.revision;
  f.db.exec('BEGIN');
  try {
    f.db.prepare('DELETE FROM documents').run();
    assert.throws(() => setSetting(f.db, 'system.seed_version', '1'), /erase_requires_draft_aware_runtime/);
  } finally { f.db.exec('ROLLBACK'); }
  assert.equal(f.db.prepare('SELECT count(*) n FROM documents').get().n, 1);
  await seedDatabase(f.db, { seedFile: 'nonexistent-synthetic-seed.json', adminEmails: [], adminPassword: null });
  assert.equal(f.db.prepare("SELECT value FROM settings WHERE key='system.seed_version'").get().value, '"1"');
  assert.equal(f.db.prepare("SELECT count(*) n FROM settings WHERE key='document_drafts.bootstrap_active'").get().n, 0);
  assert.equal((await f.request('/api/backup/erase', { method: 'POST', body: {} })).status, 200);
  const fresh = (await f.request('/api/document-drafts/new', { headers: { 'x-draft-account': 'admin' } })).json.data.revision;
  assert.notEqual(fresh, none);
}));

test('a next-document baseline and its new file title contain no previous document metadata', () => {
  const context = { employeeId: 'employee-fixture' };
  const previous = { ...newDocumentDefaults(context, 'first.pdf'), notes: 'old notes', document_type_id: 'old-type', expiry_date: new Date(2030, 1, 1) };
  const next = newDocumentDefaults(context);
  const selected = { ...next, title: newDocumentDefaults(context, 'second.pdf').title };
  assert.equal(previous.title, 'first');
  assert.equal(next.title, ''); assert.equal(selected.title, 'second');
  assert.equal(selected.employee_id, 'employee-fixture');
  assert.equal(selected.notes, ''); assert.equal(selected.document_type_id, ''); assert.equal(selected.expiry_date, undefined);
});

test('document picker MIME filters match its advertised PDF and image extensions', () => {
  assert.deepEqual(fileAccept(['.pdf', '.jpg', '.jpeg', '.png']), {
    'application/pdf': ['.pdf'], 'image/jpeg': ['.jpg', '.jpeg'], 'image/png': ['.png'],
  });
  assert.deepEqual(fileAccept(['.doc', '.docx']), {
    'application/msword': ['.doc'], 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
  });
});

test('a second edit during the post-discard PUT is flushed before discard and close finish', () => reminderApi(async f => {
  const deleteEntered = deferred(), deleteRelease = deferred(), putEntered = deferred(), putRelease = deferred();
  let afterDelete = false, pausePut = true;
  const session = new DocumentDraftSession('new', () => {}, () => {}, draftTransport(f, async method => {
    if (method === 'DELETE') { afterDelete = true; deleteEntered.resolve(); await deleteRelease.promise; }
    else if (method === 'PUT' && afterDelete && pausePut) { pausePut = false; putEntered.resolve(); await putRelease.promise; }
  }));
  await session.flush(); session.change({ notes: 'old' }); await session.flush();
  const discard = session.discard(); await deleteEntered.promise;
  session.change({ notes: 'first new edit' }); deleteRelease.resolve(); await putEntered.promise;
  session.change({ notes: 'second new edit' }); putRelease.resolve(); await discard;
  assert.equal(await session.close(() => false), true);
  assert.equal((await f.request('/api/document-drafts/new', { headers: { 'x-draft-account': 'admin' } })).json.data.values.notes, 'second new edit');
  session.dispose();
}));

test('legacy erase cannot commit over private drafts or queued bytes after migration 008', () => reminderApi(async f => {
  writeSeedMarker(f.db);
  const draft = await f.request('/api/document-drafts/new', { method: 'PUT', headers: { 'x-draft-account': 'admin' }, body: { revision: 'none', values: { notes: 'private synthetic note' } } });
  assert.equal(draft.status, 200);
  const stored = await f.storage.save(file.buffer, file.originalname, file.mimetype);
  f.db.prepare('INSERT INTO upload_cleanup_queue(file_path,created_at) VALUES(?,?)').run(stored.relativePath, new Date().toISOString());
  // Pre-008 erase commits only after writing this existing seed marker. Its
  // transaction must roll back before its post-commit unlink loop can run.
  f.db.exec('BEGIN');
  try {
    f.db.prepare('DELETE FROM documents').run();
    assert.throws(() => setSetting(f.db, 'system.seed_version', '1'), /erase_requires_draft_aware_runtime/);
  } finally { f.db.exec('ROLLBACK'); }
  assert.equal(f.db.prepare('SELECT count(*) n FROM documents').get().n, 1);
  assert.match(f.db.prepare('SELECT values_json FROM document_drafts').get().values_json, /private synthetic note/);
  assert.equal(f.storage.exists(stored.relativePath), true);
  const erased = await f.request('/api/backup/erase', { method: 'POST', body: {} });
  assert.equal(erased.status, 200); assert.equal(erased.json.data.filesPendingCleanup, 0);
  assert.equal(f.db.prepare('SELECT count(*) n FROM document_drafts WHERE values_json IS NOT NULL').get().n, 0);
  assert.equal(f.db.prepare("SELECT count(*) n FROM settings WHERE key='document_drafts.erase_active'").get().n, 0);
  assert.equal(f.storage.exists(stored.relativePath), false);
}));

test('partial disk-write failure retains cleanup authority even when unlink also fails', t => reminderApi(async f => {
  const write = fs.promises.writeFile.bind(fs.promises);
  t.mock.method(fs.promises, 'writeFile', async (path, bytes) => {
    await write(path, bytes.subarray(0, 4));
    throw Object.assign(new Error('Synthetic disk full'), { code: 'ENOSPC' });
  });
  const unlink = t.mock.method(f.storage, 'remove', async () => { throw new Error('Synthetic unlink failure'); });
  await assert.rejects(f.documents.stageUploads([file]), /Synthetic disk full/);
  const queued = f.db.prepare('SELECT file_path FROM upload_cleanup_queue').all();
  assert.equal(queued.length, 1);
  assert.equal(f.db.prepare('SELECT count(*) n FROM pending_uploads').get().n, 0);
  assert.deepEqual(await f.storage.read(queued[0].file_path), file.buffer.subarray(0, 4));
  unlink.mock.restore();
  assert.equal(await f.documents.purgeStaleUploads(), 1);
  assert.equal(f.storage.exists(queued[0].file_path), false);
  assert.equal(f.db.prepare('SELECT count(*) n FROM upload_cleanup_queue').get().n, 0);
}));

test('replacement cannot claim a stale upload while purge is unlinking it', t => reminderApi(async f => {
  const [upload] = await f.documents.stageUploads([file]);
  f.db.prepare("UPDATE pending_uploads SET created_at='2000-01-01T00:00:00.000Z' WHERE id=?").run(upload.uploadId);
  const entered = deferred(), release = deferred(), requested = deferred();
  const remove = f.storage.remove.bind(f.storage);
  t.mock.method(f.storage, 'remove', async path => { entered.resolve(); await release.promise; return remove(path); });
  const onRequest = req => { if (req.url.endsWith('/file')) requested.resolve(); };
  f.server.on('request', onRequest);
  const purge = f.documents.purgeStaleUploads();
  await entered.promise;
  let settled = false;
  const replacement = f.request('/api/documents/' + f.document.id + '/file', { method: 'PUT', body: { upload_id: upload.uploadId } }).then(r => { settled = true; return r; });
  try {
    await requested.promise;
    assert.equal(settled, false);
    assert.equal(f.db.prepare('SELECT file_path FROM documents WHERE id=?').get(f.document.id).file_path, null);
  } finally { release.resolve(); f.server.off('request', onRequest); }
  assert.equal(await purge, 1);
  assert.equal((await replacement).status, 404);
  assert.equal(f.db.prepare('SELECT file_path FROM documents WHERE id=?').get(f.document.id).file_path, null);
}));

test('typing before the draft loads retains loading state until the revision is ready', () => reminderApi(async f => {
  const read = deferred(), states = [];
  const session = new DocumentDraftSession('new', () => {}, s => states.push(s), draftTransport(f, method => method === 'GET' ? read.promise : undefined));
  session.change({ notes: 'typed before loading' });
  assert.equal(states.at(-1), 'loading');
  await assert.rejects(session.prepare({ notes: 'premature submit' }), /Wait for the draft/);
  read.resolve(); await session.flush();
  assert.equal(states.at(-1), 'saved');
  assert.equal((await f.request('/api/document-drafts/new', { headers: { 'x-draft-account': 'admin' } })).json.data.values.notes, 'typed before loading');
  session.dispose();
}));

for (const phase of ['PUT', 'DELETE']) test(`discard preserves an edit while waiting for ${phase}`, () => reminderApi(async f => {
  const entered = deferred(), release = deferred(), states = [], restored = [];
  let armed = false;
  const session = new DocumentDraftSession('new', v => restored.push(v), s => states.push(s), draftTransport(f, async method => {
    if (armed && method === phase) { armed = false; entered.resolve(); await release.promise; }
  }));
  await session.flush(); session.change({ notes: 'old draft' });
  let flushing, discard;
  if (phase === 'PUT') {
    armed = true; flushing = session.flush(); await entered.promise; discard = session.discard();
  } else {
    await session.flush(); armed = true; discard = session.discard(); await entered.promise;
  }
  assert.equal(states.at(-1), 'discarding');
  session.change({ notes: 'new edit while deletion replies' });
  release.resolve(); await flushing; await discard;
  assert.equal(states.at(-1), 'saved');
  assert.equal((await f.request('/api/document-drafts/new', { headers: { 'x-draft-account': 'admin' } })).json.data.values.notes, 'new edit while deletion replies');
  assert.equal(restored.length, 1); // Only the initial empty load, no late reset.
  session.dispose();
}));
