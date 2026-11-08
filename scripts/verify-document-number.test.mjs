import test from 'node:test';
import assert from 'node:assert/strict';
import { documentNumber } from '../server/contracts/documentNumber.ts';
import { reminderApi } from './fixtures/whatsapp-api.mjs';
import { readSubmission, rememberSubmission } from '../server/repositories/formDefaults.ts';
import { newDocumentDefaults, employeeDocumentDraft } from '../src/lib/documentFormDrafts.ts';
import { createDocumentSchema } from '../src/components/documents/documentFormSchema.ts';
import { saveDocument } from '../src/components/documents/saveDocument.ts';

test('document number preserves representation and rejects coercion', () => {
  for (const value of ['000123', 'AB-001/٧', '٠٠١٢']) assert.equal(documentNumber.parse(` ${value} `), value);
  for (const value of [undefined, null, '', '   ']) assert.equal(documentNumber.parse(value), null);
  assert.equal(documentNumber.safeParse(123).success, false);
  assert.equal(documentNumber.safeParse('x'.repeat(129)).success, false);
  assert.equal(documentNumber.parse('x'.repeat(128)).length, 128);
});

// MergePilot: the actual save helper must preserve PATCH omission semantics.
// Forward its real fetch through the existing authenticated loopback API fixture,
// capturing the serialized wire body and checking the persisted server value.
for (const scenario of [
  { name: 'omitted', fields: {}, expected: 'KEEP-001', hasNumber: false },
  { name: 'explicit null', fields: { document_number: null }, expected: null, hasNumber: true },
  { name: 'explicit empty', fields: { document_number: '' }, expected: null, hasNumber: true },
  { name: 'leading zeroes', fields: { document_number: '000042' }, expected: '000042', hasNumber: true },
]) {
  test(`saveDocument existing-document ${scenario.name} preserves HTTP PATCH semantics`, async t => reminderApi(async f => {
    const created = await f.request('/api/documents', {
      method: 'POST',
      body: { title: 'Original', employee_id: f.employee.id, document_type_id: f.type.id,
        expiry_date: '2028-12-31', document_number: 'KEEP-001' },
    });
    assert.equal(created.status, 201);
    const id = created.json.data[0].id;
    const originalFetch = globalThis.fetch;
    const captured = [];
    t.mock.method(globalThis, 'fetch', async (url, options = {}) => {
      if (typeof url !== 'string' || !url.startsWith('/api/')) return originalFetch(url, options);
      assert.equal(url, `/api/documents/${id}`);
      assert.equal(options.method, 'PATCH');
      const body = JSON.parse(options.body);
      captured.push(body);
      const response = await f.request(url, { method: options.method, body });
      return new Response(JSON.stringify(response.json), {
        status: response.status, headers: { 'Content-Type': 'application/json' },
      });
    });
    await saveDocument({
      title: 'Updated through real helper', beneficiary_type: 'employee', employee_id: f.employee.id,
      document_type_id: f.type.id, expiry_date: new Date(2028, 11, 31), ...scenario.fields,
    }, id, undefined, key => key);
    assert.equal(captured.length, 1);
    const persisted = f.db.prepare('SELECT title, document_number FROM documents WHERE id = ?').get(id);
    assert.equal(persisted.title, 'Updated through real helper', 'Positive control: actual PATCH reached storage');
    assert.deepEqual({ hasNumber: Object.hasOwn(captured[0], 'document_number'), number: persisted.document_number },
      { hasNumber: scenario.hasNumber, number: scenario.expected });
    if (scenario.hasNumber) assert.equal(captured[0].document_number, scenario.expected);
  }));
}

