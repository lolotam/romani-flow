import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { reminderApi } from './fixtures/whatsapp-api.mjs';
import { signSession } from '../server/middleware/auth.ts';

const ARABIC_NAME = 'اذن عمل موقت روماني.pdf';

test('an Arabic upload filename is stored as UTF-8, not latin1 mojibake', () => reminderApi(async f => {
  const data = new FormData();
  data.append('files', new Blob(['%PDF-1.4\nSynthetic'], { type: 'application/pdf' }), ARABIC_NAME);
  const cookie = f.config.cookieName + '=' + signSession(f.config, { id: 'admin', role: 'admin', name: 'Synthetic', email: 'admin@example.invalid' });

  const response = await fetch(f.base + '/api/files/upload', { method: 'POST', headers: { cookie }, body: data });

  assert.equal(response.status, 201);
  const [staged] = (await response.json()).data;
  assert.equal(staged.original_name, ARABIC_NAME);
  assert.equal(staged.file_name, ARABIC_NAME);
  const stored = fs.readdirSync(f.config.uploadsDir, { recursive: true }).map(String);
  assert.ok(stored.some(file => file.endsWith(ARABIC_NAME)), `expected a stored file ending in the Arabic name, got ${stored.join(', ')}`);
}));
