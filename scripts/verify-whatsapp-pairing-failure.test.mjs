import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiRequestError } from '../src/lib/api/http.ts';
import { pairingFailureCode, pairingStateFailure, PAIRING_FAILURE_CODES } from '../src/lib/whatsappPairingFailure.ts';
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
  // Every documented code round-trips: a typo in the catalog would otherwise
  // fall back to the general alert at runtime without failing a test.
  for (const code of PAIRING_FAILURE_CODES) {
    assert.equal(pairingFailureCode(new ApiRequestError('x', code, 502)), code, `${code} keeps its name`);
  }
});

test('a failure without a known code stays unnamed', () => {
  assert.equal(pairingFailureCode(new Error('boom')), null);
  assert.equal(pairingFailureCode(null), null);
  assert.equal(pairingFailureCode({ code: 'something_else' }), null);
  assert.equal(pairingFailureCode({ code: 42 }), null);
});

test('every code the pairing stack emits is named', () => {
  // The codes the pairing routes, the pairing client and the HTTP wrapper
  // can answer with. A code that is missing here leaves the operator with the
  // general sentence instead of the reason.
  const emitted = [
    'whatsapp_not_configured',
    'provider_unauthorized',
    'provider_unavailable',
    'instance_not_ready',
    'project_mismatch',
    'connection_state_unknown',
    'invalid_provider_response',
    'qr_unavailable',
    'disconnect_pending',
    'pairing_rate_limited',
    'invalid_response',
    'request_timeout',
    'network_error',
    'http_error',
  ];
  for (const code of emitted) {
    assert.equal(pairingFailureCode(new ApiRequestError('x', code, 502)), code, `${code} keeps its name`);
  }
});

test('a state the provider did not explain names its reason', () => {
  assert.equal(pairingStateFailure('unknown'), 'connection_state_unknown');
  assert.equal(pairingStateFailure('connected'), null);
  assert.equal(pairingStateFailure('disconnected'), null);
  assert.equal(pairingStateFailure('connecting'), null);
  assert.equal(pairingStateFailure(undefined), null);
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

test('the Arabic sentences keep the register of the panel', () => {
  // The pairing panel speaks Modern Standard Arabic. A colloquial sentence in
  // the middle of it is the mix a reviewer named, and it reads like a
  // different product in the same card.
  const colloquial = ['مش ', 'اتأكد', 'بتاع', 'استنى', 'رجّع', 'شغال', 'تاني', 'أوي', 'لسه', 'كمان', 'لازم', 'يعني ', 'بس '];
  for (const code of PAIRING_FAILURE_CODES) {
    const arabic = arabicSettings.whatsapp.failures[code];
    for (const word of colloquial) {
      assert.equal(arabic.includes(word), false, `${code} keeps the register of the panel (no ${word})`);
    }
  }
});