test('POST /api/documents trims whitespace, preserves digits/zeros, allows duplicates, and rejects invalid inputs', () => reminderApi(async f => {
  const baseDoc = {
    title: 'Document with Number',
    employee_id: f.employee.id,
    document_type_id: f.type.id,
    expiry_date: '2028-06-30',
  };

  // Trimming and preserving representation
  const res1 = await f.request('/api/documents', {
    method: 'POST',
    body: { ...baseDoc, document_number: '  000123  ' },
  });
  assert.equal(res1.status, 201);
  assert.equal(res1.json.data[0].document_number, '000123');
  const row1 = f.db.prepare('SELECT document_number FROM documents WHERE id = ?').get(res1.json.data[0].id);
  assert.equal(row1.document_number, '000123');

  // Arabic-Indic and internal separators
  const res2 = await f.request('/api/documents', {
    method: 'POST',
    body: { ...baseDoc, title: 'Arabic Doc', document_number: 'AB-001/٧' },
  });
  assert.equal(res2.status, 201);
  assert.equal(res2.json.data[0].document_number, 'AB-001/٧');

  // Duplicate document numbers are explicitly allowed
  const res3 = await f.request('/api/documents', {
    method: 'POST',
    body: { ...baseDoc, title: 'Duplicate Doc', document_number: '000123' },
  });
  assert.equal(res3.status, 201);
  assert.equal(res3.json.data[0].document_number, '000123');

  // Omitted document_number defaults to null
  const res4 = await f.request('/api/documents', {
    method: 'POST',
    body: { ...baseDoc, title: 'Omitted Number Doc' },
  });
  assert.equal(res4.status, 201);
  assert.equal(res4.json.data[0].document_number, null);

  // Empty string becomes null
  const res5 = await f.request('/api/documents', {
    method: 'POST',
    body: { ...baseDoc, title: 'Empty String Doc', document_number: '' },
  });
  assert.equal(res5.status, 201);
  assert.equal(res5.json.data[0].document_number, null);

  // Whitespace-only string becomes null
  const res6 = await f.request('/api/documents', {
    method: 'POST',
    body: { ...baseDoc, title: 'Whitespace Doc', document_number: '   ' },
  });
  assert.equal(res6.status, 201);
  assert.equal(res6.json.data[0].document_number, null);

  // Non-string coercion rejection (number)
  const resNum = await f.request('/api/documents', {
    method: 'POST',
    body: { ...baseDoc, document_number: 12345 },
  });
  assert.equal(resNum.status, 400);
  assert.equal(resNum.json.error.code, 'invalid_document_number');
  assert.equal(resNum.json.error.message, 'Invalid document number.');

  // Overlong rejection (>128 chars)
  const resOver = await f.request('/api/documents', {
    method: 'POST',
    body: { ...baseDoc, document_number: 'x'.repeat(129) },
  });
  assert.equal(resOver.status, 400);
  assert.equal(resOver.json.error.code, 'invalid_document_number');
  assert.equal(resOver.json.error.message, 'Invalid document number.');

  // Boolean rejection
  const resBool = await f.request('/api/documents', {
    method: 'POST',
    body: { ...baseDoc, document_number: true },
  });
  assert.equal(resBool.status, 400);
  assert.equal(resBool.json.error.code, 'invalid_document_number');
}));

test('PATCH /api/documents preserves omitted number, clears on empty/null, and rejects invalid inputs', () => reminderApi(async f => {
  const created = await f.request('/api/documents', {
    method: 'POST',
    body: {
      title: 'Initial Document',
      employee_id: f.employee.id,
      document_type_id: f.type.id,
      expiry_date: '2028-12-31',
      document_number: 'KEEP-001',
    },
  });
  assert.equal(created.status, 201);
  const docId = created.json.data[0].id;
  assert.equal(created.json.data[0].document_number, 'KEEP-001');

  // Omitted PATCH preserves existing document_number
  const patch1 = await f.request(`/api/documents/${docId}`, {
    method: 'PATCH',
    body: { title: 'Updated Title Only' },
  });
  assert.equal(patch1.status, 200);
  assert.equal(patch1.json.data.document_number, 'KEEP-001');
  assert.equal(f.db.prepare('SELECT document_number FROM documents WHERE id = ?').get(docId).document_number, 'KEEP-001');

  // Explicit update changes document_number
  const patch2 = await f.request(`/api/documents/${docId}`, {
    method: 'PATCH',
    body: { document_number: 'NEW-002' },
  });
  assert.equal(patch2.status, 200);
  assert.equal(patch2.json.data.document_number, 'NEW-002');
  assert.equal(f.db.prepare('SELECT document_number FROM documents WHERE id = ?').get(docId).document_number, 'NEW-002');

  // Explicit empty string clears document_number to null
  const patch3 = await f.request(`/api/documents/${docId}`, {
    method: 'PATCH',
    body: { document_number: '' },
  });
  assert.equal(patch3.status, 200);
  assert.equal(patch3.json.data.document_number, null);
  assert.equal(f.db.prepare('SELECT document_number FROM documents WHERE id = ?').get(docId).document_number, null);

  // Restore number then clear with null
  await f.request(`/api/documents/${docId}`, {
    method: 'PATCH',
    body: { document_number: 'RESTORE-003' },
  });
  const patch4 = await f.request(`/api/documents/${docId}`, {
    method: 'PATCH',
    body: { document_number: null },
  });
  assert.equal(patch4.status, 200);
  assert.equal(patch4.json.data.document_number, null);

  // Clear with whitespace
  await f.request(`/api/documents/${docId}`, {
    method: 'PATCH',
    body: { document_number: 'RESTORE-004' },
  });
  const patch5 = await f.request(`/api/documents/${docId}`, {
    method: 'PATCH',
    body: { document_number: '   ' },
  });
  assert.equal(patch5.status, 200);
  assert.equal(patch5.json.data.document_number, null);

  // Invalid PATCH inputs rejected
  const patchBadNum = await f.request(`/api/documents/${docId}`, {
    method: 'PATCH',
    body: { document_number: 123 },
  });
  assert.equal(patchBadNum.status, 400);
  assert.equal(patchBadNum.json.error.code, 'invalid_document_number');

  const patchBadLen = await f.request(`/api/documents/${docId}`, {
    method: 'PATCH',
    body: { document_number: 'x'.repeat(129) },
  });
  assert.equal(patchBadLen.status, 400);
  assert.equal(patchBadLen.json.error.code, 'invalid_document_number');
}));

