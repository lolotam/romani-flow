import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { createApp } from '../server/app.ts';
import { loadConfig } from '../server/config.ts';
import { runMigrations } from '../server/db/migrator.ts';
import { signSession } from '../server/middleware/auth.ts';
import { StorageService } from '../server/services/storageService.ts';
import { DocumentService } from '../server/services/documentService.ts';
import { CronService } from '../server/services/cronService.ts';
import { pairingConfiguration, readPairingConfig } from '../server/whatsapp/config.ts';
import { createServer as createViteServer } from 'vite';

// Synthetic loopback provider only; no .env, production accounts or real QR scan.
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jGDkAAAAASUVORK5CYII=';
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const stop = server => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });

async function fixture(run, overrides = {}) {
  const apiKey = randomBytes(32).toString('hex');
  const webhookSecret = randomBytes(32).toString('hex');
  const curemedKey = randomBytes(32).toString('hex');
  const calls = [];
  const mode = { state: 'close', instance: 'romani-fixture', qr: PNG, status: 200, delay: 0, redirect: false, oversized: false, connectResponse: null, errorBody: false };
  const provider = http.createServer(async (req, res) => {
    calls.push({ path: req.url, method: req.method, authorized: req.headers.apikey === apiKey });
    // Emulate a project-scoped provider boundary; Curemed key cannot read Romani.
    if (req.headers.apikey !== apiKey || !req.url.endsWith('/romani-fixture')) { res.writeHead(403); res.end('not allowed'); return; }
    if (mode.delay) await new Promise(resolve => setTimeout(resolve, mode.delay));
    if (mode.redirect) { res.writeHead(302, { location: '/instance/connectionState/curemed' }); res.end(); return; }
    res.writeHead(mode.status, { 'content-type': 'application/json' });
    if (mode.status !== 200) { res.end(JSON.stringify({ apikey: apiKey, session: 'must-not-leak' })); return; }
    if (mode.oversized) { res.end(JSON.stringify({ base64: 'a'.repeat(410_000) })); return; }
    if (mode.errorBody) { res.end(JSON.stringify({ error: 'must-not-leak', instance: { instanceName: mode.instance, state: 'open' } })); return; }
    if (req.url.includes('/connectionState/')) res.end(JSON.stringify({ instance: { instanceName: mode.instance, state: mode.state }, apikey: apiKey, chats: ['must-not-leak'] }));
    else if (req.url.includes('/connect/')) res.end(JSON.stringify(mode.connectResponse ?? { base64: mode.qr, code: 'must-not-leak', pairingCode: 'must-not-leak', apikey: apiKey }));
    else { res.end('{}'); }
  });
  await listen(provider);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'romani-pairing-'));
  const config = loadConfig({ NODE_ENV: 'test', JWT_SECRET: randomBytes(32).toString('hex'),
    ROMANI_EVOLUTION_URL: `http://127.0.0.1:${provider.address().port}/api`, ROMANI_EVOLUTION_API_KEY: apiKey,
    ROMANI_EVOLUTION_INSTANCE: 'romani-fixture', ROMANI_EVOLUTION_WEBHOOK_SECRET: webhookSecret, ...overrides });
  const db = new DatabaseSync(path.join(dir, 'romani.db'));
  db.exec('PRAGMA foreign_keys=ON'); runMigrations(db, path.resolve('server/db/migrations'));
  for (const role of ['admin', 'viewer']) db.prepare(`INSERT INTO admin_users
    (id,email,name,role,password_hash,created_at,updated_at) VALUES(?,?,?,?,?,?,?)`)
    .run(role, `${role}@example.invalid`, 'Synthetic', role, 'no-password-login-used', '2026-01-01', '2026-01-01');
  const mailer = { isConfigured: () => false };
  const storage = new StorageService(path.join(dir, 'uploads')); storage.ensureDirectories();
  const cron = new CronService(db, mailer);
  const app = createApp({ config, db, mailer, cron, storage, documents: new DocumentService(db, storage), staticDir: dir });
  const server = http.createServer(app); await listen(server);
  const base = `http://127.0.0.1:${server.address().port}`;
  const cookie = (role = 'admin', cfg = config) => `${config.cookieName}=${signSession(cfg, { id: role, role, name: 'Synthetic', email: `${role}@example.invalid` })}`;
  const request = async (url, { method = 'GET', body, role = 'admin', headers = {}, session } = {}) => {
    const res = await fetch(base + url, { method, headers: { ...(role ? { cookie: session ?? cookie(role) } : {}),
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    const json = await res.json();
    assert.ok(!JSON.stringify(json).includes(apiKey)); assert.ok(!JSON.stringify(json).includes(webhookSecret));
    assert.ok(!JSON.stringify(json).includes('must-not-leak'));
    return { status: res.status, headers: res.headers, json };
  };
  try { await run({ request, config, db, mode, calls, cookie, webhookSecret, curemedKey, base }); }
  finally { cron.stop(); await stop(server); await stop(provider); db.close(); fs.rmSync(dir, { recursive: true, force: true }); }
}

test('optional pairing is absent by default; wrong project and shared secret config fail closed', () => {
  assert.equal(pairingConfiguration(readPairingConfig({})), 'absent');
  const valid = { url: 'http://service:8080/api', apiKey: randomBytes(32).toString('hex'), instance: 'romani-fixture', webhookSecret: randomBytes(32).toString('hex') };
  assert.equal(pairingConfiguration(valid), 'valid');
  for (const instance of ['curemed', '../curemed', 'romani/../curemed', 'romani?instance=curemed', '']) assert.equal(pairingConfiguration({ ...valid, instance }), 'invalid');
  for (const url of ['file:///etc/passwd', 'http://user:key@service/', 'http://service/?apikey=secret', 'http://service/#x']) assert.equal(pairingConfiguration({ ...valid, url }), 'invalid');
  assert.equal(pairingConfiguration({ ...valid, webhookSecret: valid.apiKey }), 'invalid');
});

test('absent config preserves status and makes no provider calls', () => fixture(async f => {
  const r = await f.request('/api/whatsapp/status');
  assert.equal(r.status, 200); assert.deepEqual(r.json.data, { configured: false, state: 'unconfigured' });
  assert.equal((await f.request('/api/whatsapp/connect', { method: 'POST', body: {} })).status, 503);
  assert.equal(f.calls.length, 0);
}, { ROMANI_EVOLUTION_URL: '', ROMANI_EVOLUTION_API_KEY: '', ROMANI_EVOLUTION_INSTANCE: '', ROMANI_EVOLUTION_WEBHOOK_SECRET: '' }));

test('unauthenticated, viewer, foreign-project JWT and demoted account cannot contact provider', () => fixture(async f => {
  const foreign = { ...f.config, jwtSecret: randomBytes(32).toString('hex') };
  const before = f.db.prepare('SELECT total_changes() n').get().n;
  for (const url of ['/api/whatsapp/status', '/api/whatsapp/connect']) {
    const method = url.endsWith('connect') ? 'POST' : 'GET';
    assert.equal((await f.request(url, { method, role: null })).status, 401);
    assert.equal((await f.request(url, { method, role: 'viewer' })).status, 403);
    const forgedActor = { 'x-role': 'admin', 'x-user-id': 'admin', 'x-project-id': 'romani' };
    assert.equal((await f.request(url, { method, role: null, headers: forgedActor })).status, 401);
    assert.equal((await f.request(url, { method, role: 'viewer', headers: forgedActor })).status, 403);
    assert.equal((await f.request(url, { method, session: f.cookie('admin', foreign) })).status, 401);
  }
  assert.equal(f.db.prepare('SELECT total_changes() n').get().n, before);
  f.db.prepare("UPDATE admin_users SET role='viewer' WHERE id='admin'").run();
  assert.equal((await f.request('/api/whatsapp/status')).status, 403);
  assert.equal(f.calls.length, 0);
}));

test('admin input cannot override project, instance, upstream URL or scoped key', () => fixture(async f => {
  for (const url of ['/api/whatsapp/status?instance=curemed', '/api/whatsapp/status?project=curemed']) assert.equal((await f.request(url)).status, 400);
  for (const body of [{ instance: 'curemed' }, { project: 'curemed', url: 'http://elsewhere' }, [], 'curemed']) {
    assert.equal((await f.request('/api/whatsapp/connect', { method: 'POST', body })).status, 400);
  }
  assert.equal((await f.request('/api/whatsapp/status', { headers: { 'x-project-id': 'curemed' } })).status, 400);
  assert.equal((await f.request('/api/whatsapp/curemed/status')).status, 404);
  assert.equal((await f.request('/api/whatsapp/connect', { method: 'POST', body: {}, headers: { origin: 'https://curemed.example.invalid' } })).status, 403);
  assert.equal(f.calls.length, 0);
}));

test('QR and status use only fixed Romani route and redact all other provider fields', () => fixture(async f => {
  const status = await f.request('/api/whatsapp/status');
  assert.deepEqual(status.json.data, { configured: true, state: 'disconnected' });
  assert.equal(status.headers.get('cache-control'), 'no-store');
  const qr = await f.request('/api/whatsapp/connect', { method: 'POST', body: {} });
  assert.equal(qr.status, 200); assert.equal(qr.headers.get('cache-control'), 'no-store');
  assert.deepEqual(qr.json.data, { configured: true, state: 'connecting', qr: PNG, expiresInSeconds: 60 });
  assert.ok(f.calls.every(c => c.authorized && c.method === 'GET' && c.path.endsWith('/romani-fixture')));
  assert.equal((await f.request('/api/whatsapp/connect', { method: 'POST', body: {} })).status, 429);
}));

test('already-connected session is never reconnected or reset', () => fixture(async f => {
  f.mode.state = 'open';
  assert.deepEqual((await f.request('/api/whatsapp/connect', { method: 'POST', body: {} })).json.data, { configured: true, state: 'connected' });
  assert.equal(f.calls.length, 1); assert.ok(f.calls[0].path.includes('/connectionState/'));
}));

test('simultaneous QR requests have one provider handoff', () => fixture(async f => {
  f.mode.delay = 25;
  const results = await Promise.all([1, 2].map(() => f.request('/api/whatsapp/connect', { method: 'POST', body: {} })));
  assert.deepEqual(results.map(r => r.status).sort(), [200, 429]);
  assert.equal(f.calls.filter(c => c.path.includes('/connect/')).length, 1);
}));

test('missing native state is unknown, and flat QR without identity is still fixed-route bound', () => fixture(async f => {
  for (const state of [undefined, 'native-new-state']) {
    f.mode.state = state;
    assert.equal((await f.request('/api/whatsapp/status')).json.data.state, 'unknown');
  }
  const r = await f.request('/api/whatsapp/connect', { method: 'POST', body: {} });
  assert.equal(r.status, 200); assert.equal(r.json.data.qr, PNG);
}));

test('account opening between status and connect returns connected without requiring a QR', () => fixture(async f => {
  f.mode.connectResponse = { instance: { instanceName: 'romani-fixture', state: 'open' } };
  const r = await f.request('/api/whatsapp/connect', { method: 'POST', body: {} });
  assert.equal(r.status, 200); assert.deepEqual(r.json.data, { configured: true, state: 'connected' });
}));

test('identity present in connect response cannot point to Curemed', () => fixture(async f => {
  f.mode.connectResponse = { instance: { instanceName: 'curemed', state: 'open' } };
  const r = await f.request('/api/whatsapp/connect', { method: 'POST', body: {} });
  assert.equal(r.status, 502); assert.equal(r.json.error.code, 'project_mismatch');
}));

test('provider cross-project payload is denied instead of displayed', () => fixture(async f => {
  f.mode.instance = 'curemed';
  const r = await f.request('/api/whatsapp/connect', { method: 'POST', body: {} });
  assert.equal(r.status, 502); assert.equal(r.json.error.code, 'project_mismatch');
  assert.equal(f.calls.length, 1);
}));

test('top-level QR identity cannot contradict the fixed instance', () => fixture(async f => {
  f.mode.connectResponse = { instanceName: 'curemed', base64: PNG };
  assert.equal((await f.request('/api/whatsapp/connect', { method: 'POST', body: {} })).status, 502);
}));

test('JSON error inside HTTP 200 is not a connected state', () => fixture(async f => {
  f.mode.errorBody = true;
  const r = await f.request('/api/whatsapp/status');
  assert.equal(r.status, 502); assert.equal(r.json.data, null);
}));

test('provider redirect, failure and oversized response stay sanitized', () => fixture(async f => {
  f.mode.redirect = true; assert.equal((await f.request('/api/whatsapp/status')).status, 502);
  assert.equal(f.calls.length, 1); // Redirect to Curemed was not followed.
  f.mode.redirect = false; f.mode.status = 401; assert.equal((await f.request('/api/whatsapp/status')).status, 502);
  f.mode.status = 200; f.mode.oversized = true; assert.equal((await f.request('/api/whatsapp/status')).status, 502);
}));

test('SVG or non-image QR response cannot reach browser', () => fixture(async f => {
  f.mode.qr = 'data:image/svg+xml,<svg onload="alert(1)" />';
  const r = await f.request('/api/whatsapp/connect', { method: 'POST', body: {} });
  assert.equal(r.status, 502); assert.equal(r.json.error.code, 'qr_unavailable');
}));

test('configured Curemed instance is rejected without provider contact', () => fixture(async f => {
  assert.equal((await f.request('/api/whatsapp/status')).status, 503); assert.equal(f.calls.length, 0);
}, { ROMANI_EVOLUTION_INSTANCE: 'curemed' }));

test('a credential belonging to another project cannot produce a Romani QR', () => fixture(async f => {
  f.config.whatsapp.apiKey = f.curemedKey;
  const r = await f.request('/api/whatsapp/connect', { method: 'POST', body: {} });
  assert.equal(r.status, 502); assert.equal(r.json.data, null);
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].authorized, false);
}));

