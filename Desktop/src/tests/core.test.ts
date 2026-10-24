import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { frontier, parseJob, type Quote, type Platform } from '../domain.js';
import { Store, Pairing } from '../store.js';
import { MealService } from '../service.js';
import { startServer } from '../server.js';
import type { BrowserPort, Frame } from '../browser.js';
const food=(key:string,quantity=1)=>({key,quantity});
const quote=(id:string,price:number,items=[food('burger')],extra:Partial<Quote>={}):Quote=>({id,platform:'meituan',storeKey:'mt:store1',addressKey:'context1',batchKey:'batch1',items,totalCents:price,observedAt:new Date().toISOString(),etaText:'35分钟',checkoutVerified:true,...extra});
test('同价更多与满减多买更便宜淘汰子篮；异类内容不可相互淘汰',()=>{
  const quotes=[quote('base',2000),quote('fries',2000,[food('burger'),food('fries')]),quote('nuggets',2000,[food('burger'),food('nuggets')]),quote('dearer',2100,[food('burger'),food('fries')])];
  assert.deepEqual(frontier(quotes,3000,[food('burger')]).map(q=>q.id),['fries','nuggets']);
  assert.deepEqual(frontier([quote('a',2000),quote('b',1900,[food('burger',2)])],3000,[food('burger')]).map(q=>q.id),['b']);
});
test('完整规格、门店、地址及批次隔离；时间不参与支配；未核实金额不可获胜',()=>{
  const quotes=[quote('base',2000),quote('slower',1900,undefined,{etaText:'90分钟'}),quote('other-spec',100,[food('burger-small')]),quote('other-store',100,undefined,{storeKey:'mt:store2'}),quote('other-address',100,undefined,{addressKey:'context2'}),quote('old-batch',100,undefined,{batchKey:'old'}),quote('unverified',1,undefined,{checkoutVerified:false})];
  assert.deepEqual(frontier(quotes,3000,[food('burger')]).map(q=>q.id),['slower','other-store','other-address','old-batch']);
});
test('数量汇总，预算含上限，未知套餐不推定包含单品',()=>{
  assert.deepEqual(frontier([quote('split',3000,[food('burger'),food('burger')]),quote('one',3000),quote('over',3001,[food('burger',3)]),quote('bundle',1000,[food('opaque-combo')])],3000,[food('burger',2)]).map(q=>q.id),['split']);
  assert.throws(()=>parseJob({requestID:'x',platform:'eleme',kind:'pay',query:'x',budgetCents:3000}));
});
test('配对码一次性、过期与错误次数；设备仅保存哈希且支持撤销',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'mealcompare-auth-'));const store=new Store(join(dir,'db.sqlite'));
  try {
    const pairing=new Pairing(store), first=pairing.renew(1000);
    assert.throws(()=>pairing.pair(first.code,602000));
    const next=pairing.renew();for(let n=0;n<5;n++) assert.throws(()=>pairing.pair('wrong'));
    assert.throws(()=>pairing.pair(next.code));
    const code=pairing.renew().code, device=pairing.pair(code);
    assert.equal(store.authenticate(device.token),device.id);assert.throws(()=>pairing.pair(code));
    const bytes=await readFile(join(dir,'db.sqlite-wal'));assert.equal(bytes.includes(Buffer.from(device.token)),false);
    store.revokeDevices();assert.equal(store.authenticate(device.token),undefined);
  } finally {store.close();await rm(dir,{recursive:true,force:true});}
});
class FakeBrowser implements BrowserPort {
  calls:string[]=[]; gate:Promise<void>=Promise.resolve();
  async goto(p:Platform,url:string){this.calls.push('goto');await this.gate;}
  async script(p:Platform,name:string,request:any){this.calls.push(name+':'+request.action);return {status:'submitted',message:'搜索完成'};}
  async frame():Promise<Frame>{return {id:'frame',image:'',width:390,height:780,createdAt:Date.now(),origin:'https://h5.ele.me'};}
  async input(){this.calls.push('input');}
  async close(){}
}
test('任务幂等、接管先排空当前动作、自动化暂停、重启不重放任务',async()=>{
  const store=new Store(':memory:'),browser=new FakeBrowser(),service=new MealService(store,browser);
  let release!:()=>void;browser.gate=new Promise(resolve=>{release=resolve;});
  const input=parseJob({requestID:randomUUID(),platform:'meituan',kind:'search',query:'鸡堡',budgetCents:3000});
  const job=service.start(input);assert.equal(service.start(input).id,job.id);
  await new Promise(resolve=>setTimeout(resolve,10));
  let acknowledged=false;
  const takeover=service.takeover('meituan','phone',true).then(()=>{acknowledged=true;});
  await new Promise(resolve=>setTimeout(resolve,10));assert.equal(acknowledged,false);
  release();await takeover;
  await service.input('meituan','phone',{type:'tap',frameID:'frame',x:1,y:1});
  assert.deepEqual(browser.calls,['goto','input']);
  assert.equal(store.job(job.id)?.state,'needs-user');
  await assert.rejects(service.input('meituan','other',{type:'tap',frameID:'frame'}));
  assert.throws(()=>service.start({...input,requestID:randomUUID()}));
  await service.takeover('meituan','phone',false);await service.close();
});
test('SQLite 重开保留记录并标记运行中任务为中断',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'mealcompare-db-')),path=join(dir,'db.sqlite');
  let store=new Store(path);
  const id=randomUUID(),input=parseJob({requestID:id,platform:'eleme',kind:'inspect',query:'',budgetCents:3000});
  store.saveJob({id,input,state:'running',message:'读取中',updatedAt:new Date().toISOString()});
  store.saveRecord('record',{id:'record',totalCents:2800});store.close();store=new Store(path);
  assert.equal(store.job(id)?.state,'interrupted');assert.equal(store.records().length,1);
  store.close();await rm(dir,{recursive:true,force:true});
});
test('HTTP 拒绝未认证、跨站来源、未知命令；配对后取状态及提交任务',async()=>{
  const store=new Store(':memory:'),service=new MealService(store,new FakeBrowser()),server=await startServer(service,0);
  const url=`http://127.0.0.1:${server.port}`;
  try {
    assert.equal((await fetch(url+'/v1/status')).status,401);
    assert.equal((await fetch(url+'/v1/pair',{method:'POST',headers:{Origin:'https://bad.example'},body:JSON.stringify({code:service.pairing.current().code})})).status,403);
    const paired=await (await fetch(url+'/v1/pair',{method:'POST',body:JSON.stringify({code:service.pairing.current().code})})).json() as {token:string};
    const headers={Authorization:'Bearer '+paired.token};
    assert.equal((await fetch(url+'/v1/status',{headers})).status,200);
    assert.equal((await fetch(url+'/v1/pay',{method:'POST',headers,body:'{}'})).status,404);
    assert.equal((await fetch(url+'/v1/platforms/meituan/input',{method:'POST',headers,body:'{}'})).status,400);
    const input={requestID:randomUUID(),platform:'eleme',kind:'search',query:'牛约堡',budgetCents:3000};
    assert.equal((await fetch(url+'/v1/jobs',{method:'POST',headers,body:JSON.stringify(input)})).status,202);
    store.revokeDevices();assert.equal((await fetch(url+'/v1/status',{headers})).status,401);
  } finally {await server.close();await service.close();}
});
test('WebSocket 配对后推送变化，撤销设备即断开；消息不含配对密钥',async()=>{
  const store=new Store(':memory:'),service=new MealService(store,new FakeBrowser()),server=await startServer(service,0);
  const device=store.addDevice();
  const ws=new WebSocket(`ws://127.0.0.1:${server.port}/v1/events`,{headers:{Authorization:'Bearer '+device.token}});
  try {
    const first=once(ws,'message');await once(ws,'open');
    assert.deepEqual(JSON.parse(String((await first)[0])),{type:'changed'});
    const changed=once(ws,'message');service.emit('change');
    assert.equal(String((await changed)[0]).includes(device.token),false);
    const closed=once(ws,'close');store.revokeDevices();service.emit('change');
    assert.equal((await closed)[0],1008);
  } finally {ws.terminate();await server.close();await service.close();}
});
