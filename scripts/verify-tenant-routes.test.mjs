import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { reminderApi } from './fixtures/whatsapp-api.mjs';
import { addWorkspaceB, asB, LEG } from './fixtures/workspace-b.mjs';
import { setSetting } from '../server/repositories/settings.ts';
import { writeEmailLog } from '../server/services/emailLog.ts';
import { rememberSubmission } from '../server/repositories/formDefaults.ts';

/**
 * Route inventory: every `/api` path in `server/app.ts` is listed here, either with
 * the reads workspace B makes against it or with the reason it holds no tenant data.
 * A new mount fails the first test until someone decides how B is kept out of it.
 */

const NO_TENANT_DATA = {
  '/api/': 'The JSON 404 fallback for unknown API paths.',
  '/api/auth': 'Sign-in and the caller\'s own identity; the account row yields the workspace.',
  '/api/health': 'Liveness and database reachability only.',
  '/api/whatsapp/webhook': 'Provider callback without a session; it carries no tenant rows.',
  '/api/cron/schedule': 'A write; its platform gate is proved in verify-tenant-isolation.',
  '/api/documents/:id/file': 'A write; the record is looked up through the caller\'s scope first.',
};

/** `ids` are legacy row ids; a probe is a URL or [URL, status, headers]; every probe runs as B and must neither fail nor reveal legacy data. */
const PROBES = {
  '/api/companies': ids => ['/api/companies', [`/api/companies/${ids.company}`, 404]],
  '/api/ministries': () => ['/api/ministries'],
  '/api/document-types': ids => ['/api/document-types', [`/api/document-types/${ids.type}`, 404]],
  '/api/positions': () => ['/api/positions'],
  '/api/employees': ids => ['/api/employees', [`/api/employees/${ids.employee}`, 404]],
  '/api/documents': ids => ['/api/documents', [`/api/documents/${ids.document}`, 404]],
  '/api/files': ids => [[`/api/files/${ids.document}`, 404], [`/api/files/${ids.document}/download`, 404],
    [`/api/files/${ids.document}/preview`, 404], [`/api/files/employees/${ids.employee}/photo`, 404]],
  '/api/email': () => ['/api/email/log', '/api/email/status', '/api/email/expiry-preview'],
  '/api/backup': () => ['/api/backup/export'],
  '/api/settings': () => ['/api/settings'],
  '/api/cron/status': () => ['/api/cron/status'],
  '/api/form-defaults': () => ['/api/form-defaults/documents'],
  '/api/document-drafts': () => [['/api/document-drafts/new', 200, { 'x-draft-account': 'admin-b' }]],
  // catalog, candidates and models list a provider's models over the network; they read no tenant rows.
  '/api/document-extraction': () => ['/api/document-extraction/status'],
  '/api/whatsapp': () => [['/api/whatsapp/recipients', 404], ['/api/whatsapp/log', 404], ['/api/whatsapp/status', 404]],
};

const LEGACY_MARKER = 'legacy-only@example.invalid';