test('webhook rejects foreign project secret/instance and incoming chats with no side effects', () => fixture(async f => {
  const before = f.db.prepare('SELECT total_changes() n').get().n;
  const body = { event: 'connection.update', instance: 'romani-fixture', data: { state: 'open' },
    apikey: f.webhookSecret, sender: 'must-not-leak', server_url: 'must-not-leak', destination: 'must-not-leak' };
  const send = (value, token) => f.request('/api/whatsapp/webhook', { method: 'POST', role: null, body: value, headers: token ? { 'x-romani-webhook-key': token } : {} });
  assert.equal((await send(body)).status, 401);
  assert.equal((await send(body, f.curemedKey)).status, 401);
  assert.equal((await send({ ...body, instance: 'curemed' }, f.webhookSecret)).status, 403);
  assert.equal((await send({ ...body, event: 'messages.upsert' }, f.webhookSecret)).status, 400);
  assert.equal((await send(body, f.webhookSecret)).status, 202);
  assert.equal(f.calls.length, 0); assert.equal(f.db.prepare('SELECT total_changes() n').get().n, before);
}));

test('integration credentials are absent from settings and business export', () => fixture(async f => {
  for (const url of ['/api/settings', '/api/backup/export']) assert.equal((await f.request(url)).status, 200);
  assert.equal(f.calls.length, 0);
}));

