import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { parseJob, platforms, type Platform } from './domain.js';
import { MealService, friendlyError } from './service.js';
const json=(res:ServerResponse,status:number,body:unknown)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(body));};
async function body(req:IncomingMessage) {
  const chunks:Buffer[]=[]; let size=0;
  for await (const chunk of req) {size+=chunk.length;if (size>16384) throw Error('请求过大');chunks.push(chunk);}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
export async function startServer(service:MealService,port=3000) {
  const auth=(req:IncomingMessage)=>service.store.authenticate((req.headers.authorization??'').replace(/^Bearer /,''));
  const server=createServer(async(req,res)=>{
    try {
      // Native clients omit Origin; no browser-origin calls or cross-site pairing.
      if (req.headers.origin) return json(res,403,{error:'请使用饭价原生 App 连接'});
      const path=new URL(req.url??'/', 'http://localhost').pathname;
      if (path==='/v1/pair' && req.method==='POST') return json(res,200,service.pairing.pair((await body(req)).code));
      const device=auth(req); if (!device) return json(res,401,{error:'请先配对电脑'});
      if (path==='/v1/status' && req.method==='GET') return json(res,200,service.snapshot());
      if (path==='/v1/jobs' && req.method==='POST') return json(res,202,service.start(parseJob(await body(req))));
      const match=/^\/v1\/platforms\/(meituan|eleme)\/(takeover|frame|input|home)$/.exec(path);
      if (match && platforms.includes(match[1] as Platform)) {
        const p=match[1] as Platform, action=match[2];
        if (action==='frame' && req.method==='GET') return json(res,200,await service.frame(p));
        if (req.method==='POST') {
          const data=await body(req);
          if (action==='takeover') {if (typeof data.active!=='boolean') throw Error('接管状态无效');await service.takeover(p,device,data.active);}
          else if (action==='input') await service.input(p,device,data);
          else if (action==='home') await service.home(p,device);
          else return json(res,404,{error:'没有此操作'});
          return json(res,200,{ok:true});
        }
      }
      json(res,404,{error:'没有此操作'});
    } catch(error) {json(res,400,{error:friendlyError(error)});}
  });
  const sockets=new WebSocketServer({noServer:true,maxPayload:1024});
  const clients=new Map<WebSocket,string>();
  server.on('upgrade',(req,socket,head)=>{
    const device=auth(req), token=(req.headers.authorization??'').replace(/^Bearer /,'');
    if (!device || req.headers.origin || req.url!=='/v1/events') {socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');socket.destroy();return;}
    sockets.handleUpgrade(req,socket,head,ws=>{clients.set(ws,token);ws.on('close',()=>clients.delete(ws));ws.send(JSON.stringify({type:'changed'}));});
  });
  const broadcast=()=>{for(const [ws,token] of clients){
    if (!service.store.authenticate(token)) {ws.close(1008);continue;}
    if (ws.readyState===WebSocket.OPEN && ws.bufferedAmount<65536) ws.send(JSON.stringify({type:'changed'}));
  }};
  service.on('change',broadcast);
  await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
  return {port:(server.address() as {port:number}).port,close:async()=>{
    service.off('change',broadcast);for(const ws of clients.keys()) ws.terminate();sockets.close();
    server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));
  }};
}
