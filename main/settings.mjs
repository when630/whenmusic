// 설정 — %APPDATA%\whenmusic\settings.json 하나. 저장소(SQLite)와 따로 두는 이유는
// 기록 파일이 손상돼 격리되더라도 "카드를 어느 구석에 둘지"까지 잃을 이유가 없어서다.
//
// 읽기 실패는 조용히 기본값으로 떨어진다. 설정을 못 읽었다고 앱이 서면 안 된다.
import fs from 'node:fs'
import path from 'node:path'

export const DEFAULTS = {
  corner: 'br', // 카드 자리 — 우하단/좌하단 (CARD-13)
  blur: 6, // 썸네일 블러 세기 (D-09의 확정값)
  backSec: 10, // 되감기 폭 (CTL-03 · D-10)
  autoStart: false, // 자동 시작 (PLAT-04)
  window: null, // 이력 창이 마지막으로 있던 자리 (HIST-01)
  cardPos: null, // 카드를 끌어다 놓은 자리. null이면 corner가 정한다 (D-26)
}

export function createSettings(file) {
  let data = { ...DEFAULTS }

  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (raw && typeof raw === 'object') data = { ...DEFAULTS, ...raw }
  } catch {
    // 파일이 없거나 깨졌다 — 기본값으로 시작하고 다음 저장 때 새로 쓴다
  }

  function save() {
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true })
      fs.writeFileSync(file, JSON.stringify(data, null, 2))
    } catch {
      // 저장 실패가 동작을 막지 않는다
    }
  }

  return {
    get all() {
      return { ...data }
    },

    get(key) {
      return data[key]
    },

    set(key, value) {
      data[key] = value
      save()
    },

    merge(patch) {
      data = { ...data, ...patch }
      save()
    },
  }
}
