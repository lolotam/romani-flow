import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiRequestError } from '../src/lib/api/http.ts';
import { pairingFailureCode, PAIRING_FAILURE_CODES } from '../src/lib/whatsappPairingFailure.ts';
import { settings as arabicSettings } from '../src/translations/ar/settings.ts';
import { settings as englishSettings } from '../src/translations/en/settings.ts';

/**
 * The reason the pairing panel stays unusable.
 *
 * The panel used to answer every provider failure with the same sentence, so
 * a refused key and a provider that cannot be reached looked the same to the
 * operator. The code travels with the answer, and every code has its own
 * sentence in both languages.
 */

test('the pairing failure keeps the code the server named', () => {
  assert.equal(pairingFailureCode(new ApiRequestError('x', 'provider_unauthorized', 502)), 'provider_unauthorized');
  assert.equal(pairingFailureCode(new ApiRequestError('x', 'provider_unavailable', 502)), 'provider_unavailable');
  assert.equal(pairingFailureCode(new ApiRequestError('x', 'instance_not_ready', 502)), 'instance_not_ready');
  assert.equal(pairingFailureCode(new ApiRequestError('x', 'project_mismatch', 502)), 'project_mismatch');
});

test('a failure without a known code stays unnamed', () => {
  assert.equal(pairingFailureCode(new Error('boom')), null);
  assert.equal(pairingFailureCode(null), null);
  assert.equal(pairingFailureCode({ code: 'something_else' }), null);
  assert.equal(pairingFailureCode({ code: 42 }), null);
});

test('every pairing failure has a sentence in both languages', () => {
  for (const code of PAIRING_FAILURE_CODES) {
    const arabic = arabicSettings.whatsapp.failures[code];
    const english = englishSettings.whatsapp.failures[code];
    assert.equal(typeof arabic, 'string', `the Arabic sentence of ${code} exists`);
    assert.equal(typeof english, 'string', `the English sentence of ${code} exists`);
    assert.ok(arabic.length > 10, `the Arabic sentence of ${code} says something`);
    assert.ok(english.length > 10, `the English sentence of ${code} says something`);
  }
});
