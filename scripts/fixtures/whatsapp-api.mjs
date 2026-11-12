import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {reminderFixture} from './whatsapp.mjs';
import {createApp} from '../../server/app.ts';
import {loadConfig} from '../../server/config.ts';
import {signSession} from '../../server/middleware/auth.ts';
import {Mailer} from '../../server/services/mailer.ts';
import {CronService} from '../../server/services/cronService.ts';
import {StorageService} from '../../server/services/storageService.ts';
import {DocumentService} from '../../server/services/documentService.ts';
import {WhatsAppReminders} from '../../server/notifications/whatsapp/service.ts';

export async function reminderApi(run,send,pairing={}){
 const f=reminderFixture(),dir=fs.mkdtempSync(path.join(os.tmpdir(),'romani-wa-api-'));
 const calls=[];const transport=typeof send==='object'?send:{status:async()=>({configured:true,state:'connected'}),sendText:async(phone,text)=>{calls.push({phone,text});return send?send(phone,text):{kind:'provider_accepted',messageId:'synthetic-'+calls.length};}};
 const reminders=new WhatsAppReminders(f.db,'romani',transport,()=>f.clock.now);
 const config=loadConfig({NODE_ENV:'test',JWT_SECRET:randomBytes(32).toString('hex'),DATA_DIR:dir,...pairing});
 const mailer=new Mailer(config),cron=new CronService(f.db,mailer),storage=new StorageService(config.uploadsDir);storage.ensureDirectories();
 for(const role of ['admin','viewer']) f.db.prepare("INSERT INTO admin_users(workspace_id, id,email,name,role,password_hash,created_at,updated_at) VALUES('ws_legacy', ?,?,?,?,?,'2026-01-01','2026-01-01')").run(role,role+'@example.invalid','Synthetic',role,'not-a-login-fixture');
 const documents=new DocumentService(f.db,storage);
 const app=createApp({config,db:f.db,mailer,cron,storage,documents,reminders,staticDir:dir});
 const server=http.createServer(app);
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 // `user` signs in as another account row (for example a second workspace's admin); it defaults to the role's row.
 const request=async(url,{method='GET',body,role='admin',user=role,headers={}}={})=>{
  const cookie=role?{cookie:config.cookieName+'='+signSession(config,{id:user,name:'Synthetic',email:user+'@example.invalid',role})}:{};
  const res=await fetch(base+url,{method,headers:{...cookie,...(body!==undefined?{'content-type':'application/json'}:{}),...headers},body:body===undefined?undefined:JSON.stringify(body)});
  // File routes answer with bytes; only JSON bodies are parsed.
  return {status:res.status,json:(res.headers.get('content-type')??'').includes('application/json')?await res.json():null};
 };
 try{await run({...f,reminders,calls,request,base,config,cron,documents,app,server,mailer,storage});}
 finally{await cron.shutdown();await reminders.stop();server.closeAllConnections();await new Promise(r=>server.close(r));f.close();if(!dir.startsWith(path.join(os.tmpdir(),'romani-wa-api-')))throw Error('Unsafe fixture cleanup');fs.rmSync(dir,{recursive:true,force:true});}
}
