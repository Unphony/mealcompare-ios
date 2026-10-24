import {chromium} from 'playwright';
import {BrowserSessions} from '../out/browser.js';
import {mkdtemp,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
await mkdir('.runtime',{recursive:true});
const dir=await mkdtemp(resolve('.runtime/browser-'));
const context=await chromium.launchPersistentContext(dir,{channel:'msedge',headless:true,viewport:{width:390,height:780},deviceScaleFactor:1});
const sessions=new BrowserSessions(dir,resolve('out/resources'));
try {
  await context.route('**/*',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:`<!doctype html><html><head><meta charset="utf-8"></head><body>
    <input aria-label="手机号" style="position:absolute;left:10px;top:10px;width:200px;height:35px">
    <button id="pay" style="position:absolute;left:10px;top:80px;width:200px;height:40px" onclick="window.paid=true">提交订单</button>
    <p style="position:absolute;top:150px">确认订单 合计 ¥28.00 预计30分钟送达</p></body></html>`}));
  const page=context.pages()[0];await page.goto('https://h5.waimai.meituan.com/waimai/mindex/preview');
  sessions.contexts.set('meituan',context);sessions.pages.set('meituan',page);
  let frame=await sessions.frame('meituan');assert.ok(frame.image.length>100);
  await sessions.input('meituan',{type:'tap',frameID:frame.id,x:30,y:30});
  await assert.rejects(sessions.input('meituan',{type:'tap',frameID:frame.id,x:30,y:30}),/画面已变化/);
  frame=await sessions.frame('meituan');await sessions.input('meituan',{type:'text',frameID:frame.id,text:'test-only'});
  assert.equal(await page.locator('input').inputValue(),'test-only');
  frame=await sessions.frame('meituan');await assert.rejects(sessions.input('meituan',{type:'tap',frameID:frame.id,x:30,y:100}),/不提供下单/);
  assert.equal(await page.evaluate(()=>window.paid),undefined);
  const probe=await sessions.script('meituan','Probe',{action:'inspect'});
  assert.equal(probe.prices[0].cents,2800);assert.equal(probe.hasLoginInput,false);
  // Foreign origin cannot execute the platform adapters.
  await page.goto('https://example.org/');await assert.rejects(sessions.script('meituan','Probe',{action:'inspect'}));
  console.log('Real Edge: frame, input, stale-frame rejection, checkout button block, DOM adapter and origin guard passed.');
} finally {await sessions.close();await context.close().catch(()=>{});}
