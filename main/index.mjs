// 앱 부트. 배선만 한다 — 계산은 session.mjs, 창은 card.mjs, 애드온은 control.mjs.
import { app, dialog, globalShortcut, ipcMain, shell } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

import { createCard } from './card.mjs'
import { applyImport, buildExport } from './data.mjs'
import { createControl } from './control.mjs'
import { ACTION, CH } from './ipc.mjs'
import { MIN_PLAY_SEC, PLAYBACK, createTracker } from './session.mjs'
import { createLifecycle } from './lifecycle.mjs'
import { smtcSupport } from './platform/index.mjs'
import { createSettings } from './settings.mjs'
import { createStore } from './store.mjs'
import { createUpdateState, setupUpdater, updateLine } from './update.mjs'
import { createWindow } from './window.mjs'

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
// --selftest — 실제 세션에 제어를 한 번씩 보내 보고 결과를 출력한 뒤 나간다.
// 듣고 있는 음악을 건드리므로 개발 중 확인용이고, 끝나면 원래 상태로 되돌린다.
const selftestMode = process.argv.includes('--selftest')

// %APPDATA%\whenmusic\store.sqlite — 형제 앱과 폴더가 다르다 (PLAT-05)
// 데모는 임시 폴더를 쓴다 — 눈으로 확인하자고 진짜 기록을 더럽힐 이유가 없다
const DATA_DIR = demoName
  ? path.join(app.getPath('temp'), 'whenmusic-demo')
  : app.getPath('userData')
const store = createStore(path.join(DATA_DIR, 'store.sqlite'))
if (store.state.notice) console.warn('[store]', store.state.notice)

const settings = createSettings(path.join(DATA_DIR, 'settings.json'))

const tracker = createTracker({ backSec: settings.get('backSec') ?? BACK_SEC, store })
const card = createCard({ corner: settings.get('corner') })
const historyWindow = createWindow({ settings })

const updateState = createUpdateState()
let updater = null

const lifecycle = createLifecycle({
  settings,
  dataDir: DATA_DIR,
  updateLine: () => updateLine(updateState, { current: app.getVersion() }),
  onCheckUpdate: () => updater?.check(),
  onToggleWindow: () => historyWindow.toggle(),
  onExport: () => exportData(),
  onImport: () => importData(),
})

// --- 내보내기·가져오기 (DATA) -------------------------------------------

async function exportData() {
  const { canceled, filePath } = await dialog.showSaveDialog({
    title: 'WHENMUSIC 내보내기',
    defaultPath: `whenmusic-${new Date().toISOString().slice(0, 10)}.json`,
    filters: [{ name: 'JSON', extensions: ['json'] }],
  })
  if (canceled || !filePath) return

  try {
    fs.writeFileSync(filePath, JSON.stringify(buildExport({ store, settings }), null, 2))
  } catch {
    dialog.showErrorBox('WHENMUSIC', '파일을 쓰지 못했습니다')
  }
}

async function importData() {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: 'WHENMUSIC 가져오기',
    filters: [{ name: 'JSON', extensions: ['json'] }],
    properties: ['openFile'],
  })
  if (canceled || !filePaths?.[0]) return

  // 갈아끼우는 일이므로 한 번 묻는다. 직전 상태는 어차피 파일로 남지만,
  // 모르고 누르는 일은 없어야 한다.
  const { response } = await dialog.showMessageBox({
    type: 'warning',
    buttons: ['가져오기', '취소'],
    defaultId: 1,
    cancelId: 1,
    message: '지금 기록을 이 파일로 갈아끼웁니다',
    detail: '직전 상태는 데이터 폴더에 before-import-<시각>.json으로 남습니다.',
  })
  if (response !== 0) return

  let data = null
  try {
    data = JSON.parse(fs.readFileSync(filePaths[0], 'utf8'))
  } catch {
    dialog.showErrorBox('WHENMUSIC', '읽을 수 없는 파일입니다')
    return
  }

  const result = applyImport({ store, settings, data, dataDir: DATA_DIR })
  if (!result.ok) {
    dialog.showErrorBox('WHENMUSIC', result.reason)
    return
  }

  card.setCorner(settings.get('corner'))
  lifecycle.refresh()
  paint()

  dialog.showMessageBox({
    type: 'info',
    message: '가져왔습니다',
    detail: `이력 ${result.counts.plays}줄 · 도장 ${result.counts.stamps}개`,
  })
}
let control = null
let tickTimer = null

