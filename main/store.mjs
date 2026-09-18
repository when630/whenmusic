// main/store.mjs — node:sqlite 단일 파일 저장소.
//
// 열기·손상 판정·격리·마이그레이션·백업 체계는 WHENWORK main/store.mjs에서
// 승계했다(D-17 — 코드는 공유하지 않고 복사해 각자 진화한다). 스키마와 질의만
// 이 앱의 것이다(§4).
//
// DatabaseSync는 동기 API라 이 파일의 함수도 전부 동기다. Electron을
// import하지 않으므로 node --test로 그대로 검증된다.
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { likePattern, parseQuery } from './search.mjs'

/** 자기보다 높은 user_version은 열지 않는다 — 구버전으로 되돌린 사용자가 최신 스키마를 덮어쓰지 않게. */
export class NewerSchemaError extends Error {
  constructor(found, known) {
    super(`store schema v${found}, this app only knows up to v${known}`)
    this.name = 'NewerSchemaError'
    this.found = found
    this.known = known
  }
}

// v1 스키마 (03_기술_스펙 §4).
//
// plays의 한 줄은 "한 번 들은 믹스"다. 곡이 아니다 — SMTC가 1시간 영상 하나를
// 한 곡으로 주기 때문이고, 그래서 하루에 서너 줄만 쌓인다 (D-03 · D-12).
const V1_SQL = `
CREATE TABLE thumbs (
  id   INTEGER PRIMARY KEY,
  hash TEXT NOT NULL UNIQUE,
  png  BLOB NOT NULL
);

CREATE TABLE plays (
  id            INTEGER PRIMARY KEY,
  source_app    TEXT    NOT NULL,
  title         TEXT    NOT NULL,
  title_raw     TEXT    NOT NULL,
  title_cho     TEXT    NOT NULL DEFAULT '',
  channel       TEXT    NOT NULL,
  channel_cho   TEXT    NOT NULL DEFAULT '',
  duration_sec  REAL,
  thumb_id      INTEGER REFERENCES thumbs(id),
  started_at    INTEGER NOT NULL,
  ended_at      INTEGER,
  listened_sec  REAL    NOT NULL DEFAULT 0,
  last_pos_sec  REAL,
  pos_trusted   INTEGER NOT NULL DEFAULT 0,
  deleted_at    INTEGER
);

CREATE INDEX plays_started ON plays(started_at DESC);
CREATE INDEX plays_open ON plays(source_app, title, channel, ended_at);

CREATE TABLE stamps (
  id           INTEGER PRIMARY KEY,
  play_id      INTEGER NOT NULL REFERENCES plays(id),
  pos_sec      REAL    NOT NULL,
  at           INTEGER NOT NULL,
  confirmed_at INTEGER,
  deleted_at   INTEGER
);

CREATE INDEX stamps_play ON stamps(play_id, at);
`

const MIGRATIONS = [(db) => db.exec(V1_SQL)]

/** 스키마가 실제로 만드는 표 이름 — 가드 테스트가 이것과 대조한다. */
export function schemaTables() {
  const names = new Set()
  for (const m of V1_SQL.matchAll(/CREATE TABLE (\w+)/g)) names.add(m[1])
  return [...names].sort()
}

// DatabaseSync에는 트랜잭션 헬퍼가 없다 — 직접 감싼다.
function withTransaction(db, fn) {
  db.exec('BEGIN')
  try {
    const result = fn()
    db.exec('COMMIT')
    return result
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
}

const BACKUP_KEEP = 5

function todayStamp(d = new Date()) {
  return d.toISOString().slice(0, 10).replace(/-/g, '')
}

function pruneOldBackups(dir) {
  try {
    const files = fs.readdirSync(dir).filter((f) => /^store-v\d+-\d{8}\.sqlite$/.test(f))
    if (files.length <= BACKUP_KEEP) return

    const withTimes = files
      .map((f) => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs }))
      .sort((a, b) => a.t - b.t)

    for (const { f } of withTimes.slice(0, withTimes.length - BACKUP_KEEP)) {
      fs.unlinkSync(path.join(dir, f))
    }
  } catch {
    // 정리 실패가 이행을 막을 이유는 없다
  }
}

function backupBeforeMigrate(db, file, fromVersion) {
  try {
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
    const dir = path.join(path.dirname(file), 'backups')
    fs.mkdirSync(dir, { recursive: true })
    fs.copyFileSync(file, path.join(dir, `store-v${fromVersion}-${todayStamp()}.sqlite`))
    pruneOldBackups(dir)
  } catch {
    // 백업 실패가 이행을 막지 않는다
  }
}

