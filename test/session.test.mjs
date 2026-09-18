import test from 'node:test'
import assert from 'node:assert/strict'
import {
  PLAYBACK,
  SPLIT_GAP_MS,
  cardState,
  interpolate,
  isRedundantPlayback,
  makeAnchor,
  shouldSplit,
} from '../main/session.mjs'

const T0 = 1_700_000_000_000

test('재생 중이면 흐른 시간만큼 위치가 자란다', () => {
  const anchor = makeAnchor({ posSec: 100, status: PLAYBACK.PLAYING, atMs: T0 })
  assert.equal(interpolate(anchor, T0), 100)
  assert.equal(interpolate(anchor, T0 + 5_000), 105)
})

test('일시정지 상태에서는 시간이 흐르지 않는다', () => {
  const anchor = makeAnchor({ posSec: 100, status: PLAYBACK.PAUSED, atMs: T0 })
  assert.equal(interpolate(anchor, T0 + 60_000), 100)
})

test('길이를 알면 그 너머로 넘어가지 않는다', () => {
  const anchor = makeAnchor({ posSec: 3_700, status: PLAYBACK.PLAYING, atMs: T0 })
  assert.equal(interpolate(anchor, T0 + 600_000, 3_731), 3_731)
})

test('길이를 모르면 그대로 자란다 — 라디오 스트림 (CARD-12)', () => {
  const anchor = makeAnchor({ posSec: 10, status: PLAYBACK.PLAYING, atMs: T0 })
  assert.equal(interpolate(anchor, T0 + 600_000, null), 610)
})

test('시계가 거꾸로 가도 위치가 줄지 않는다', () => {
  const anchor = makeAnchor({ posSec: 100, status: PLAYBACK.PLAYING, atMs: T0 })
  assert.equal(interpolate(anchor, T0 - 5_000), 100)
})

test('기준점이 없으면 0이다', () => {
  assert.equal(interpolate(null, T0), 0)
})

test('같은 상태로 두 번 온 playback 이벤트는 버린다 (D-15)', () => {
  const a = { playbackStatus: PLAYBACK.PLAYING, playbackType: 2 }
  const b = { playbackStatus: PLAYBACK.PLAYING, playbackType: 2 }
  const c = { playbackStatus: PLAYBACK.PAUSED, playbackType: 2 }

  assert.equal(isRedundantPlayback(a, b), true)
  assert.equal(isRedundantPlayback(a, c), false)
  assert.equal(isRedundantPlayback(null, a), false)
})

test('제목이나 채널이 바뀌면 새 줄이다 (HIST-04)', () => {
  const prev = { title: '믹스 A', channel: 'CherryMix', startedAt: T0, lastSeenMs: T0 }

  assert.equal(shouldSplit(prev, { title: '믹스 B', channel: 'CherryMix' }, T0 + 1_000), true)
  assert.equal(shouldSplit(prev, { title: '믹스 A', channel: '다른 채널' }, T0 + 1_000), true)
  assert.equal(shouldSplit(prev, { title: '믹스 A', channel: 'CherryMix' }, T0 + 1_000), false)
})

test('30분 넘게 끊기면 새 줄, 그 안이면 이어 붙인다 (HIST-04)', () => {
  const prev = { title: '믹스 A', channel: 'CherryMix', startedAt: T0, lastSeenMs: T0 }
  const same = { title: '믹스 A', channel: 'CherryMix' }

  assert.equal(shouldSplit(prev, same, T0 + SPLIT_GAP_MS - 1), false)
  assert.equal(shouldSplit(prev, same, T0 + SPLIT_GAP_MS + 1), true)
})

test('앞선 줄이 없으면 항상 새 줄이다', () => {
  assert.equal(shouldSplit(null, { title: 'x', channel: 'y' }, T0), true)
})

test('카드 상태 — 애드온이 죽어도 error로 떨어질 뿐이다 (PLAT-03)', () => {
  assert.equal(cardState({ session: null, anchor: null, addonFailed: true }), 'error')
  assert.equal(cardState({ session: null, anchor: null }), 'empty')

  const playing = { playback: { playbackStatus: PLAYBACK.PLAYING } }
  const paused = { playback: { playbackStatus: PLAYBACK.PAUSED } }

  assert.equal(cardState({ session: playing, anchor: { trusted: true } }), 'playing')
  assert.equal(cardState({ session: playing, anchor: { trusted: false } }), 'stale')
  assert.equal(cardState({ session: paused, anchor: { trusted: true } }), 'paused')
})
