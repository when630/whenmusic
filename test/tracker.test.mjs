import test from 'node:test'
import assert from 'node:assert/strict'
import { PLAYBACK, createTracker } from '../main/session.mjs'

// 시계를 손으로 돌린다 — 보간이 시간에 기대므로 진짜 시계로는 테스트가 흔들린다.
function fakeClock(start = 1_700_000_000_000) {
  let t = start
  const clock = () => t
  clock.advance = (ms) => {
    t += ms
  }
  return clock
}

function session(over = {}) {
  return {
    sourceAppId: 'Chrome',
    media: { title: '[𝐏𝐥𝐚𝐲𝐥𝐢𝐬𝐭] 믹스｜힙합', artist: '𝐂𝐡𝐞𝐫𝐫𝐲𝐌𝐢𝐱' },
    playback: { playbackStatus: PLAYBACK.PLAYING, playbackType: 2 },
    timeline: { position: 100, duration: 3731 },
    ...over,
  }
}

test('앱이 켜질 때 이미 있던 세션의 위치는 믿지 않는다 (§5)', () => {
  const clock = fakeClock()
  const tr = createTracker({ clock })

  tr.seed([session()])
  assert.equal(tr.snapshot().state, 'stale')
})

test('상태가 실제로 바뀌어야 낡음이 풀린다 (§5 · D-15)', () => {
  const clock = fakeClock()
  const tr = createTracker({ clock })
  tr.seed([session()]) // 이미 재생 중이던 세션 — 위치를 믿지 못한다

  // 같은 상태(PLAYING)로 다시 오는 이벤트는 새 위치를 싣고 오지 않는다.
  // 버리는 것이 맞고, 그래서 낡음도 풀리지 않는다.
  tr.onEvent({
    name: 'playback-changed',
    payload: { appId: 'Chrome', playbackInfo: { playbackStatus: PLAYBACK.PLAYING, playbackType: 2 } },
  })
  assert.equal(tr.snapshot().state, 'stale')

  // 사용자가 한 번 만지면 SMTC가 위치를 갱신하고, 거기서 복구된다.
  tr.onEvent({
    name: 'playback-changed',
    payload: { appId: 'Chrome', playbackInfo: { playbackStatus: PLAYBACK.PAUSED, playbackType: 2 } },
  })
  assert.equal(tr.snapshot().state, 'paused')

  tr.onEvent({
    name: 'playback-changed',
    payload: { appId: 'Chrome', playbackInfo: { playbackStatus: PLAYBACK.PLAYING, playbackType: 2 } },
  })
  assert.equal(tr.snapshot().state, 'playing')
})

test('같은 상태로 두 번 와도 기준점이 흔들리지 않는다 (D-15)', () => {
  const clock = fakeClock()
  const tr = createTracker({ clock })
  tr.seed([session()])

  const info = { playbackStatus: PLAYBACK.PLAYING, playbackType: 2 }
  tr.onEvent({ name: 'playback-changed', payload: { appId: 'Chrome', playbackInfo: info } })

  clock.advance(5_000)
  tr.onEvent({ name: 'playback-changed', payload: { appId: 'Chrome', playbackInfo: { ...info } } })

  // 두 번째 이벤트가 버려졌다면 5초가 그대로 흘러 105초여야 한다.
  // 기준점을 다시 잡았다면 100초로 되돌아간다.
  assert.equal(Math.round(tr.positionOf('Chrome')), 105)
})

test('timeline 이벤트는 시크한 위치를 그대로 받는다', () => {
  const clock = fakeClock()
  const tr = createTracker({ clock })
  tr.seed([session()])

  tr.onEvent({
    name: 'timeline-changed',
    payload: { appId: 'Chrome', timelineProps: { position: 2000, duration: 3731 } },
  })

  assert.equal(Math.round(tr.positionOf('Chrome')), 2000)
  clock.advance(3_000)
  assert.equal(Math.round(tr.positionOf('Chrome')), 2003)
})

test('제목과 채널은 NFKC로 펴서 보여 준다 (CARD-09)', () => {
  const tr = createTracker({ clock: fakeClock() })
  tr.seed([session()])

  const snap = tr.snapshot()
  assert.equal(snap.title, '[Playlist] 믹스|힙합')
  assert.equal(snap.sub, 'CherryMix')
})

test('세션이 사라지면 남은 것으로 옮겨간다', () => {
  const tr = createTracker({ clock: fakeClock() })
  tr.seed([session(), session({ sourceAppId: 'Spotify.exe' })])

  assert.equal(tr.currentId, 'Chrome')
  tr.onEvent({ name: 'session-removed', payload: { appId: 'Chrome' } })

  assert.equal(tr.currentId, 'Spotify.exe')
  assert.equal(tr.count, 1)
})

test('세션이 둘 이상이면 순환하고, 하나면 그대로다 (CARD-11)', () => {
  const tr = createTracker({ clock: fakeClock() })
  tr.seed([session(), session({ sourceAppId: 'Spotify.exe' })])

  tr.pickNext()
  assert.equal(tr.currentId, 'Spotify.exe')
  tr.pickNext()
  assert.equal(tr.currentId, 'Chrome')

  const one = createTracker({ clock: fakeClock() })
  one.seed([session()])
  one.pickNext()
  assert.equal(one.currentId, 'Chrome')
})

test('스냅샷이 몇 번째 세션인지 말한다 (CARD-11)', () => {
  const tr = createTracker({ clock: fakeClock() })
  tr.seed([session(), session({ sourceAppId: 'Spotify.exe' })])

  const snap = tr.snapshot()
  assert.equal(snap.sessionCount, 2)
  assert.equal(snap.sessionIndex, 1)
})

test('제어를 보낸 직후 카드는 먼저 바뀐다 (D-14)', () => {
  const tr = createTracker({ clock: fakeClock() })
  tr.seed([session()])

  tr.assume('Chrome', PLAYBACK.PAUSED)
  assert.equal(tr.snapshot().state, 'paused')
})

test('애드온이 죽으면 error 상태로 떨어질 뿐 앱은 답을 준다 (PLAT-03)', () => {
  const tr = createTracker({ clock: fakeClock() })
  tr.seed([session()])
  tr.setFailure({ stage: 'load', message: 'not found' })

  const snap = tr.snapshot()
  assert.equal(snap.state, 'error')
  assert.match(snap.sub, /10\.0\.17763/)
})

test('세션이 없으면 안내를 준다 (CARD-10)', () => {
  const tr = createTracker({ clock: fakeClock() })
  assert.equal(tr.snapshot().state, 'empty')
})
