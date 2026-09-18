// 카드 렌더러. 계산은 전부 메인이 한다 — 여기서는 받은 것을 그리고,
// 누른 것을 돌려보낸다. 유일한 예외가 낙관적 UI다 (CTL-06).

const api = window.whenmusic

const el = {
  card: document.getElementById('card'),
  art: document.getElementById('art'),
  title: document.getElementById('title'),
  sub: document.getElementById('sub'),
  src: document.getElementById('src'),
  app: document.getElementById('app'),
  now: document.getElementById('now'),
  dur: document.getElementById('dur'),
  bar: document.getElementById('bar'),
  fill: document.getElementById('fill'),
  progress: document.getElementById('progress'),
  toggle: document.getElementById('icon-toggle'),
  stampList: document.getElementById('stampList'),
}

const ICON = {
  play: 'M8 5v14l11-7z',
  pause: 'M8 5h3v14H8zm5 0h3v14h-3z',
}

let snap = null // 마지막으로 받은 상태
let flashTimer = null

// --- 그리기 ---------------------------------------------------------------

function render(next) {
  snap = next
  const { state, title, sub, app, artUrl, posSec, durSec, caps, stamps } = next

  el.card.dataset.state = state
  el.title.textContent = title ?? ''
  el.sub.textContent = sub ?? ''

  el.src.hidden = !app
  // CARD-11 — 세션이 둘 이상이면 어느 것을 제어 중인지 드러나고, 눌러서 바꾼다
  el.src.classList.toggle('pickable', (next.sessionCount ?? 1) > 1)
  el.app.textContent =
    (next.sessionCount ?? 1) > 1 ? `${app} (${next.sessionIndex}/${next.sessionCount})` : (app ?? '')

  if (artUrl) {
    el.art.style.backgroundImage = `url("${artUrl}")`
    el.art.classList.add('has')
  } else {
    el.art.classList.remove('has')
  }

  // CARD-12 — 길이를 모르는 스트림은 진행바를 숨긴다. 0%로 멈춰 있는 바는
  // 고장으로 읽힌다.
  const known = Number.isFinite(durSec) && durSec > 0
  el.progress.hidden = !known

  if (known) {
    el.now.textContent = next.nowText
    el.dur.textContent = next.durText
    el.fill.style.width = `${Math.min(100, (posSec / durSec) * 100)}%`
    drawStamps(stamps ?? [], durSec)
  }

  el.toggle.firstElementChild?.remove()
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  path.setAttribute('d', state === 'playing' || state === 'stale' ? ICON.pause : ICON.play)
  el.toggle.appendChild(path)

  applyCaps(caps)
  renderStampList(stamps ?? [], next.durSec)

  // 단축키로 찍거나 되감았을 때 — 메인이 한 번만 실어 보낸다
  if (next.flash) flash(next.flash)
}

// CARD-08 — 호버하면 이번 세션의 도장 목록이 보인다. 도장 자체는 Phase 3다.
function renderStampList(stamps, durSec) {
  if (!stamps.length) {
    el.stampList.textContent = '표시해 둔 순간이 없습니다'
    return
  }

  el.stampList.replaceChildren(
    ...stamps
      .slice(-3)
      .reverse()
      .map((st) => {
        const row = document.createElement('span')
        row.className = 'one'
        row.dataset.pos = String(st.posSec)
        row.textContent = fmt(st.posSec)
        return row
      })
  )
}

