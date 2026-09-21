// 추적기와 저장소를 실제로 붙여서 본다 — 이력 한 줄이 언제 생기고 언제
// 이어 붙는지, 들은 시간이 어떻게 쌓이는지.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { PLAYBACK, createTracker } from '../main/session.mjs'
import { createStore } from '../main/store.mjs'

function rig({ start = 1_700_000_000_000 } = {}) {
  let t = start
  const clock = () => t
  const advance = (ms) => {
    t += ms
  }

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whenmusic-rec-'))
  const store = createStore(path.join(dir, 'store.sqlite'))
  const tr = createTracker({ clock, store })

  return { tr, store, clock, advance }
}

function session(over = {}) {
  return {
    sourceAppId: 'Chrome',
    media: { title: '[𝐏𝐥𝐚𝐲𝐥𝐢𝐬𝐭] 믹스', artist: 'CherryMix' },
    playback: { playbackStatus: PLAYBACK.PLAYING, playbackType: 2 },
    timeline: { position: 100, duration: 3731 },
    ...over,
  }
}

function play(tr, over) {
  tr.onEvent({ name: 'session-added', payload: { appId: 'Chrome', media: session(over) } })
}

test('듣기 시작하면 이력 한 줄이 열린다 (HIST-03)', () => {
  const { tr, store } = rig()
  play(tr)
  tr.tick()

  const rows = store.recentPlays()
  assert.equal(rows.length, 1)
  assert.equal(rows[0].title, '[Playlist] 믹스') // NFKC로 편 제목이 들어간다
  assert.equal(rows[0].channel, 'CherryMix')
  store.close()
})

test('제목이 아직 비어 있으면 줄을 열지 않는다', () => {
  const { tr, store } = rig()
  play(tr, { media: { title: '', artist: '' } })
  tr.tick()

  assert.equal(store.recentPlays().length, 0)
  store.close()
})

test('재생 중에만 들은 시간이 쌓인다 (STOR-02)', () => {
  const { tr, store, advance } = rig()
  play(tr)
  tr.tick()

  advance(10_000)
  tr.tick()
  assert.equal(Math.round(store.recentPlays()[0].listened_sec), 10)

  // 일시정지 중에는 시간이 흘러도 쌓이지 않는다
  tr.onEvent({
    name: 'playback-changed',
    payload: { appId: 'Chrome', playbackInfo: { playbackStatus: PLAYBACK.PAUSED, playbackType: 2 } },
  })
  advance(60_000)
  tr.tick()
  assert.equal(Math.round(store.recentPlays()[0].listened_sec), 10)
  store.close()
})

test('같은 믹스를 이어 들으면 한 줄로 합친다 (HIST-04)', () => {
  const { tr, store, advance } = rig()
  play(tr)
  tr.tick()
  const first = store.recentPlays()[0].id

  // 세션이 잠깐 사라졌다가 10분 뒤 같은 영상으로 돌아온다
  tr.onEvent({ name: 'session-removed', payload: { appId: 'Chrome' } })
  advance(10 * 60 * 1000)
  play(tr)
  tr.tick()

  const rows = store.recentPlays()
  assert.equal(rows.length, 1)
  assert.equal(rows[0].id, first)
  store.close()
})

test('제목이 바뀌면 새 줄이다 (HIST-04)', () => {
  const { tr, store, advance } = rig()
  play(tr)
  tr.tick()
  advance(120_000) // 충분히 들어야 앞 줄이 남는다 (D-22)
  tr.tick()

  tr.onEvent({
    name: 'media-changed',
    payload: { appId: 'Chrome', mediaProps: { title: '다른 믹스', artist: 'CherryMix' } },
  })
  advance(120_000)
  tr.tick()

  assert.equal(store.recentPlays().length, 2)
  store.close()
})

test('도장을 찍으면 지금 위치가 남고 카드에 눈금이 뜬다 (STMP-01 · CARD-07)', () => {
  const { tr, store, advance } = rig()
  play(tr)
  tr.tick()

  advance(30_000) // 100초에서 시작해 30초가 흘렀다
  const at = tr.stamp()

  assert.equal(Math.round(at), 130)
  assert.equal(store.stampsOf(store.recentPlays()[0].id).length, 1)
  assert.equal(Math.round(tr.snapshot().stamps[0].posSec), 130)
  store.close()
})

test('되돌아가 들은 도장은 확인 처리된다 (STMP-05)', () => {
  const { tr, store } = rig()
  play(tr)
  tr.tick()

  tr.stamp()
  assert.equal(store.unconfirmedCount(), 1)

  tr.confirmStampNear(100.4) // 100초에 찍힌 도장 근처로 돌아왔다
  assert.equal(store.unconfirmedCount(), 0)
  store.close()
})

test('멀리 떨어진 지점으로 가면 확인 처리되지 않는다', () => {
  const { tr, store } = rig()
  play(tr)
  tr.tick()

  tr.stamp()
  tr.confirmStampNear(900)
  assert.equal(store.unconfirmedCount(), 1)
  store.close()
})

test('저장소가 죽어 있어도 카드는 답한다 (PLAT-03)', () => {
  const tr = createTracker({ clock: () => 1, store: null })
  play(tr)

  assert.doesNotThrow(() => tr.tick())
  assert.equal(tr.stamp(), null)
  assert.equal(tr.snapshot().state, 'playing')
})

test('스쳐 지나간 줄은 이력에 남지 않는다 (D-22)', () => {
  const { tr, store, advance } = rig()

  // 믹스를 듣는 중에
  play(tr)
  tr.tick()
  advance(120_000)
  tr.tick()

  // 다른 미디어가 2초 동안 세션을 가로챘다가
  tr.onEvent({
    name: 'media-changed',
    payload: { appId: 'Chrome', mediaProps: { title: 'Miss your voice', artist: 'Tokyo Lyric - Topic' } },
  })
  tr.tick()
  advance(2_000)
  tr.tick()

  // 원래 믹스로 돌아온다
  tr.onEvent({
    name: 'media-changed',
    payload: { appId: 'Chrome', mediaProps: { title: '[𝐏𝐥𝐚𝐲𝐥𝐢𝐬𝐭] 믹스', artist: 'CherryMix' } },
  })
  tr.tick()

  const rows = store.recentPlays()
  assert.equal(rows.length, 1)
  assert.equal(rows[0].title, '[Playlist] 믹스')
  store.close()
})

test('도장을 찍었으면 짧아도 남긴다', () => {
  const { tr, store, advance } = rig()

  play(tr, { media: { title: '짧게 스친 곡', artist: 'Someone' } })
  tr.tick()
  tr.stamp() // 2초를 들었어도 표시해 뒀다면 의미가 있다
  advance(2_000)
  tr.tick()

  tr.onEvent({
    name: 'media-changed',
    payload: { appId: 'Chrome', mediaProps: { title: '다음 것', artist: 'Someone' } },
  })
  tr.tick()

  assert.equal(store.recentPlays().some((r) => r.title === '짧게 스친 곡'), true)
  store.close()
})
