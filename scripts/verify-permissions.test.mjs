import test from 'node:test';
import assert from 'node:assert/strict';
import { canEdit, isOwner } from '../src/lib/permissions.ts';

test('workspace role permissions mirror the server role matrix', () => {
  const cases = [
    { role: 'admin', canEdit: true, isOwner: true },
    { role: 'owner', canEdit: true, isOwner: true },
    { role: 'editor', canEdit: true, isOwner: false },
    { role: 'viewer', canEdit: false, isOwner: false },
    { role: 'unknown', canEdit: false, isOwner: false },
    { role: null, canEdit: false, isOwner: false },
    { role: undefined, canEdit: false, isOwner: false },
  ];

  for (const expected of cases) {
    assert.equal(canEdit(expected.role), expected.canEdit, `canEdit(${expected.role})`);
    assert.equal(isOwner(expected.role), expected.isOwner, `isOwner(${expected.role})`);
  }
});
