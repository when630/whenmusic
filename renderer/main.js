// 이력 창. 마우스 없이 전부 조작된다 (HIST-08) — 키 글자의 뜻은 형제 앱과 같다.
const api = window.whenmusic

const el = {
  tabs: document.getElementById('tabs'),
  badge: document.getElementById('badge'),
  week: document.getElementById('week'),
  search: document.getElementById('search'),
  q: document.getElementById('q'),
  cho: document.getElementById('cho'),
  list: document.getElementById('list'),
  hint: document.getElementById('hint'),
  help: document.getElementById('help'),
}

const TABS = ['plays', 'stamps', 'settings']

const HINT = {
  plays: '한 줄이 한 번 들은 믹스다',
  stamps: '표시해 둔 순간들 — 되돌아가면 확인 처리된다',
  settings: '설정은 바꾸는 즉시 적용된다',
}

let tab = 'plays'
let rows = []
let cursor = 0
let query = ''
let onlyUnconfirmed = false
let settings = null
let lastRemoved = null // U로 되돌릴 대상 (STOR-04)

// --- 시간 표기 -------------------------------------------------------------

const pad = (n) => String(n).padStart(2, '0')

function clock(ms) {
  const d = new Date(ms)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function dayKey(ms) {
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function dayLabel(key) {
  const today = dayKey(Date.now())
  const yesterday = dayKey(Date.now() - 86_400_000)
  if (key === today) return '오늘'
  if (key === yesterday) return '어제'

  const [, m, d] = key.split('-')
  return `${Number(m)}월 ${Number(d)}일`
}

/** 들은 시간. 분 단위까지만 — 초를 보여 줄 이유가 없다. */
function span(sec) {
  const total = Math.round(sec ?? 0)
  const m = Math.round(total / 60)
  if (m < 60) return `${m}분`

  const h = Math.floor(m / 60)
  const rest = m % 60
  return rest ? `${h}시간 ${rest}분` : `${h}시간`
}

function pos(sec) {
  const t = Math.floor(sec ?? 0)
  const s = pad(t % 60)
  const m = Math.floor(t / 60) % 60
  const h = Math.floor(t / 3600)
  return h > 0 ? `${h}:${pad(m)}:${s}` : `${m}:${s}`
}

// --- 그리기 ---------------------------------------------------------------

/** 검색어가 걸린 자리를 표시한다. 초성 검색은 원문에 대응이 없으므로 그냥 둔다. */
function mark(text, terms) {
  const frag = document.createDocumentFragment()
  if (!terms.length) {
    frag.append(text)
    return frag
  }

  const lower = text.toLowerCase()
  let at = 0

  while (at < text.length) {
    let best = -1
    let len = 0
    for (const t of terms) {
      const i = lower.indexOf(t.toLowerCase(), at)
      if (i >= 0 && (best < 0 || i < best)) {
        best = i
        len = t.length
      }
    }
    if (best < 0) break

    frag.append(text.slice(at, best))
    const m = document.createElement('mark')
    m.textContent = text.slice(best, best + len)
    frag.append(m)
    at = best + len
  }

  frag.append(text.slice(at))
  return frag
}

function terms() {
  const t = query.trim().split(/\s+/).filter(Boolean)
  return t.every((x) => /^[ㄱ-ㅎ]+$/.test(x)) ? [] : t
}

function thumbEl(row) {
  const div = document.createElement('div')
  div.className = 'thumb'
  if (row.thumbUrl) div.style.backgroundImage = `url("${row.thumbUrl}")`
  return div
}

function playRow(row, i) {
  const div = document.createElement('div')
  div.className = 'row' + (i === cursor ? ' sel' : '') + (row.deleted_at ? ' gone' : '')
  div.dataset.i = String(i)

  const at = document.createElement('span')
  at.className = 'tm at'
  at.textContent = clock(row.started_at)

  const meta = document.createElement('div')
  meta.className = 'meta'

  const t = document.createElement('div')
  t.className = 't'
  t.append(mark(row.title, terms()))

  const a = document.createElement('div')
  a.className = 'a'
  // 길이를 모르는 스트림은 그 사실을 적는다 — 빈 칸보다 낫다 (CARD-12와 같은 이유)
  a.textContent = row.duration_sec
    ? row.channel
    : `${row.channel} · 길이 모름(스트림)`

  meta.append(t, a)
  div.append(at, thumbEl(row), meta)

  if (row.stampCount) {
    const n = document.createElement('span')
    n.className = 'stampn'
    n.textContent = `도장 ${row.stampCount}`
    div.append(n)
  }

  const len = document.createElement('span')
  len.className = 'tm'
  len.textContent = span(row.listened_sec)
  div.append(len)

  return div
}

function stampRow(row, i) {
  const div = document.createElement('div')
  div.className = 'row' + (i === cursor ? ' sel' : '') + (row.deleted_at ? ' gone' : '')
  div.dataset.i = String(i)

  const at = document.createElement('span')
  at.className = 'tm at'
  at.textContent = clock(row.at)

  const meta = document.createElement('div')
  meta.className = 'meta'

  const t = document.createElement('div')
  t.className = 't'
  t.append(mark(row.title, terms()))

  const a = document.createElement('div')
  a.className = 'a'
  a.textContent = row.channel

  meta.append(t, a)
  div.append(at, thumbEl(row), meta)

  if (!row.confirmed_at) {
    const u = document.createElement('span')
    u.className = 'unseen'
    u.textContent = '확인 안 함'
    div.append(u)
  }

  const p = document.createElement('span')
  p.className = 'tm'
  p.textContent = pos(row.pos_sec)
  div.append(p)

  return div
}

function renderList() {
  el.list.replaceChildren()

  if (!rows.length) {
    const empty = document.createElement('div')
    empty.className = 'empty'
    empty.textContent = query
      ? '찾는 것이 없습니다'
      : tab === 'plays'
        ? '아직 들은 기록이 없습니다.\n재생을 시작하면 여기 쌓입니다.'
        : '표시해 둔 순간이 없습니다.\nCtrl+Alt+S로 지금 순간을 남길 수 있습니다.'
    el.list.append(empty)
    return
  }

  let day = null
  rows.forEach((row, i) => {
    const key = dayKey(tab === 'plays' ? row.started_at : row.at)

    if (key !== day) {
      day = key
      const head = document.createElement('div')
      head.className = 'day'

      const b = document.createElement('b')
      b.textContent = dayLabel(key)

      const line = document.createElement('i')

      const em = document.createElement('em')
      const same = rows.filter((r) => dayKey(tab === 'plays' ? r.started_at : r.at) === key)
      em.textContent =
        tab === 'plays'
          ? `${span(same.reduce((n, r) => n + (r.listened_sec ?? 0), 0))} · 믹스 ${same.length}`
          : `도장 ${same.length}`

      head.append(b, line, em)
      el.list.append(head)
    }

    el.list.append(tab === 'plays' ? playRow(row, i) : stampRow(row, i))
  })

  el.list.querySelector('.row.sel')?.scrollIntoView({ block: 'nearest' })
}

function renderSettings() {
  el.list.replaceChildren()
  if (!settings) return

  const item = (title, desc, node) => {
    const div = document.createElement('div')
    div.className = 'set'

    const label = document.createElement('div')
    label.className = 'label'
    const b = document.createElement('b')
    b.textContent = title
    const s = document.createElement('span')
    s.textContent = desc
    label.append(b, s)

    div.append(label, node)
    el.list.append(div)
  }

  const choices = (options, current, onPick) => {
    const box = document.createElement('div')
    box.className = 'choices'
    for (const [value, text] of options) {
      const btn = document.createElement('button')
      btn.textContent = text
      if (String(current) === String(value)) btn.classList.add('on')
      btn.addEventListener('click', () => onPick(value))
      box.append(btn)
    }
    return box
  }

  const set = async (key, value) => {
    settings = await api.setSetting(key, value)
    renderSettings()
  }

  item(
    '카드 자리',
    'WHENCALENDAR가 상단을 쓰므로 기본은 우하단이다',
    choices(
      [
        ['br', '우하단'],
        ['bl', '좌하단'],
      ],
      settings.corner,
      (v) => set('corner', v)
    )
  )

  item(
    '되감기 폭',
    '한 곡이 지나간 직후를 되짚는 데 필요한 양',
    choices(
      [
        [5, '5초'],
        [10, '10초'],
        [15, '15초'],
      ],
      settings.backSec,
      (v) => set('backSec', v)
    )
  )

  item(
    '썸네일 블러',
    '약할수록 이미지가 보이고, 그만큼 글자가 위태로워진다',
    choices(
      [
        [0, '없음'],
        [6, '6px'],
        [12, '12px'],
      ],
      settings.blur,
      (v) => set('blur', v)
    )
  )

  item(
    '로그인할 때 시작',
    '트레이에 상주하며 카드를 띄운다',
    choices(
      [
        [true, '켬'],
        [false, '끔'],
      ],
      settings.autoStart,
      (v) => set('autoStart', v)
    )
  )

  const path = document.createElement('div')
  path.className = 'path'
  path.textContent = settings.dataDir ?? ''

  const open = document.createElement('button')
  open.textContent = '열기'
  const box = document.createElement('div')
  box.className = 'choices'
  open.addEventListener('click', () => api.openDataDir())
  box.append(open)

  item('데이터 폴더', settings.dataDir ?? '', box)
}

// --- 불러오기 --------------------------------------------------------------

async function load() {
  el.hint.textContent = HINT[tab]
  el.cho.hidden = !(query.trim() && terms().length === 0)

  for (const btn of el.tabs.querySelectorAll('button')) {
    btn.classList.toggle('on', btn.dataset.tab === tab)
  }

  if (tab === 'settings') {
    el.search.hidden = true
    settings = await api.settings()
    renderSettings()
    return
  }

  const result = await api.query({ tab, query, onlyUnconfirmed })
  rows = result.rows
  cursor = Math.min(cursor, Math.max(0, rows.length - 1))

  el.week.textContent = result.weekText ?? ''
  el.badge.hidden = !result.unconfirmed
  el.badge.textContent = String(result.unconfirmed ?? 0)

  renderList()
}

function move(delta) {
  if (!rows.length) return
  cursor = Math.max(0, Math.min(rows.length - 1, cursor + delta))
  renderList()
}

async function resume() {
  const row = rows[cursor]
  if (!row) return

  const ok = await api.resume(tab === 'plays' ? { playId: row.id } : { stampId: row.id })
  el.hint.textContent = ok
    ? '그 지점으로 보냈습니다'
    : '그 세션이 지금 없습니다 — 같은 영상을 다시 틀면 이어집니다'
}

async function remove() {
  const row = rows[cursor]
  if (!row || row.deleted_at) return

  await api.remove({ kind: tab === 'plays' ? 'play' : 'stamp', id: row.id })
  lastRemoved = { kind: tab === 'plays' ? 'play' : 'stamp', id: row.id }
  el.hint.textContent = '지웠습니다 — U로 되돌립니다'
  await load()
}

async function undo() {
  if (!lastRemoved) return
  await api.restore(lastRemoved)
  lastRemoved = null
  el.hint.textContent = '되돌렸습니다'
  await load()
}

// --- 입력 -----------------------------------------------------------------

el.tabs.addEventListener('click', (e) => {
  const btn = e.target.closest('button')
  if (!btn) return
  tab = btn.dataset.tab
  cursor = 0
  load()
})

el.list.addEventListener('click', (e) => {
  const row = e.target.closest('.row')
  if (!row) return
  cursor = Number(row.dataset.i)
  renderList()
})

el.list.addEventListener('dblclick', (e) => {
  if (e.target.closest('.row')) resume()
})

el.q.addEventListener('input', () => {
  query = el.q.value
  cursor = 0
  load()
})

el.q.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    e.stopPropagation()
    closeSearch()
  }
  if (e.key === 'Enter') {
    e.preventDefault()
    el.q.blur()
  }
})

