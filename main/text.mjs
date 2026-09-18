// 제목 정규화 (CARD-09 · D-13).
//
// 실측 제목이 이랬다:
//   [𝐏𝐥𝐚𝐲𝐥𝐢𝐬𝐭] 우연히 듣고 반해버려서… 그냥 저장해버린 노래들 🎧🤍｜감성 힙합/R&B
//
// 유니코드 수학 볼드(𝐏)와 전각 세로줄(｜)이 섞여 있다. NFKC를 거치지 않으면
// "playlist"로 검색해도 걸리지 않는다. 원문은 따로 보관한다 — 표시는 정규화본이
// 낫지만, 나중에 소스를 다시 찾을 때 원문이 필요할 수 있다.

/**
 * 표시·검색용으로 정규화한다.
 *
 * NFKC가 수학 문자와 전각 기호를 아스키로 되돌린다. 이모지는 NFKC가 건드리지
 * 않으므로 그대로 남는데, 그건 그대로 두는 편이 맞다 — 제목의 일부다.
 * 공백만 정리한다.
 */
export function normalize(raw) {
  if (typeof raw !== 'string') return ''
  return raw.normalize('NFKC').replace(/\s+/g, ' ').trim()
}

/** 초 → `1:02:11` / `58:01`. 한 자리 분은 앞을 채우지 않는다. */
export function hms(sec) {
  if (!Number.isFinite(sec) || sec < 0) return '0:00'

  const total = Math.floor(sec)
  const s = total % 60
  const m = Math.floor(total / 60) % 60
  const h = Math.floor(total / 3600)

  const ss = String(s).padStart(2, '0')
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${ss}`
  return `${m}:${ss}`
}
