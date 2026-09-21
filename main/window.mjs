// 이력 창 (HIST-01 · HIST-09 · HIST-10).
//
// 이 창은 드물게 열린다 — 평소에는 카드만 보고, 뭘 들었는지 뒤질 때만 연다.
// 그래서 창을 닫아도 앱은 트레이에 남고 카드는 계속 돈다.
import { BrowserWindow, screen } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { pickPosition } from './place.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))

const SIZE = { width: 720, height: 520 }
const MIN = { width: 620, height: 440 }

export function createWindow({ settings }) {
  let win = null

  function place() {
    const saved = settings.get('window')
    const cursor = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())

    return pickPosition({
      saved,
      size: { width: saved?.width ?? SIZE.width, height: saved?.height ?? SIZE.height },
      workAreas: screen.getAllDisplays().map((d) => d.workArea),
      cursorArea: cursor.workArea,
    })
  }

  function remember() {
    if (!win || win.isDestroyed()) return
    const b = win.getBounds()
    settings.set('window', { x: b.x, y: b.y, width: b.width, height: b.height })
  }

  function build() {
    const saved = settings.get('window')
    const { x, y } = place()

    win = new BrowserWindow({
      x,
      y,
      width: saved?.width ?? SIZE.width,
      height: saved?.height ?? SIZE.height,
      minWidth: MIN.width,
      minHeight: MIN.height,
      show: false,
      backgroundColor: '#16171c',
      autoHideMenuBar: true,
      webPreferences: { preload: path.join(HERE, 'preload.cjs') },
    })

    win.loadFile(path.join(HERE, '..', 'renderer', 'main.html'))
    win.once('ready-to-show', () => win.show())

    // 창을 닫아도 앱은 살아 있다 (HIST-09). 다음에 열 때 만들지 않고 되살린다.
    win.on('close', (e) => {
      if (win.isDestroyed()) return
      e.preventDefault()
      remember()
      win.hide()
    })

    win.on('moved', remember)
    win.on('resized', remember)
  }

  return {
    /** HIST-01 — 같은 단축키로 열고 닫는다. */
    toggle() {
      if (!win || win.isDestroyed()) {
        build()
        return true
      }

      if (win.isVisible() && win.isFocused()) {
        remember()
        win.hide()
        return false
      }

      win.show()
      win.focus()
      return true
    },

    /** 무조건 보여 준다 — 두 번째 실행은 "숨겨라"가 아니라 "보여 달라"다. */
    show() {
      if (!win || win.isDestroyed()) {
        build()
        return
      }
      win.show()
      win.focus()
    },

    get visible() {
      return !!win && !win.isDestroyed() && win.isVisible()
    },

    send(channel, payload) {
      if (!win || win.isDestroyed()) return
      win.webContents.send(channel, payload)
    },

    async capture(file, { tab = null } = {}) {
      if (!win || win.isDestroyed()) return false

      // 개발용 — 캡처할 탭을 골라 연다
      if (tab) {
        await win.webContents.executeJavaScript(
          `document.querySelector('[data-tab="${tab}"]').click()`
        )
        await new Promise((r) => setTimeout(r, 300))
      }

      const image = await win.webContents.capturePage()
      const { writeFile } = await import('node:fs/promises')
      await writeFile(file, image.toPNG())
      return true
    },

    destroy() {
      if (!win || win.isDestroyed()) return
      remember()
      win.destroy()
      win = null
    },
  }
}
