// 코너 카드 창 (CARD-01~04). 이 앱의 존재 이유다.
//
// 창 기법은 WHENCALENDAR main/overlay.mjs에서 승계했다 — 투명·클릭 통과·
// 포커스 없음, 그리고 z-order를 주기적으로 다시 잡는 것(CARD-02). 다른 점은
// 자리뿐이다: 상단 중앙은 WHENCALENDAR가 쓰므로 이 앱은 하단으로 간다(D-08).
import { BrowserWindow, ipcMain, screen } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { CH } from './ipc.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))

// 카드는 292 너비지만, 창은 호버로 펼쳐지는 도장 목록까지 담아야 한다
// (CARD-08). 접혀 있을 때는 이 안의 104px 원만 쓴다.
export const WIN_W = 336
export const WIN_H = 250
const MARGIN = 16

// 전체화면 앱이 나중에 뜨면 같은 z-order 밴드에서 우리 위로 올라간다.
// 레벨을 올려서 풀리는 문제가 아니라 다시 잡아야 한다 (CARD-02).
const KEEP_TOP_MS = 1000

export function createCard({ corner = 'br' } = {}) {
  let win = null
  let keepTopTimer = null
  let hovering = false
  let placement = corner

  function placeOn(display) {
    const a = display.workArea // 작업표시줄을 피한다 (CARD-01)
    const y = a.y + a.height - WIN_H - MARGIN
    const x =
      placement === 'bl' ? a.x + MARGIN : a.x + a.width - WIN_W - MARGIN
    return { x: Math.round(x), y: Math.round(y) }
  }

  function build() {
    const { x, y } = placeOn(screen.getPrimaryDisplay())

    win = new BrowserWindow({
      x,
      y,
      width: WIN_W,
      height: WIN_H,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      skipTaskbar: true,
      focusable: false, // 타이핑하던 창의 커서를 뺏지 않는다 (CARD-04)
      hasShadow: false,
      alwaysOnTop: true,
      show: false,
      webPreferences: { preload: path.join(HERE, 'preload.cjs') },
    })

    // 클릭은 통과시키되 마우스 이동은 렌더러로 넘긴다 — 호버를 알아야
    // 도장 목록을 펼치고 버튼을 살릴 수 있다 (CARD-03 · CARD-08).
    win.setIgnoreMouseEvents(true, { forward: true })
    raise()
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })

    win.loadFile(path.join(HERE, '..', 'renderer', 'card.html'))
    win.webContents.once('did-finish-load', () => {
      win.showInactive() // show()가 아니다 — 포커스를 가져가면 안 된다
    })
  }

  function raise() {
    if (!win || win.isDestroyed()) return
    win.setAlwaysOnTop(true, 'screen-saver')
    win.moveTop()
  }

  function startKeepTop() {
    stopKeepTop()
    keepTopTimer = setInterval(() => {
      if (!win || win.isDestroyed() || !win.isVisible()) return
      raise()
    }, KEEP_TOP_MS)
  }

  function stopKeepTop() {
    if (keepTopTimer) clearInterval(keepTopTimer)
    keepTopTimer = null
  }

  // 카드 위에 마우스가 올라오면 통과를 잠깐 끈다. 버튼이 눌려야 하기
  // 때문이고, 벗어나면 즉시 되돌린다 (CARD-03).
  ipcMain.on(CH.HOVER, (_e, on) => {
    hovering = !!on
    if (!win || win.isDestroyed()) return
    win.setIgnoreMouseEvents(!hovering, { forward: true })
  })

  function relocate() {
    if (!win || win.isDestroyed()) return
    const { x, y } = placeOn(screen.getPrimaryDisplay())
    win.setBounds({ x, y, width: WIN_W, height: WIN_H })
    raise()
  }

  return {
    start() {
      if (win) return
      build()
      startKeepTop()
      // 모니터를 붙였다 떼면 주 모니터와 작업 영역이 바뀐다
      screen.on('display-metrics-changed', relocate)
      screen.on('display-added', relocate)
      screen.on('display-removed', relocate)
    },

    /** 카드에 그릴 것을 보낸다 (§9 `now`). */
    push(payload) {
      if (!win || win.isDestroyed()) return
      win.webContents.send(CH.NOW, payload)
    },

    pushStamps(list) {
      if (!win || win.isDestroyed()) return
      win.webContents.send(CH.STAMPS, list)
    },

    /**
     * CARD-10 — 세션이 없으면 안내를 잠깐 보여 준 뒤 사라진다.
     * 빈 카드가 화면 구석에 계속 붙어 있을 이유가 없다.
     */
    setVisible(on) {
      if (!win || win.isDestroyed()) return
      if (on) {
        if (!win.isVisible()) {
          win.showInactive()
          raise()
        }
      } else if (win.isVisible()) {
        win.hide()
      }
    },

    /** CARD-13 — 설정에서 좌하단으로 옮긴다. */
    setCorner(next) {
      placement = next === 'bl' ? 'bl' : 'br'
      relocate()
    },

    get hovering() {
      return hovering
    },

    /**
     * 개발용 — 카드 창을 그대로 PNG로 뜬다.
     *
     * 이 창은 클릭도 포커스도 받지 않아서 평범한 화면 캡처 도구로 확인하기
     * 번거롭다. 렌더러가 실제로 무엇을 그렸는지 보는 가장 짧은 길이다.
     */
    /**
     * 개발용 — 펼침에서 접힘으로 넘어가는 도중 한 프레임을 찍는다.
     * 전환이 어색한지는 정지 상태로는 알 수 없다.
     */
    async captureMidCollapse(file, { at = 120, zoom = 3 } = {}) {
      if (!win || win.isDestroyed()) return false

      await win.webContents.executeJavaScript(
        `document.body.style.alignItems='flex-start';` +
          `document.getElementById('card').style.marginLeft='0';` +
          `document.body.style.zoom=${zoom};` +
          `document.getElementById('card').classList.add('open')`
      )
      await new Promise((r) => setTimeout(r, 400))

      await win.webContents.executeJavaScript(
        "document.getElementById('card').classList.remove('open')"
      )
      await new Promise((r) => setTimeout(r, at))

      const image = await win.webContents.capturePage()
      const { writeFile } = await import('node:fs/promises')
      await writeFile(file, image.toPNG())
      return true
    },

    async capture(file, { open = false, zoom = 0 } = {}) {
      if (!win || win.isDestroyed()) return false

      // 개발용 — 접힌 원은 68px이라 화면 캡처로는 세부가 안 보인다.
      // 확대해서 찍고 좌상단으로 붙여 잘리지 않게 한다.
      if (zoom > 1) {
        await win.webContents.executeJavaScript(
          `document.body.style.alignItems='flex-start';` +
            `document.getElementById('card').style.marginLeft='0';` +
            `document.body.style.zoom=${zoom}`
        )
        await new Promise((r) => setTimeout(r, 150))
      }

      // 호버 확장은 마우스가 있어야 열린다. 캡처할 때는 강제로 펼친다.
      if (open) {
        await win.webContents.executeJavaScript(
          "document.getElementById('card').classList.add('open')"
        )
        await new Promise((r) => setTimeout(r, 400))
      }

      // 개발용 — 펼친 카드의 실제 높이를 알려 준다 (전환 애니메이션 값 맞추기)
      if (open) {
        const box = await win.webContents.executeJavaScript(
          "JSON.stringify(document.getElementById('card').getBoundingClientRect())"
        )
        const r = JSON.parse(box)
        const cls = await win.webContents.executeJavaScript(
          "document.getElementById('card').className"
        )
        console.log(`[card] 펼친 크기 ${Math.round(r.width)}x${Math.round(r.height)} · class="${cls}"`)
      }

      const image = await win.webContents.capturePage()
      const { writeFile } = await import('node:fs/promises')
      await writeFile(file, image.toPNG())
      return true
    },

    destroy() {
      stopKeepTop()
      screen.removeListener('display-metrics-changed', relocate)
      screen.removeListener('display-added', relocate)
      screen.removeListener('display-removed', relocate)
      if (win && !win.isDestroyed()) win.destroy()
      win = null
    },
  }
}
