// 내보내기·가져오기 (DATA-01 · DATA-02).
//
// 데이터는 내 PC의 파일 하나다. 그 사실이 의미를 가지려면 통째로 꺼내
// 다른 PC에서 되살릴 수 있어야 한다.
//
// 검증은 형제 앱의 규칙을 따른다 — **절대 경로나 내부 구조를 이유에 넣지
// 않는다.** 사용자가 고칠 수 있는 말만 한다.
import fs from 'node:fs'
import path from 'node:path'

export const EXPORT_VERSION = 1

export function buildExport({ store, settings }) {
  const { plays, stamps } = store.exportRows()

  return {
    app: 'whenmusic',
    schema_version: EXPORT_VERSION,
    exported_at: new Date().toISOString(),
    settings: settings.all,
    plays,
    stamps,
  }
}

/** 통과하면 null, 아니면 사람이 읽을 수 있는 이유 한 줄. */
export function validateImport(data) {
  if (!data || typeof data !== 'object') return '읽을 수 없는 파일입니다'
  if (data.app !== 'whenmusic') return 'WHENMUSIC이 내보낸 파일이 아닙니다'
  if (!Array.isArray(data.plays) || !Array.isArray(data.stamps)) {
    return '내보내기 파일의 형식이 올바르지 않습니다'
  }

  const version = Number(data.schema_version)
  if (!Number.isFinite(version) || version < 1) return '내보내기 파일의 형식이 올바르지 않습니다'
  if (version > EXPORT_VERSION) {
    return '더 새로운 버전에서 내보낸 파일입니다 — 앱을 업데이트한 뒤 다시 가져오세요'
  }

  for (const p of data.plays) {
    if (!Number.isInteger(p?.id)) return '이력 자료가 손상되었습니다'
    if (typeof p?.title !== 'string' || !p.title) return '이력 자료가 손상되었습니다'
    if (!Number.isFinite(p?.started_at)) return '이력 자료가 손상되었습니다'
    if (typeof p?.source_app !== 'string' || !p.source_app) return '이력 자료가 손상되었습니다'
  }

  // 도장이 가리키는 줄이 파일 안에 없으면 외래키가 깨진 채로 들어간다
  const ids = new Set(data.plays.map((p) => p.id))
  for (const st of data.stamps) {
    if (!Number.isInteger(st?.id)) return '도장 자료가 손상되었습니다'
    if (!Number.isFinite(st?.pos_sec)) return '도장 자료가 손상되었습니다'
    if (!ids.has(st?.play_id)) return '도장이 가리키는 이력이 파일에 없습니다'
  }

  return null
}

function stamp(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0')
  return (
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
    `-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  )
}

/**
 * 가져오기는 지금 데이터를 갈아끼운다. 그래서 **직전 상태를 먼저 남긴다**
 * (DATA-02) — 남기지 못하면 갈아끼우지도 않는다. 되돌아갈 길 없이 지우는
 * 것보다 가져오기를 포기하는 편이 낫다.
 */
export function applyImport({ store, settings, data, dataDir, now = new Date() }) {
  const reason = validateImport(data)
  if (reason) return { ok: false, reason }

  let backup = null
  try {
    backup = path.join(dataDir, `before-import-${stamp(now)}.json`)
    fs.writeFileSync(backup, JSON.stringify(buildExport({ store, settings }), null, 2))
  } catch {
    return { ok: false, reason: '가져오기 전 백업을 남기지 못해 중단했습니다' }
  }

  try {
    store.replaceAll({ plays: data.plays, stamps: data.stamps })
  } catch {
    return { ok: false, reason: '가져오는 중 문제가 생겨 되돌렸습니다', backup }
  }

  // 설정은 있으면 덮고 없으면 둔다 — 설정이 빠진 파일이라고 실패할 이유는 없다
  if (data.settings && typeof data.settings === 'object') {
    const { window: _ignored, ...rest } = data.settings
    settings.merge(rest)
  }

  return { ok: true, backup, counts: { plays: data.plays.length, stamps: data.stamps.length } }
}
