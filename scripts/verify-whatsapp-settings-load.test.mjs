import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {loadWhatsAppReminderSettings} from '../src/lib/api/whatsappSettings.ts';
import {request} from '../src/lib/api/http.ts';

test('settings loader preserves sending truth across independent HTTP failures and a successful toggle',async t=>{
 const state={enabled:false,language:'en',peopleFail:false,jobsFail:false,settingsFail:false,malformed:false};
 const server=http.createServer(async(req,res)=>{
  const settings=req.url==='/api/settings';
  if(settings&&req.method==='PUT'){
   let body='';for await(const chunk of req)body+=chunk;
   state.enabled=JSON.parse(body).settings['whatsapp.enabled'];
  }
  const failed=settings?state.settingsFail:req.url.startsWith('/api/whatsapp/recipients')?state.peopleFail:state.jobsFail;
  res.writeHead(failed?503:200,{'content-type':'application/json'});
  res.end(JSON.stringify(failed?{data:null,error:{message:'Synthetic read failure',code:'unavailable'}}:
   {data:settings?{settings:{'whatsapp.enabled':state.malformed?'true':state.enabled,'whatsapp.language':state.language}}:{items:[],total:0},error:null}));
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const nativeFetch=globalThis.fetch,base='http://127.0.0.1:'+server.address().port;
 // Only browser URL resolution is adapted; production request parsing and HTTP are real.
 t.mock.method(globalThis,'fetch',(url,options)=>nativeFetch(base+url,options));
 try{
  assert.equal((await loadWhatsAppReminderSettings(0,{})).enabled,false);
  assert.equal((await request('/api/settings',{method:'PUT',body:{settings:{'whatsapp.enabled':true}}})).error,null);
  for(const [peopleFail,jobsFail] of [[true,false],[false,true],[true,true]]){
   state.peopleFail=peopleFail;state.jobsFail=jobsFail;
   const result=await loadWhatsAppReminderSettings(0,{});
   assert.equal(result.enabled,true);assert.equal(result.failed,true);
   assert.equal(result.language,'en');
   assert.equal(result.people===null,peopleFail);assert.equal(result.jobs===null,jobsFail);
  }
  state.peopleFail=false;state.jobsFail=false;
  for(const failure of ['settingsFail','malformed']){
   state[failure]=true;const result=await loadWhatsAppReminderSettings(0,{});
   assert.equal(result.enabled,null);assert.equal(result.failed,true);
   assert.deepEqual(result.people,{items:[],total:0});assert.deepEqual(result.jobs,{items:[],total:0});state[failure]=false;
  }
  assert.equal((await loadWhatsAppReminderSettings(0,{})).enabled,true);
  state.language='unsupported';assert.equal((await loadWhatsAppReminderSettings(0,{})).language,null);
  assert.equal((await loadWhatsAppReminderSettings(0,{})).failed,true);
 }finally{t.mock.restoreAll();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
