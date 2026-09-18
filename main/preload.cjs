// 프리로드 — 렌더러에 열어 주는 것은 이 셋뿐이다.
// contextIsolation 기본값(켜짐)이라 렌더러는 Node를 볼 수 없다.
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('whenmusic', {
  onNow: (fn) => ipcRenderer.on('now', (_e, payload) => fn(payload)),
  onStamps: (fn) => ipcRenderer.on('stamps', (_e, list) => fn(list)),

  ctl: (msg) => ipcRenderer.send('ctl', msg),
  stamp: () => ipcRenderer.send('stamp'),
  hover: (on) => ipcRenderer.send('card:hover', !!on),
})