test('GET list and detail endpoints return document_number and embed relations', () => reminderApi(async f => {
  const created = await f.request('/api/documents', {
    method: 'POST',
    body: {
      title: 'Embedding Test Doc',
      employee_id: f.employee.id,
      document_type_id: f.type.id,
      company_id: f.company.id,
      expiry_date: '2028-10-10',
      document_number: 'EMBED-999',
    },
  });
  assert.equal(created.status, 201);
  const docId = created.json.data[0].id;

  // List endpoint
  const listRes = await f.request('/api/documents');
  assert.equal(listRes.status, 200);
  const foundInList = listRes.json.data.find(d => d.id === docId);
  assert.ok(foundInList);
  assert.equal(foundInList.document_number, 'EMBED-999');
  assert.ok(foundInList.employees);
  assert.equal(foundInList.employees.id, f.employee.id);
  assert.ok(foundInList.document_types);
  assert.equal(foundInList.document_types.id, f.type.id);

  // Detail endpoint
  const detailRes = await f.request(`/api/documents/${docId}`);
  assert.equal(detailRes.status, 200);
  assert.equal(detailRes.json.data.id, docId);
  assert.equal(detailRes.json.data.document_number, 'EMBED-999');
  assert.ok(detailRes.json.data.employees);
  assert.ok(detailRes.json.data.companies);
}));

test('GET /api/backup/export includes document_number in documents export', () => reminderApi(async f => {
  await f.request('/api/documents', {
    method: 'POST',
    body: {
      title: 'Exported Doc',
      employee_id: f.employee.id,
      document_type_id: f.type.id,
      expiry_date: '2028-10-10',
      document_number: 'EXP-12345',
    },
  });

  const exportRes = await f.request('/api/backup/export');
  assert.equal(exportRes.status, 200);
  assert.ok(exportRes.json.data.documents);
  const doc = exportRes.json.data.documents.find(d => d.document_number === 'EXP-12345');
  assert.ok(doc, 'Exported documents array must contain row with document_number');
  assert.equal(doc.document_number, 'EXP-12345');
}));

