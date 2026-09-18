// 앱 부트. 배선만 한다 — 계산은 session.mjs, 창은 card.mjs, 애드온은 control.mjs.
import { app, globalShortcut, ipcMain } from 'electron'

import { createCard } from './card.mjs'
import { createControl } from './control.mjs'
import { ACTION, CH } from './ipc.mjs'
import { PLAYBACK, createTracker } from './session.mjs'

app.setName('whenmusic')

// 다섯 앱이 한 PC에서 동시에 돈다. 락 이름이 형제 앱과 달라야 한다 (PLAT-05).
if (!app.requestSingleInstanceLock()) {
  app.quit()
  process.exit(0)
}

// SMTC는 재생 중에 위치를 갱신하지 않으므로 앱이 직접 보간해 그린다(§5).
// 초 단위로만 표시하니 1초면 충분하다.
const TICK_MS = 1000
const BACK_SEC = 10 // CTL-03 · D-10

const smoke = process.argv.includes('--smoke')
// --shot <경로> — 카드를 PNG로 뜨고 끝낸다. 개발 중 눈으로 확인하는 용도다.
const shotAt = process.argv.indexOf('--shot')
const shotFile = shotAt >= 0 ? process.argv[shotAt + 1] : null
// --demo <이름> — 실측값으로 만든 가짜 상태를 그린다 (tools/demo-state.mjs)
const demoAt = process.argv.indexOf('--demo')
const demoName = demoAt >= 0 ? (process.argv[demoAt + 1] ?? 'playing') : null

const tracker = createTracker({ backSec: BACK_SEC })
const card = createCard()
let control = null
let tickTimer = null

let demo = null

function paint() {
  if (demo) return card.push(demo)

  const snap = tracker.snapshot()
  card.push({ ...snap, artUrl: artOf(snap.appId) })
}

// 썸네일은 세션마다 한 번만 data URL로 만든다. 1초마다 23KB를 base64로
// 다시 굽는 것은 낭비다.
const artCache = new Map()
function artOf(appId) {
  return appId ? (artCache.get(appId)?.url ?? null) : null
}

function cacheArt(appId, thumbnail) {
  if (!appId || !thumbnail?.length) return
  const size = thumbnail.length
  if (artCache.get(appId)?.size === size) return

  const base64 = Buffer.from(thumbnail).toString('base64')
  artCache.set(appId, { size, url: `data:image/png;base64,${base64}` })
}

async function refreshCaps(appId) {
  if (!appId || !control) return
  try {
    tracker.setCaps(appId, await control.capabilities(appId))
  } catch {
    // 못 물어봤다고 버튼을 잠그지는 않는다 — 눌러 보면 알게 된다
  }
}

function wireControl() {
  control = createControl({
    onReady(sessions) {
      tracker.seed(sessions)
      for (const s of sessions) cacheArt(s.sourceAppId, s.media?.thumbnail)
      refreshCaps(tracker.currentId)
      paint()
    },

    onEvent(msg) {
      tracker.onEvent(msg)

      if (msg.name === 'session-added') cacheArt(msg.payload.appId, msg.payload.media?.media?.thumbnail)
      if (msg.name === 'media-changed') cacheArt(msg.payload.appId, msg.payload.mediaProps?.thumbnail)
      if (msg.name === 'sessions') {
        for (const s of msg.payload.sessions ?? []) cacheArt(s.sourceAppId, s.media?.thumbnail)
      }
      if (msg.name === 'session-added' || msg.name === 'current-changed') {
        refreshCaps(tracker.currentId)
      }
      if (msg.name === 'session-removed') artCache.delete(msg.payload.appId)

      paint()
    },

    onFail(failure) {
      // 애드온이 죽어도 앱은 산다 (PLAT-03)
      tracker.setFailure(failure)
      paint()
    },
  })

  control.start()
}

// CTL-03 — 지금 위치에서 10초 뒤로. 절대 시크만 가능하므로 목표를 직접 계산한다.
async function rewind(sec = BACK_SEC) {
  const id = tracker.currentId
  if (!id || !control) return

  const target = Math.max(0, tracker.positionOf(id) - sec)
  tracker.assumeSeek(id, target) // 이벤트보다 먼저 카드를 맞춘다 (D-14)
  paint()

  try {
    await control.seek(id, target)
  } catch {
    // 거부되면 다음 timeline-changed가 제자리로 되돌려 놓는다
  }
}

function wireIpc() {
  ipcMain.on(CH.CTL, async (_e, msg) => {
    const id = msg?.appId ?? tracker.currentId
    if (!id || !control) return

    try {
      switch (msg.action) {
        case ACTION.PLAY:
          tracker.assume(id, PLAYBACK.PLAYING)
          paint()
          await control.play(id)
          break

        case ACTION.PAUSE:
          tracker.assume(id, PLAYBACK.PAUSED)
          paint()
          await control.pause(id)
          break

        case ACTION.NEXT:
          await control.next(id)
          break

        case ACTION.PREV:
          await control.prev(id)
          break

        case ACTION.SEEK:
          tracker.assumeSeek(id, msg.sec)
          paint()
          await control.seek(id, msg.sec)
          break

        case ACTION.BACK:
          await rewind(msg.sec ?? BACK_SEC)
          break

        case ACTION.PICK:
          tracker.pick(id)
          refreshCaps(id)
          paint()
          break
      }
    } catch {
      // 명령이 실패하면 다음 이벤트가 진실을 가져온다 (D-14)
      paint()
    }
  })

  // 도장은 Phase 3에서 붙인다. 지금 눌러도 카드가 혼자 반짝이고 끝난다.
  ipcMain.on(CH.STAMP, () => {})
}

function wireShortcuts() {
  // 형제 앱과 겹치지 않는다 (PLAT-05)
  globalShortcut.register('Control+Alt+Left', () => rewind())
}

app.whenReady().then(async () => {
  wireControl()
  wireIpc()

  if (smoke) {
    // 창 없는 스모크 — 부트와 애드온 로드만 확인하고 나간다
    setTimeout(() => {
      const snap = tracker.snapshot()
      console.log('[smoke] state:', snap.state, '· sessions:', tracker.count)
      app.exit(snap.state === 'error' ? 1 : 0)
    }, 1500)
    return
  }

  if (demoName) {
    const { demoState } = await import('../tools/demo-state.mjs')
    demo = await demoState(demoName)
  }

  card.start()
  wireShortcuts()
  tickTimer = setInterval(paint, TICK_MS)

  if (shotFile) {
    setTimeout(async () => {
      paint()
      setTimeout(async () => {
        await card.capture(shotFile)
        app.exit(0)
      }, 400)
    }, 1200)
  }
})

app.on('window-all-closed', () => {
  // 카드를 닫아도 앱은 살아 있어야 한다 (HIST-09). 종료는 트레이에서 한다.
})

app.on('will-quit', () => {
  clearInterval(tickTimer)
  globalShortcut.unregisterAll()
  control?.stop()
  card.destroy()
})
