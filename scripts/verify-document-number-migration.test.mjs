import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { runMigrations } from '../server/db/migrator.ts';

const migrationsDir = path.resolve('server/db/migrations');
const INTEGRATION_BASE = '60f8be79af0c510d44792074055dde3e75851f80';

test('migrations 001-008 match git baseline bytes and enforce no prior alteration', () => {
  const existingFiles = fs.readdirSync(migrationsDir)
    .filter(file => file.endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b, 'en'));

  const baselineVersions = ['001', '002', '003', '004', '005', '006', '007', '008'];
  for (const version of baselineVersions) {
    const file = existingFiles.find(f => f.startsWith(`${version}_`));
    assert.ok(file, `Baseline migration ${version} must exist`);

    const relPath = `server/db/migrations/${file}`;

    // Verify git working tree purity against immutable integration base for each baseline migration
    execFileSync('git', ['diff', '--quiet', INTEGRATION_BASE, '--', relPath]);

    const actual = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    const baseline = execFileSync('git', ['show', `${INTEGRATION_BASE}:${relPath}`], { encoding: 'utf8' });
    assert.equal(
      actual.replace(/\r\n/g, '\n'),
      baseline.replace(/\r\n/g, '\n'),
      `Migration ${file} must match integration baseline content`
    );
    assert.equal(actual.includes('document_number'), false, `Migration ${file} must not contain document_number`);
  }
});

