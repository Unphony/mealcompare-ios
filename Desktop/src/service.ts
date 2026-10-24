import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { homes, searches, platforms, type Platform, type Job, type JobInput } from './domain.js';
import { Store, Pairing } from './store.js';
import type { BrowserPort, RemoteInput } from './browser.js';
export class MealService extends EventEmitter {
  pairing:Pairing;
  private queues=new Map<Platform,Promise<unknown>>();
  private generation=new Map<Platform,number>();
  private owners=new Map<Platform,string>();
  private busy=new Map<Platform,string>();
  private executions=new Set<Promise<void>>();
  constructor(public store:Store,private browser:BrowserPort) { super(); this.pairing=new Pairing(store); this.pairing.renew(); }
  private serial<T>(p:Platform,action:()=>Promise<T>):Promise<T> {
    const next=(this.queues.get(p)??Promise.resolve()).catch(()=>{}).then(action);
    this.queues.set(p,next); return next;
  }
  snapshot() { return {version:'0.3.0',jobs:this.store.jobs(),records:this.store.records(),history:this.store.history(),
    platforms:platforms.map(platform=>({platform,controlled:this.owners.has(platform),busy:this.busy.has(platform)}))}; }
  private update(job:Job,state:Job['state'],message:string,result?:unknown) {
    Object.assign(job,{state,message,updatedAt:new Date().toISOString(),result});
    this.store.saveJob(job); this.emit('change');
  }
  start(input:JobInput):Job {
    const previous=this.store.job(input.requestID);
    if (previous) {
      if (JSON.stringify(previous.input)!==JSON.stringify(input)) throw Error('请求编号已用于其他条件');
      return previous;
    }
    if (this.owners.has(input.platform)) throw Error('请先结束手机接管，再发起查询');
    if (this.busy.has(input.platform)) throw Error('该平台已有查询正在进行');
    const job:Job={id:input.requestID,input,state:'running',message:'电脑已接收查询',updatedAt:new Date().toISOString()};
    this.busy.set(input.platform,job.id); this.store.saveJob(job); this.emit('change');
    const execution=this.execute(job);this.executions.add(execution);
    void execution.finally(()=>this.executions.delete(execution));
    return job;
  }
  private async execute(job:Job) {
    const p=job.input.platform, generation=this.generation.get(p)??0;
    const guard=()=>{if (generation!==(this.generation.get(p)??0)||this.owners.has(p)) throw Error('已暂停，手机接管结束后请核对页面并重新查询');};
    const step=<T>(action:()=>Promise<T>)=>this.serial(p,async()=>{guard();const result=await action();guard();return result;});
    try {
      if (job.input.kind==='search') {
        this.update(job,'running','正在打开平台搜索页');
        await step(()=>this.browser.goto(p,searches[p]));
        let result:any;
        for (let n=0;n<12;n++) {
          result=await step(()=>this.browser.script(p,'Probe',{action:'search',query:job.input.query}));
          if (result.status!=='waiting') break;
          await new Promise(resolve=>setTimeout(resolve,500)); guard();
        }
        if (result?.status==='prepared') result=await step(()=>this.browser.script(p,'Probe',{action:'submit-search',query:job.input.query}));
        this.update(job,result?.status==='submitted'?'completed':'needs-user', result?.message??'需要在手机接管中继续搜索',result);
      } else if (job.input.kind==='history') {
        const result=await step(()=>this.browser.script(p,'History',{action:'read'}));
        if (result.status==='ready' && Array.isArray(result.entries)) this.store.saveHistory(p,result.entries);
        this.update(job,result.status==='ready'?'completed':'needs-user',result.message,result);
      } else {
        this.update(job,'running','正在读取当前结算页');
        let last='',stable=0,result:any;
        for (let n=0;n<12;n++) {
          result=await step(()=>this.browser.script(p,'Probe',{action:'inspect'}));
          const amounts=[...new Set((result.prices??[]).map((x:any)=>x.cents))];
          if (result.hasLoginInput || result.addressRequired) break;
          const key=JSON.stringify([amounts,result.deliveryHints]);
          stable=result.checkoutLikely && amounts.length===1 && result.addressRequired===false ? (key===last?stable+1:1):0;
          last=key;
          if (stable>=3) break;
          await new Promise(resolve=>setTimeout(resolve,500)); guard();
        }
        guard();
        if (stable<3) this.update(job,'needs-user','请接管电脑网页，选好地址与餐品并进入提交订单前页面，再重新检测',result);
        else {
          const record={id:randomUUID(),platform:p,observedAt:new Date().toISOString(),totalCents:result.prices[0].cents,
            etaText:(result.deliveryHints??[]).join(' / '),checkoutVerified:false,
            note:'当前页面候选金额。尚未核实完整购物篮、具体门店及配送地址，不进入正式前沿。'};
          this.store.saveRecord(record.id,record);
          this.update(job,'completed','已保存稳定的候选金额；完整购物篮比较尚待接入',record);
        }
      }
    } catch (error) {
      this.update(job,'needs-user',generation!==(this.generation.get(p)??0)?'手机已接管，查询暂停；结束接管后重新检测当前页面':friendlyError(error));
    } finally { this.busy.delete(p);this.emit('change'); }
  }
  async takeover(p:Platform,device:string,active:boolean) {
    const owner=this.owners.get(p);
    if (owner && owner!==device) throw Error('另一台已配对手机正在接管，请先在电脑结束接管');
    // Invalidate the automation BEFORE waiting for the last in-flight action.
    this.generation.set(p,(this.generation.get(p)??0)+1);
    if (active) this.owners.set(p,device);
    await this.serial(p,async()=>{if (!active) this.owners.delete(p);});
    this.emit('change');
  }
  async releaseAll() {
    for (const p of platforms) {this.generation.set(p,(this.generation.get(p)??0)+1);await this.serial(p,async()=>this.owners.delete(p));}
    this.emit('change');
  }
  frame(p:Platform) { return this.serial(p,()=>this.browser.frame(p)); }
  input(p:Platform,device:string,input:RemoteInput) {
    return this.serial(p,()=>{if (this.owners.get(p)!==device) throw Error('请先开启手机接管');return this.browser.input(p,input);});
  }
  home(p:Platform,device:string) {
    return this.serial(p,()=>{if (this.owners.get(p)!==device) throw Error('请先开启手机接管');return this.browser.goto(p,homes[p]);});
  }
  async close() {
    await this.releaseAll();
    await Promise.allSettled([...this.executions]);
    await Promise.allSettled([...this.queues.values()]);
    await this.browser.close();
    this.store.close();
  }
}
export function friendlyError(error:unknown):string {
  const message=error instanceof Error?error.message:'操作未完成';
  // Do not forward Playwright traces, selectors, URLs or page content to status logs.
  return /^[\u3400-\u9fff]/.test(message) ? message.slice(0,200) : '网页操作未完成，请刷新接管画面检查登录或网络状态';
}