function openSearch() {
  el.search.hidden = false
  el.q.focus()
  el.q.select()
}

function closeSearch() {
  el.search.hidden = true
  if (query) {
    query = ''
    el.q.value = ''
    cursor = 0
    load()
  }
}

document.addEventListener('keydown', (e) => {
  if (!el.help.hidden) {
    if (e.key === 'Escape' || e.key === '?') el.help.hidden = true
    return
  }

  if (document.activeElement === el.q) return

  if (e.key === 'Tab') {
    e.preventDefault()
    const at = TABS.indexOf(tab)
    tab = TABS[(at + (e.shiftKey ? TABS.length - 1 : 1)) % TABS.length]
    cursor = 0
    load()
    return
  }

  switch (e.key) {
    case 'ArrowDown':
    case 'j':
      e.preventDefault()
      move(1)
      break

    case 'ArrowUp':
    case 'k':
      e.preventDefault()
      move(-1)
      break

    case 'Enter':
      resume()
      break

    case 'x':
    case 'X':
      remove()
      break

    case 'u':
    case 'U':
      undo()
      break

    case '/':
      e.preventDefault()
      openSearch()
      break

    case 'f':
    case 'F':
      if (tab !== 'stamps') break
      onlyUnconfirmed = !onlyUnconfirmed
      el.hint.textContent = onlyUnconfirmed ? '확인 안 한 것만' : HINT.stamps
      load()
      break

    case '?':
      el.help.hidden = false
      break

    case 'Escape':
      if (!el.search.hidden) closeSearch()
      else window.close()
      break
  }
})

load()
