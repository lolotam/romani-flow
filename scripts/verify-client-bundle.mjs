import fs from 'node:fs';
import path from 'node:path';

const dist = path.resolve('dist');
if (!fs.existsSync(dist)) throw new Error('dist/ is missing; run the client build first.');

// Short synthetic fixtures used by the server tests. They are not live secrets,
// and they are shorter than the live-key patterns below, so a test build that
// mentions them only in server code is not flagged by those patterns.
const forbidden = ['sk_test_synthetic', 'whsec_c3ludGhldGlj', 'CLERK_SECRET_KEY'];

// Live Clerk secret and webhook signing secret shapes. The {20,} floor keeps
// the short synthetic fixtures above from matching.
const secretPatterns = [
  /sk_(?:live|test)_[A-Za-z0-9]{20,}/,
  /whsec_[A-Za-z0-9+/=]{20,}/,
];

// The configured secrets, when the process actually has them. A value shorter
// than the synthetic fixtures is ignored so a placeholder cannot match ordinary
// bundle text. The value itself is never printed.
const SECRET_ENV = ['CLERK_SECRET_KEY', 'CLERK_WEBHOOK_SIGNING_SECRET'];
const envSecrets = SECRET_ENV
  .map(name => process.env[name])
  .filter(value => typeof value === 'string' && value.length >= 16);

const files = [];
function collect(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) collect(file);
    else if (entry.isFile()) files.push(file);
  }
}
collect(dist);

for (const file of files) {
  const contents = fs.readFileSync(file, 'utf8');
  const relative = path.relative(dist, file);
  for (const value of forbidden) {
    if (contents.includes(value)) {
      throw new Error(`Forbidden server-only auth value ${value} found in ${relative}.`);
    }
  }
  for (const pattern of secretPatterns) {
    if (pattern.test(contents)) {
      throw new Error(`Forbidden server-only auth secret found in ${relative}.`);
    }
  }
  for (const value of envSecrets) {
    if (contents.includes(value)) {
      throw new Error(`Forbidden server-only auth secret found in ${relative}.`);
    }
  }
}

console.log(`Client bundle secret check passed (${files.length} files).`);
