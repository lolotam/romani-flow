import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { reminderApi } from './fixtures/whatsapp-api.mjs';
import { DocumentDraftSession } from '../src/lib/documentDraftSession.ts';
import { setSetting } from '../server/repositories/settings.ts';

const file = { buffer: Buffer.from('synthetic document'), originalname: 'fixture.pdf', mimetype: 'application/pdf' };
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const draftTransport = (f, pause) => async (url, options = {}) => {
  const response = await f.request(url, { ...options, headers: { 'x-draft-account': 'admin' } });
  await pause?.(options.method ?? 'GET');
  return response.json;
};

test('legacy erase cannot commit over private drafts or queued bytes after migration 008', () => reminderApi(async f => {
  setSetting(f.db, 'system.seed_version', '1');
  const draft = await f.request('/api/document-drafts/new', { method: 'PUT', headers: { 'x-draft-account': 'admin' }, body: { revision: 'none', values: { notes: 'private synthetic note' } } });
  assert.equal(draft.status, 200);
  const stored = await f.storage.save(file.buffer, file.originalname, file.mimetype);
  f.db.prepare('INSERT INTO upload_cleanup_queue VALUES(?,?)').run(stored.relativePath, new Date().toISOString());
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