test('upgrade migration applies 009, leaves existing rows with NULL, and repeat runner is a no-op', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('PRAGMA foreign_keys=ON;');
    db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version     TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      applied_at  TEXT NOT NULL
    );`);

    const files = fs.readdirSync(migrationsDir)
      .filter(file => file.endsWith('.sql'))
      .sort((a, b) => a.localeCompare(b, 'en'));

    for (const file of files) {
      const separator = file.indexOf('_');
      const version = separator === -1 ? file : file.slice(0, separator);
      if (Number(version) > 8) continue;
      const name = separator === -1 ? file : file.slice(separator + 1).replace(/\.sql$/, '');
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
      db.exec(sql);
      db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)').run(
        version,
        name,
        new Date().toISOString()
      );
    }

    db.prepare("INSERT INTO companies(id, name, name_ar, created_at, updated_at) VALUES ('comp-1', 'Synthetic Co', 'شركة اختبار', '2026-01-01', '2026-01-01')").run();
    db.prepare("INSERT INTO document_types(id, name, name_ar, created_at, updated_at) VALUES ('type-1', 'Type 1', 'نوع 1', '2026-01-01', '2026-01-01')").run();
    db.prepare("INSERT INTO employees(id, company_id, name, created_at, updated_at) VALUES ('emp-1', 'comp-1', 'Employee 1', '2026-01-01', '2026-01-01')").run();
    db.prepare(`INSERT INTO documents(
      id, title, file_name, file_path, file_size, mime_type, status,
      issue_date, expiry_date, employee_id, company_id, document_type_id,
      created_at, updated_at
    ) VALUES (
      'doc-1', 'Pre-migration Doc', 'test.pdf', 'uploads/test.pdf', 1024, 'application/pdf', 'valid',
      '2026-01-01', '2027-01-01', 'emp-1', 'comp-1', 'type-1',
      '2026-01-01', '2026-01-01'
    )`).run();

    const result = runMigrations(db, migrationsDir);
    assert.deepEqual(result.applied, ['009_document_number.sql', '010_workspaces.sql', '011_clerk_identity.sql'], 'Only the migrations after 008 are applied on upgrade');

    const appliedVersions = db.prepare('SELECT version FROM schema_migrations WHERE version = ?').all('009');
    assert.equal(appliedVersions.length, 1, 'Migration 009 must be recorded in schema_migrations');

    const doc = db.prepare("SELECT * FROM documents WHERE id = 'doc-1'").get();
    assert.ok(doc, 'Existing document must survive migration');
    assert.equal(doc.document_number, null, 'Pre-existing document must have NULL document_number without backfill');
    assert.equal(doc.title, 'Pre-migration Doc');
    assert.equal(doc.file_name, 'test.pdf');
    assert.equal(doc.file_path, 'uploads/test.pdf');
    assert.equal(doc.file_size, 1024);
    assert.equal(doc.mime_type, 'application/pdf');
    assert.equal(doc.status, 'valid');
    assert.equal(doc.employee_id, 'emp-1');
    assert.equal(doc.company_id, 'comp-1');
    assert.equal(doc.document_type_id, 'type-1');

    const repeat = runMigrations(db, migrationsDir);
    assert.deepEqual(repeat.applied, [], 'Repeated migration runner must apply nothing');
    assert.ok(repeat.skipped.includes('009_document_number.sql'), 'Migration 009 must be reported as skipped on repeat');
  } finally {
    db.close();
  }
});

test('fresh install creates document_number column with CHECK constraint and allows duplicate numbers', () => {
  const freshDb = new DatabaseSync(':memory:');
  try {
    freshDb.exec('PRAGMA foreign_keys=ON;');
    runMigrations(freshDb, migrationsDir);

    const columns = freshDb.prepare("PRAGMA table_info(documents)").all();
    const col = columns.find(c => c.name === 'document_number');
    assert.ok(col, 'documents table must contain document_number column');
    assert.equal(col.type.toUpperCase(), 'TEXT');
    assert.equal(col.notnull, 0);
    assert.equal(col.dflt_value, 'NULL');

    const indexes = freshDb.prepare("PRAGMA index_list(documents)").all();
    for (const idx of indexes) {
      const idxCols = freshDb.prepare(`PRAGMA index_info("${idx.name}")`).all();
      assert.equal(idxCols.some(c => c.name === 'document_number'), false, 'document_number must not have any index');
    }

    freshDb.prepare("INSERT INTO companies(workspace_id, id, name, name_ar, created_at, updated_at) VALUES ('ws_legacy', 'comp-1', 'C', 'ش', '2026-01-01', '2026-01-01')").run();
    freshDb.prepare("INSERT INTO document_types(workspace_id, id, name, name_ar, created_at, updated_at) VALUES ('ws_legacy', 'type-1', 'T', 'ن', '2026-01-01', '2026-01-01')").run();

    freshDb.prepare("INSERT INTO documents(workspace_id, id, title, document_type_id, document_number, created_at, updated_at) VALUES ('ws_legacy', 'd1', 'Doc 1', 'type-1', NULL, '2026-01-01', '2026-01-01')").run();
    assert.equal(freshDb.prepare("SELECT document_number FROM documents WHERE id = 'd1'").get().document_number, null);

    freshDb.prepare("INSERT INTO documents(workspace_id, id, title, document_type_id, document_number, created_at, updated_at) VALUES ('ws_legacy', 'd2', 'Doc 2', 'type-1', '000123', '2026-01-01', '2026-01-01')").run();
    freshDb.prepare("INSERT INTO documents(workspace_id, id, title, document_type_id, document_number, created_at, updated_at) VALUES ('ws_legacy', 'd3', 'Doc 3', 'type-1', 'AB-001/٧', '2026-01-01', '2026-01-01')").run();
    assert.equal(freshDb.prepare("SELECT document_number FROM documents WHERE id = 'd2'").get().document_number, '000123');
    assert.equal(freshDb.prepare("SELECT document_number FROM documents WHERE id = 'd3'").get().document_number, 'AB-001/٧');

    freshDb.prepare("INSERT INTO documents(workspace_id, id, title, document_type_id, document_number, created_at, updated_at) VALUES ('ws_legacy', 'd4', 'Doc 4', 'type-1', '000123', '2026-01-01', '2026-01-01')").run();
    assert.equal(freshDb.prepare("SELECT count(*) as count FROM documents WHERE document_number = '000123'").get().count, 2);

    const atLimit = 'x'.repeat(128);
    freshDb.prepare("INSERT INTO documents(workspace_id, id, title, document_type_id, document_number, created_at, updated_at) VALUES ('ws_legacy', 'd5', 'Doc 5', 'type-1', ?, '2026-01-01', '2026-01-01')").run(atLimit);
    assert.equal(freshDb.prepare("SELECT document_number FROM documents WHERE id = 'd5'").get().document_number, atLimit);

    const overLimit = 'x'.repeat(129);
    assert.throws(() => {
      freshDb.prepare("INSERT INTO documents(workspace_id, id, title, document_type_id, document_number, created_at, updated_at) VALUES ('ws_legacy', 'd6', 'Doc 6', 'type-1', ?, '2026-01-01', '2026-01-01')").run(overLimit);
    }, /CHECK constraint failed/);

    // Non-text binary BLOB is rejected by typeof(document_number) = 'text' CHECK constraint
    assert.throws(() => {
      freshDb.prepare("INSERT INTO documents(workspace_id, id, title, document_type_id, document_number, created_at, updated_at) VALUES ('ws_legacy', 'd7', 'Doc 7', 'type-1', ?, '2026-01-01', '2026-01-01')").run(Buffer.from([0x01, 0x02, 0x03]));
    }, /CHECK constraint failed/);

    // Demonstrate and verify SQLite column TEXT affinity:
    // SQLite coerces numeric literals (such as 12345) to TEXT on columns with TEXT affinity
    // before the CHECK constraint evaluates, which is why client and API layer validation (Task 4)
    // must strictly enforce rejection of numeric/boolean inputs.
    freshDb.prepare("INSERT INTO documents(workspace_id, id, title, document_type_id, document_number, created_at, updated_at) VALUES ('ws_legacy', 'd8', 'Doc 8', 'type-1', 12345, '2026-01-01', '2026-01-01')").run();
    const coerced = freshDb.prepare("SELECT document_number, typeof(document_number) as stored_type FROM documents WHERE id = 'd8'").get();
    assert.equal(coerced.document_number, '12345');
    assert.equal(coerced.stored_type, 'text');
  } finally {
    freshDb.close();
  }
});
