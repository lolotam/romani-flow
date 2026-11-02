/**
 * Rewrites relative ESM imports in the server sources to include the `.js`
 * extension, which NodeNext module resolution requires at runtime.
 *
 *   node scripts/fix-server-imports.mjs
 */

import fs from 'node:fs';
import path from 'node:path';

const serverDir = path.join(process.cwd(), 'server');

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) return walk(full);
    return full.endsWith('.ts') ? [full] : [];
  });
}

const PATTERN = /(from\s+['"])(\.\.?\/[^'"]+?)(['"])/g;

let changed = 0;
for (const file of walk(serverDir)) {
  const source = fs.readFileSync(file, 'utf8');
  const next = source.replace(PATTERN, (match, prefix, specifier, suffix) => {
    if (specifier.endsWith('.js') || specifier.endsWith('.json')) return match;
    return `${prefix}${specifier}.js${suffix}`;
  });

  if (next !== source) {
    fs.writeFileSync(file, next, 'utf8');
    changed += 1;
  }
}

console.log(`Rewrote relative imports in ${changed} file(s).`);
