// main/update.mjs — GitHub Releases를 보고 새 버전을 알린다 (REL-02 · REL-03).
//
// WHENWORK main/update.mjs에서 승계했다(D-17). 거기 있던 macOS 분기는 뺐다 —
// 이 앱은 Windows 전용이다(SMTC).
//
// **사용자가 모르는 채로 바뀌지 않는다.** 내려받은 뒤에도 바로 재시작하지 않고
// 다음에 앱을 끌 때 설치한다(autoInstallOnAppQuit). 음악을 듣는 도중에 카드가
// 사라졌다 돌아오는 것보다 나쁜 일은 없다.
import { app, shell } from 'electron'
import electronUpdater from 'electron-updater'

// electron-updater는 CommonJS다 — ESM에서는 구조분해로 꺼내야 한다
// (electron-builder#7976의 알려진 상호운용 문제).
const { autoUpdater } = electronUpdater

const RELEASES_URL = 'https://github.com/when630/whenmusic/releases/latest'

// 켜자마자 확인하지 않는다 — 부팅이 무거워진다. 카드가 먼저 떠야 한다.
const FIRST_CHECK_MS = 60_000
// 하루 한 번. 트레이 앱은 몇 주씩 떠 있어 주기 확인이 곧 유일한 확인 기회다.
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000

export function createUpdateState() {
  return {
    status: 'idle', // idle | checking | available | downloading | ready | error
    version: null,
    percent: 0,
    error: null, // 사람이 읽을 수 있는 한 줄 (내부 경로·스택 없음)
    checkedAt: null,
  }
}

/** 트레이 메뉴가 읽는 한 줄. */
export function updateLine(state, { current = app.getVersion?.() ?? '' } = {}) {
  switch (state.status) {
    case 'checking':
      return '새 버전 확인 중…'
    case 'available':
      return `새 버전 ${state.version} 받는 중…`
    case 'downloading':
      return `새 버전 ${state.version} 받는 중 ${state.percent}%`
    case 'ready':
      return `새 버전 ${state.version} — 앱을 끄면 설치됩니다`
    case 'error':
      return state.error ?? '업데이트를 확인하지 못했습니다'
    case 'unsupported':
      return `버전 ${current} — 업데이트 확인은 설치본에서만`
    default:
      return `버전 ${current}`
  }
}

/**
 * 오류를 사람 말로. 내부 경로·스택·URL을 그대로 보여 주지 않는다 —
 * 사용자가 할 수 있는 일이 없는 문장이다.
 */
export function friendlyUpdateError(err) {
  const text = String(err?.message ?? err ?? '')

  if (/ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ECONNREFUSED|network/i.test(text)) {
    return '네트워크에 연결하지 못했습니다'
  }
  if (/404/.test(text)) {
    return '아직 공개된 릴리스가 없습니다'
  }
  if (/signature|sha512|checksum/i.test(text)) {
    return '내려받은 파일이 손상되어 설치하지 않았습니다'
  }
  return '업데이트를 확인하지 못했습니다'
}

export function setupUpdater({ state, onChange }) {
  // 개발 중에는 확인하지 않는다 — 포장되지 않은 앱은 갱신할 대상이 없다
  if (!app.isPackaged) {
    state.status = 'unsupported'
    return { check: async () => state, install: () => ({ installing: false, opened: false }), openReleases: () => {}, stop: () => {}, supported: false }
  }

  let timer = null
  const change = () => onChange?.(state)

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true // REL-03 — 끌 때 설치한다

  autoUpdater.on('checking-for-update', () => {
    state.status = 'checking'
    change()
  })

  autoUpdater.on('update-available', (info) => {
    state.status = 'available'
    state.version = info?.version ?? null
    change()
  })

  autoUpdater.on('update-not-available', () => {
    state.status = 'idle'
    state.checkedAt = Date.now()
    change()
  })

  autoUpdater.on('download-progress', (p) => {
    state.status = 'downloading'
    state.percent = Math.round(p?.percent ?? 0)
    change()
  })

  autoUpdater.on('update-downloaded', (info) => {
    state.status = 'ready'
    state.version = info?.version ?? state.version
    state.checkedAt = Date.now()
    change()
  })

  autoUpdater.on('error', (err) => {
    state.status = 'error'
    state.error = friendlyUpdateError(err)
    state.checkedAt = Date.now()
    change()
  })

  // 설정 화면은 결과 줄을 받아야 하므로 끝날 때까지 기다린다. 트레이는 기다리지 않고 부른다.
  async function check() {
    try {
      await autoUpdater.checkForUpdates()
    } catch (err) {
      state.status = 'error'
      state.error = friendlyUpdateError(err)
      change()
    }
    return state
  }

  // 설정 화면의 "지금 설치". 내려받아 둔 것이 있을 때만 재시작하며 갈아끼운다 —
  // 평소 경로(끌 때 설치)를 대신하는 것이 아니라, 지금 당장 바꾸고 싶은 사람을 위한 문이다.
  function install() {
    if (state.status !== 'ready') return { installing: false, opened: false }
    setImmediate(() => autoUpdater.quitAndInstall())
    return { installing: true, opened: false }
  }

  const first = setTimeout(check, FIRST_CHECK_MS)
  timer = setInterval(check, CHECK_INTERVAL_MS)

  return {
    check,
    install,
    supported: true,
    openReleases: () => shell.openExternal(RELEASES_URL),
    stop() {
      clearTimeout(first)
      clearInterval(timer)
    },
  }
}