test('every /api path in app.ts is in the inventory', () => {
  const source = fs.readFileSync('server/app.ts', 'utf8');
  const mounted = [...new Set([...source.matchAll(/'(\/api\/[^']*)'/g)].map(match => match[1]))];
  const unlisted = mounted.filter(route => !(route in PROBES) && !(route in NO_TENANT_DATA));
  assert.deepEqual(unlisted, [], 'decide how workspace B is kept out of these routes');
  const stale = [...Object.keys(PROBES), ...Object.keys(NO_TENANT_DATA)].filter(route => !mounted.includes(route));
  assert.deepEqual(stale, [], 'inventory entries without a mount');
});

test('no read route reveals legacy rows, settings or logs to workspace B', () => reminderApi(async f => {
  const b = addWorkspaceB(f);
  setSetting(f.db, LEG, 'email.recipients', [LEGACY_MARKER]);
  writeEmailLog(f.db, LEG, { kind: 'expiry_report', recipients: [LEGACY_MARKER], subject: 'Legacy only', status: 'sent', triggerSource: 'cron' });
  rememberSubmission(f.db, LEG, 'admin', 'documents', { title: 'Legacy remembered', company_id: f.company.id, document_type_id: f.type.id });
  const ids = { company: f.company.id, type: f.type.id, employee: f.employee.id, document: f.document.id };
  const markers = [...Object.values(ids), LEGACY_MARKER, 'Legacy remembered', 'admin@example.invalid', 'شركة اختبار', 'موظف اختبار', 'وثيقة اختبار'];

  for (const [mount, probes] of Object.entries(PROBES)) {
    for (const probe of probes(ids)) {
      const [url, expected, headers] = Array.isArray(probe) ? probe : [probe, 200];
      const response = await asB(f, url, { headers });
      assert.equal(response.status, expected, `${url} (${mount}) answered ${response.status}: ${JSON.stringify(response.json).slice(0, 200)}`);
      const body = JSON.stringify(response.json);
      // A 404 may echo the id B itself asked for; that reveals nothing B did not already send.
      for (const marker of markers.filter(value => !url.includes(value))) assert.equal(body.includes(marker), false, `${url} revealed legacy data: ${marker}`);
    }
  }

  // The scan above would pass if B saw nothing at all; B must see its own rows, and the boundary holds both ways.
  assert.ok(JSON.stringify((await asB(f, '/api/documents')).json).includes(b.document.id), 'B lists its own document');
  assert.equal((await f.request(`/api/documents/${b.document.id}`)).status, 404, "legacy cannot reach B's document");
}));

/** Gives the legacy document and employee real files, so a 404 for B means scoping, not a missing file. */
function plantLegacyFiles(f) {
  const files = { document: '2026/01/legacy-route.pdf', photo: '2026/01/legacy-photo.png' };
  for (const rel of Object.values(files)) { fs.mkdirSync(path.dirname(f.storage.resolve(rel)), { recursive: true }); fs.writeFileSync(f.storage.resolve(rel), '%PDF-1.4 synthetic'); }
  f.db.prepare("UPDATE documents SET file_path=?,file_name='legacy-route.pdf',mime_type='application/pdf' WHERE id=?").run(files.document, f.document.id);
  f.db.prepare("UPDATE employees SET photo_path=?,photo_mime_type='image/png' WHERE id=?").run(files.photo, f.employee.id);
}

test('legacy files open for their own workspace and stay hidden from B', () => reminderApi(async f => {
  addWorkspaceB(f); plantLegacyFiles(f);
  for (const url of [`/api/files/${f.document.id}`, `/api/files/${f.document.id}/download`, `/api/files/employees/${f.employee.id}/photo`]) {
    assert.equal((await f.request(url)).status, 200, `legacy reads its own ${url}`);
    assert.equal((await asB(f, url)).status, 404, `B cannot read ${url}`);
  }
}));

test('no write route lets B change, delete or reference legacy rows', () => reminderApi(async f => {
  const b = addWorkspaceB(f); plantLegacyFiles(f);
  const legacyState = () => JSON.stringify(['companies', 'employees', 'documents', 'document_types']
    .map(table => f.db.prepare(`SELECT * FROM "${table}" WHERE workspace_id='ws_legacy' ORDER BY id`).all()));
  const before = legacyState();
  const attempts = [
    ['PATCH', `/api/documents/${f.document.id}`, { title: 'Changed by B' }],
    ['DELETE', `/api/documents/${f.document.id}`],
    ['PATCH', `/api/employees/${f.employee.id}`, { name: 'Changed by B' }],
    ['DELETE', `/api/employees/${f.employee.id}`],
    ['PATCH', `/api/companies/${f.company.id}`, { name: 'Changed by B' }],
    ['DELETE', `/api/document-types/${f.type.id}`],
    ['PUT', `/api/documents/${f.document.id}/file`, { upload_id: 'synthetic-upload' }],
    ['POST', '/api/documents', { title: 'Points at legacy', employee_id: f.employee.id, document_type_id: f.type.id }],
    ['POST', '/api/employees', { name: 'Points at legacy', company_id: f.company.id }],
    ['PATCH', `/api/documents/${b.document.id}`, { employee_id: f.employee.id }],
    ['POST', '/api/whatsapp/jobs/synthetic/retry', {}],
  ];
  for (const [method, url, body] of attempts) {
    const response = await asB(f, url, { method, body });
    assert.equal(response.status, 404, `${method} ${url} answered ${response.status}: ${JSON.stringify(response.json).slice(0, 160)}`);
  }
  assert.equal(legacyState(), before, 'legacy rows are unchanged');
  assert.equal(f.db.prepare("SELECT count(*) n FROM documents WHERE workspace_id='ws_b' AND title='Points at legacy'").get().n, 0);
  assert.equal(f.db.prepare("SELECT count(*) n FROM employees WHERE workspace_id='ws_b' AND name='Points at legacy'").get().n, 0);
  assert.equal(f.db.prepare('SELECT employee_id FROM documents WHERE id=?').get(b.document.id).employee_id, b.employee.id);
  // Control: the same write succeeds for the row's own workspace, so the 404s above are the boundary, not a guard on every write.
  assert.equal((await f.request(`/api/companies/${f.company.id}`, { method: 'PATCH', body: { name: 'Legacy edit' } })).status, 200);
}));
