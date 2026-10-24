import {_electron as electron} from 'playwright';
import {mkdir, mkdtemp} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import assert from 'node:assert/strict';
await mkdir('.runtime',{recursive:true});
const data=await mkdtemp(resolve('.runtime/smoke-'));
const environment={...process.env,MEALCOMPARE_DATA_DIR:data};
delete environment.ELECTRON_RUN_AS_NODE;
const app=await electron.launch({args:['.','--background'],env:environment,timeout:30000});
try {
  const page=await app.firstWindow();
  await page.waitForFunction(()=>document.getElementById('code')?.textContent?.length===8);
  const versions=await app.evaluate(()=>process.versions);
  assert.ok(versions.electron);
  const state=await page.evaluate(()=>window.desktop.request('status'));
  assert.equal(state.jobs.length,0);
  assert.equal(state.records.length,0);
  assert.match(state.pairing.code,/^\d{8}$/);
  const r=await fetch('http://127.0.0.1:3000/v1/pair',{method:'POST',body:JSON.stringify({code:state.pairing.code})});
  assert.equal(r.status,200);
  const {token}=await r.json();
  assert.equal((await fetch('http://127.0.0.1:3000/v1/status',{headers:{Authorization:'Bearer '+token}})).status,200);
  // Screenshot is local-only; pair code expires when the test process exits.
  await page.screenshot({path:resolve('.runtime/desktop-smoke.png')});
  console.log(JSON.stringify({electron:versions.electron,node:versions.node,sqlite:versions.sqlite,ui:'passed',pairing:'passed'}));
} finally {await app.close();}
