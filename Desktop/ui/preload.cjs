const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('desktop',{
  request:(action,value)=>ipcRenderer.invoke('desktop',action,value),
  onChange:callback=>ipcRenderer.on('changed',()=>callback())
});