let demo = null
// 단축키로 찍거나 되감으면 렌더러는 그 사실을 모른다. 다음 그리기에 한 번만
// 실어 보낸다 (STMP-02 · CTL-03).
let flashOnce = null

// CARD-10 — 세션이 없을 때 안내를 보여 주는 시간. 이보다 길면 빈 카드가
// 그냥 상주하는 것이 되고, 짧으면 읽을 틈이 없다.
const EMPTY_LINGER_MS = 8000
let emptySince = null

function paint() {
  if (demo) return card.push(demo)

  const snap = tracker.snapshot()
  card.push({
    ...snap,
    artUrl: artOf(snap.appId),
    flash: flashOnce,
    backSec: settings.get('backSec') ?? BACK_SEC,
    blur: settings.get('blur') ?? 6,
  })
  flashOnce = null

  if (snap.state === 'empty') {
    emptySince ??= Date.now()
    card.setVisible(Date.now() - emptySince < EMPTY_LINGER_MS)
  } else {
    emptySince = null
    card.setVisible(true)
  }
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
async function rewind(sec = settings.get('backSec') ?? BACK_SEC) {
  const id = tracker.currentId
  if (!id || !control) return

  const target = Math.max(0, tracker.positionOf(id) - sec)
  tracker.assumeSeek(id, target) // 이벤트보다 먼저 카드를 맞춘다 (D-14)
  flashOnce = `← ${sec}초 되감음`
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
          // 도장으로 되돌아가 들었으면 확인 처리된다 (STMP-05)
          tracker.confirmStampNear(msg.sec)
          paint()
          await control.seek(id, msg.sec)
          break

        case ACTION.BACK:
          await rewind(msg.sec ?? BACK_SEC)
          break

        case ACTION.PICK:
          tracker.pickNext()
          refreshCaps(tracker.currentId)
          paint()
          break
      }
    } catch {
      // 명령이 실패하면 다음 이벤트가 진실을 가져온다 (D-14)
      paint()
    }
  })

  // STMP-01 — 확인을 요구하지 않는다. 찍고 끝이다.
  ipcMain.on(CH.STAMP, () => stamp())
}

// STMP-01 — 확인을 요구하지 않는다. 찍고 끝이다.
function stamp() {
  const at = tracker.stamp()
  if (at != null) flashOnce = '이 순간을 표시했습니다'
  paint()
}


// --- 이력 창이 묻는 것들 -------------------------------------------------

