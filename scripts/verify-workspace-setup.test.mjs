import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { reminderApi } from './fixtures/whatsapp-api.mjs';
import { createWorkspace } from '../server/repositories/workspaces.ts';
import { getBoolean, isTenantSetting, SETTING_DEFINITIONS } from '../server/repositories/settings.ts';
import { STARTER_MINISTRIES, STARTER_POSITIONS } from '../server/db/starterCatalog.ts';

/** Plan D5 and D10: what a new workspace starts with, and where each workspace's files go. */

const C = { workspaceId: 'ws_c' };
const file = { buffer: Buffer.from('%PDF-1.4 synthetic'), originalname: 'setup.pdf', mimetype: 'application/pdf' };
const rows = (f, table, ws) => f.db.prepare(`SELECT * FROM "${table}" WHERE workspace_id=? ORDER BY id`).all(ws);

test('a new workspace starts with every default setting and only the generic catalog', () => reminderApi(async f => {
  createWorkspace(f.db, { id: C.workspaceId, name: 'Tenant C' });

  const stored = f.db.prepare('SELECT key FROM workspace_settings WHERE workspace_id=? ORDER BY key').all(C.workspaceId).map(row => row.key);
  const expected = SETTING_DEFINITIONS.filter(definition => isTenantSetting(definition.key)).map(definition => definition.key).sort();
  assert.deepEqual(stored, expected);
  assert.equal(getBoolean(f.db, C, 'whatsapp.enabled'), false, 'a new workspace never starts with WhatsApp on');

  const byName = list => list.map(({ name, name_ar }) => [name, name_ar]).sort((a, b) => a[0].localeCompare(b[0]));
  assert.deepEqual(byName(rows(f, 'ministries', C.workspaceId)), byName(STARTER_MINISTRIES));
  assert.deepEqual(rows(f, 'positions', C.workspaceId).map(row => row.value).sort(), STARTER_POSITIONS.map(row => row.value).sort());
  for (const table of ['companies', 'document_types', 'employees', 'documents']) assert.deepEqual(rows(f, table, C.workspaceId), [], `${table} starts empty`);

  // Fresh ids: no catalog row is shared with another workspace.
  const shared = f.db.prepare(`SELECT count(*) n FROM ministries a JOIN ministries b ON a.id=b.id AND a.workspace_id<>b.workspace_id`).get().n;
  assert.equal(shared, 0);
}));

test('a failed setup leaves no half-created workspace behind', () => reminderApi(async f => {
  f.db.exec("CREATE TRIGGER reject_positions BEFORE INSERT ON positions WHEN NEW.workspace_id='ws_c' BEGIN SELECT RAISE(ABORT,'Synthetic setup failure'); END;");
  assert.throws(() => createWorkspace(f.db, { id: C.workspaceId, name: 'Tenant C' }), /Synthetic setup failure/);
  for (const table of ['workspaces', 'workspace_settings', 'ministries']) {
    const column = table === 'workspaces' ? 'id' : 'workspace_id';
    assert.equal(f.db.prepare(`SELECT count(*) n FROM "${table}" WHERE ${column}='ws_c'`).get().n, 0, `${table} is rolled back`);
  }
}));

test('the starter catalog is the generic part of the owner catalog, never Romani\'s companies', () => {
  const owner = fs.readFileSync('server/db/ownerCatalogs.ts', 'utf8');
  for (const entry of [...STARTER_MINISTRIES, ...STARTER_POSITIONS]) assert.ok(owner.includes(`'${entry.name}', '${entry.name_ar}'`), entry.name);
  const starter = fs.readFileSync('server/db/starterCatalog.ts', 'utf8');
  for (const company of ['CureMed', 'Cosmenix']) assert.equal(starter.includes(company), false);
});

test('each workspace\'s new uploads land in its own folder, and old paths still resolve', () => reminderApi(async f => {
  createWorkspace(f.db, { id: C.workspaceId, name: 'Tenant C' });
  const [legacy] = await f.documents.stageUploads({ workspaceId: 'ws_legacy' }, [file]);
  const [own] = await f.documents.stageUploads(C, [file]);
  assert.match(legacy.filePath, /^ws_legacy\/\d{4}\/\d{2}\//);
  assert.match(own.filePath, /^ws_c\/\d{4}\/\d{2}\//);
  assert.ok(f.storage.exists(own.filePath));

  // Files stored before workspaces existed keep their YYYY/MM path and are still served.
  fs.mkdirSync(f.storage.resolve('2025/12'), { recursive: true });
  fs.writeFileSync(f.storage.resolve('2025/12/old.pdf'), '%PDF-1.4 old');
  f.db.prepare("UPDATE documents SET file_path='2025/12/old.pdf',file_name='old.pdf',mime_type='application/pdf' WHERE id=?").run(f.document.id);
  assert.equal((await f.request(`/api/files/${f.document.id}`)).status, 200);
}));

test('a workspace id that is not a safe folder name is refused before any write', () => reminderApi(async f => {
  for (const workspaceId of ['../ws_legacy', 'ws/x', '', 'ws legacy']) {
    await assert.rejects(f.storage.save(workspaceId, { buffer: Buffer.from('x'), originalName: 'x.pdf', mimeType: 'application/pdf' }), /Invalid workspace folder/, workspaceId);
  }
}));
