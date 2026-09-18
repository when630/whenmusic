// 세션 추적 — SMTC가 주는 조각들을 "지금 무엇이 어디까지 흐르고 있는가"로 바꾼다.
//
// 이 파일의 함수는 전부 순수하다. SMTC도 시계도 직접 만지지 않고 인자로 받는다.
// 이 앱에서 제일 틀리기 쉬운 계산이 여기 모여 있어서, 실제 세션 없이 테스트로
// 못 박아 두는 편이 낫다.

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


export function createTracker({ clock = Date.now, backSec = 10 } = {}) {
  const sessions = new Map() // appId -> MediaInfo
  const anchors = new Map() // appId -> anchor
  const caps = new Map() // appId -> PlaybackCapabilities
  let currentId = null
  let addonFailure = null

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

      const durSec = s.timeline?.duration ?? 0
      const posSec = interpolate(anchor, clock(), durSec > 0 ? durSec : null)
      const channel = normalize(s.media?.artist ?? '')

      return {
        state,
        appId: id,
        app: id,
        title: normalize(s.media?.title ?? '') || '(제목 없음)',
        sub: sessions.size > 1 ? `${channel} · 세션 ${sessions.size}개` : channel,
        posSec,
        durSec,
        nowText: hms(posSec),
        durText: hms(durSec),
        caps: caps.get(id) ?? null,
        backSec,
      }
    },
  }
}
