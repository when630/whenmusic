// 세션 추적 — SMTC가 주는 조각들을 "지금 무엇이 어디까지 흐르고 있는가"로 바꾼다.
//
// 이 파일의 함수는 전부 순수하다. SMTC도 시계도 직접 만지지 않고 인자로 받는다.
// 이 앱에서 제일 틀리기 쉬운 계산이 여기 모여 있어서, 실제 세션 없이 테스트로
// 못 박아 두는 편이 낫다.

import { toChoseong } from './search.mjs'
import { hms, normalize } from './text.mjs'

/** SMTC PlaybackStatus. 애드온 constant.js와 같은 값이다. */
export const PLAYBACK = {
  CLOSED: 0,
  OPENED: 1,
  CHANGING: 2,
  STOPPED: 3,
  PLAYING: 4,
  PAUSED: 5,
}

/** 30분 넘게 끊겼으면 다른 청취로 본다 (HIST-04). */
export const SPLIT_GAP_MS = 30 * 60 * 1000

/**
 * 이보다 짧게 관측한 줄은 이력에 남기지 않는다 (D-22).
 *
 * 2026-09-21 실측 — 믹스를 듣는 중에 다른 미디어(`Tokyo Lyric - Topic`,
 * 길이 599초)가 **2초 동안 세션을 가로챘다가** 돌아갔다. 제목·채널·길이가
 * 통째로 바뀌므로 HIST-04 규칙상 새 줄이 되고, 이런 줄이 계속 쌓이면
 * "무엇을 들었나"를 이력이 더는 답하지 못한다.
 */
export const MIN_PLAY_SEC = 20

/**
 * 보간 기준점을 만든다.
 *
 * SMTC의 timeline.position은 재생 중에 갱신되지 않는다 — 실측에서 8분까지
 * 낡아 있었다. 그래서 위치는 "언제 읽은 값인가"와 함께 들고 다녀야 한다.
 *
 * `trusted`는 이 기준점을 이벤트로 잡았는지를 말한다. 앱이 켜질 때 이미
 * 재생 중이던 세션을 처음 읽은 값은 얼마나 낡았는지 알 길이 없으므로
 * 믿지 않는다 (§5).
 */
export function makeAnchor({ posSec, status, atMs, trusted = true }) {
  return { posSec, status, atMs, trusted }
}

/**
 * 기준점에서 지금 위치를 추정한다.
 *
 * 재생 중이 아니면 시간이 흐르지 않는다. 길이를 알면 그 너머로는 넘어가지
 * 않는다 — 곡이 끝났는데 진행바가 계속 자라는 것이 제일 이상해 보인다.
 */
export function interpolate(anchor, nowMs, durationSec = null) {
  if (!anchor) return 0

  const elapsed =
    anchor.status === PLAYBACK.PLAYING ? Math.max(0, nowMs - anchor.atMs) / 1000 : 0
  const pos = anchor.posSec + elapsed

  if (durationSec != null && durationSec > 0) return Math.min(pos, durationSec)
  return Math.max(0, pos)
}

/**
 * 같은 상태로 두 번 오는 playback 이벤트를 버린다 (D-15).
 *
 * 실측에서 `playback-changed`가 같은 값으로 연달아 왔다. 이력 적재가 이벤트
 * 수에 비례하므로 이걸 흘려보내면 기록이 부풀어 오른다.
 */
export function isRedundantPlayback(prev, next) {
  if (!prev || !next) return false
  return prev.playbackStatus === next.playbackStatus && prev.playbackType === next.playbackType
}

/**
 * 새 재생 줄(plays)을 시작해야 하는가 (HIST-04).
 *
 * 제목이나 채널이 바뀌었거나, 30분 넘게 끊겼을 때다. 같은 영상을 이어 들으면
 * 한 줄로 합친다 — 1시간짜리 믹스를 두 번에 나눠 들었다고 두 줄이 되면
 * "무엇을 들었나"에 답하지 못한다.
 */
