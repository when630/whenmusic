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

test('제목·채널·초성으로 이력을 찾는다 (SRCH)', () => {
  const { store } = tmpStore()
  const base = { sourceApp: 'Chrome', startedAt: 1 }

  store.startPlay({ ...base, title: '감성 힙합 모음', titleCho: 'ㄱㅅ ㅎㅎ ㅁㅇ', channel: 'CherryMix', channelCho: 'CherryMix' })
  store.startPlay({ ...base, title: '재즈 밤', titleCho: 'ㅈㅈ ㅂ', channel: 'NightJazz', channelCho: 'NightJazz', sourceApp: 'Spotify.exe' })

  assert.equal(store.searchPlays({ query: '힙합' }).length, 1)
  assert.equal(store.searchPlays({ query: 'ㅎㅎ' }).length, 1)
  assert.equal(store.searchPlays({ query: 'jazz' }).length, 1)
  assert.equal(store.searchPlays({ query: '' }).length, 2)
  assert.equal(store.searchPlays({ query: '없는말' }).length, 0)

  // 소스 앱으로 거른다 (SRCH-04)
  assert.equal(store.searchPlays({ sourceApp: 'Spotify.exe' }).length, 1)
  store.close()
})

test('LIKE 와일드카드를 글자 그대로 찾는다', () => {
  const { store } = tmpStore()
  store.startPlay({ sourceApp: 'Chrome', title: '100% 순수', channel: 'x', startedAt: 1 })
  store.startPlay({ sourceApp: 'Chrome', title: '아무거나', channel: 'y', startedAt: 2 })

  assert.equal(store.searchPlays({ query: '100%' }).length, 1)
  store.close()
})

test('삭제는 소프트 삭제이고 되돌릴 수 있다 (STOR-04)', () => {
  const { store } = tmpStore()
  const id = store.startPlay({ sourceApp: 'Chrome', title: '믹스', channel: 'c', startedAt: 1 })

  store.softDeletePlay(id, 1000)
  assert.equal(store.recentPlays().length, 0)

  store.restorePlay(id)
  assert.equal(store.recentPlays().length, 1)
  store.close()
})

test('30일이 지난 것만 실제로 지운다 (STOR-04)', () => {
  const { store } = tmpStore()
  const keep = store.startPlay({ sourceApp: 'Chrome', title: '최근 삭제', channel: 'c', startedAt: 1 })
  const gone = store.startPlay({ sourceApp: 'Chrome', title: '오래된 삭제', channel: 'c', startedAt: 1 })
  store.addStamp({ playId: gone, posSec: 10, at: 1 })

  const now = 1_700_000_000_000
  const month = 30 * 24 * 60 * 60 * 1000

  store.softDeletePlay(keep, now - 1000)
  store.softDeletePlay(gone, now - month - 1000)

  const result = store.purgeDeleted(now - month)
  assert.equal(result.plays, 1)

  store.restorePlay(keep)
  assert.equal(store.recentPlays().length, 1) // 최근에 지운 것은 살아 있다
  store.close()
})

test('도장 탭 목록은 줄 정보를 붙여 온다 (HIST-06)', () => {
  const { store } = tmpStore()
  const id = store.startPlay({ sourceApp: 'Chrome', title: '믹스', channel: 'CherryMix', startedAt: 1 })
  const a = store.addStamp({ playId: id, posSec: 410, at: 10 })
  store.addStamp({ playId: id, posSec: 800, at: 20 })
  store.confirmStamp(a, 30)

  const all = store.allStamps()
  assert.equal(all.length, 2)
  assert.equal(all[0].title, '믹스')
  assert.equal(all[0].channel, 'CherryMix')

  assert.equal(store.allStamps({ onlyUnconfirmed: true }).length, 1)
  assert.equal(store.allStamps({ channel: 'CherryMix' }).length, 2)
  assert.equal(store.allStamps({ channel: '없는채널' }).length, 0)
  store.close()
})

test('날짜별 청취 시간을 합친다 (HIST-07)', () => {
  const { store } = tmpStore()
  const day = new Date('2026-09-18T10:00:00').getTime()

  const a = store.startPlay({ sourceApp: 'Chrome', title: 'A', channel: 'c', startedAt: day })
  const b = store.startPlay({ sourceApp: 'Chrome', title: 'B', channel: 'c', startedAt: day + 3600_000 })
  store.touchPlay(a, { listenedSec: 600 })
  store.touchPlay(b, { listenedSec: 900 })

  const totals = store.dailyTotals()
  assert.equal(totals.length, 1)
  assert.equal(totals[0].sec, 1500)
  assert.equal(totals[0].n, 2)
  store.close()
})

test('v1 파일을 열면 v2로 올리고 직전 상태를 백업한다', () => {
  const { file, store } = tmpStore()
  const playId = store.startPlay({ sourceApp: 'Chrome', title: '믹스', channel: 'c', startedAt: 1 })
  store.addStamp({ playId, posSec: 10, at: 1 })
  store.close()

  // v1 시절 모양으로 되돌린다 — 컬럼을 떼고 버전을 낮춘다
  const raw = new DatabaseSync(file)
  raw.exec('ALTER TABLE stamps DROP COLUMN pos_trusted')
  raw.exec('PRAGMA user_version = 1')
  raw.close()

  const reopened = createStore(file)
  assert.equal(reopened.ok, true)
  assert.equal(reopened.state.reason, null)

  // 자료는 그대로 있고, 기존 도장은 믿는 쪽으로 채워진다 (D-23)
  const stamps = reopened.allStamps()
  assert.equal(stamps.length, 1)
  assert.equal(stamps[0].pos_trusted, 1)

  // 이행 전 백업이 남았다
  const backups = fs.readdirSync(path.join(path.dirname(file), 'backups'))
  assert.equal(backups.some((f) => f.startsWith('store-v1-')), true)
  reopened.close()
})

test('낡은 기준점에서 찍힌 도장은 그 사실을 달고 저장된다 (D-23)', () => {
  const { store } = tmpStore()
  const playId = store.startPlay({ sourceApp: 'Chrome', title: '믹스', channel: 'c', startedAt: 1 })

  store.addStamp({ playId, posSec: 7, at: 10, posTrusted: false })
  store.addStamp({ playId, posSec: 650, at: 20, posTrusted: true })

  const rows = store.stampsOf(playId)
  assert.equal(rows.find((r) => r.pos_sec === 7).pos_trusted, 0)
  assert.equal(rows.find((r) => r.pos_sec === 650).pos_trusted, 1)
  store.close()
})
