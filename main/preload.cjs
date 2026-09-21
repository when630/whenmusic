// 프리로드 — 렌더러에 열어 주는 것은 이 셋뿐이다.
// contextIsolation 기본값(켜짐)이라 렌더러는 Node를 볼 수 없다.
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('whenmusic', {
  onNow: (fn) => ipcRenderer.on('now', (_e, payload) => fn(payload)),
  onStamps: (fn) => ipcRenderer.on('stamps', (_e, list) => fn(list)),
  onUnhover: (fn) => ipcRenderer.on('card:unhover', () => fn()),

  ctl: (msg) => ipcRenderer.send('ctl', msg),
  stamp: () => ipcRenderer.send('stamp'),
  hover: (on) => ipcRenderer.send('card:hover', !!on),
  moveBy: (dx, dy) => ipcRenderer.send('card:move', { dx, dy }),
  moveEnd: () => ipcRenderer.send('card:move-end'),

  // 이력 창 — 답을 받아야 그리므로 전부 invoke다
  onSearch: (fn) => ipcRenderer.on('hist:search', (_e, q) => fn(q)),
  query: (args) => ipcRenderer.invoke('hist:query', args),
  resume: (args) => ipcRenderer.invoke('hist:resume', args),
  remove: (args) => ipcRenderer.invoke('hist:remove', args),
  restore: (args) => ipcRenderer.invoke('hist:restore', args),
  settings: () => ipcRenderer.invoke('settings:get'),
  setSetting: (key, value) => ipcRenderer.invoke('settings:set', key, value),
  openDataDir: () => ipcRenderer.invoke('data:open'),
})
