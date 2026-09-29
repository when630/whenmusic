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
  // 전역 단축키 (PLAT-05). Accelerator 문법 그대로 두고 보여줄 때만 사람 표기로 편다.
  // 빈 문자열이면 그 자리는 잡지 않는다 — 끄는 방법이 곧 비우는 것이다.
  // WHENWORK `Ctrl+Alt+Space`·WHENNOTE `Ctrl+Alt+M`·`N`·WHENCALENDAR `Ctrl+Alt+C`·`O`와 겹치지 않는 조합.
  hotkeys: {
    rewind: 'Control+Alt+Left',
    forward: 'Control+Alt+Right',
    stamp: 'Control+Alt+S',
    history: 'Control+Alt+P',
  },
}

export const DEFAULT_HOTKEYS = DEFAULTS.hotkeys

/** 단축키 자리와 사람에게 보이는 이름. 설정 화면·트레이·--shortcut-check가 같은 표를 읽는다. */
export const HOTKEY_LABELS = {
  rewind: '되감기',
  forward: '앞으로',
  stamp: '도장',
  history: '이력 창',
}

// 손으로 고친 settings.json이 자리를 빼먹거나 문자열이 아닌 것을 넣어도 앱이 서지 않게 —
// 모르는 자리는 버리고, 빠진 자리는 기본값으로 채운다.
export function sanitizeHotkeys(v) {
  const out = { ...DEFAULTS.hotkeys }
  if (v && typeof v === 'object') {
    for (const k of Object.keys(out)) {
      if (typeof v[k] === 'string') out[k] = v[k].trim()
    }
  }
  return out
}

// 사람에게 보여줄 조합 표기 — 키캡에 새겨진 이름 그대로(Ctrl+Alt+←). 이 앱은 Windows에서만
// 돈다(SMTC)라 맥 기호 표기는 두지 않는다.
const KEY_LABEL = {
  CommandOrControl: 'Ctrl',
  Control: 'Ctrl',
  Command: 'Win',
  Super: 'Win',
  Left: '←',
  Right: '→',
  Up: '↑',
  Down: '↓',
}
export function hotkeyLabel(accel) {
  return String(accel ?? '')
    .split('+')
    .filter(Boolean)
    .map((part) => KEY_LABEL[part] ?? part)
    .join('+')
}

export function createSettings(file) {
  let data = { ...DEFAULTS }

  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (raw && typeof raw === 'object') data = { ...DEFAULTS, ...raw }
    data.hotkeys = sanitizeHotkeys(data.hotkeys)
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
