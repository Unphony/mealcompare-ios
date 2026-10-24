import { app, BrowserWindow, ipcMain, Menu, Tray, nativeImage, shell, powerSaveBlocker } from 'electron';
import { mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Store } from './store.js';
import { BrowserSessions } from './browser.js';
import { MealService } from './service.js';
import { startServer } from './server.js';
const run=promisify(execFile), here=dirname(fileURLToPath(import.meta.url));
if (process.env.MEALCOMPARE_DATA_DIR) app.setPath('userData',process.env.MEALCOMPARE_DATA_DIR);
const tailscale=join(process.env.ProgramFiles??'C:/Program Files','Tailscale','tailscale.exe');
let window:BrowserWindow|undefined, tray:Tray|undefined, service:MealService|undefined;
let networkURL='', networkMessage='尚未连接私人网络', quitting=false;
const single=app.requestSingleInstanceLock();
if (!single) app.quit();
else {
  app.on('second-instance',()=>{window?.show();window?.focus();});
  app.whenReady().then(async()=>{
    const dataDir=join(app.getPath('userData'),'mealcompare');
    await mkdir(dataDir,{recursive:true});
    service=new MealService(new Store(join(dataDir,'records.sqlite')),new BrowserSessions(join(dataDir,'browsers'),join(here,'resources')));
    const server=await startServer(service);
    const snapshot=()=>({pairing:service!.pairing.current(),...service!.snapshot(),networkURL,networkMessage,dataDir,startAtLogin:app.getLoginItemSettings().openAtLogin});
    const network=async(enable=false)=>{
      if(!existsSync(tailscale)){networkMessage='请先安装并登录 Tailscale Personal，手机使用同一账号';return;}
      try {
        const {stdout}=await run(tailscale,['status','--json'],{windowsHide:true,timeout:15000});
        const status=JSON.parse(stdout);
        if(status.BackendState!=='Running' || !status.Self?.DNSName){networkURL='';networkMessage='请在 Tailscale 中完成登录';return;}
        // A dedicated HTTPS port avoids replacing the user's existing Serve route on 443.
        if(enable) {
          const previous=JSON.parse((await run(tailscale,['serve','status','--json'],{windowsHide:true,timeout:15000})).stdout);
          const existing=previous.Web?.[`${status.Self.DNSName.replace(/\.$/,'')}:8443`];
          if (existing && existing.Handlers?.['/']?.Proxy!==`http://127.0.0.1:${server.port}`) {
            networkMessage='8443 端口已有其他私人服务，请先在 Tailscale 中核对配置';return;
          }
          await run(tailscale,['serve','--bg','--https=8443',`http://127.0.0.1:${server.port}`],{windowsHide:true,timeout:20000});
        }
        const config=JSON.parse((await run(tailscale,['serve','status','--json'],{windowsHide:true,timeout:15000})).stdout);
        const dns=status.Self.DNSName.replace(/\.$/,'');
        const proxy=config.Web?.[`${dns}:8443`]?.Handlers?.['/']?.Proxy;
        networkURL=proxy===`http://127.0.0.1:${server.port}`?`https://${dns}:8443`:'';
        networkMessage=networkURL?'私人 HTTPS 已配置，请用手机 Wi-Fi 与流量分别测试':'Tailscale 已登录，点击“启用手机连接”';
      } catch {networkURL='';networkMessage='私人连接未就绪，请在 Tailscale 检查 HTTPS 授权或网络连接';}
    };
    ipcMain.handle('desktop',async(event,action:string,value?:boolean)=>{
      if(quitting) return null;
      if(event.sender!==window?.webContents || event.senderFrame!==window.webContents.mainFrame) throw Error('不受信任的窗口');
      if(action==='renew') service!.pairing.renew();
      else if(action==='network') await network(true);
      else if(action==='refresh') await network();
      else if(action==='revoke') {await service!.releaseAll();service!.store.revokeDevices();service!.pairing.renew();service!.emit('change');}
      else if(action==='release') await service!.releaseAll();
      else if(action==='login' && typeof value==='boolean') app.setLoginItemSettings({openAtLogin:value,args:['--background']});
      else if(action==='tailscale') await shell.openExternal('https://tailscale.com/download/windows');
      else if(action==='https') await shell.openExternal('https://login.tailscale.com/admin/dns');
      else if(action!=='status') throw Error('未知操作');
      return snapshot();
    });
    window=new BrowserWindow({width:880,height:750,minWidth:650,minHeight:550,show:!process.argv.includes('--background'),title:'饭价 · 电脑端',
      webPreferences:{preload:join(here,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
    window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
    window.webContents.on('will-navigate',event=>event.preventDefault());
    await window.loadFile(join(here,'ui/index.html'));
    window.on('close',event=>{if(!quitting){event.preventDefault();window?.hide();}});
    const icon=nativeImage.createFromPath(join(here,'ui/icon.png')).resize({width:24,height:24});
    tray=new Tray(icon);tray.setToolTip('饭价电脑端正在运行');
    tray.setContextMenu(Menu.buildFromTemplate([{label:'打开饭价',click:()=>window?.show()},{label:'退出电脑端',click:()=>app.quit()}]));
    tray.on('double-click',()=>window?.show());
    const blocker=powerSaveBlocker.start('prevent-app-suspension');
    service.on('change',()=>{if(!quitting)window?.webContents.send('changed');});
    await network();window.webContents.send('changed');
    app.on('before-quit',event=>{
      if(quitting)return;
      event.preventDefault();quitting=true;powerSaveBlocker.stop(blocker);
      window?.destroy();window=undefined;
      void server.close().then(()=>service!.close()).finally(()=>app.quit());
    });
  }).catch(()=>{console.error('饭价启动失败，请检查 3000 端口是否被占用、Edge 是否安装及记录目录是否可写。');app.exit(1);});
}
