import { chromium, type BrowserContext, type Page } from 'playwright';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { homes, type Platform } from './domain.js';
export interface Frame { id:string; image:string; width:number; height:number; createdAt:number; origin:string }
export interface RemoteInput { frameID:string; type:'tap'|'drag'|'scroll'|'text'|'key'; x?:number; y?:number; endX?:number; endY?:number; delta?:number; text?:string; key?:string }
export interface BrowserPort {
  goto(p:Platform,url:string):Promise<void>;
  script(p:Platform,name:'Probe'|'Shopping'|'Coupon'|'History',request:object):Promise<any>;
  frame(p:Platform):Promise<Frame>;
  input(p:Platform,input:RemoteInput):Promise<void>;
  close():Promise<void>;
}
export class BrowserSessions implements BrowserPort {
  private contexts = new Map<Platform,BrowserContext>();
  private pages = new Map<Platform,Page>();
  private frames = new Map<Platform,{frame:Frame,url:string}>();
  constructor(private dataDir:string,private resources:string) {}
  private async page(p:Platform) {
    let page=this.pages.get(p);
    if (page && !page.isClosed()) return page;
    let context=this.contexts.get(p);
    if (!context) {
      context=await chromium.launchPersistentContext(join(this.dataDir,p),{
        channel:'msedge',headless:true,viewport:{width:390,height:780},deviceScaleFactor:1,
        isMobile:true,hasTouch:true,locale:'zh-CN',timezoneId:'Asia/Shanghai',
        userAgent:'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36'
      });
      context.setDefaultTimeout(10000);
      // The phone controls only this page. Popups are kept in the same session, never a system browser.
      context.on('page',candidate=>{
        if (!this.pages.has(p)) this.pages.set(p,candidate);
        else candidate.close().catch(()=>{});
      });
      this.contexts.set(p,context);
    }
    page=context.pages().find(x=>!x.isClosed()) ?? await context.newPage();
    this.pages.set(p,page);
    if (page.url()==='about:blank') await page.goto(homes[p],{waitUntil:'domcontentloaded',timeout:45000});
    return page;
  }
  async goto(p:Platform,url:string) {
    const target=new URL(url);
    if (target.protocol!=='https:' || target.hostname!==new URL(homes[p]).hostname) throw Error('仅能打开该平台官方入口');
    this.frames.delete(p);
    await (await this.page(p)).goto(url,{waitUntil:'domcontentloaded',timeout:45000});
  }
  async script(p:Platform,name:'Probe'|'Shopping'|'Coupon'|'History',request:object) {
    const page=await this.page(p);
    if (new URL(page.url()).hostname!==new URL(homes[p]).hostname) throw Error('当前在登录或验证页面，请在手机接管处理');
    const marker={Probe:'__MEAL_COMPARE_REQUEST__',Shopping:'__MEAL_SHOPPING_REQUEST__',Coupon:'__MEAL_COUPON_REQUEST__',History:'__MEAL_HISTORY_REQUEST__'}[name];
    const source=await readFile(join(this.resources,name+'.js'),'utf8');
    return JSON.parse(await page.evaluate(source.replace(marker,()=>JSON.stringify(request))));
  }
  async frame(p:Platform):Promise<Frame> {
    const page=await this.page(p);
    const url=page.url();
    const bytes=await page.screenshot({type:'jpeg',quality:65,timeout:10000});
    if (url!==page.url()) throw Error('页面正在跳转，请刷新画面');
    const frame={id:randomUUID(),image:bytes.toString('base64'),width:390,height:780,createdAt:Date.now(),origin:new URL(url).origin};
    this.frames.set(p,{frame,url});
    return frame;
  }
  async input(p:Platform,input:RemoteInput) {
    const page=await this.page(p), stored=this.frames.get(p);
    if (!stored || stored.frame.id!==input.frameID || Date.now()-stored.frame.createdAt>10000 || stored.url!==page.url()) throw Error('画面已变化，请刷新后操作');
    const point=(x:unknown,y:unknown) => typeof x==='number' && typeof y==='number' && Number.isFinite(x) && Number.isFinite(y) && x>=0 && y>=0 && x<390 && y<780;
    const blocked=async(x:number,y:number)=>page.evaluate(({x,y})=>{
      let element=document.elementFromPoint(x,y);
      for (let n=0;element && n<5;n++,element=element.parentElement) {
        if (['BODY','HTML'].includes(element.tagName)) break;
        if (element.querySelector('button,input,textarea,a,[role="button"]')) continue;
        const label=(element.getAttribute('aria-label')||'')+' '+(element.textContent||'');
        if (label.length<160 && /提交订单|立即支付|确认支付|去支付|确认付款|立即购买|立即开通|立即兑换/.test(label)) return true;
      }
      return false;
    },{x,y});
    this.frames.delete(p); // Every input consumes a frame, preventing duplicate taps after reconnect.
    if (input.type==='tap' || input.type==='drag') {
      if (!point(input.x,input.y)) throw Error('点击位置无效');
      if (await blocked(input.x!,input.y!)) throw Error('饭价不提供下单、支付或购券操作');
      if (input.type==='tap') await page.mouse.click(input.x!,input.y!);
      else {
        if (!point(input.endX,input.endY) || await blocked(input.endX!,input.endY!)) throw Error('拖动终点无效');
        await page.mouse.move(input.x!,input.y!); await page.mouse.down();
        try { await page.mouse.move(input.endX!,input.endY!,{steps:20}); } finally { await page.mouse.up(); }
      }
    } else if (input.type==='scroll') {
      if (!Number.isFinite(input.delta) || Math.abs(input.delta!)>1500) throw Error('滚动距离无效');
      await page.mouse.move(195,390); await page.mouse.wheel(0,input.delta!);
    } else if (input.type==='text') {
      if (typeof input.text!=='string' || input.text.length>500 || /[\r\n\x00-\x1f]/.test(input.text)) throw Error('输入内容无效');
      const editable=await page.evaluate(()=>{const e=document.activeElement;return e instanceof HTMLInputElement || e instanceof HTMLTextAreaElement || (e instanceof HTMLElement && e.isContentEditable);});
      if (!editable) throw Error('请先点选网页输入框');
      await page.keyboard.insertText(input.text);
    } else if (input.type==='key' && ['Backspace','Tab'].includes(input.key||'')) await page.keyboard.press(input.key!);
    else throw Error('不支持此接管操作');
  }
  async close() { await Promise.allSettled([...this.contexts.values()].map(c=>c.close())); this.contexts.clear(); this.pages.clear(); }
}
