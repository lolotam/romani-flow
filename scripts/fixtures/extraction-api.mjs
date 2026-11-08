import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { createApp } from '../../server/app.ts';
import { loadConfig } from '../../server/config.ts';
import { signSession } from '../../server/middleware/auth.ts';
import { runMigrations } from '../../server/db/migrator.ts';
import { insertRow } from '../../server/repositories/base.ts';
import { setSetting } from '../../server/repositories/settings.ts';
import { Mailer } from '../../server/services/mailer.ts';
import { CronService } from '../../server/services/cronService.ts';
import { StorageService } from '../../server/services/storageService.ts';
import { DocumentService } from '../../server/services/documentService.ts';
import { WhatsAppReminders } from '../../server/notifications/whatsapp/service.ts';
import {
  VALID_PNG_BASE64,
  MOCK_MODEL_ID,
  MOCK_ENDPOINT_TAG,
  MOCK_GROQ_MODEL_ID,
  MOCK_GROQ_ENDPOINT,
  makeMockModel,
  makeMockEndpoint,
  makeMockZdr,
  makeMockByok,
  makeMockApproval,
  makeMockGroqApproval,
  makeMockGroqModels,
  makeRawPage,
} from './extraction-data.mjs';

import { settingsVersion } from '../../server/extraction/policy.ts';
import { readCatalogs } from '../../server/extraction/catalog.ts';

/**
 * Loopback extraction API test fixture.
 *
 * Implements real in-memory SQLite, synthetic admin/viewer accounts with valid
 * draft scopes, disabled external notification transports, explicit config, loopback
 * Express, injected extraction transport, deterministic operation barriers, and strict egress interception.
 */