function fmt(sec) {
  const t = Math.floor(sec)
  const s = String(t % 60).padStart(2, '0')
  const m = Math.floor(t / 60) % 60
  const h = Math.floor(t / 3600)
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`
}

// CARD-07 · STMP-06 — 이번 세션에 찍은 도장을 진행바에 눈금으로 남긴다.
function drawStamps(stamps, durSec) {
  for (const old of el.bar.querySelectorAll('.mark')) old.remove()

  const newest = stamps.length ? Math.max(...stamps.map((s) => s.at)) : 0
  for (const s of stamps) {
    const mark = document.createElement('span')
    mark.className = s.at === newest ? 'mark' : 'mark old'
    mark.style.left = `${Math.min(100, (s.posSec / durSec) * 100)}%`
    mark.dataset.pos = String(s.posSec)
    el.bar.appendChild(mark)
  }
}

// CTL-07 — 세션이 못 받는 명령은 눌리지 않게 한다.
function applyCaps(caps) {
  const can = (key) => (caps ? caps[key] !== false : true)

  for (const btn of el.card.querySelectorAll('.ctl button')) {
    const act = btn.dataset.act
    let ok = true

    if (act === 'toggle') ok = can('isPlayEnabled') || can('isPauseEnabled')
    if (act === 'back') ok = can('isPlaybackPositionEnabled')

    btn.disabled = !ok
  }
}

// 되감기·도장 직후 1.4초만 다르게 보이고 돌아온다 (STMP-02 · CTL-03)
function flash(message) {
  el.card.classList.add('flash')
  if (message) el.sub.textContent = message

  clearTimeout(flashTimer)
  flashTimer = setTimeout(() => {
    el.card.classList.remove('flash')
    if (snap) el.sub.textContent = snap.sub ?? ''
  }, 1400)
}

// --- 입력 -----------------------------------------------------------------

// 창은 클릭을 통과시키고 있다. 카드 위에 마우스가 오는 동안만 통과를 끈다 —
// 그래야 아래 창을 계속 쓸 수 있으면서 버튼도 눌린다 (CARD-03).
let inside = false
document.addEventListener('mousemove', (e) => {
  const r = el.card.getBoundingClientRect()
  const on =
    e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom

  if (on !== inside) {
    inside = on
    api.hover(on)
    el.card.classList.toggle('open', on)
  }
})

document.addEventListener('mouseleave', () => {
  if (!inside) return
  inside = false
  api.hover(false)
  el.card.classList.remove('open')
})

el.card.addEventListener('click', (e) => {
  const btn = e.target.closest('button')
  if (!btn || btn.disabled || !snap?.appId) return

  const act = btn.dataset.act

  if (btn.id === 'src') {
    if (btn.classList.contains('pickable')) api.ctl({ action: 'pick' })
    return
  }

  if (act === 'prev' || act === 'next') {
    api.ctl({ action: act, appId: snap.appId })
    return
  }

  if (act === 'stamp') {
    api.stamp()
    flash('이 순간을 표시했습니다')
    return
  }

  if (act === 'back') {
    api.ctl({ action: 'back', appId: snap.appId, sec: snap.backSec ?? 10 })
    flash(`← ${snap.backSec ?? 10}초 되감음`)
    return
  }

  if (act === 'toggle') {
    // 명령 수락(약 5ms)보다 SMTC 상태 반영이 늦다. 카드를 먼저 바꾸고
    // 이벤트가 오면 맞춘다 — 어긋나면 이벤트가 이긴다 (D-14).
    const playing = snap.state === 'playing' || snap.state === 'stale'
    api.ctl({ action: playing ? 'pause' : 'play', appId: snap.appId })
    render({ ...snap, state: playing ? 'paused' : 'playing' })
  }
})

// CTL-05 — 진행바를 눌러 그 지점으로. 도장 눈금을 누르면 그 도장 위치로.
el.bar.addEventListener('click', (e) => {
  if (!snap?.appId || !snap.durSec) return

  const mark = e.target.closest('.mark')
  if (mark) {
    api.ctl({ action: 'seek', appId: snap.appId, sec: Number(mark.dataset.pos) })
    flash('표시해 둔 지점으로')
    return
  }

  const r = el.bar.getBoundingClientRect()
  const ratio = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width))
  api.ctl({ action: 'seek', appId: snap.appId, sec: ratio * snap.durSec })
})

// 도장 목록에서 눌러도 그 지점으로 간다 (STMP-04)
el.stampList.addEventListener('click', (e) => {
  const row = e.target.closest('.one')
  if (!row || !snap?.appId) return
  api.ctl({ action: 'seek', appId: snap.appId, sec: Number(row.dataset.pos) })
  flash('표시해 둔 지점으로')
})

api.onNow(render)
api.onStamps((list) => {
  if (snap) render({ ...snap, stamps: list })
})
