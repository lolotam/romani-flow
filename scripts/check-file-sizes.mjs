#!/usr/bin/env node
/**
 * Enforces the file size rule: no source file may exceed 500 lines.
 *
 * Run as part of `npm run lint` so an oversized file can never reach main.
 */

import fs from 'node:fs';
import path from 'node:path';

const MAX_LINES = 500;
const ROOTS = ['src', 'server'];
const EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx'];
const IGNORED_DIRECTORIES = new Set(['node_modules', 'dist', 'server-dist', '.git']);

/**
 * The vendored design-system primitives.
 *
 * `src/components/ui` holds the shadcn/ui components. They are generated, they
 * are not edited by hand, and splitting them would only make them harder to
 * update — so the rule applies to the code we actually own.
 */
const IGNORED_PATHS = [path.join('src', 'components', 'ui')];

function isIgnored(relativePath) {
  return IGNORED_PATHS.some((ignored) => relativePath.startsWith(`${ignored}${path.sep}`));
}

function collectFiles(directory) {
  const entries = fs.readdirSync(directory, { withFileTypes: true });

  return entries.flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (IGNORED_DIRECTORIES.has(entry.name)) return [];
      return collectFiles(fullPath);
    }
    if (!EXTENSIONS.includes(path.extname(entry.name))) return [];
    return [fullPath];
  });
}

const projectRoot = process.cwd();
const violations = [];
let checked = 0;

for (const root of ROOTS) {
  const absoluteRoot = path.join(projectRoot, root);
  if (!fs.existsSync(absoluteRoot)) continue;

  for (const file of collectFiles(absoluteRoot)) {
    const relativePath = path.relative(projectRoot, file);
    if (isIgnored(relativePath)) continue;

    const lines = fs.readFileSync(file, 'utf8').split('\n').length;
    checked += 1;

    if (lines > MAX_LINES) {
      violations.push({ file: relativePath, lines });
    }
  }
}

if (violations.length > 0) {
  console.error(`\nFile size check failed — ${violations.length} file(s) exceed ${MAX_LINES} lines:\n`);
  for (const violation of violations.sort((a, b) => b.lines - a.lines)) {
    console.error(`  ${violation.lines.toString().padStart(5)} lines  ${violation.file}`);
  }
  console.error('');
  process.exit(1);
}

console.log(`File size check passed — ${checked} files, none above ${MAX_LINES} lines.`);