export function shouldSplit(prev, next, nowMs) {
  if (!prev) return true
  if (prev.title !== next.title) return true
  if (prev.channel !== next.channel) return true

  const lastSeen = prev.lastSeenMs ?? prev.startedAt
  return nowMs - lastSeen > SPLIT_GAP_MS
}

/**
 * 카드가 그릴 상태 (§6).
 *
 * `stamped`·`seeking`처럼 잠깐 덮어쓰는 상태는 카드가 스스로 관리한다.
 * 여기서는 세션이 실제로 어떤지만 말한다.
 */
export function cardState({ session, anchor, addonFailed = false }) {
  if (addonFailed) return 'error'
  if (!session) return 'empty'
  if (session.playback?.playbackStatus !== PLAYBACK.PLAYING) return 'paused'
  return anchor?.trusted ? 'playing' : 'stale'
}

// --- 추적기 ---------------------------------------------------------------
//
// SMTC 이벤트를 받아 "지금 무엇을 제어 중이고 어디까지 흘렀는가"를 들고 있는다.
// 시계를 주입받으므로 이것도 테스트된다.


export function createTracker({ clock = Date.now, backSec = 10, store = null } = {}) {
  const sessions = new Map() // appId -> MediaInfo
  const anchors = new Map() // appId -> anchor
  const caps = new Map() // appId -> PlaybackCapabilities
  let currentId = null
  let addonFailure = null

  // 이력 적재 (HIST-03·04). store를 주지 않으면 통째로 건너뛴다 —
  // 기록을 못 남겨도 카드는 그대로 동작해야 한다 (PLAT-03).
  let playId = null // 지금 적고 있는 plays 줄
  let playKey = null // 그 줄이 무엇에 대한 것인지
  let lastTick = null
  let stamps = []

  function keyOf(id) {
    const s = sessions.get(id)
    if (!s) return null
    return {
      sourceApp: id,
      title: normalize(s.media?.title ?? ''),
      channel: normalize(s.media?.artist ?? ''),
    }
  }

  function sameKey(a, b) {
    return a && b && a.sourceApp === b.sourceApp && a.title === b.title && a.channel === b.channel
  }

  /**
   * 지금 듣는 것에 맞는 plays 줄을 연다.
   *
   * 같은 믹스를 30분 안에 이어 들으면 앞의 줄에 계속 적는다 (HIST-04).
   * 제목이 아직 비어 있으면(SMTC가 미디어 속성을 늦게 준다) 줄을 열지 않고
   * 다음 기회를 기다린다 — 빈 제목으로 한 줄을 만들면 이력이 더러워진다.
   */
  function syncPlay() {
    if (!store?.ok || !currentId) return

    const key = keyOf(currentId)
    if (!key?.title) return
    if (sameKey(key, playKey) && playId != null) return

    const now = clock()
    const s = sessions.get(currentId)

    // 넘어가기 전에, 직전 줄이 스쳐 지나간 것이면 지운다 (D-22)
    if (playId != null) store.dropTrivialPlay(playId, MIN_PLAY_SEC)

    const open = store.findOpenPlay({ ...key, notBefore: now - SPLIT_GAP_MS })
    if (open) {
      playId = open.id
    } else {
      playId = store.startPlay({
        ...key,
        titleCho: toChoseong(key.title),
        channelCho: toChoseong(key.channel),
        titleRaw: s.media?.title ?? '',
        durationSec: s.timeline?.duration || null,
        thumbId: store.putThumb(s.media?.thumbnail),
        startedAt: now,
        posTrusted: anchors.get(currentId)?.trusted ?? false,
      })
    }

    playKey = key
    stamps = store.stampsOf(playId)
  }

  function adopt(info, { trusted }) {
    if (!info?.sourceAppId) return
    const id = info.sourceAppId

    sessions.set(id, info)
    anchors.set(
      id,
      makeAnchor({
        posSec: info.timeline?.position ?? 0,
        status: info.playback?.playbackStatus ?? PLAYBACK.CLOSED,
        atMs: clock(),
        trusted,
      })
    )
    if (currentId == null) currentId = id
  }

  function reanchor(id, { posSec, status }) {
    const prev = anchors.get(id)
    anchors.set(
      id,
      makeAnchor({
        posSec: posSec ?? prev?.posSec ?? 0,
        status: status ?? prev?.status ?? PLAYBACK.CLOSED,
        atMs: clock(),
        trusted: true, // 이벤트로 잡은 기준점은 믿는다 (§5)
      })
    )
  }

  return {
    /**
     * 앱이 켜질 때 이미 있던 세션들. 이 위치가 얼마나 낡았는지 알 길이 없으므로
     * 믿지 않는다 — 실측에서 8분까지 낡아 있었다 (§5).
     */
    seed(list) {
      for (const info of list ?? []) adopt(info, { trusted: false })
    },

    onEvent({ name, payload }) {
      const id = payload?.appId

      switch (name) {
        case 'sessions':
          for (const info of payload.sessions ?? []) {
            const had = sessions.has(info.sourceAppId)
            adopt(info, { trusted: had ? (anchors.get(info.sourceAppId)?.trusted ?? false) : false })
          }
          break

        case 'session-added':
          adopt(payload.media, { trusted: true })
          break

        case 'session-removed':
          sessions.delete(id)
          anchors.delete(id)
          caps.delete(id)
          if (currentId === id) currentId = sessions.keys().next().value ?? null
          break

        case 'current-changed':
          if (sessions.has(id)) currentId = id
          break

        case 'media-changed': {
          const s = sessions.get(id)
          if (s) s.media = payload.mediaProps
          break
        }

        case 'playback-changed': {
          const s = sessions.get(id)
          if (!s) break
          // 같은 상태로 두 번 오는 이벤트는 버린다 (D-15)
          if (isRedundantPlayback(s.playback, payload.playbackInfo)) break

          s.playback = payload.playbackInfo
          // 상태가 바뀌는 순간이 SMTC가 위치를 갱신하는 유일한 때다.
          // 여기서 기준점을 다시 잡아야 낡음이 복구된다 (§5).
          reanchor(id, { status: payload.playbackInfo.playbackStatus })
          break
        }

        case 'timeline-changed': {
          const s = sessions.get(id)
          if (!s) break
          s.timeline = payload.timelineProps
          reanchor(id, { posSec: payload.timelineProps.position })
          break
        }
      }
    },

    /** 제어 명령을 보낸 직후, 이벤트가 오기 전에 카드를 먼저 맞춘다 (D-14). */
    assume(id, status) {
      const s = sessions.get(id)
      if (!s) return
      s.playback = { ...s.playback, playbackStatus: status }
      reanchor(id, { status })
    },

    /** 시크한 위치를 즉시 반영한다. timeline-changed가 뒤따라 확정한다. */
    assumeSeek(id, posSec) {
      reanchor(id, { posSec })
    },

    setCaps(id, value) {
      if (value) caps.set(id, value)
    },

    setFailure(f) {
      addonFailure = f
    },

    pick(id) {
      if (sessions.has(id)) currentId = id
    },

    /** CARD-11 — 다음 세션으로 넘긴다. 카드에서 배지를 누르면 이게 돈다. */
    pickNext() {
      const ids = [...sessions.keys()]
      if (ids.length < 2) return
      const at = ids.indexOf(currentId)
      currentId = ids[(at + 1) % ids.length]
    },

    get currentId() {
      return currentId
    },

    get count() {
      return sessions.size
    },

    /** 지금 위치. 되감기가 이 값을 기준으로 목표를 만든다 (CTL-03). */
    positionOf(id) {
      const s = sessions.get(id)
      return interpolate(anchors.get(id), clock(), s?.timeline?.duration ?? null)
    },

    /**
     * 1초마다 불린다. 실제로 들은 시간을 누적하고 어디까지 갔는지 적는다.
     * 관측한 시간만 센다 — 앱이 꺼져 있던 동안은 알 수 없고, 모르는 것을
     * 지어내면 통계 전체가 거짓이 된다 (STOR-02).
     */
    tick() {
      syncPlay()

      const now = clock()
      const elapsed = lastTick == null ? 0 : Math.max(0, now - lastTick)
      lastTick = now

      if (!store?.ok || playId == null || !currentId) return

      const s = sessions.get(currentId)
      const playing = s?.playback?.playbackStatus === PLAYBACK.PLAYING
      const anchor = anchors.get(currentId)
      const pos = interpolate(anchor, now, s?.timeline?.duration ?? null)
      const prev = store.play(playId)

      store.touchPlay(playId, {
        listenedSec: playing ? (prev?.listened_sec ?? 0) + elapsed / 1000 : null,
        lastPosSec: pos,
        posTrusted: anchor?.trusted ?? false,
        endedAt: now,
        durationSec: s?.timeline?.duration || null,
      })
    },

    /** STMP-01 — 지금 위치에 도장. 확인을 요구하지 않는다. */
    stamp() {
      syncPlay()
      if (!store?.ok || playId == null || !currentId) return null

      const s = sessions.get(currentId)
      const anchor = anchors.get(currentId)
      const posSec = interpolate(anchor, clock(), s?.timeline?.duration ?? null)

      // 기준점이 낡았으면 이 위치도 근사다. 막지는 않되 그 사실을 적어 둔다
      // — 나중에 되돌아갈 때 엉뚱한 곳으로 데려가지 않으려면 알아야 한다 (§5 · D-23)
      store.addStamp({ playId, posSec, at: clock(), posTrusted: anchor?.trusted ?? false })
      stamps = store.stampsOf(playId)
      return posSec
    },

    /** STMP-05 — 되돌아가 들은 도장은 확인 처리한다. */
    confirmStampNear(posSec, within = 2) {
      if (!store?.ok || playId == null) return

      const hit = stamps.find((st) => Math.abs(st.pos_sec - posSec) <= within && !st.confirmed_at)
      if (!hit) return

      store.confirmStamp(hit.id, clock())
      stamps = store.stampsOf(playId)
    },

    get playId() {
      return playId
    },

    /** 카드가 그릴 것 (§6 · §9 `now`). */
    snapshot() {
      if (addonFailure) {
        return {
          state: 'error',
          title: 'SMTC에 연결하지 못했습니다',
          sub: 'Windows 10 1809(10.0.17763) 이상이 필요합니다',
          backSec,
        }
      }

      const id = currentId
      const s = id ? sessions.get(id) : null
      const anchor = id ? anchors.get(id) : null
      const state = cardState({ session: s, anchor })

      if (!s) {
        return {
          state,
          title: '재생 중인 것이 없습니다',
          sub: '재생을 시작하면 여기 뜹니다',
          backSec,
        }
      }

      const ids = [...sessions.keys()]
      const durSec = s.timeline?.duration ?? 0
      const posSec = interpolate(anchor, clock(), durSec > 0 ? durSec : null)
      const channel = normalize(s.media?.artist ?? '')

      return {
        state,
        appId: id,
        app: id,
        title: normalize(s.media?.title ?? '') || '(제목 없음)',
        sub: channel,
        sessionCount: ids.length,
        sessionIndex: ids.indexOf(id) + 1,
        posSec,
        durSec,
        nowText: hms(posSec),
        durText: hms(durSec),
        caps: caps.get(id) ?? null,
        // 진행바에 눈금으로 남는다 (CARD-07 · STMP-06)
        stamps: stamps.map((st) => ({
          posSec: st.pos_sec,
          at: st.at,
          trusted: st.pos_trusted !== 0,
        })),
        backSec,
      }
    },
  }
}
