// main/search.mjs — 검색어 해석과 한글 초성 변환.
//
// WHENNOTE main/search.mjs에서 이식했다(D-17). 거기서 가져온 것은 초성 변환과
// LIKE 패턴 두 개이고, FTS5·태그 해석은 뺐다 — 이 앱의 이력은 하루 서너 줄씩
// 쌓여서(D-12) 수천 줄 규모다. 그 크기에 trigram 색인은 과하고, LIKE 하나로
// 끝난다.
//
// Electron·SQLite에 기대지 않는 순수 모듈이라 node --test로 검증한다.

// 초성 19개 — 유니코드 완성형 한글의 초성 순서와 같다
const CHO = [
  'ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ',
  'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ',
]

/**
 * 완성형 한글 한 글자를 초성 한 글자로 바꾼다. 한글이 아닌 글자는 그대로 둔다.
 * UTF-16 단위로 1:1이라 결과 문자열의 인덱스가 원문 인덱스와 같다.
 */
export function toChoseong(str) {
  const s = String(str ?? '')
  let out = ''
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i)
    if (code >= 0xac00 && code <= 0xd7a3) out += CHO[Math.floor((code - 0xac00) / 588)]
    else out += s[i]
  }
  return out
}

/**
 * 검색어 한 줄을 가른다.
 *
 *   "감성 힙합"  → terms ['감성', '힙합'], choseong false
 *   "ㅎㅎ"       → terms ['ㅎㅎ'],          choseong true
 *
 * 단어가 전부 초성 자모면 초성 컬럼을 대상으로 찾는다 (SRCH-02).
 */
export function parseQuery(raw) {
  const terms = String(raw ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)

  const choseong = terms.length > 0 && terms.every((t) => /^[ㄱ-ㅎ]+$/.test(t))
  return { terms, choseong }
}

/** LIKE 패턴. %·_·\를 이스케이프한다 — SQL 쪽은 ESCAPE '\'를 명시해야 한다. */
export function likePattern(term) {
  return '%' + String(term).replace(/[\\%_]/g, (c) => '\\' + c) + '%'
}

/**
 * 한 줄이 질의에 걸리는가. SQL을 만들기 전에 규칙을 여기서 정해 두면
 * 저장소 없이도 검증된다.
 *
 * 검색 대상은 정규화된 제목과 채널이다 — 유니코드 볼드로 쓰인 제목이
 * 검색에서 빠지지 않아야 한다 (SRCH-03).
 */
export function matches(row, query) {
  const { terms, choseong } = parseQuery(query)
  if (!terms.length) return true

  const hay = choseong
    ? `${row.title_cho ?? ''} ${row.channel_cho ?? ''}`
    : `${row.title ?? ''} ${row.channel ?? ''}`.toLowerCase()

  return terms.every((t) => hay.includes(choseong ? t : t.toLowerCase()))
}
