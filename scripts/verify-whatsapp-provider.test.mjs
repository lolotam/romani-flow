import test from 'node:test';import assert from 'node:assert/strict';import http from 'node:http';import {randomBytes} from 'node:crypto';
import {MessageClient} from '../server/whatsapp/messageClient.ts';import {EMPLOYEE_PHONE} from './fixtures/whatsapp.mjs';
// Source contract f1100ad: SHA256 746bd874f587bced5668145695710fca40957994787a1d80849416d185294c4c.
async function provider(run){
 const apiKey=randomBytes(32).toString('hex'),calls=[];
 const mode={status:201,payload:{key:{id:'synthetic-id',fromMe:true,remoteJid:'99900000001@s.whatsapp.net'}},raw:null};
 const server=http.createServer(async(req,res)=>{const chunks=[];for await(const chunk of req)chunks.push(chunk);calls.push({path:req.url,method:req.method,authorized:req.headers.apikey===apiKey,body:JSON.parse(Buffer.concat(chunks).toString())});
  if(mode.status===302)res.setHeader('location','http://foreign.example.invalid/');res.writeHead(mode.status,{'content-type':'application/json'});res.end(mode.raw??JSON.stringify(mode.payload));});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const config={url:'http://127.0.0.1:'+server.address().port,apiKey,instance:'romani',webhookSecret:randomBytes(32).toString('hex')};
 try{await run({client:new MessageClient(config),mode,calls,config,server});}finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
}

test('pinned send request uses only fixed path, scoped header and stored text; extra body never escapes',()=>provider(async f=>{
 f.mode.payload.apikey=f.config.apiKey;f.mode.payload.chats=['must-not-leak'];
 const result=await f.client.sendText(EMPLOYEE_PHONE,'Synthetic reminder');assert.deepEqual(result,{kind:'provider_accepted',messageId:'synthetic-id'});
 assert.deepEqual(f.calls,[{path:'/message/sendText/romani',method:'POST',authorized:true,body:{number:'99900000001',text:'Synthetic reminder',linkPreview:false}}]);
 assert.equal(f.calls[0].path.includes('?'),false);
 assert.equal(JSON.stringify(result).includes(f.config.apiKey),false);
}));

test('native broad400,429,5xx and redirects are uncertain, not safe retries',()=>provider(async f=>{
 for(const status of [400,429,500,503,302]){f.mode.status=status;f.mode.payload={error:'must-not-leak'};const r=await f.client.sendText(EMPLOYEE_PHONE,'Synthetic');assert.equal(r.kind,'unknown');assert.equal(JSON.stringify(r).includes('must-not-leak'),false);}
 assert.equal(f.calls.length,5);
 for(const status of [401,403]){f.mode.status=status;assert.deepEqual(await f.client.sendText(EMPLOYEE_PHONE,'Synthetic'),{kind:'permanent_failed',code:'provider_unauthorized'});}
}));

test('missing IDs or destination, wrong destination, foreign instance, malformed and oversized success remain unknown',()=>provider(async f=>{
 for(const payload of [{},{key:{id:'id',fromMe:false}},{key:{id:'id',fromMe:true}},{key:{id:'id',fromMe:true,remoteJid:'99900000002@s.whatsapp.net'}},{instanceName:'curemed',key:{id:'id',fromMe:true,remoteJid:'99900000001@s.whatsapp.net'}},null]){f.mode.payload=payload;assert.equal((await f.client.sendText(EMPLOYEE_PHONE,'Synthetic')).kind,'unknown');}
 for(const raw of ['{',JSON.stringify({key:{id:'id',fromMe:true},extra:'x'.repeat(70000)})]){f.mode.raw=raw;assert.equal((await f.client.sendText(EMPLOYEE_PHONE,'Synthetic')).kind,'unknown');}
}));

test('invalid local input/config makes no request; verified connection refusal may retry',()=>provider(async f=>{
 assert.equal((await f.client.sendText('group@g.us','Synthetic')).kind,'permanent_failed');assert.equal((await f.client.sendText(EMPLOYEE_PHONE,'')).kind,'permanent_failed');assert.equal(f.calls.length,0);
 for(const config of [{...f.config,instance:'curemed'},{...f.config,instance:'romani-other'},{...f.config,url:f.config.url+'?instanceName=curemed'},{...f.config,url:f.config.url+'?'},{...f.config,url:f.config.url+'/prefix'}]){
  assert.equal((await new MessageClient(config).sendText(EMPLOYEE_PHONE,'Synthetic')).kind,'permanent_failed');assert.equal(f.calls.length,0);
 }
 const address=f.server.address();await new Promise(r=>f.server.close(r));
 const refused=new MessageClient({...f.config,url:'http://127.0.0.1:'+address.port});const r=await refused.sendText(EMPLOYEE_PHONE,'Synthetic');assert.equal(r.kind,'retryable_failed');
}));

test('only DNS or refused connection is retryable; resets, timeouts, aborts and generic fetch failures stay unknown',()=>provider(async f=>{
 const original=globalThis.fetch;
 try{
  for(const code of ['ENOTFOUND','EAI_AGAIN','ECONNREFUSED','ECONNRESET','UND_ERR_SOCKET',undefined]){
   globalThis.fetch=async()=>{throw new TypeError('Synthetic transport failure',{cause:code?{code}:undefined});};
   const outcome=await f.client.sendText(EMPLOYEE_PHONE,'Synthetic');
   assert.equal(outcome.kind,['ENOTFOUND','EAI_AGAIN','ECONNREFUSED'].includes(code)?'retryable_failed':'unknown',String(code));
  }
  for(const name of ['TimeoutError','AbortError']){
   globalThis.fetch=async()=>{throw new DOMException('Synthetic interruption',name);};assert.equal((await f.client.sendText(EMPLOYEE_PHONE,'Synthetic')).kind,'unknown');
  }
 }finally{globalThis.fetch=original;}
 assert.equal(f.calls.length,0);
}));