export async function extractionApi(run, options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'romani-ext-api-'));
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys=ON');
  runMigrations(db, path.resolve('server/db/migrations'));

  // Seed standard admin and viewer users
  for (const role of ['admin', 'viewer']) {
    db.prepare(
      "INSERT INTO admin_users(id, email, name, role, password_hash, created_at, updated_at) VALUES(?, ?, ?, ?, ?, '2026-01-01', '2026-01-01')"
    ).run(role, `${role}@example.invalid`, `Synthetic ${role}`, role, 'not-a-login-fixture');
  }

  // Seed baseline company, document draft scope and catalogs
  const company = insertRow(db, 'companies', { name: 'Synthetic Company', name_ar: 'شركة اختبار' });
  insertRow(db, 'document_types', { id: 'type-civil-id', name: 'Civil ID', name_ar: 'البطاقة المدنية' });
  insertRow(db, 'ministries', { id: 'min-moi', name: 'Ministry of Interior', name_ar: 'وزارة الداخلية' });

  const validScope = `company:${company.id}`;
  const seedDraftScope = (userId, scope = validScope, revision = globalThis.crypto.randomUUID()) => {
    db.prepare(
      "INSERT OR REPLACE INTO document_drafts(user_id, scope, revision, values_json, updated_at) VALUES(?, ?, ?, ?, ?)"
    ).run(userId, scope, revision, JSON.stringify({}), '2026-01-01T00:00:00.000Z');
  };
  seedDraftScope('admin', validScope);

  const seedUser = (id, role = 'admin') => {
    db.prepare(
      "INSERT OR REPLACE INTO admin_users(id, email, name, role, password_hash, created_at, updated_at) VALUES(?, ?, ?, ?, ?, '2026-01-01', '2026-01-01')"
    ).run(id, `${id}@example.invalid`, `Synthetic ${id}`, role, 'hash');
    seedDraftScope(id, validScope);
  };

  // Disable external notification transports
  setSetting(db, 'whatsapp.enabled', false);
  setSetting(db, 'email.enabled', false);

  // Seed extraction settings
  const enabled = options.enabled ?? false;
  const provider = options.provider ?? (enabled ? 'openrouter' : '');
  const model = options.model ?? (enabled ? (provider === 'groq' ? MOCK_GROQ_MODEL_ID : MOCK_MODEL_ID) : '');
  setSetting(db, 'ai_extraction.enabled', enabled);
  setSetting(db, 'ai_extraction.provider', provider);
  setSetting(db, 'ai_extraction.model', model);

  // Set up explicit extraction config (never trust default process.env)
  const context = options.context ?? 'kw-docs';
  const authorized = options.authorized ?? false;

  const defaultApprovals = options.approvals ?? [
    provider === 'groq'
      ? makeMockGroqApproval({ model: model || MOCK_GROQ_MODEL_ID })
      : makeMockApproval({
          model: model || MOCK_MODEL_ID,
          endpoint: options.endpoint ?? MOCK_ENDPOINT_TAG,
        }),
  ];

  const config = loadConfig({
    NODE_ENV: 'test',
    JWT_SECRET: randomBytes(32).toString('hex'),
    DATA_DIR: dir,
    ...(options.env || {}),
  });

  config.extraction = {
    authorized,
    context,
    groqKey: options.groqKey !== undefined ? options.groqKey : (provider === 'groq' ? 'mock-groq-key' : null),
    openRouterKey:
      options.openRouterKey !== undefined
        ? options.openRouterKey
        : (provider === 'openrouter' ? 'mock-openrouter-key' : null),
    groqFreeAccount: options.groqFreeAccount ?? true,
    dataControlsApproved: options.dataControlsApproved ?? true,
    openRouterNoByok: options.openRouterNoByok ?? true,
    openRouterZdrOnly: options.openRouterZdrOnly ?? true,
    approvals: defaultApprovals,
  };

  let deferred = Boolean(options.deferTransport);
  const calls = [];
  const deferredResolvers = [];
  const callWaiters = [];
  const settlementWaiters = [];

  const release = () => {
    deferred = false;
    while (deferredResolvers.length > 0) {
      const item = deferredResolvers.shift();
      item.resolve();
    }
  };

  const waitForTransportCall = (predicate = () => true, timeoutMs = 2000) => {
    const existing = calls.find(predicate);
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      let waiter;
      const timer = setTimeout(() => {
        const idx = callWaiters.indexOf(waiter);
        if (idx !== -1) callWaiters.splice(idx, 1);
        reject(new Error(`Timeout waiting for transport call after ${timeoutMs}ms`));
      }, timeoutMs);
      waiter = (call) => {
        if (predicate(call)) {
          clearTimeout(timer);
          resolve(call);
          return true;
        }
        return false;
      };
      callWaiters.push(waiter);
    });
  };

  const waitForTransportSettlement = (predicate = () => true, timeoutMs = 2000) => {
    const existing = calls.find((c) => c.settled && predicate(c));
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      let waiter;
      const timer = setTimeout(() => {
        const idx = settlementWaiters.indexOf(waiter);
        if (idx !== -1) settlementWaiters.splice(idx, 1);
        reject(new Error(`Timeout waiting for transport settlement after ${timeoutMs}ms`));
      }, timeoutMs);
      waiter = (call) => {
        if (call.settled && predicate(call)) {
          clearTimeout(timer);
          resolve(call);
          return true;
        }
        return false;
      };
      settlementWaiters.push(waiter);
    });
  };

  // Injected extraction transport (spy)
  const extractionTransport = async (url, init = {}) => {
    const callRecord = {
      url,
      init,
      timestamp: Date.now(),
      settled: false,
      aborted: false,
      error: null,
      response: null,
    };
    calls.push(callRecord);

    for (let i = callWaiters.length - 1; i >= 0; i--) {
      if (callWaiters[i](callRecord)) {
        callWaiters.splice(i, 1);
      }
    }

    try {
      if (deferred) {
        await new Promise((resolve, reject) => {
          let onAbort;
          const item = {
            resolve: () => {
              if (init.signal && onAbort) {
                init.signal.removeEventListener('abort', onAbort);
              }
              resolve();
            },
            reject: (err) => {
              if (init.signal && onAbort) {
                init.signal.removeEventListener('abort', onAbort);
              }
              reject(err);
            },
          };
          if (init.signal) {
            if (init.signal.aborted) {
              reject(init.signal.reason || new DOMException('The operation was aborted', 'AbortError'));
              return;
            }
            onAbort = () => {
              const idx = deferredResolvers.indexOf(item);
              if (idx !== -1) deferredResolvers.splice(idx, 1);
              reject(init.signal.reason || new DOMException('The operation was aborted', 'AbortError'));
            };
            init.signal.addEventListener('abort', onAbort, { once: true });
          }
          deferredResolvers.push(item);
        });
      }

      if (typeof options.transport === 'function') {
        const res = await options.transport(url, init);
        callRecord.response = res;
        return res;
      }
      if (typeof options.mockResponse === 'function') {
        const res = await options.mockResponse(url, init);
        callRecord.response = res;
        return res;
      }

    // Exact URL and envelope matching
    if (url === 'https://api.groq.com/openai/v1/models') {
      return new Response(JSON.stringify(makeMockGroqModels()), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (url === 'https://api.groq.com/openai/v1/chat/completions') {
      let pageCount = 1;
      try {
        const body = JSON.parse(init.body);
        const userMsg = body.messages?.find((m) => m.role === 'user');
        const images = userMsg?.content?.filter((c) => c.type === 'image_url') ?? [];
        if (images.length > 0) pageCount = images.length;
      } catch {}
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  pages: Array.from({ length: pageCount }, (_, i) => makeRawPage(i + 1)),
                }),
              },
              finish_reason: 'stop',
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    }
    if (url === 'https://openrouter.ai/api/v1/models') {
      return new Response(JSON.stringify({ data: [makeMockModel(options.modelOverrides ?? {})] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (url.startsWith('https://openrouter.ai/api/v1/models/') && url.endsWith('/endpoints')) {
      const modelId = model || MOCK_MODEL_ID;
      return new Response(
        JSON.stringify({
          data: {
            id: modelId,
            endpoints: [
              {
                model_id: modelId,
                tag: options.endpoint ?? MOCK_ENDPOINT_TAG,
                status: 0,
                pricing: {
                  prompt: '0',
                  completion: '0',
                  image: '0',
                  request: '0',
                },
              },
            ],
          },
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }
      );
    }
    if (url === 'https://openrouter.ai/api/v1/endpoints/zdr') {
      const modelId = model || MOCK_MODEL_ID;
      return new Response(
        JSON.stringify({
          data: [
            {
              model_id: modelId,
              tag: options.endpoint ?? MOCK_ENDPOINT_TAG,
              status: 0,
              safety_retention: false,
            },
          ],
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }
      );
    }
    if (url.startsWith('https://openrouter.ai/api/v1/byok')) {
      return new Response(JSON.stringify(makeMockByok()), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (url === 'https://openrouter.ai/api/v1/chat/completions') {
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: { content: JSON.stringify({ pages: [makeRawPage(1)] }) },
              finish_reason: 'stop',
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    }

    throw new Error('unexpected_provider_url: ' + url);
    } catch (err) {
      callRecord.error = err;
      if (init.signal?.aborted) {
        callRecord.aborted = true;
      }
      throw err;
    } finally {
      callRecord.settled = true;
      for (let i = settlementWaiters.length - 1; i >= 0; i--) {
        if (settlementWaiters[i](callRecord)) {
          settlementWaiters.splice(i, 1);
        }
      }
    }
  };

  let base;

  // Guard globalThis.fetch so no non-loopback calls can escape
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const target = new URL(urlStr);
    if (base && target.origin === base && !target.username && !target.password) {
      return originalFetch(input, init);
    }
    throw new Error('external_inference_forbidden: ' + urlStr);
  };

  // Intercept logs
  const logs = [];
  const originalLog = console.log;
  const originalWarn = console.warn;
  const originalError = console.error;
  console.log = (...args) => logs.push({ level: 'info', message: args.join(' ') });
  console.warn = (...args) => logs.push({ level: 'warn', message: args.join(' ') });
  console.error = (...args) => logs.push({ level: 'error', message: args.join(' ') });

  const mailer = new Mailer(config);
  const cron = new CronService(db, mailer);
  const storage = new StorageService(config.uploadsDir);
  storage.ensureDirectories();

  const sendTextCalls = [];
  const defaultWhatsAppTransport = {
    status: async () => ({ configured: false, state: 'disconnected' }),
    sendText: async (...args) => {
      sendTextCalls.push(args);
      return { kind: 'permanent_failed', error: 'disabled' };
    },
  };
  const baseWhatsAppTransport = options.whatsappTransport ?? options.reminderTransport ?? defaultWhatsAppTransport;
  const whatsappTransport = {
    status: (...args) => baseWhatsAppTransport.status(...args),
    sendText: async (...args) => {
      sendTextCalls.push(args);
      return baseWhatsAppTransport.sendText(...args);
    },
  };

  const reminders = new WhatsAppReminders(
    db,
    'romani',
    whatsappTransport,
    () => new Date('2026-01-01T00:00:00Z')
  );

  const documents = new DocumentService(db, storage);

  const app = createApp({
    config,
    db,
    mailer,
    cron,
    storage,
    documents,
    reminders,
    staticDir: dir,
    extractionTransport,
    extractionClock: options.clock ?? {
      now: () => Date.parse('2026-11-08T00:00:00Z'),
      setTimeout: (callback, ms) => setTimeout(callback, ms),
      clearTimeout: timer => clearTimeout(timer),
    },
    ...(options.decoderFactory ? { decoderFactory: options.decoderFactory } : {}),
  });

  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + server.address().port;

  const request = async (
    url,
    { method = 'GET', body, userId = 'admin', role = 'admin', headers = {}, signal } = {}
  ) => {
    const cookie =
      userId !== null
        ? {
            cookie:
              config.cookieName +
              '=' +
              signSession(config, {
                id: userId,
                name: `Synthetic ${userId}`,
                email: `${userId}@example.invalid`,
                role: role ?? 'admin',
              }),
          }
        : {};

    const reqHeaders = {
      ...cookie,
      ...(body !== undefined && !headers['content-type'] ? { 'content-type': 'application/json' } : {}),
      ...headers,
    };

    const payload =
      body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body);

    const res = await originalFetch(base + url, {
      method,
      headers: reqHeaders,
      body: payload,
      signal,
    });

    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      json = text;
    }

    return {
      status: res.status,
      json,
      text,
      headers: res.headers,
    };
  };

  const validRequest = {
    requestId: '12345678-1234-4234-8234-123456789abc',
    scope: validScope,
    context: config.extraction.context,
    settingsVersion: settingsVersion(db, config),
    catalogVersion: readCatalogs(db).version,
    pageCount: 1,
    images: [{ page: 1, mime: 'image/png', base64: VALID_PNG_BASE64 }],
  };

  try {
    return await run({
      request,
      db,
      calls,
      config,
      release,
      logs,
      validRequest,
      base,
      server,
      app,
      documents,
      storage,
      seedDraftScope,
      seedUser,
      waitForTransportCall,
      waitForTransportSettlement,
      validScope,
      reminders,
      coordinator: reminders.coordinator,
      whatsappTransport,
      sendTextCalls,
    });
  } finally {
    globalThis.fetch = originalFetch;
    console.log = originalLog;
    console.warn = originalWarn;
    console.error = originalError;
    release();

    await cron.shutdown();
    await reminders.stop();
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    db.close();

    if (!dir.startsWith(path.join(os.tmpdir(), 'romani-ext-api-'))) {
      throw new Error('Unsafe fixture cleanup');
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