function migrate(db, file) {
  const { user_version: current } = db.prepare('PRAGMA user_version').get()
  if (current > MIGRATIONS.length) throw new NewerSchemaError(current, MIGRATIONS.length)
  if (current === MIGRATIONS.length) return
  if (current > 0) backupBeforeMigrate(db, file, current)

  for (let v = current; v < MIGRATIONS.length; v++) {
    withTransaction(db, () => {
      MIGRATIONS[v](db)
      db.exec(`PRAGMA user_version = ${v + 1}`)
    })
  }
}

class IntegrityCheckFailedError extends Error {}

function checkIntegrity(db) {
  const row = db.prepare('PRAGMA integrity_check').get()
  if (row?.integrity_check !== 'ok') {
    throw new IntegrityCheckFailedError(`integrity_check: ${row?.integrity_check}`)
  }
}

// 손상 판정은 "열기에 실패했다"가 아니라 에러의 정체로 한다 — 건강한 파일을
// 옆으로 미는 일이 절대 없어야 한다. 잠김(5)·권한 오류는 손상이 아니다.
function isCorruptError(err) {
  if (err instanceof IntegrityCheckFailedError) return true
  return !!err && (err.errcode === 26 || err.errcode === 11)
}

function quarantine(file) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '')
  const name = `store.corrupt-${stamp}.sqlite`
  const dir = path.dirname(file)

  for (const suffix of ['', '-wal', '-shm']) {
    const src = file + suffix
    if (!fs.existsSync(src)) continue
    try {
      fs.renameSync(src, path.join(dir, name + suffix))
    } catch {
      // 옆 파일 이동 실패가 본 파일 격리를 막지 않는다
    }
  }
  return name
}

const OPEN_FAILED = '기록 파일을 열지 못했습니다 — 카드는 그대로 동작합니다'

