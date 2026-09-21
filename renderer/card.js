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
  ring: document.getElementById('ring'),
  ringFill: document.getElementById('ringFill'),
  ringDot: document.getElementById('ringDot'),
}

// 링의 중심·반지름·둘레 — card.html의 viewBox와 맞아야 한다
const RING_C = 42
const RING_R = 38.5
const RING_LENGTH = 2 * Math.PI * RING_R

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

  // 길이를 모르면 링도 그리지 않는다 — 0에서 멈춘 링은 진행바와 똑같이
  // 고장으로 읽힌다 (CARD-12)
  el.ring.style.visibility = known ? 'visible' : 'hidden'

  if (known) {
    el.now.textContent = next.nowText
    el.dur.textContent = next.durText

    const ratio = Math.min(1, Math.max(0, posSec / durSec))
    el.fill.style.width = `${ratio * 100}%`
    el.ringFill.style.strokeDasharray = String(RING_LENGTH)
    el.ringFill.style.strokeDashoffset = String(RING_LENGTH * (1 - ratio))

    // 링이 어디까지 찼는지 점으로 찍는다. svg 전체가 -90도 돌아 있어서
    // 여기서는 3시 방향이 0이고, 화면에서는 12시가 된다.
    const angle = 2 * Math.PI * ratio
    el.ringDot.setAttribute('cx', String(RING_C + RING_R * Math.cos(angle)))
    el.ringDot.setAttribute('cy', String(RING_C + RING_R * Math.sin(angle)))

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
        // 기준점이 낡았을 때 찍힌 것은 근사다 — 그 사실을 숨기지 않는다 (D-23)
        row.textContent = (st.trusted === false ? '≈' : '') + fmt(st.posSec)
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
    // 위치를 믿을 수 없는 상태에서 찍힌 눈금은 흐리게 — 진행바에 박혀 있는
    // 막대가 정확한 자리인 것처럼 보이면 안 된다 (D-23)
    mark.className =
      (s.at === newest ? 'mark' : 'mark old') + (s.trusted === false ? ' approx' : '')
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
    if (act === 'back' || act === 'forward') ok = can('isPlaybackPositionEnabled')

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

  if (act === 'back' || act === 'forward') {
    const sec = snap.backSec ?? 10
    api.ctl({ action: act, appId: snap.appId, sec })
    flash(act === 'back' ? `← ${sec}초 되감음` : `${sec}초 앞으로 →`)
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

// --- 끌어서 옮기기 (D-26) -------------------------------------------------
//
// -webkit-app-region: drag를 쓰면 한 줄로 끝나지만, **그 영역은 포인터
// 이벤트를 렌더러에 주지 않는다.** 카드는 마우스가 들어왔는지로 펼침을
// 정하므로(CARD-08) 드래그를 얻는 대신 호버를 잃는다. 그래서 손으로 끈다.
//
// 좌표는 screenX/Y(화면 절대)를 쓴다 — 창이 따라 움직이는 중이라
// clientX/Y는 매 프레임 기준이 달라진다.
let drag = null

el.card.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return
  // 누를 것 위에서 시작한 것은 끌기가 아니다
  if (e.target.closest('button, .bar, .stamp-list')) return

  drag = { x: e.screenX, y: e.screenY }
  e.preventDefault()
})

window.addEventListener('mousemove', (e) => {
  if (!drag) return

  const dx = e.screenX - drag.x
  const dy = e.screenY - drag.y
  if (dx || dy) {
    api.moveBy(dx, dy)
    drag = { x: e.screenX, y: e.screenY }
  }
})

window.addEventListener('mouseup', () => {
  if (!drag) return
  drag = null
  api.moveEnd()
})

// 커서가 카드를 떠났는데 mousemove가 끊겨 펼친 채로 남는 일이 있다.
// 메인이 커서를 대신 보고 알려 준다.
api.onUnhover(() => {
  inside = false
  el.card.classList.remove('open')
})

api.onNow(render)
api.onStamps((list) => {
  if (snap) render({ ...snap, stamps: list })
})
