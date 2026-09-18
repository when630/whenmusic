import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { EXPORT_VERSION, applyImport, buildExport, validateImport } from '../main/data.mjs'
import { createSettings } from '../main/settings.mjs'
import { createStore } from '../main/store.mjs'

function rig() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whenmusic-data-'))
  const store = createStore(path.join(dir, 'store.sqlite'))
  const settings = createSettings(path.join(dir, 'settings.json'))

  const playId = store.startPlay({
    sourceApp: 'Chrome',
    title: '[Playlist] 믹스',
    titleRaw: '[𝐏𝐥𝐚𝐲𝐥𝐢𝐬𝐭] 믹스',
    channel: 'CherryMix',
    durationSec: 3731,
    startedAt: 1_700_000_000_000,
    listenedSec: 600,
  })
  store.addStamp({ playId, posSec: 410, at: 1_700_000_100_000 })

  return { dir, store, settings, playId }
}

test('내보내기는 이력·도장·설정을 담는다 (DATA-01)', () => {
  const { store, settings } = rig()
  const out = buildExport({ store, settings })

  assert.equal(out.app, 'whenmusic')
  assert.equal(out.schema_version, EXPORT_VERSION)
  assert.equal(out.plays.length, 1)
  assert.equal(out.stamps.length, 1)
  assert.equal(out.settings.corner, 'br')
  assert.equal(out.plays[0].title_raw, '[𝐏𝐥𝐚𝐲𝐥𝐢𝐬𝐭] 믹스')
  store.close()
})

test('썸네일은 내보내기에 담지 않는다 (D-21)', () => {
  const { store, settings } = rig()
  store.putThumb(Buffer.from('png bytes'))

  const out = buildExport({ store, settings })
  assert.equal('thumb_id' in out.plays[0], false)
  assert.equal(JSON.stringify(out).includes('png bytes'), false)
  store.close()
})

test('남의 파일과 깨진 파일을 사람 말로 거른다', () => {
  assert.match(validateImport(null), /읽을 수 없는/)
  assert.match(validateImport({ app: 'whenwork' }), /WHENMUSIC이 내보낸/)
  assert.match(validateImport({ app: 'whenmusic', plays: 'x' }), /형식이 올바르지/)
  assert.match(
    validateImport({ app: 'whenmusic', schema_version: 99, plays: [], stamps: [] }),
    /앱을 업데이트한 뒤/
  )
})

test('이유에 내부 경로나 구조를 흘리지 않는다', () => {
  const reason = validateImport({
    app: 'whenmusic',
    schema_version: 1,
    plays: [{ id: 1, title: '', started_at: 1, source_app: 'Chrome' }],
    stamps: [],
  })
  assert.match(reason, /이력 자료가 손상/)
  assert.equal(/sqlite|SELECT|column|\\|\//.test(reason), false)
})

test('도장이 가리키는 이력이 없으면 거절한다', () => {
  const reason = validateImport({
    app: 'whenmusic',
    schema_version: 1,
    plays: [{ id: 1, title: 'A', started_at: 1, source_app: 'Chrome' }],
    stamps: [{ id: 1, play_id: 99, pos_sec: 10, at: 1 }],
  })
  assert.match(reason, /가리키는 이력이 파일에 없습니다/)
})

test('가져오기는 갈아끼우고 직전 상태를 파일로 남긴다 (DATA-02)', () => {
  const { dir, store, settings } = rig()

  const incoming = {
    app: 'whenmusic',
    schema_version: 1,
    plays: [
      { id: 7, source_app: 'Spotify.exe', title: '다른 기록', started_at: 1_700_000_500_000 },
    ],
    stamps: [{ id: 3, play_id: 7, pos_sec: 22, at: 1_700_000_600_000 }],
    settings: { corner: 'bl', backSec: 15 },
  }

  const result = applyImport({ store, settings, data: incoming, dataDir: dir })
  assert.equal(result.ok, true)
  assert.deepEqual(result.counts, { plays: 1, stamps: 1 })

  // 지금 데이터는 갈아끼워졌다
  const rows = store.recentPlays()
  assert.equal(rows.length, 1)
  assert.equal(rows[0].title, '다른 기록')

  // 설정도 따라온다
  assert.equal(settings.get('corner'), 'bl')
  assert.equal(settings.get('backSec'), 15)

  // 직전 상태가 파일로 남았고, 그 안에 원래 이력이 들어 있다
  assert.ok(result.backup)
  const backup = JSON.parse(fs.readFileSync(result.backup, 'utf8'))
  assert.equal(backup.plays[0].title, '[Playlist] 믹스')
  assert.match(path.basename(result.backup), /^before-import-\d{8}-\d{6}\.json$/)
  store.close()
})

test('창 자리는 가져오지 않는다 — 이 PC의 화면 배치는 이 PC의 것이다', () => {
  const { dir, store, settings } = rig()
  settings.set('window', { x: 10, y: 10, width: 800, height: 600 })

  applyImport({
    store,
    settings,
    dataDir: dir,
    data: {
      app: 'whenmusic',
      schema_version: 1,
      plays: [],
      stamps: [],
      settings: { window: { x: 9999, y: 9999, width: 100, height: 100 } },
    },
  })

  assert.equal(settings.get('window').x, 10)
  store.close()
})

test('검증에 걸리면 아무것도 건드리지 않는다', () => {
  const { dir, store, settings } = rig()

  const result = applyImport({ store, settings, data: { app: 'whenwork' }, dataDir: dir })
  assert.equal(result.ok, false)
  assert.equal(store.recentPlays().length, 1) // 원래 기록이 그대로다
  assert.equal(fs.readdirSync(dir).some((f) => f.startsWith('before-import-')), false)
  store.close()
})
