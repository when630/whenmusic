// main/deeplink.mjs — 형제 앱 연동의 순수 부분.
//
// 규약은 when630/when-protocol, 첫 구현은 WHENNOTE, 이 파일의 꼴은 WHENWORK
// main/deeplink.mjs에서 복사했다(D-17 — 코드는 공유하지 않고 베껴 시작한다).
//
//   parseDeepLink   whenmusic://history?q=힙합 → { command: 'history', args: { q: '힙합' } }
//   fromArgv        Windows는 URL이 argv로 온다(첫 실행이면 process.argv, 떠 있으면 second-instance)
//   buildManifest   ~/.when/apps/whenmusic.json에 쓸 명령 목록 — WHENCOMMAND가 읽어 입력줄에 합친다

export const SCHEME = 'whenmusic'
export const APP_ID = 'whenmusic'

/**
 * 이 앱이 받는 명령.
 *
 * 고른 것은 셋뿐이다. 이 앱의 조작은 대부분 **손이 키보드에 있는 동안** 일어나고
 * (되감기·도장은 전역 단축키가 더 빠르다), WHENCOMMAND를 여는 순간 이미
 * 한 박자 늦다. 그래서 재생·정지·되감기 같은 것은 넣지 않았다 — 명령줄을
 * 띄워 고를 바에 Ctrl+Alt+←를 누르는 편이 낫다.
 *
 * 남은 것은 "손이 멀리 있을 때 쓸 만한 것"이다.
 */
export const COMMANDS = [
  {
    id: 'now',
    title: '지금 듣는 것',
    description: '카드를 잠깐 펼쳐 무엇이 흐르는지 보여 준다 — 창을 띄우지 않는다',
  },
  {
    id: 'stamp',
    title: '이 순간 표시',
    description: '방금 그 대목을 표시해 둔다. 나중에 이력 창에서 되돌아간다',
  },
  {
    id: 'history',
    title: '청취 이력',
    description: '무엇을 얼마나 들었는지 — 뒤에 적은 말로 제목·채널을 찾는다',
    args: [{ name: 'q', type: 'string', optional: true }],
  },
]

const KNOWN = new Set(COMMANDS.map((c) => c.id))

export function parseDeepLink(raw) {
  let u
  try {
    u = new URL(String(raw ?? ''))
  } catch {
    return null
  }
  if (u.protocol !== `${SCHEME}:`) return null

  const command = (u.host || u.pathname.replace(/^\/+/, '')).replace(/\/+$/, '').toLowerCase()
  if (!KNOWN.has(command)) return null

  const args = {}
  for (const [k, v] of u.searchParams) if (v) args[k] = v
  return { command, args }
}

export function fromArgv(argv) {
  return (
    (argv ?? []).find((a) => typeof a === 'string' && a.toLowerCase().startsWith(`${SCHEME}://`)) ??
    null
  )
}

/**
 * WHENCOMMAND가 읽을 매니페스트.
 *
 * `verify`에 **win32만 넣는다.** 규약은 "이 OS의 항목이 없으면 이 OS에는 없는
 * 앱"으로 읽으므로, 그것이 이 앱의 사실과 맞는다 — SMTC는 Windows 기능이고
 * macOS 판은 v2에서 MPNowPlayingInfoCenter로 다시 써야 한다(PLAT-06).
 * 없는 앱을 목록에 올리는 것보다 빠지는 편이 낫다.
 *
 * 경로는 패키징본이면 지금 실행 파일, 개발 실행이면 설치본의 관례 경로다 —
 * 개발용 electron.exe를 적으면 설치본이 없는 PC에서도 "있다"고 읽힌다.
 */
export function buildManifest({ platformName = process.platform, exePath, packaged } = {}) {
  const verify = { win32: '%LOCALAPPDATA%\\Programs\\WHENMUSIC\\WHENMUSIC.exe' }
  if (packaged && exePath && platformName === 'win32') verify.win32 = exePath

  return {
    protocol: 1,
    id: APP_ID,
    name: 'WHENMUSIC',
    scheme: SCHEME,
    verify,
    // args가 없는 명령은 키 자체를 넣지 않는다 — `args: undefined`는
    // JSON.stringify에서 조용히 사라져서, 쓴 것과 읽은 것이 달라진다
    commands: COMMANDS.map((c) =>
      c.args ? { ...c, args: c.args.map((a) => ({ ...a })) } : { ...c }
    ),
  }
}
