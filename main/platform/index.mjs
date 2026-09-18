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

/** 트레이 글리프. 없으면 앱 아이콘으로 떨어진다. */
export function trayImage(root) {
  for (const file of [path.join(root, 'build', 'tray.png'), path.join(root, 'build', 'icon.png')]) {
    if (!fs.existsSync(file)) continue
    const img = nativeImage.createFromPath(file)
    if (!img.isEmpty()) return img
  }

  return nativeImage.createEmpty()
}
