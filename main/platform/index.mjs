// OS에 기대는 코드는 이 폴더 안에만 둔다 (PLAT-06). macOS 분기(v2)가 이
// 경계로만 들어온다 — SMTC는 Windows 전용이라 그때는 MPNowPlayingInfoCenter로
// 다시 써야 하고, 그 차이가 앱 전체로 번지면 안 된다.
import { nativeImage } from 'electron'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/** SMTC가 요구하는 최소 Windows 빌드 (PLAT-02). */
export const MIN_WINDOWS_BUILD = 17763 // Windows 10 1809

/**
 * 이 PC가 SMTC를 쓸 수 있는가.
 *
 * 못 쓰면 카드가 그 이유를 한 줄로 말해야 하므로 판정과 문구를 함께 돌려준다
 * (CARD-10). 값을 인자로 받는 것은 다른 OS·빌드를 테스트에서 흉내 내기
 * 위해서다 — 실제로 Windows 10 1809 미만을 구해 볼 방법이 없다.
 */
export function smtcSupport({ platform = process.platform, release = os.release() } = {}) {
  if (platform !== 'win32') {
    return {
      ok: false,
      reason: 'SMTC는 Windows 기능입니다 — 이 OS에서는 카드가 동작하지 않습니다',
    }
  }

  const build = Number(String(release).split('.')[2] ?? 0)
  if (Number.isFinite(build) && build > 0 && build < MIN_WINDOWS_BUILD) {
    return { ok: false, reason: `Windows 10 1809(10.0.${MIN_WINDOWS_BUILD}) 이상이 필요합니다` }
  }

  // 빌드 번호를 못 읽었으면 막지 않는다 — 읽기 실패가 사용 금지가 될 이유는 없다
  return { ok: true, reason: null }
}

/**
 * 창을 숨긴다 — 직전 창으로 포커스가 돌아가게 (D-29).
 *
 * Windows는 **`hide()`만으로는 직전 창에 포커스가 돌아오지 않는다** — 창을 숨기면 OS가
 * Z순서에서 아무 창이나 고른다(WHENCOMMAND 실측 2026-09-21). 숨기기 전에 `minimize()`를
 * 거치면 최소화의 정규 활성화 경로가 직전 포그라운드 창을 복귀시킨다. 이미 최소화된
 * 창은 다시 최소화하지 않는다 — blur 핸들러가 재진입해도 안전해야 한다.
 * macOS는 `hide()`로 돌아가므로 최소화를 거치지 않는다(실기기 미검증).
 */
export function deactivateWindow(win, { platform = process.platform } = {}) {
  if (platform === 'win32' && !win.isMinimized()) win.minimize()
  win.hide()
}

/**
 * 창을 보인다. 최소화된 창은 `isVisible()=false`라 `restore()`가 먼저다 — 그리고 그 뒤
 * `show()`를 **반드시** 부른다. restore만으로는 렌더러가 프레임을 내지 않아 직전 화면이
 * 굳은 채 키를 안 받는다(WHENCOMMAND D-29).
 */
export function activateWindow(win) {
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

/** 트레이 글리프. 없으면 앱 아이콘으로 떨어진다. */
export function trayImage(root) {
  for (const file of [path.join(root, 'build', 'tray.png'), path.join(root, 'build', 'icon.png')]) {
    if (!fs.existsSync(file)) continue
    const img = nativeImage.createFromPath(file)
    if (!img.isEmpty()) return img
  }

  return nativeImage.createEmpty()
}
