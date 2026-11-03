import assert from 'node:assert/strict';
import test from 'node:test';
import { createDocumentSchema } from '../src/components/documents/documentFormSchema.ts';

const schema = createDocumentSchema(key => key);
const base = { title: 'Fixture document', expiry_date: new Date(2030, 1, 1) };
for (const [beneficiary_type, required] of [
  ['company', ['company_id', 'ministry_id', 'document_type_id']],
  ['employee', ['employee_id', 'document_type_id']],
]) {
  test(`${beneficiary_type} missing selections have visible field errors`, () => {
    const result = schema.safeParse({ ...base, beneficiary_type });
    assert.equal(result.success, false);
    assert.deepEqual(result.error.issues.map(issue => issue.path[0]).sort(), [...required].sort());
    for (const expiry_date of [undefined, new Date('invalid')]) {
      const incomplete = schema.safeParse({ ...base, beneficiary_type, expiry_date });
      assert.equal(incomplete.success, false);
      assert.deepEqual(incomplete.error.issues.map(issue => issue.path[0]).sort(),
        [...required, 'expiry_date'].sort());
    }
    for (const field of required) {
      const values = Object.fromEntries(required.map(key => [key, key === field ? '' : 'fixture-id']));
      const missing = schema.safeParse({ ...base, beneficiary_type, ...values });
      assert.equal(missing.success, false);
      assert.deepEqual(missing.error.issues.map(issue => issue.path), [[field]]);
    }
    assert.equal(schema.safeParse({ ...base, beneficiary_type,
      ...Object.fromEntries(required.map(key => [key, 'fixture-id'])) }).success, true);
  });
}