test('malformed webhook JSON cannot leak its body to the exception log', () => fixture(async f => {
  const logged = [];
  const original = console.error;
  console.error = (...args) => logged.push(args);
  try {
    const r = await fetch(f.base + '/api/whatsapp/webhook', { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: '{"transientSecret":"synthetic-not-for-logs",' });
    assert.equal(r.status, 400); assert.equal((await r.json()).error.code, 'invalid_body');
    assert.equal(logged.length, 0); assert.equal(f.calls.length, 0);
  } finally { console.error = original; }
}));

test('actual development proxy preserves same-origin pairing and still rejects another site', () => fixture(async f => {
  const vite = await createViteServer({ configFile: path.resolve('vite.config.ts'), mode: 'test', logLevel: 'silent',
    server: { host: '127.0.0.1', port: 0, proxy: { '/api': { target: f.base } } } });
  try {
    await vite.listen();
    const origin = `http://127.0.0.1:${vite.httpServer.address().port}`;
    const post = site => fetch(origin + '/api/whatsapp/connect', { method: 'POST',
      headers: { origin: site, cookie: f.cookie(), 'content-type': 'application/json' }, body: '{}' });
    const own = await post(origin);
    assert.equal(own.status, 200); assert.equal((await own.json()).data.qr, PNG);
    const before = f.calls.length;
    assert.equal((await post('https://curemed.example.invalid')).status, 403);
    assert.equal(f.calls.length, before);
  } finally { await vite.close(); }
}));
