// 트레이와 앱 수명 (PLAT-04 · HIST-09).
//
// 이 앱은 창을 거의 열지 않는다. 평소에는 카드만 보이고, 트레이가 유일하게
// "앱이 살아 있다"고 말하는 자리다.
import { Menu, Tray, app, shell } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { trayImage } from './platform/index.mjs'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')

export function createLifecycle({ settings, onToggleWindow, onExport, onImport, dataDir }) {
  let tray = null

  function refresh() {
    if (!tray) return

    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: '이력 창 열기', accelerator: 'Ctrl+Alt+P', click: onToggleWindow },
        { type: 'separator' },
        {
          label: '카드 자리',
          submenu: [
            {
              label: '우하단',
              type: 'radio',
              checked: settings.get('corner') !== 'bl',
              click: () => set('corner', 'br'),
            },
            {
              label: '좌하단',
              type: 'radio',
              checked: settings.get('corner') === 'bl',
              click: () => set('corner', 'bl'),
            },
          ],
        },
        {
          label: '로그인할 때 시작',
          type: 'checkbox',
          checked: !!settings.get('autoStart'),
          click: (item) => set('autoStart', item.checked),
        },
        { type: 'separator' },
        { label: '내보내기…', click: onExport },
        { label: '가져오기…', click: onImport },
        { label: '데이터 폴더 열기', click: () => shell.openPath(dataDir) },
        { type: 'separator' },
        { label: '종료', click: () => app.exit(0) },
      ])
    )
  }

  let apply = () => {}

  function set(key, value) {
    settings.set(key, value)
    apply(key, value)
    refresh()
  }

  return {
    start({ onApplySetting }) {
      apply = onApplySetting ?? (() => {})

      tray = new Tray(trayImage(ROOT))
      tray.setToolTip('WHENMUSIC')
      // 트레이를 누르면 이력 창이 열린다 — 가장 자주 하는 일이다
      tray.on('click', onToggleWindow)
      refresh()

      // 설정을 창에서 바꿔도 메뉴의 체크가 따라와야 한다
      return { refresh }
    },

    refresh,

    destroy() {
      tray?.destroy()
      tray = null
    },
  }
}
