import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyPricing } from '../server/extraction/pricing.ts';

test('pricing must not treat whitespace-padded amounts as verified zero', () => {
  assert.equal(classifyPricing({ prompt: '0', completion: '0.00' }), 'zero');
  for (const prompt of ['0\n', '0\r', '0\t', ' 0', '0 ']) {
    assert.equal(classifyPricing({ prompt, completion: '0' }), 'unverified', JSON.stringify(prompt));
  }
});
