const $=id=>document.getElementById(id);
async function call(action,value){try{const s=await window.desktop.request(action,value);render(s);$('error').textContent='';}catch{$('error').textContent='操作未完成，请检查电脑连接状态后重试。';}}
function render(s){
  $('network').textContent=s.networkMessage;$('url').value=s.networkURL;
  $('code').textContent=s.pairing.code;$('expires').textContent='有效至 '+new Date(s.pairing.expiresAt).toLocaleTimeString();
  $('dataDir').textContent='记录位置：'+s.dataDir;$('counts').textContent=`候选金额 ${s.records.length} 条 · 常买摘要 ${s.history.length} 条`;
  $('startup').checked=s.startAtLogin;
  $('jobs').replaceChildren();
  for(const j of s.jobs.slice(0,6)){const row=document.createElement('div');row.className='job';row.textContent=`${j.input.platform==='meituan'?'美团':'淘宝闪购'} · ${j.message}`;$('jobs').append(row);}
  if(!s.jobs.length)$('jobs').textContent='手机配对后可发起查询';
}
for(const [id,action] of [['install','tailscale'],['networkButton','network'],['refresh','refresh'],['renew','renew'],['release','release'],['revoke','revoke']]){
  $(id).onclick=async()=>{if(action==='revoke'&&!confirm('解除所有手机配对？手机需要重新输入配对码。'))return;$(id).disabled=true;await call(action);$(id).disabled=false;};
}
$('startup').onchange=()=>call('login',$('startup').checked);
window.desktop.onChange(()=>call('status'));call('status');