test('form defaults isolate document_number: rememberSubmission never stores it, readSubmission deletes legacy', () => reminderApi(async f => {
  // rememberSubmission does not store document_number in form_defaults
  rememberSubmission(f.db, 'admin', 'documents', {
    id: 'doc-synth',
    title: 'Submitted Title',
    notes: 'Some notes',
    document_number: 'SECRET-NUM-123',
    company_id: f.company.id,
    document_type_id: f.type.id,
  });

  const stored = f.db.prepare("SELECT values_json FROM form_defaults WHERE user_id = 'admin' AND form_key = 'documents'").get();
  assert.ok(stored);
  const parsed = JSON.parse(stored.values_json);
  assert.equal(parsed.title, 'Submitted Title');
  assert.equal('document_number' in parsed, false, 'rememberSubmission must never store document_number');

  // readSubmission strips any synthetic legacy document_number
  f.db.prepare("UPDATE form_defaults SET values_json = ? WHERE user_id = 'admin' AND form_key = 'documents'").run(
    JSON.stringify({
      title: 'Legacy Title',
      notes: 'Legacy notes',
      document_number: 'LEGACY-STORED-NUM',
      company_id: f.company.id,
      document_type_id: f.type.id,
    })
  );

  const restored = readSubmission(f.db, 'admin', 'documents');
  assert.equal(restored.title, 'Legacy Title');
  assert.equal('document_number' in restored, false, 'readSubmission must remove legacy document_number');

  // Verify form-defaults API endpoint also omits document_number
  const apiRes = await f.request('/api/form-defaults/documents');
  assert.equal(apiRes.status, 200);
  assert.equal('document_number' in apiRes.json.data, false);

  // newDocumentDefaults provides empty string
  const empDefaults = newDocumentDefaults({ employeeId: f.employee.id });
  assert.equal(empDefaults.document_number, '', 'newDocumentDefaults must default document_number to empty string');

  const compDefaults = newDocumentDefaults({ companyId: f.company.id });
  assert.equal(compDefaults.document_number, '', 'newDocumentDefaults must default document_number to empty string');

  // employeeDocumentDraft defaults to empty or retains existing value
  const draftFromNull = employeeDocumentDraft(null, 'test.pdf');
  assert.equal(draftFromNull.document_number, '', 'employeeDocumentDraft must default to empty string when saved is null');

  const draftFromSaved = employeeDocumentDraft({ document_number: 'RETAINED-NUM' }, 'test.pdf');
  assert.equal(draftFromSaved.document_number, 'RETAINED-NUM', 'employeeDocumentDraft must retain existing document_number');

  const draftFromEmpty = employeeDocumentDraft({ document_number: '' }, 'test.pdf');
  assert.equal(draftFromEmpty.document_number, '', 'employeeDocumentDraft must retain empty string if explicitly set');
}));

test('document draft API roundtrips document_number and rolls back save on CAS conflict', () => reminderApi(async f => {
  const scope = `employee:${f.employee.id}`;
  const draftUrl = `/api/document-drafts/${encodeURIComponent(scope)}`;
  const draftHeaders = { 'x-draft-account': 'admin' };

  // Initial read
  const initial = await f.request(draftUrl, { headers: draftHeaders });
  assert.equal(initial.status, 200);
  assert.equal(initial.json.data.values, null);

  // Write draft with document_number
  const putRes = await f.request(draftUrl, {
    method: 'PUT',
    headers: draftHeaders,
    body: {
      revision: initial.json.data.revision,
      values: {
        title: 'Draft Document',
        document_number: 'DRAFT-DOC-789',
        employee_id: f.employee.id,
        document_type_id: f.type.id,
      },
    },
  });
  assert.equal(putRes.status, 200);
  const currentRevision = putRes.json.data.revision;

  // Read back draft
  const readRes = await f.request(draftUrl, { headers: draftHeaders });
  assert.equal(readRes.status, 200);
  assert.equal(readRes.json.data.values.document_number, 'DRAFT-DOC-789');

  // Overlong document_number in draft rejected (LIMITS: 128)
  const badDraftRes = await f.request(draftUrl, {
    method: 'PUT',
    headers: draftHeaders,
    body: {
      revision: currentRevision,
      values: {
        title: 'Draft Document',
        document_number: 'x'.repeat(129),
        employee_id: f.employee.id,
        document_type_id: f.type.id,
      },
    },
  });
  assert.equal(badDraftRes.status, 400);
  assert.equal(badDraftRes.json.error.code, 'invalid_draft');

  // CAS conflict rollback test:
  // Another client updates the draft
  const newerPut = await f.request(draftUrl, {
    method: 'PUT',
    headers: draftHeaders,
    body: {
      revision: currentRevision,
      values: {
        title: 'Newer Draft Title',
        document_number: 'DRAFT-DOC-NEWER',
        employee_id: f.employee.id,
        document_type_id: f.type.id,
      },
    },
  });
  assert.equal(newerPut.status, 200);
  const newerRevision = newerPut.json.data.revision;

  // Stale client tries to save document with previous revision
  const countBefore = f.db.prepare('SELECT count(*) n FROM documents').get().n;
  const staleSaveRes = await f.request('/api/documents', {
    method: 'POST',
    body: {
      title: 'Stale Save Attempt',
      document_number: 'STALE-SAVE-001',
      employee_id: f.employee.id,
      document_type_id: f.type.id,
      expiry_date: '2028-12-31',
      draft: { scope, revision: currentRevision, account: 'admin' },
    },
  });
  assert.equal(staleSaveRes.status, 409);
  assert.equal(staleSaveRes.json.error.code, 'draft_conflict');
  // Rolled back: row count unchanged
  assert.equal(f.db.prepare('SELECT count(*) n FROM documents').get().n, countBefore);

  // Saving with current revision succeeds and finishes draft
  const validSaveRes = await f.request('/api/documents', {
    method: 'POST',
    body: {
      title: 'Valid Save Attempt',
      document_number: 'VALID-SAVE-001',
      employee_id: f.employee.id,
      document_type_id: f.type.id,
      expiry_date: '2028-12-31',
      draft: { scope, revision: newerRevision, account: 'admin' },
    },
  });
  assert.equal(validSaveRes.status, 201);
  assert.equal(validSaveRes.json.data[0].document_number, 'VALID-SAVE-001');

  // Draft is finished/tombstoned
  const postSaveDraft = await f.request(draftUrl, { headers: draftHeaders });
  assert.equal(postSaveDraft.status, 200);
  assert.equal(postSaveDraft.json.data.values, null);
}));

