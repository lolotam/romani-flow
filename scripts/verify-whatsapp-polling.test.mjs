import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiRequestError } from '../src/lib/api/http.ts';
import { isTransientPairingReadError, startPairingStatusPolling } from '../src/lib/whatsappPairingPolling.ts';

test('temporary read failures allow continued pairing but auth and identity failures do not',()=>{
 for(const [code,status,expected] of [
  ['network_error',0,true],['provider_unavailable',502,true],
  ['project_mismatch',502,false],['invalid_provider_response',502,false],
  ['unauthorized',401,false],['forbidden',403,false],['provider_unavailable',401,false],
 ]) assert.equal(isTransientPairingReadError(new ApiRequestError('Synthetic failure',code,status)),expected,`${code}/${status}`);
 assert.equal(isTransientPairingReadError(new Error('Unexpected application failure')),false);
});

test('polling retains its original deadline across visibility changes and QR-expiry resubscription',t=>{
 t.mock.timers.enable({apis:['Date','setTimeout','setInterval'],now:0});
 let visible=true;const calls=[];const until=180_000;
 const poll=()=>calls.push(Date.now());
 let polling=startPairingStatusPolling(until,poll,()=>visible);
 try{
  t.mock.timers.tick(3000);assert.equal(calls.length,1);
  visible=false;t.mock.timers.tick(57_000);assert.equal(calls.length,1);
  // Even a subscription recreated at QR expiry must retain the original session end.
  polling.stop();visible=true;t.mock.timers.tick(3000);assert.equal(calls.length,1);
  polling=startPairingStatusPolling(until,poll,()=>visible);
  polling.check();assert.equal(calls.at(-1),63_000);
  t.mock.timers.tick(114_000);const count=calls.length;assert.ok(count>2);
  t.mock.timers.tick(3000);polling.check();assert.equal(calls.length,count);
  t.mock.timers.tick(180_000);polling.check();assert.equal(calls.length,count);
  polling.stop();polling=startPairingStatusPolling(until,poll,()=>visible);
  polling.check();assert.equal(calls.length,count,'an expired session cannot restart polling');
 }finally{polling.stop();t.mock.timers.reset();}
});
