import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { createStore, schemaTables } from '../main/store.mjs'

function tmpStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whenmusic-'))
  const file = path.join(dir, 'store.sqlite')
  return { file, dir, store: createStore(file) }
}

test('스키마가 만드는 표는 셋이다', () => {
  assert.deepEqual(schemaTables(), ['plays', 'stamps', 'thumbs'])
})

test('새 파일을 열면 정상이고 안내가 없다', () => {
  const { store } = tmpStore()
  assert.equal(store.ok, true)
  assert.equal(store.state.notice, null)
  store.close()
})

test('같은 썸네일은 한 번만 저장된다 (STOR-03)', () => {
  const { store } = tmpStore()
  const png = Buffer.from('fake png bytes')

  const a = store.putThumb(png)
  const b = store.putThumb(Buffer.from('fake png bytes'))
  const c = store.putThumb(Buffer.from('다른 이미지'))

  assert.equal(a, b)
  assert.notEqual(a, c)
  assert.deepEqual(Buffer.from(store.thumb(a)), png)
  store.close()
})

test('재생 줄을 적고 다시 읽는다', () => {
  const { store } = tmpStore()
  const id = store.startPlay({
    sourceApp: 'Chrome',
    title: '[Playlist] 믹스',
    titleRaw: '[𝐏𝐥𝐚𝐲𝐥𝐢𝐬𝐭] 믹스',
    channel: 'CherryMix',
    durationSec: 3731,
    startedAt: 1_700_000_000_000,
    posTrusted: false,
  })

  const row = store.play(id)
  assert.equal(row.title, '[Playlist] 믹스')
  assert.equal(row.title_raw, '[𝐏𝐥𝐚𝐲𝐥𝐢𝐬𝐭] 믹스') // 원문도 남는다 (D-13)
  assert.equal(row.pos_trusted, 0)
  store.close()
})

test('듣는 동안 갱신되고, 주지 않은 값은 그대로 둔다', () => {
  const { store } = tmpStore()
  const id = store.startPlay({
    sourceApp: 'Chrome',
    title: '믹스',
    channel: 'CherryMix',
    startedAt: 1,
    durationSec: 3731,
  })

  store.touchPlay(id, { listenedSec: 120, lastPosSec: 300, posTrusted: true })
  store.touchPlay(id, { listenedSec: 180 })

  const row = store.play(id)
  assert.equal(row.listened_sec, 180)
  assert.equal(row.last_pos_sec, 300) // 건드리지 않은 값은 살아 있다
  assert.equal(row.pos_trusted, 1)
  assert.equal(row.duration_sec, 3731)
  store.close()
})

test('같은 믹스를 이어 들으면 그 줄을 찾아낸다 (HIST-04)', () => {
  const { store } = tmpStore()
  const at = 1_700_000_000_000

  store.startPlay({ sourceApp: 'Chrome', title: '믹스', channel: 'CherryMix', startedAt: at })

  const found = store.findOpenPlay({
    sourceApp: 'Chrome',
    title: '믹스',
    channel: 'CherryMix',
    notBefore: at - 1000,
  })
  assert.ok(found)

  // 30분이 지나면 못 찾는다 — 새 줄이 된다
  const stale = store.findOpenPlay({
    sourceApp: 'Chrome',
    title: '믹스',
    channel: 'CherryMix',
    notBefore: at + 30 * 60 * 1000,
  })
  assert.equal(stale, null)

  // 제목이 다르면 다른 줄이다
  const other = store.findOpenPlay({
    sourceApp: 'Chrome',
    title: '다른 믹스',
    channel: 'CherryMix',
    notBefore: at - 1000,
  })
  assert.equal(other, null)
  store.close()
})

test('도장을 찍고, 세어 보고, 확인 처리한다 (STMP-03 · STMP-05)', () => {
  const { store } = tmpStore()
  const playId = store.startPlay({
    sourceApp: 'Chrome',
    title: '믹스',
    channel: 'CherryMix',
    startedAt: 1,
  })

  const a = store.addStamp({ playId, posSec: 410, at: 10 })
  store.addStamp({ playId, posSec: 1268, at: 20 })

  assert.equal(store.stampsOf(playId).length, 2)
  assert.equal(store.unconfirmedCount(), 2)

  store.confirmStamp(a, 30)
  assert.equal(store.unconfirmedCount(), 1)
  store.close()
})

test('손상된 파일은 옆으로 치우고 빈 파일로 계속한다', () => {
  const { file, store } = tmpStore()
  store.close()

  // SQLite 헤더가 아닌 쓰레기로 덮어쓴다 — SQLITE_NOTADB
  fs.writeFileSync(file, 'this is definitely not a database')

  const reopened = createStore(file)
  assert.equal(reopened.ok, true)
  assert.equal(reopened.state.reason, 'corrupt')
  assert.ok(reopened.state.quarantined)

  // 격리된 파일은 지우지 않고 보존한다
  assert.ok(fs.existsSync(path.join(path.dirname(file), reopened.state.quarantined)))

  // 빈 스키마로 정상 동작한다
  assert.equal(reopened.recentPlays().length, 0)
  reopened.close()
})

test('더 새로운 스키마는 열지 않는다', () => {
  const { file, store } = tmpStore()
  store.close()

  const raw = new DatabaseSync(file)
  raw.exec('PRAGMA user_version = 99')
  raw.close()

  const reopened = createStore(file)
  assert.equal(reopened.ok, false)
  assert.equal(reopened.state.reason, 'newer')
  assert.match(reopened.state.notice, /업데이트/)
})