test('createDocumentSchema handles document_number without breaking required fields or date validation', () => {
  const schema = createDocumentSchema(key => key);

  const validEmployeeDoc = {
    title: 'Valid Employee Doc',
    beneficiary_type: 'employee',
    employee_id: 'emp-1',
    document_type_id: 'type-1',
    expiry_date: new Date(2029, 0, 1),
  };

  const validCompanyDoc = {
    title: 'Valid Company Doc',
    beneficiary_type: 'company',
    company_id: 'comp-1',
    ministry_id: 'min-1',
    document_type_id: 'type-1',
    expiry_date: new Date(2029, 0, 1),
  };

  // Optional document_number omitted succeeds
  assert.equal(schema.safeParse(validEmployeeDoc).success, true);
  assert.equal(schema.safeParse(validCompanyDoc).success, true);

  // Valid document_number succeeds
  assert.equal(schema.safeParse({ ...validEmployeeDoc, document_number: '000123' }).success, true);
  assert.equal(schema.safeParse({ ...validCompanyDoc, document_number: 'AB-001/٧' }).success, true);
  assert.equal(schema.safeParse({ ...validCompanyDoc, document_number: 'x'.repeat(128) }).success, true);

  // Overlong document_number fails
  const overlongRes = schema.safeParse({ ...validCompanyDoc, document_number: 'x'.repeat(129) });
  assert.equal(overlongRes.success, false);
  assert.ok(overlongRes.error.issues.some(i => i.path[0] === 'document_number'));

  // Missing required expiry_date still fails
  const missingExpiry = schema.safeParse({ ...validEmployeeDoc, expiry_date: undefined });
  assert.equal(missingExpiry.success, false);
  assert.ok(missingExpiry.error.issues.some(i => i.path[0] === 'expiry_date'));

  // Missing required company fields still fail
  const missingCompany = schema.safeParse({ ...validCompanyDoc, company_id: '' });
  assert.equal(missingCompany.success, false);
  assert.ok(missingCompany.error.issues.some(i => i.path[0] === 'company_id'));

  const missingMinistry = schema.safeParse({ ...validCompanyDoc, ministry_id: '' });
  assert.equal(missingMinistry.success, false);
  assert.ok(missingMinistry.error.issues.some(i => i.path[0] === 'ministry_id'));

  // Ministry 'other' requires entity_name
  const customMinistryNoEntity = schema.safeParse({
    ...validCompanyDoc,
    ministry_id: 'other',
    entity_name: '',
  });
  assert.equal(customMinistryNoEntity.success, false);
  assert.ok(customMinistryNoEntity.error.issues.some(i => i.path[0] === 'entity_name'));

  // Invalid date range (expiry < issue) still fails
  const invalidDateRange = schema.safeParse({
    ...validEmployeeDoc,
    issue_date: new Date(2029, 5, 1),
    expiry_date: new Date(2029, 0, 1),
  });
  assert.equal(invalidDateRange.success, false);
  assert.ok(invalidDateRange.error.issues.some(i => i.path[0] === 'expiry_date'));
});
