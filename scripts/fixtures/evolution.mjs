import http from 'node:http';
import {randomBytes} from 'node:crypto';

/** Synthetic HTTP boundary only: no DNS, native QR, contacts or real provider. */
export async function loopbackEvolution(run){
 const key=randomBytes(32).toString('hex'),secret=randomBytes(32).toString('hex');
 const mode={state:'open',loseResponse:false},sends=[],requests=[];
 const server=http.createServer(async(req,res)=>{
  requests.push({method:req.method,path:req.url});res.setHeader('content-type','application/json');
  if(req.headers.apikey!==key||!req.url.endsWith('/romani')){res.writeHead(401);res.end('{}');return;}
  if(req.url==='/instance/connectionState/romani'&&req.method==='GET'){res.end(JSON.stringify({instance:{instanceName:'romani',state:mode.state},apikey:key}));return;}
  if(req.url!=='/message/sendText/romani'||req.method!=='POST'){res.writeHead(404);res.end('{}');return;}
  const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=JSON.parse(Buffer.concat(chunks).toString());sends.push(body);
  if(mode.loseResponse){req.socket.destroy();return;}
  res.writeHead(201);res.end(JSON.stringify({key:{id:'synthetic-'+sends.length,fromMe:true,remoteJid:body.number+'@s.whatsapp.net'},apikey:key,message:{conversation:body.text}}));
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const config={url:'http://127.0.0.1:'+server.address().port,apiKey:key,instance:'romani',webhookSecret:secret};
 const env={ROMANI_EVOLUTION_URL:config.url,ROMANI_EVOLUTION_API_KEY:key,ROMANI_EVOLUTION_INSTANCE:config.instance,ROMANI_EVOLUTION_WEBHOOK_SECRET:secret};
 try{await run({config,env,mode,sends,requests});}finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
}
