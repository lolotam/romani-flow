#!/usr/bin/env node
/**
 * End-to-end verification of the API.
 *
 * Runs against a live server and asserts the behaviours that are easy to break
 * silently: relation embedding, the filter contract, the derived status, the
 * PATCH clearing semantics, the rejection of storage columns, the staged-upload
 * flow and the authentication boundary.
 *
 *   node scripts/verify-api.mjs [baseUrl]
 *
 * Environment:
 *   API_URL      base url of the running server (default http://127.0.0.1:3199)
 *   ADMIN_EMAIL  an administrator of the server under test (required)
 *   ADMIN_PASS   its password (required; never commit it)
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BASE = (process.argv[2] ?? process.env.API_URL ?? 'http://127.0.0.1:3199').replace(/\/$/, '');
const EMAIL = process.env.ADMIN_EMAIL;
const PASSWORD = process.env.ADMIN_PASS;

if (!EMAIL || !PASSWORD) {
  console.error('ADMIN_EMAIL and ADMIN_PASS are required (an administrator of the server under test).');
  process.exit(2);
}

let passed = 0;
const failures = [];

function check(name, condition, detail = '') {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

let cookie = '';

async function call(pathname, options = {}) {
  const headers = { ...(options.headers ?? {}) };
  if (cookie) headers.cookie = cookie;

  let body = options.body;
  if (body !== undefined && !(body instanceof FormData)) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(body);
  }

  const response = await fetch(`${BASE}${pathname}`, {
    method: options.method ?? 'GET',
    headers,
    body,
    redirect: 'manual',
  });

  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }

  const setCookie = response.headers.getSetCookie?.() ?? [];
  for (const entry of setCookie) {
    const [pair] = entry.split(';');
    if (pair.startsWith('romani_session=')) cookie = pair;
  }

  return { status: response.status, payload, headers: response.headers };
}

function section(title) {
  console.log(`\n${title}`);
}

async function main() {
  console.log(`Verifying ${BASE}\n`);

  section('Health');
  const health = await call('/api/health');
  check('the health endpoint answers', health.status === 200, `status ${health.status}`);
  check('the database is reachable', health.payload?.database === 'ok');

  section('Authentication');
  const anonymous = await call('/api/employees');
  check('anonymous access is rejected', anonymous.status === 401, `status ${anonymous.status}`);

  const badLogin = await call('/api/auth/login', {
    method: 'POST',
    body: { email: EMAIL, password: 'definitely-wrong' },
  });
  check('a wrong password is rejected', badLogin.status === 401, `status ${badLogin.status}`);

  const login = await call('/api/auth/login', {
    method: 'POST',
    body: { email: EMAIL, password: PASSWORD },
  });
  check('the seeded administrator can sign in', login.status === 200, `status ${login.status}`);
  check('the session cookie is issued', cookie.includes('romani_session='));

  const me = await call('/api/auth/me');
  check('/api/auth/me resolves the session', me.status === 200 && me.payload?.data?.user?.email === EMAIL);
  check('the session carries no password field', !JSON.stringify(me.payload).includes('password'));

  section('Data');
  const employees = await call('/api/employees');
  const rows = employees.payload?.data ?? [];
  check('the employees list is returned', employees.status === 200 && Array.isArray(rows));
  check('the seeded dataset is loaded', rows.length >= 20, `${rows.length} rows`);

  const first = rows[0];
  check('boolean columns arrive as booleans', typeof first?.is_active === 'boolean');
  check('the driving licence flag arrives as a boolean', typeof first?.driving_license === 'boolean');

  section('Relations');
  const withRelations = await call(
    '/api/employees?select=*,companies (name, name_ar)',
  );
  const related = (withRelations.payload?.data ?? []).find((row) => row.companies);
  check('a relation is embedded as a nested object', Boolean(related?.companies?.name));
  check(
    'the relation is a complete row, not a projection',
    related?.companies === undefined || related.companies.created_at !== undefined,
  );

  section('Filters');
  const companyId = first?.company_id;
  const byCompany = await call(`/api/employees?eq[company_id]=${companyId}`);
  check(
    'an equality filter narrows the result',
    byCompany.payload?.data?.length > 0 && byCompany.payload.data.length < rows.length,
    `${byCompany.payload?.data?.length} of ${rows.length}`,
  );

  const byName = await call('/api/employees?like[name]=%25%D9%85%25');
  check(
    'a wildcard filter matches',
    (byName.payload?.data?.length ?? 0) > 0,
    `${byName.payload?.data?.length ?? 0} matches`,
  );

  const ordered = await call('/api/employees?order=name:asc&limit=3');
  check('ordering and limiting work', ordered.payload?.data?.length === 3);

  const inFilter = await call('/api/employees?in[position]=مدير,محاسب');
  check('an IN filter works', Array.isArray(inFilter.payload?.data));

  section('Derived status and the PATCH contract');
  const documents = await call('/api/documents');
  const document = (documents.payload?.data ?? [])[0];
  check('a document is available for the test', Boolean(document?.id));

  const today = new Date().toISOString().slice(0, 10);
  const patched = await call(`/api/documents/${document.id}`, {
    method: 'PATCH',
    body: { expiry_date: today },
  });
  check(
    'the status is derived from the expiry date',
    patched.payload?.data?.status === 'expiring_soon',
    `status ${patched.payload?.data?.status}`,
  );

  const titleOnly = await call(`/api/documents/${document.id}`, {
    method: 'PATCH',
    body: { title: document.title },
  });
  check(
    'the status stays correct after an unrelated edit',
    titleOnly.payload?.data?.status === 'expiring_soon',
    `status ${titleOnly.payload?.data?.status}`,
  );

  const cleared = await call(`/api/documents/${document.id}`, {
    method: 'PATCH',
    body: { notes: null },
  });
  check(
    'an explicit null clears a field',
    cleared.payload?.data?.notes === null,
    `notes ${String(cleared.payload?.data?.notes)}`,
  );

  const forged = await call(`/api/documents/${document.id}`, {
    method: 'PATCH',
    body: { file_path: '../../etc/passwd' },
  });
  check(
    'a storage column is refused rather than written',
    forged.status === 400 && forged.payload?.error?.code === 'managed_field',
    `status ${forged.status} code ${String(forged.payload?.error?.code)}`,
  );

  section('Files');
  const file = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'verification.png', {
    type: 'image/png',
  });
  const form = new FormData();
  form.append('files', file);

  const upload = await call('/api/files/upload', { method: 'POST', body: form });
  const uploadId = upload.payload?.data?.[0]?.upload_id;
  check('an upload is staged and returns an upload id', Boolean(uploadId));
  check('the upload response does not expose a path', upload.payload?.data?.[0]?.file_path === undefined);

  const created = await call('/api/documents', {
    method: 'POST',
    body: {
      title: 'Verification upload',
      document_type_id: document.document_type_id,
      upload_id: uploadId,
    },
  });
  const createdId = created.payload?.data?.[0]?.id;
  check('a document can claim the staged upload', Boolean(createdId));
  const storedPath = created.payload?.data?.[0]?.file_path;
  check(
    'the document carries the stored file',
    typeof storedPath === 'string' && storedPath.length > 0,
    `file_path ${String(storedPath)}`,
  );
  check(
    'the stored path stays inside the bucket',
    typeof storedPath === 'string' && !storedPath.includes('..') && !storedPath.startsWith('/'),
    `file_path ${String(storedPath)}`,
  );

  const download = await call(`/api/files/${createdId}/download`);
  check('the file can be downloaded', download.status === 200);
  check(
    'the download is an attachment',
    (download.headers.get('content-disposition') ?? '').startsWith('attachment'),
  );

  const preview = await call(`/api/files/${createdId}/preview`);
  check('the file can be previewed', preview.status === 200);

  const anonymousFile = await fetch(`${BASE}/api/files/${createdId}/download`);
  check('a file cannot be read without a session', anonymousFile.status === 401);

  const deleted = await call(`/api/documents/${createdId}`, { method: 'DELETE' });
  check('the document can be deleted', deleted.status === 200);
  const afterDelete = await call(`/api/files/${createdId}/download`);
  check('its file is gone with it', afterDelete.status === 404);

  section('Email and settings');
  const previewReport = await call('/api/email/expiry-preview');
  check('the expiry preview answers', previewReport.status === 200);
  check(
    'the preview reports the window and the intervals',
    Array.isArray(previewReport.payload?.data?.intervals),
  );
  check(
    'the preview returns the items',
    Array.isArray(previewReport.payload?.data?.documents) &&
      Array.isArray(previewReport.payload?.data?.employees),
  );

  const settings = await call('/api/settings');
  check('the settings are readable', settings.status === 200);
  check(
    'the SMTP password is never exposed',
    !JSON.stringify(settings.payload).includes('SMTP_PASS'),
  );

  const rejected = await call('/api/settings', {
    method: 'PUT',
    body: { settings: { 'smtp.pass': 'leak' } },
  });
  check(
    'a secret setting cannot be written',
    rejected.status === 400 && (rejected.payload?.error?.rejected ?? []).length > 0,
    `status ${rejected.status}`,
  );

  const intervals = await call('/api/settings', {
    method: 'PUT',
    body: { settings: { 'email.notification_intervals': ['90', '30'] } },
  });
  check(
    'the reminder intervals can be changed',
    (intervals.payload?.data?.updated ?? []).includes('email.notification_intervals'),
  );

  const cron = await call('/api/cron/status');
  check('the scheduler status is readable', cron.status === 200);
  check('the scheduler reports a next run', Boolean(cron.payload?.data?.nextRun));

  const noRecipients = await call('/api/email/expiry-report', { method: 'POST' });
  check(
    'the manual report reports a real outcome',
    noRecipients.status === 200 && noRecipients.payload?.data !== undefined,
  );

  section('Backup');
  const exported = await call('/api/backup/export');
  check('the data export works', exported.status === 200);
  check(
    'the export contains the data tables',
    Array.isArray(exported.payload?.data?.employees) &&
      Array.isArray(exported.payload?.data?.documents),
  );
  check('the export contains positions', Array.isArray(exported.payload?.data?.positions));

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length > 0) {
    console.log('\nFailures:');
    for (const failure of failures) console.log(`  - ${failure}`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('\nThe verification run crashed:', error);
  process.exit(1);
});