// 썸네일은 창이 열릴 때마다 굽지 않는다. 같은 영상을 며칠에 걸쳐 들으면
// 같은 thumb_id가 계속 나온다.
const thumbCache = new Map()
function thumbUrl(id) {
  if (id == null) return null
  if (thumbCache.has(id)) return thumbCache.get(id)

  const png = store.thumb(id)
  const url = png ? `data:image/png;base64,${Buffer.from(png).toString('base64')}` : null
  thumbCache.set(id, url)
  return url
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000

function weekText() {
  const sec = store.weekSeconds(Date.now() - WEEK_MS)
  if (!sec) return ''

  const m = Math.round(sec / 60)
  const h = Math.floor(m / 60)
  return h > 0 ? `이번 주 ${h}시간 ${m % 60}분` : `이번 주 ${m}분`
}

function wireWindowIpc() {
  ipcMain.handle(CH.QUERY, (_e, { tab, query, onlyUnconfirmed }) => {
    const rows =
      tab === 'plays'
        ? store.searchPlays({ query })
        : store.allStamps({ onlyUnconfirmed })

    return {
      rows: rows.map((r) => ({ ...r, thumbUrl: thumbUrl(r.thumb_id) })),
      weekText: weekText(),
      unconfirmed: store.unconfirmedCount(),
    }
  })

  /**
   * HIST-05 · STMP-04 — 그 지점부터 이어 듣는다.
   *
   * 같은 세션이 아직 살아 있으면 시크로 끝난다. 아니면 소스 URL이 필요한데
   * SMTC가 videoId를 주지 않으므로(오픈이슈 #1) 제목으로 유튜브 검색을 연다.
   */
  ipcMain.handle(CH.RESUME, async (_e, { playId, stampId }) => {
    const stamp = stampId != null ? store.allStamps({ limit: 500 }).find((s) => s.id === stampId) : null
    const play = store.play(stamp?.play_id ?? playId)
    if (!play) return false

    const target = stamp ? stamp.pos_sec : (play.last_pos_sec ?? 0)
    const live = tracker.currentId === play.source_app

    if (live && control) {
      try {
        await control.seek(play.source_app, target)
        tracker.assumeSeek(play.source_app, target)
        if (stamp) store.confirmStamp(stamp.id, Date.now())
        paint()
        return true
      } catch {
        return false
      }
    }

    await shell.openExternal(
      `https://www.youtube.com/results?search_query=${encodeURIComponent(play.title)}`
    )
    return false
  })

  ipcMain.handle(CH.REMOVE, (_e, { kind, id }) => {
    const at = Date.now()
    if (kind === 'play') store.softDeletePlay(id, at)
    else store.softDeleteStamp(id, at)
    return true
  })

  ipcMain.handle(CH.RESTORE, (_e, { kind, id }) => {
    if (kind === 'play') store.restorePlay(id)
    else store.restoreStamp(id)
    return true
  })

  ipcMain.handle(CH.SETTINGS, () => ({ ...settings.all, dataDir: DATA_DIR }))

  ipcMain.handle(CH.SET_SETTING, (_e, key, value) => {
    settings.set(key, value)
    applySetting(key, value)
    return { ...settings.all, dataDir: DATA_DIR }
  })

  ipcMain.handle(CH.OPEN_DATA_DIR, () => shell.openPath(DATA_DIR))
}

// 설정은 바꾸는 즉시 적용된다 — 저장하고 다시 시작하라고 말하지 않는다.
function applySetting(key, value) {
  if (key === 'corner') card.setCorner(value)
  if (key === 'backSec' || key === 'corner') lifecycle.refresh()
  if (key === 'autoStart') app.setLoginItemSettings({ openAtLogin: !!value, args: ['--hidden'] })
  // backSec·blur는 다음 그리기에 실린다
  paint()
}

function wireShortcuts() {
  // 형제 앱과 겹치지 않는다 (PLAT-05)
  globalShortcut.register('Control+Alt+Left', () => rewind())
  globalShortcut.register('Control+Alt+S', stamp)
  globalShortcut.register('Control+Alt+P', () => historyWindow.toggle())
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * 제어 경로를 실물로 확인한다 — control.mjs → Worker → 애드온 → SMTC까지.
 *
 * SMTC는 재생 중 위치를 갱신하지 않으므로(§5) 되감기 목표를 계산하려면 먼저
 * 정확한 위치가 있어야 한다. 상태를 한 번 바꾸면 그때 갱신되므로 pause/play로
 * 기준점을 잡고 시작한다.
 */
async function selftest() {
  const log = (...a) => console.log('[selftest]', ...a)
  await wait(1500) // Worker가 세션을 읽어 올 때까지

  const id = tracker.currentId
  if (!id) {
    log('세션이 없습니다 — 음악을 틀고 다시 실행하세요')
    app.exit(1)
    return
  }

  const read = async () => (await control.session(id))?.timeline?.position ?? null
  const status = async () => (await control.session(id))?.playback?.playbackStatus ?? null

  log('세션:', id)
  log('capabilities:', JSON.stringify(await control.capabilities(id)))

  const wasPlaying = (await status()) === PLAYBACK.PLAYING
  log('시작 상태:', wasPlaying ? 'PLAYING' : 'PAUSED', '· SMTC가 주는 위치', await read())

  // 1) 일시정지 — 여기서 SMTC가 위치를 갱신한다
  const okPause = await control.pause(id)
  await wait(1200)
  const anchored = await read()
  log('pause  → 수락', okPause, '· 상태', await status(), '· 갱신된 위치', anchored)

  // 2) 재생 복귀
  const okPlay = await control.play(id)
  await wait(1200)
  log('play   → 수락', okPlay, '· 상태', await status())

  // 3) 되감기 — 절대 시크만 가능하므로 목표를 직접 계산한다 (CTL-03)
  const target = Math.max(0, anchored - 10)
  const okSeek = await control.seek(id, target)
  await wait(1200)
  const landed = await read()
  log('seek   → 수락', okSeek, '· 목표', target.toFixed(2), '· 착지', landed?.toFixed(2),
      '· 오차', landed == null ? '?' : (landed - target).toFixed(2), '초')

  // 4) 원래 자리로 되돌린다 — 남의 음악을 옮겨 놓고 끝내지 않는다
  await control.seek(id, anchored)
  await wait(1000)
  log('복귀   → 위치', (await read())?.toFixed(2))

  if (!wasPlaying) await control.pause(id)

  log('끝')
  app.exit(0)
}

app.whenReady().then(async () => {
  wireControl()
  wireIpc()
  wireWindowIpc()

  // 지운 지 30일이 지난 것만 실제로 지운다 (STOR-04)
  store.purgeDeleted(Date.now() - 30 * 24 * 60 * 60 * 1000)

  // 세션을 스쳐 지나간 줄 치우기 — 줄이 닫힐 때 걸러지지만 그 사이에
  // 앱이 꺼졌으면 남는다 (D-22). 5분보다 오래된 것만 본다.
  const swept = store.purgeTrivialPlays(Date.now() - 5 * 60 * 1000, MIN_PLAY_SEC)
  if (swept) console.log(`[store] 스쳐 지나간 줄 ${swept}개 정리`)

  if (selftestMode) {
    selftest()
    return
  }

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
    const { demoState, seedDemoStore } = await import('../tools/demo-state.mjs')
    demo = await demoState(demoName)
    seedDemoStore(store)
  }

  // PLAT-02 — 쓸 수 없는 OS·빌드면 카드가 그 사실과 필요 조건을 말한다
  const support = smtcSupport()
  if (!support.ok) tracker.setFailure({ stage: 'platform', message: support.reason })

  card.start()
  lifecycle.start({ onApplySetting: applySetting })

  // 켜고 1분 뒤 한 번, 이후 하루 한 번. 설치는 앱을 끌 때 (REL-02 · REL-03)
  updater = setupUpdater({ state: updateState, onChange: () => lifecycle.refresh() })
  wireShortcuts()
  tickTimer = setInterval(() => {
    tracker.tick() // 들은 시간을 누적하고 어디까지 갔는지 적는다
    paint()
  }, TICK_MS)

  if (shotFile) {
    const shotWindow = process.argv.includes('--window')
    if (shotWindow) historyWindow.toggle()

    setTimeout(async () => {
      paint()
      setTimeout(async () => {
        if (shotWindow) {
          const tabAt = process.argv.indexOf('--tab')
          await historyWindow.capture(shotFile, { tab: tabAt >= 0 ? process.argv[tabAt + 1] : null })
        }
        else {
          const zoomAt = process.argv.indexOf('--zoom')
          await card.capture(shotFile, {
            open: process.argv.includes('--open'),
            zoom: zoomAt >= 0 ? Number(process.argv[zoomAt + 1]) : 0,
          })
        }
        app.exit(0)
      }, 600)
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
  updater?.stop()
  historyWindow.destroy()
  lifecycle.destroy()
  store.close()
})
