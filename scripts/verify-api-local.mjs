#!/usr/bin/env node
/**
 * Isolated loopback API runner.
 *
 * Boots an in-memory SQLite database, runs migrations, seeds synthetic catalogs
 * and an ephemeral admin user, mounts a loopback Express server with stubbed
 * mailer and notification transports, and runs scripts/verify-api.mjs without
 * external egress or reading .env.
 */

import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import bcrypt from 'bcryptjs';

import { createApp } from '../server/app.ts';
import { loadConfig } from '../server/config.ts';
import { runMigrations } from '../server/db/migrator.ts';
import { insertRow } from '../server/repositories/base.ts';
import { setSetting } from '../server/repositories/settings.ts';
import { CronService } from '../server/services/cronService.ts';
import { StorageService } from '../server/services/storageService.ts';
import { DocumentService } from '../server/services/documentService.ts';
import { WhatsAppReminders } from '../server/notifications/whatsapp/service.ts';

async function main() {
  let tempDir = null;
  let db = null;
  let cron = null;
  let server = null;
  let exitCode = 1;

  try {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'romani-api-local-'));
    const uploadsDir = path.join(tempDir, 'uploads');

    db = new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys = ON;');
    runMigrations(db, path.resolve('server/db/migrations'));

    const storage = new StorageService(uploadsDir);
    storage.ensureDirectories();

    // Synthetic ephemeral admin credentials (never committed, never read from .env)
    const adminEmail = `admin_local_${randomBytes(4).toString('hex')}@synthetic.invalid`;
    const adminPass = `TestPass_${randomBytes(8).toString('hex')}!123`;
    const adminHash = await bcrypt.hash(adminPass, 10);

    insertRow(db, 'admin_users', {
      id: 'admin_local_id',
      email: adminEmail,
      name: 'Synthetic Local Admin',
      role: 'admin',
      is_active: 1,
      password_hash: adminHash,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    });

    // Catalogs
    const comp1 = insertRow(db, 'companies', {
      name: 'Acme Kuwait Trading',
      name_ar: 'شركة أكمي للتجارة',
      description: 'First test company',
    });
    const comp2 = insertRow(db, 'companies', {
      name: 'Gulf Solutions Co',
      name_ar: 'شركة حلول الخليج',
      description: 'Second test company',
    });

    insertRow(db, 'ministries', {
      id: 'min-moi',
      name: 'Ministry of Interior',
      name_ar: 'وزارة الداخلية',
    });
    insertRow(db, 'ministries', {
      id: 'min-mol',
      name: 'Ministry of Labour',
      name_ar: 'وزارة الشؤون الاجتماعية والعمل',
    });

    insertRow(db, 'document_types', {
      id: 'type-civil-id',
      name: 'Civil ID',
      name_ar: 'البطاقة المدنية',
    });
    insertRow(db, 'document_types', {
      id: 'type-passport',
      name: 'Passport',
      name_ar: 'جواز السفر',
    });

    insertRow(db, 'positions', {
      id: 'pos-mgr',
      name: 'Manager',
      name_ar: 'مدير',
      value: 'مدير',
    });
    insertRow(db, 'positions', {
      id: 'pos-acc',
      name: 'Accountant',
      name_ar: 'محاسب',
      value: 'محاسب',
    });
    insertRow(db, 'positions', {
      id: 'pos-eng',
      name: 'Engineer',
      name_ar: 'مهندس',
      value: 'مهندس',
    });

    // Seed >= 20 employees with Arabic names (some containing 'م'), alternating companies and positions
    const employeeNames = [
      'محمد أحمد الصباح',
      'محمود علي حسين',
      'مريم سالم الكندري',
      'مصطفى كمال الدين',
      'ماجد ناصر العتيبي',
      'منصور فهد الرشيدي',
      'منى إبراهيم الدوسري',
      'مهدي صالح المطيري',
      'مختار عبد الله السبيعي',
      'مسعود حمد الهاجري',
      'علي حسن الخالد',
      'أحمد بدر العازمي',
      'فاطمة جاسم القحطاني',
      'سارة خليل الظفيري',
      'يوسف يعقوب الفضلي',
      'عبد العزيز سعود الصقر',
      'خالد وليد الشمري',
      'عمر فاروق البابطين',
      'طلال حمود الخرافي',
      'طارق زياد الغانم',
      'بدر ناصر الملا',
      'فيصل عبد الرحمن الصانع',
    ];

    const employees = [];
    for (let i = 0; i < employeeNames.length; i++) {
      const isComp1 = i < 12;
      const pos = i % 3 === 0 ? 'مدير' : i % 3 === 1 ? 'محاسب' : 'مهندس';
      const posId = i % 3 === 0 ? 'pos-mgr' : i % 3 === 1 ? 'pos-acc' : 'pos-eng';

      const emp = insertRow(db, 'employees', {
        company_id: isComp1 ? comp1.id : comp2.id,
        name: employeeNames[i],
        phone: `+965 9000${String(i).padStart(4, '0')}`,
        mobile_no: `+965 9000${String(i).padStart(4, '0')}`,
        email: `emp${i}@synthetic.invalid`,
        hire_date: '2023-01-01',
        civil_id_no: `2900101${String(i).padStart(5, '0')}`,
        position: pos,
        position_id: posId,
        is_active: 1,
        driving_license: i % 2 === 0 ? 1 : 0,
        driving_license_expiry_date: '2027-01-01',
        residency_expiry_date: '2026-12-31',
      });
      employees.push(emp);
    }

    // Seed at least one document for testing patch, derived status, and relations
    insertRow(db, 'documents', {
      id: 'doc-verify-seed',
      title: 'Civil ID Card',
      status: 'valid',
      expiry_date: '2028-12-31',
      document_type_id: 'type-civil-id',
      company_id: comp1.id,
      employee_id: employees[0].id,
      notes: 'Initial test note',
    });

    // Settings
    setSetting(db, 'cron.enabled', 'true');
    setSetting(db, 'cron.schedule', '0 8 * * *');
    setSetting(db, 'cron.include_employees', 'true');
    setSetting(db, 'cron.include_documents', 'true');
    setSetting(db, 'email.enabled', 'true');
    setSetting(db, 'email.recipients', '["admin@synthetic.invalid"]');
    setSetting(db, 'email.notification_intervals', '["30", "60", "90"]');

    // Stub mailer
    const stubMailer = {
      isConfigured: () => true,
      verify: async () => ({ ok: true, message: 'stub smtp verified' }),
      send: async (msg) => ({
        status: 'sent',
        messageId: `stub-${Date.now()}`,
        accepted: Array.isArray(msg.to) ? msg.to : [msg.to],
        rejected: [],
      }),
    };

    cron = new CronService(db, stubMailer);
    cron.reschedule();

    const documents = new DocumentService(db, storage);

    const whatsappTransport = {
      status: async () => ({ configured: false, state: 'disconnected' }),
      sendText: async () => ({ kind: 'permanent_failed', error: 'disabled' }),
    };

    const reminders = new WhatsAppReminders(
      db,
      'romani',
      whatsappTransport,
      () => new Date('2026-01-01T00:00:00Z')
    );

    const config = loadConfig({
      NODE_ENV: 'test',
      JWT_SECRET: randomBytes(32).toString('hex'),
      DATA_DIR: tempDir,
      UPLOADS_DIR: uploadsDir,
    });

    const extractionTransport = async (url) => {
      throw new Error(`External extraction egress forbidden: ${url}`);
    };

    const app = createApp({
      config,
      db,
      mailer: stubMailer,
      cron,
      storage,
      documents,
      reminders,
      staticDir: tempDir,
      extractionTransport,
    });

    server = http.createServer((req, res) => {
      if (req.url === '/test-owned-redirect-disallowed') {
        res.writeHead(302, { Location: 'https://example.invalid/disallowed-target' });
        res.end();
        return;
      }
      app(req, res);
    });
    await new Promise((resolve, reject) => {
      server.listen(0, '127.0.0.1', () => resolve());
      server.on('error', reject);
    });

    const { port } = server.address();
    const apiUrl = `http://127.0.0.1:${port}`;

    console.log(`[verify-api-local] Loopback server listening at ${apiUrl}`);
    console.log(`[verify-api-local] Spawning scripts/verify-api.mjs with synthetic credentials...\n`);

    // Create owned bootstrap script inside owned tempDir to enforce exact loopback origin and redirect guards
    const bootstrapPath = path.join(tempDir, 'bootstrap-verifier.mjs');
    const bootstrapCode = `
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

const targetOrigin = process.env.API_URL;
if (!targetOrigin) {
  console.error('[GUARD ERROR] API_URL missing in child environment');
  process.exit(1);
}

const originalFetch = globalThis.fetch;

// Exact loopback origin and redirect guard on child fetch
globalThis.fetch = async (input, init = {}) => {
  const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const url = new URL(urlStr);
  if (url.origin !== targetOrigin) {
    throw new Error(\`[SECURITY BLOCKED] Disallowed origin: \${url.origin}. Must strictly match exact loopback \${targetOrigin}\`);
  }
  if (init.redirect && init.redirect === 'follow') {
    throw new Error(\`[SECURITY BLOCKED] Disallowed redirect policy: follow\`);
  }
  const guardedInit = {
    ...init,
    redirect: init.redirect === 'manual' ? 'manual' : 'error',
  };
  return originalFetch(input, guardedInit);
};

// Prove non-loopback, redirect rejection, and owned loopback 302 rejection without real egress
try {
  await assert.rejects(
    () => globalThis.fetch('https://example.invalid'),
    /Disallowed origin/
  );
  await assert.rejects(
    () => globalThis.fetch('http://127.0.0.1:9999/api'),
    /Disallowed origin/
  );
  await assert.rejects(
    () => globalThis.fetch(\`\${targetOrigin}/redirect-test\`, { redirect: 'follow' }),
    /Disallowed redirect policy/
  );
  await assert.rejects(
    () => globalThis.fetch(\`\${targetOrigin}/test-owned-redirect-disallowed\`),
    (err) => err instanceof TypeError && /fetch failed/i.test(err.message)
  );
} catch (guardCheckErr) {
  console.error('[SECURITY GUARD CHECK FAILED]', guardCheckErr);
  process.exit(1);
}

// Run the verifier with all assertions under active guard
const verifierPath = pathToFileURL(process.env.VERIFIER_SCRIPT_PATH).href;
await import(verifierPath);
`;
    fs.writeFileSync(bootstrapPath, bootstrapCode.trim(), 'utf8');

    exitCode = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [bootstrapPath, apiUrl], {
        env: {
          PATH: process.env.PATH || '',
          SystemRoot: process.env.SystemRoot || '',
          ComSpec: process.env.ComSpec || '',
          TEMP: tempDir,
          TMP: tempDir,
          API_URL: apiUrl,
          ADMIN_EMAIL: adminEmail,
          ADMIN_PASS: adminPass,
          VERIFIER_SCRIPT_PATH: path.resolve('scripts/verify-api.mjs'),
        },
        stdio: 'inherit',
      });

      child.on('error', reject);
      child.on('close', (code, signal) => {
        // Signaled child (null exit code) must fail, not resolve to 0
        if (code === null) {
          resolve(signal ? 1 : 1);
        } else {
          resolve(code);
        }
      });
    });
  } finally {
    if (cron) {
      await cron.shutdown().catch(() => {});
    }
    if (server) {
      await new Promise((resolve) => server.close(resolve)).catch(() => {});
    }
    if (db) {
      try {
        db.close();
      } catch {}
    }
    if (tempDir && fs.existsSync(tempDir)) {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch {}
    }
  }

  process.exit(exitCode);
}

main().catch((err) => {
  console.error('[verify-api-local] Runner crashed:', err);
  process.exit(1);
});
