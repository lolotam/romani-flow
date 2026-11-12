import fs from 'node:fs';
import path from 'node:path';

const dist = path.resolve('dist');
if (!fs.existsSync(dist)) throw new Error('dist/ is missing; run the client build first.');

const forbidden = ['sk_test_synthetic', 'whsec_c3ludGhldGlj', 'CLERK_SECRET_KEY'];
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
  for (const value of forbidden) {
    if (contents.includes(value)) {
      throw new Error(`Forbidden server-only auth value ${value} found in ${path.relative(dist, file)}.`);
    }
  }
}

console.log(`Client bundle secret check passed (${files.length} files).`);
