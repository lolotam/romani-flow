import test from 'node:test';
import assert from 'node:assert/strict';
import { ExtractionSession, describeFailure, approvedErrorCode } from '../src/lib/extraction/session.ts';
import { ApiRequestError } from '../src/lib/api/http.ts';
import { fieldNames } from '../server/contracts/documentExtraction.ts';

// Helper to construct blank values dictionary matching the shared contract
function createEmptyValues(overrides = {}) {
  return {
    title: '',
    document_number: '',
    document_type_id: '',
    ministry_id: '',
    issue_date: '',
    expiry_date: '',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1. Untouched empty fields eligibility
// ---------------------------------------------------------------------------
test('untouched empty fields are eligible and filled by apply', () => {
  const session = new ExtractionSession();
  const initialValues = createEmptyValues({ title: 'civil-id-front.pdf' });
  const ticket = session.begin('account-1:new:docA', initialValues);

  const suggestions = {
    document_number: '290010112345',
    document_type_id: 'type-civil-id',
    ministry_id: 'min-moi',
    issue_date: '2024-01-15',
    expiry_date: '2026-01-15',
  };

  const patch = session.apply(ticket, suggestions, initialValues);
  assert.deepEqual(patch, {
    document_number: '290010112345',
    document_type_id: 'type-civil-id',
    ministry_id: 'min-moi',
    issue_date: '2024-01-15',
    expiry_date: '2026-01-15',
  });
});

// ---------------------------------------------------------------------------
// 2. Deliberate manual clear and edit-back protection
// ---------------------------------------------------------------------------
test('a deliberate clear and edit-back cannot be overwritten', () => {
  const session = new ExtractionSession();
  const values = createEmptyValues({ title: 'filename.pdf' });
  const ticket = session.begin('account:new:A', values);
  session.manual('document_number');
  assert.deepEqual(session.apply(ticket, { ...values, document_number: '0009' }, values), {});
});

test('edit-and-restore-original remains protected against late arrival', () => {
  const session = new ExtractionSession();
  const initial = createEmptyValues({ title: 'doc.pdf' });
  const ticket = session.begin('ctx-1', initial);

  // User types 'TEMP_NUM' then clears it back to empty string
  session.manual('document_number');
  const typed = { ...initial, document_number: 'TEMP_NUM' };
  session.manual('document_number');
  const restored = { ...typed, document_number: '' };

  // Current values have document_number === '' matching initial snapshot,
  // but version changed and field was marked manual
  const patch = session.apply(ticket, { document_number: 'AI_NUM_123' }, restored);
  assert.equal(patch.document_number, undefined);
  assert.deepEqual(patch, {});
});

// ---------------------------------------------------------------------------
// 3. Explicit clear after machine apply
// ---------------------------------------------------------------------------
test('explicit clear after machine apply protects field and prevents replacement clear leakage', () => {
  const session = new ExtractionSession();
  const initial = createEmptyValues({ title: 'docA.pdf' });
  const ticket = session.begin('ctx:fileA', initial);

  // Machine applies suggestions
  const patch = session.apply(ticket, {
    document_number: 'AI-100',
    ministry_id: 'min-moi',
  }, initial);

  const appliedState = { ...initial, ...patch };

  // User explicitly clears the machine-applied document_number
  session.manual('document_number');
  const userClearedState = { ...appliedState, document_number: '' };

  // On file replacement, only ministry_id (still machine-owned) should be cleared.
  // document_number must NOT be included in clears because the user explicitly cleared it.
  const clears = session.replace(userClearedState);
  assert.deepEqual(clears, {
    ministry_id: '',
  });
  assert.equal(clears.document_number, undefined);

  // Subsequent suggestions for document_number in a new ticket must also be rejected
  const nextTicket = session.begin('ctx:fileB', userClearedState);
  const nextPatch = session.apply(nextTicket, { document_number: 'AI-200' }, userClearedState);
  assert.equal(nextPatch.document_number, undefined);
  assert.deepEqual(nextPatch, {});
});

// ---------------------------------------------------------------------------
// 4. Value changed without manual call
// ---------------------------------------------------------------------------
test('value changed in form without explicit manual() call is not overwritten by apply', () => {
  const session = new ExtractionSession();
  const initial = createEmptyValues({ title: 'doc.pdf' });
  const ticket = session.begin('ctx:no-manual', initial);

  // Form value changed from empty to typed string without session.manual() having fired
  const currentWithTyped = { ...initial, document_number: 'DIRECT_INPUT' };
  const patch1 = session.apply(ticket, { document_number: 'AI_SUGGESTION' }, currentWithTyped);
  assert.equal(patch1.document_number, undefined);
  assert.deepEqual(patch1, {});

  // Form value started non-empty and changed to empty without manual() call
  const session2 = new ExtractionSession();
  const initialNonEmpty = createEmptyValues({ document_number: 'INITIAL_STORED' });
  const ticket2 = session2.begin('ctx:non-empty', initialNonEmpty);
  const currentClearedDirectly = { ...initialNonEmpty, document_number: '' };
  const patch2 = session2.apply(ticket2, { document_number: 'AI_SUGGESTION' }, currentClearedDirectly);
  assert.equal(patch2.document_number, undefined);
  assert.deepEqual(patch2, {});
});

// ---------------------------------------------------------------------------
// 5. Draft-restored and stored edit protection
// ---------------------------------------------------------------------------
test('draft-restored empty/null keys stay protected', () => {
  const session = new ExtractionSession();
  // Draft had keys present for document_number and expiry_date (even if empty in form)
  session.protect(['document_number', 'expiry_date']);

  const values = createEmptyValues();
  const ticket = session.begin('account:draft:restore', values);

  const suggestions = {
    document_number: 'AI-777',
    document_type_id: 'type-pass',
    expiry_date: '2027-12-31',
  };

  const patch = session.apply(ticket, suggestions, values);
  // document_number and expiry_date must not be overwritten; document_type_id may be filled
  assert.equal(patch.document_number, undefined);
  assert.equal(patch.expiry_date, undefined);
  assert.equal(patch.document_type_id, 'type-pass');
});

test('stored edit values protected across all fields', () => {
  const session = new ExtractionSession();
  // In edit mode, all fields are protected from AI automatic overwrite
  session.protect([...fieldNames]);

  const existingValues = {
    title: 'Existing Certificate',
    document_number: 'OLD-999',
    document_type_id: 'type-cert',
    ministry_id: 'min-moe',
    issue_date: '2020-05-01',
    expiry_date: '2025-05-01',
  };

  const ticket = session.begin('edit:doc-999', existingValues);
  const suggestions = {
    title: 'Suggested Certificate',
    document_number: 'NEW-000',
    document_type_id: 'type-other',
  };

  const patch = session.apply(ticket, suggestions, existingValues);
  assert.deepEqual(patch, {});
});

// ---------------------------------------------------------------------------
// 6. Filename title preservation
// ---------------------------------------------------------------------------
test('filename title is preserved and never automatically overwritten', () => {
  const session = new ExtractionSession();
  const initialValues = createEmptyValues({ title: 'MyScannedFile.pdf' });
  const ticket = session.begin('new:title-check', initialValues);

  const suggestions = {
    title: 'AI Extracted Title From Header',
    document_number: '12345',
  };

  const patch = session.apply(ticket, suggestions, initialValues);
  // title had 'MyScannedFile.pdf' (non-empty), so automatic apply must ignore title
  assert.equal(patch.title, undefined);
  assert.equal(patch.document_number, '12345');
});

// ---------------------------------------------------------------------------
// 7. Cross-attachment / replacement races
// ---------------------------------------------------------------------------
test('result for attachment A arriving after B selection is ignored', () => {
  const session = new ExtractionSession();
  const valuesA = createEmptyValues({ title: 'fileA.pdf' });
  const ticketA = session.begin('ctx:fileA', valuesA);

  const valuesB = createEmptyValues({ title: 'fileB.pdf' });
  const ticketB = session.begin('ctx:fileB', valuesB);

  // Late arrival of A
  const patchA = session.apply(ticketA, { document_number: 'A-NUM' }, valuesB);
  assert.deepEqual(patchA, {});

  // B arrives and applies
  const patchB = session.apply(ticketB, { document_number: 'B-NUM' }, valuesB);
  assert.deepEqual(patchB, { document_number: 'B-NUM' });
});

test('A-applied unchanged clears on replacement', () => {
  const session = new ExtractionSession();
  const values = createEmptyValues({ title: 'fileA.pdf' });
  const ticket = session.begin('ctx:fileA', values);

  const patch = session.apply(ticket, {
    document_number: 'AI-100',
    ministry_id: 'min-moi',
  }, values);

  const currentValues = { ...values, ...patch };

  // User did not edit the AI-applied fields; then replaces file
  const clears = session.replace(currentValues);
  assert.deepEqual(clears, {
    document_number: '',
    ministry_id: '',
  });

  // Ticket A is now invalidated
  assert.equal(session.current(ticket), false);
});

test('A-applied then edited or cleared remains on replacement', () => {
  const session = new ExtractionSession();
  const values = createEmptyValues({ title: 'fileA.pdf' });
  const ticket = session.begin('ctx:fileA', values);

  const patch = session.apply(ticket, {
    document_number: 'AI-100',
    ministry_id: 'min-moi',
  }, values);

  // User manually edits document_number
  session.manual('document_number');
  const userEditedValues = {
    ...values,
    ...patch,
    document_number: 'USER-EDITED-999',
  };

  // On replace, only ministry_id (still machine-owned) should be cleared
  const clears = session.replace(userEditedValues);
  assert.deepEqual(clears, {
    ministry_id: '',
  });
  assert.equal(clears.document_number, undefined);
});

// ---------------------------------------------------------------------------
// 8. Same-context retry
// ---------------------------------------------------------------------------
test('same-context retry increments ticket epoch and invalidates earlier result', () => {
  const session = new ExtractionSession();
  const values = createEmptyValues({ title: 'retry-file.pdf' });

  // First attempt on this context
  const ticket1 = session.begin('account:doc:ctx-same', values);
  // User hits retry with the same context and values
  const ticket2 = session.begin('account:doc:ctx-same', values);

  assert.notEqual(ticket1.id, ticket2.id, 'Retry must generate a new unique ticket ID');
  assert.equal(session.current(ticket1), false, 'First ticket must be invalidated by retry');
  assert.equal(session.current(ticket2), true, 'Second ticket must be currently active');

  // Result from try 1 arrives late -> must be discarded
  const latePatch = session.apply(ticket1, { document_number: 'LATE-NUM-1' }, values);
  assert.deepEqual(latePatch, {});

  // Result from try 2 arrives -> must be applied
  const validPatch = session.apply(ticket2, { document_number: 'VALID-NUM-2' }, values);
  assert.deepEqual(validPatch, { document_number: 'VALID-NUM-2' });
});

// ---------------------------------------------------------------------------
// 9. Snapshot copy behavior
// ---------------------------------------------------------------------------
test('caller mutation of input object does not corrupt ticket internal snapshot', () => {
  const session = new ExtractionSession();
  const inputObject = createEmptyValues({ title: 'input.pdf', document_number: '' });

  const ticket = session.begin('ctx:snapshot', inputObject);

  // Caller mutates the object passed to begin()
  inputObject.document_number = 'MUTATED_AFTER_BEGIN';

  // The ticket's stored snapshot values must remain untouched
  assert.equal(ticket.values.document_number, '');

  // Current values still empty: apply should succeed based on snapshot equality
  const current = createEmptyValues({ title: 'input.pdf', document_number: '' });
  const patch = session.apply(ticket, { document_number: 'AI-VALUE' }, current);
  assert.deepEqual(patch, { document_number: 'AI-VALUE' });
});

// ---------------------------------------------------------------------------
// 10. Context / Catalog / Settings / Discard / Close / Save invalidation
// ---------------------------------------------------------------------------
test('account/context/catalog/settings change/discard/close/save invalidate session', () => {
  const session = new ExtractionSession();
  const values = createEmptyValues();
  const ticket = session.begin('accountA:scope:1', values);

  // Invalidation triggered by context change or close attempt
  session.invalidate();

  const patch = session.apply(ticket, { document_number: 'LATE-NUM' }, values);
  assert.deepEqual(patch, {});
});

// ---------------------------------------------------------------------------
// 11. Session reset vs Rejected close
// ---------------------------------------------------------------------------
test('rejected close does not reset manual protection; reset starts clean session', () => {
  const session = new ExtractionSession();
  const values = createEmptyValues();
  session.manual('document_number');

  // Close attempt begins: session is invalidated, but NOT reset
  session.invalidate();
  // Close confirmation rejected by user -> protection MUST remain intact
  const ticketAfterCancel = session.begin('ctx:after-cancel-close', values);
  const patchAfterCancel = session.apply(ticketAfterCancel, { document_number: 'SHOULD-NOT-APPLY' }, values);
  assert.deepEqual(patchAfterCancel, {});

  // Save & Add Next completes successfully -> reset is called
  session.reset();

  // Fresh session: document_number is no longer protected
  const freshTicket = session.begin('ctx:fresh', values);
  const freshPatch = session.apply(freshTicket, { document_number: 'FRESH-NUM' }, values);
  assert.deepEqual(freshPatch, { document_number: 'FRESH-NUM' });
});

// ---------------------------------------------------------------------------
// 12. Metadata draft cleanup exact patch
// ---------------------------------------------------------------------------
test('cleanup returns exact expected empty field values without leaking payload or machine provenance', () => {
  const session = new ExtractionSession();
  const values = createEmptyValues();
  const ticket = session.begin('ctx:meta-clean', values);

  session.apply(ticket, {
    document_number: 'AI-NUM',
    document_type_id: 'type-id',
  }, values);

  const current = { ...values, document_number: 'AI-NUM', document_type_id: 'type-id' };
  const clears = session.replace(current);

  // Assert exact expected patch shape: exactly the two machine-owned keys cleared to empty string
  assert.deepEqual(clears, {
    document_number: '',
    document_type_id: '',
  });

  // Explicitly verify zero extra or leaked properties
  assert.equal(clears.provider, undefined);
  assert.equal(clears.confidence, undefined);
  assert.equal(clears.raw, undefined);
  assert.equal(clears.ministry_id, undefined);
  assert.equal(clears.title, undefined);
});

// ---------------------------------------------------------------------------
// 13. Pure-Class ExtractionSession Unit Characterization: Field Protection & Invalidation
// ---------------------------------------------------------------------------

test('pure-class ExtractionSession: manual field protection prevents ticket suggestion overwrites across simulated edits', () => {
  const session = new ExtractionSession();
  const initial = createEmptyValues({ title: 'contract.pdf' });
  const ticket = session.begin('ctx:doc-1', initial);

  // Machine applies document_number and document_type_id
  const patch1 = session.apply(ticket, {
    document_number: '290010112345',
    document_type_id: 'type-civil-id',
  }, initial);

  assert.deepEqual(patch1, {
    document_number: '290010112345',
    document_type_id: 'type-civil-id',
  });

  const currentValues = { ...initial, ...patch1 };

  // Deliberately empty supported fields require manual protection, not a nonempty-value guard.
  session.manual('issue_date');
  session.manual('expiry_date');
  const userEditedValues = {
    ...currentValues,
    issue_date: '',
    expiry_date: '',
  };

  // A late second suggestion attempts to fill both protected empty dates.
  const secondPatch = session.apply(ticket, {
    issue_date: '2024-01-01',
    expiry_date: '2026-01-01',
    document_number: '290010112345',
  }, userEditedValues);

  // User-edited manual fields are rejected; unchanged document_number is not re-applied
  assert.equal(secondPatch.issue_date, undefined);
  assert.equal(secondPatch.expiry_date, undefined);
  assert.equal(secondPatch.document_number, undefined);
  assert.deepEqual(secondPatch, {});
});

test('pure-class ExtractionSession: session invalidation marks ticket not current and drops late suggestion application', () => {
  const session = new ExtractionSession();
  const initial = createEmptyValues({ title: 'doc.pdf' });
  const ticket = session.begin('ctx:cancel-test', initial);

  assert.equal(session.current(ticket), true);

  // Invalidation simulates cancellation (such as aborting rendering or clearing context)
  session.invalidate();

  assert.equal(session.current(ticket), false);

  // Late arrival on invalidated ticket produces an empty patch
  const latePatch = session.apply(ticket, {
    document_number: 'AI-LATE-123',
    document_type_id: 'type-civil-id',
  }, initial);

  assert.deepEqual(latePatch, {}, 'Invalidated session must produce empty patch on late arrival');
});

// CodeRabbit 4504592822: 403 policy failures must retain the approved UI reason.
for (const [wireCode, approved, forbiddenCode] of [
  ['processing_not_authorized', 'processing_not_authorized', 'processing_not_authorized'],
  ['extraction_disabled', 'extraction_disabled', 'extraction_disabled'],
  ['provider_not_configured', 'unconfigured', 'unconfigured'],
  ['provider_policy', 'provider_policy', 'provider_policy'],
  ['invalid_origin', 'origin_forbidden', 'origin_forbidden'],
  ['forbidden', 'forbidden', 'forbidden'],
  ['unrecognized-private-reason', 'network_error', 'forbidden'],
  ['constructor', 'network_error', 'forbidden'],
  ['toString', 'network_error', 'forbidden'],
  ['__proto__', 'network_error', 'forbidden'],
]) {
  test(`PR16 403 mapping: ${wireCode}`, () => {
    const outcome = describeFailure(new ApiRequestError('Never display raw server message', wireCode, 403));
    assert.deepEqual({ outcome, approved: approvedErrorCode(wireCode) }, {
      outcome: { phase: 'unavailable', errorCode: forbiddenCode, retryAfterSeconds: null }, approved,
    });
  });
}

// The server refuses a changed setting, a changed catalogue and a changed
// account with its own codes. They must reach the form as the conflict they
// are, never as a connection failure that hides the reason.
for (const [wireCode, status, expected] of [
  ['stale_settings', 409, 'extraction_conflict'],
  ['stale_catalog', 409, 'extraction_conflict'],
  ['account_mismatch', 409, 'extraction_conflict'],
  ['unsupported_media_type', 415, 'invalid_request'],
  ['invalid_provider', 400, 'invalid_provider'],
]) {
  test(`refusal mapping keeps the reason of the server: ${wireCode}`, () => {
    const outcome = describeFailure(new ApiRequestError('Never display raw server message', wireCode, status));
    assert.deepEqual({ outcome, approved: approvedErrorCode(wireCode) }, {
      outcome: { phase: 'failed', errorCode: expected, retryAfterSeconds: null },
      approved: expected,
    });
  });
}