export function createStore(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true })

  let db = null
  let state = { ok: false, reason: null, notice: null, quarantined: null }

  function closeQuietly() {
    if (!db) return
    try {
      db.close()
    } catch {
      // 망가진 핸들은 닫기도 실패한다
    }
    db = null
  }

  function prepareDb() {
    db.exec('PRAGMA journal_mode = WAL')
    db.exec('PRAGMA synchronous = FULL')
    db.exec('PRAGMA foreign_keys = ON')
    migrate(db, file)
  }

  function open() {
    try {
      db = new DatabaseSync(file)
      checkIntegrity(db)
    } catch (err) {
      closeQuietly()

      if (!isCorruptError(err)) {
        state = { ok: false, reason: 'error', notice: OPEN_FAILED, quarantined: null }
        return state
      }

      const quarantined = quarantine(file)
      try {
        db = new DatabaseSync(file) // 같은 자리에 빈 파일을 새로 연다
        prepareDb()
        state = {
          ok: true,
          reason: 'corrupt',
          notice: '이전 기록 파일이 손상되어 보관해 두었습니다',
          quarantined,
        }
      } catch {
        closeQuietly()
        state = { ok: false, reason: 'error', notice: OPEN_FAILED, quarantined }
      }
      return state
    }

    try {
      prepareDb()
      state = { ok: true, reason: null, notice: null, quarantined: null }
    } catch (err) {
      closeQuietly()
      const newer = err instanceof NewerSchemaError
      state = {
        ok: false,
        reason: newer ? 'newer' : 'error',
        notice: newer
          ? '더 새로운 버전이 만든 기록 파일입니다 — 앱을 업데이트하세요'
          : OPEN_FAILED,
        quarantined: null,
      }
    }
    return state
  }

  open()

  const q = (sql) => db.prepare(sql)

  return {
    get state() {
      return state
    },

    get ok() {
      return state.ok
    },

    close: closeQuietly,

    /** 썸네일은 내용 해시로 한 번만 저장한다 (STOR-03). 실측 약 23KB PNG. */
    putThumb(png) {
      if (!state.ok || !png?.length) return null

      const buf = Buffer.from(png)
      const hash = crypto.createHash('sha256').update(buf).digest('hex')

      const found = q('SELECT id FROM thumbs WHERE hash = ?').get(hash)
      if (found) return found.id

      const info = q('INSERT INTO thumbs (hash, png) VALUES (?, ?)').run(hash, buf)
      return Number(info.lastInsertRowid)
    },

    thumb(id) {
      if (!state.ok || id == null) return null
      return q('SELECT png FROM thumbs WHERE id = ?').get(id)?.png ?? null
    },

    /**
     * 이어 붙일 줄을 찾는다 (HIST-04).
     *
     * 같은 소스·제목·채널이고 마지막으로 본 지 얼마 안 됐으면 같은 청취로 본다.
     * 1시간 믹스를 두 번에 나눠 들었다고 두 줄이 되면 "무엇을 들었나"에 답하지
     * 못한다.
     */
    findOpenPlay({ sourceApp, title, channel, notBefore }) {
      if (!state.ok) return null
      return (
        q(
          `SELECT * FROM plays
             WHERE source_app = ? AND title = ? AND channel = ?
               AND deleted_at IS NULL
               AND COALESCE(ended_at, started_at) >= ?
             ORDER BY started_at DESC LIMIT 1`
        ).get(sourceApp, title, channel, notBefore) ?? null
      )
    },

    startPlay(row) {
      if (!state.ok) return null

      const info = q(
        `INSERT INTO plays
          (source_app, title, title_raw, title_cho, channel, channel_cho,
           duration_sec, thumb_id, started_at, ended_at, listened_sec, last_pos_sec, pos_trusted)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        row.sourceApp,
        row.title,
        row.titleRaw ?? row.title,
        row.titleCho ?? '',
        row.channel ?? '',
        row.channelCho ?? '',
        row.durationSec ?? null,
        row.thumbId ?? null,
        row.startedAt,
        row.endedAt ?? null,
        row.listenedSec ?? 0,
        row.lastPosSec ?? null,
        row.posTrusted ? 1 : 0
      )
      return Number(info.lastInsertRowid)
    },

    /** 듣는 동안 계속 갱신된다 — 얼마나 들었고 어디까지 갔는지. */
    touchPlay(id, { listenedSec, lastPosSec, posTrusted, endedAt, durationSec } = {}) {
      if (!state.ok || id == null) return

      q(
        `UPDATE plays SET
           listened_sec = COALESCE(?, listened_sec),
           last_pos_sec = COALESCE(?, last_pos_sec),
           pos_trusted  = COALESCE(?, pos_trusted),
           ended_at     = COALESCE(?, ended_at),
           duration_sec = COALESCE(?, duration_sec)
         WHERE id = ?`
      ).run(
        listenedSec ?? null,
        lastPosSec ?? null,
        posTrusted == null ? null : posTrusted ? 1 : 0,
        endedAt ?? null,
        durationSec ?? null,
        id
      )
    },

    play(id) {
      if (!state.ok || id == null) return null
      return q('SELECT * FROM plays WHERE id = ?').get(id) ?? null
    },

    recentPlays(limit = 50) {
      if (!state.ok) return []
      return q(
        `SELECT *, (SELECT COUNT(*) FROM stamps s
                  WHERE s.play_id = plays.id AND s.deleted_at IS NULL) AS stampCount FROM plays WHERE deleted_at IS NULL
         ORDER BY started_at DESC LIMIT ?`
      ).all(limit)
    },

    /**
     * 이력을 찾는다 (SRCH).
     *
     * 단어마다 AND로 좁히고, 각 단어는 제목이나 채널 어느 쪽에 걸려도 된다.
     * 전부 초성 자모면 초성 컬럼을 본다.
     */
    searchPlays({ query = '', sourceApp = null, limit = 200 } = {}) {
      if (!state.ok) return []

      const { terms, choseong } = parseQuery(query)
      const where = ['deleted_at IS NULL']
      const args = []

      for (const t of terms) {
        const [a, b] = choseong ? ['title_cho', 'channel_cho'] : ['title', 'channel']
        // 템플릿 리터럴 안에서는 백슬래시를 두 번 써야 SQL에 하나로 닿는다
        where.push(`(${a} LIKE ? ESCAPE '\\' OR ${b} LIKE ? ESCAPE '\\')`)
        args.push(likePattern(t), likePattern(t))
      }

      if (sourceApp) {
        where.push('source_app = ?')
        args.push(sourceApp)
      }

      args.push(limit)
      return q(
        `SELECT *, (SELECT COUNT(*) FROM stamps s
                  WHERE s.play_id = plays.id AND s.deleted_at IS NULL) AS stampCount FROM plays WHERE ${where.join(' AND ')}
         ORDER BY started_at DESC LIMIT ?`
      ).all(...args)
    },

    /** 어떤 소스 앱들이 이력에 있는가 — 필터 목록을 만든다 (SRCH-04). */
    sourceApps() {
      if (!state.ok) return []
      return q(
        `SELECT source_app AS app, COUNT(*) AS n FROM plays
         WHERE deleted_at IS NULL GROUP BY source_app ORDER BY n DESC`
      ).all()
    },

    /** 지난 7일 동안 들은 시간 (HIST-07). 창 머리에 한 줄로 걸린다. */
    weekSeconds(since) {
      if (!state.ok) return 0
      return (
        q(
          `SELECT COALESCE(SUM(listened_sec), 0) AS sec FROM plays
           WHERE deleted_at IS NULL AND started_at >= ?`
        ).get(since)?.sec ?? 0
      )
    },

    /** 날짜별 청취 시간 합계 (HIST-07). 길이를 모르는 스트림도 관측 시간으로 센다. */
    dailyTotals(limit = 30) {
      if (!state.ok) return []
      return q(
        `SELECT date(started_at / 1000, 'unixepoch', 'localtime') AS day,
                SUM(listened_sec) AS sec,
                COUNT(*) AS n
         FROM plays WHERE deleted_at IS NULL
         GROUP BY day ORDER BY day DESC LIMIT ?`
      ).all(limit)
    },

    // --- 삭제 (STOR-04) — 형제 앱의 소프트 삭제 규칙을 승계한다 ---

    softDeletePlay(id, at) {
      if (!state.ok) return
      q('UPDATE plays SET deleted_at = ? WHERE id = ?').run(at, id)
    },

    restorePlay(id) {
      if (!state.ok) return
      q('UPDATE plays SET deleted_at = NULL WHERE id = ?').run(id)
    },

    softDeleteStamp(id, at) {
      if (!state.ok) return
      q('UPDATE stamps SET deleted_at = ? WHERE id = ?').run(at, id)
    },

    restoreStamp(id) {
      if (!state.ok) return
      q('UPDATE stamps SET deleted_at = NULL WHERE id = ?').run(id)
    },

    /** 지운 지 30일이 지난 것만 실제로 지운다 (STOR-04). */
    purgeDeleted(before) {
      if (!state.ok) return { plays: 0, stamps: 0 }

      return withTransaction(db, () => {
        const st = q('DELETE FROM stamps WHERE deleted_at IS NOT NULL AND deleted_at < ?').run(before)
        // 지워진 줄에 매달린 도장은 함께 정리한다 — 외래키가 가리킬 곳이 없어진다
        q(
          `DELETE FROM stamps WHERE play_id IN
             (SELECT id FROM plays WHERE deleted_at IS NOT NULL AND deleted_at < ?)`
        ).run(before)
        const pl = q('DELETE FROM plays WHERE deleted_at IS NOT NULL AND deleted_at < ?').run(before)

        return { plays: Number(pl.changes), stamps: Number(st.changes) }
      })
    },

    // --- 도장 (STMP) ---

    addStamp({ playId, posSec, at }) {
      if (!state.ok || playId == null) return null
      const info = q('INSERT INTO stamps (play_id, pos_sec, at) VALUES (?, ?, ?)').run(
        playId,
        posSec,
        at
      )
      return Number(info.lastInsertRowid)
    },

    stampsOf(playId) {
      if (!state.ok || playId == null) return []
      return q(
        `SELECT * FROM stamps WHERE play_id = ? AND deleted_at IS NULL
         ORDER BY at`
      ).all(playId)
    },

    /** 되돌아가 들은 도장은 확인 처리된다 (STMP-05). */
    confirmStamp(id, at) {
      if (!state.ok) return
      q('UPDATE stamps SET confirmed_at = ? WHERE id = ?').run(at, id)
    },

    /** 도장 탭이 보여 줄 목록 (HIST-06). 줄 정보를 함께 붙여 온다. */
    allStamps({ onlyUnconfirmed = false, channel = null, limit = 200 } = {}) {
      if (!state.ok) return []

      const where = ['s.deleted_at IS NULL', 'p.deleted_at IS NULL']
      const args = []

      if (onlyUnconfirmed) where.push('s.confirmed_at IS NULL')
      if (channel) {
        where.push('p.channel = ?')
        args.push(channel)
      }

      args.push(limit)
      return q(
        `SELECT s.*, p.title, p.channel, p.source_app, p.thumb_id, p.duration_sec
         FROM stamps s JOIN plays p ON p.id = s.play_id
         WHERE ${where.join(' AND ')}
         ORDER BY s.at DESC LIMIT ?`
      ).all(...args)
    },

    unconfirmedCount() {
      if (!state.ok) return 0
      return (
        q('SELECT COUNT(*) AS n FROM stamps WHERE confirmed_at IS NULL AND deleted_at IS NULL').get()
          ?.n ?? 0
      )
    },
  }
}
