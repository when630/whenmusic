// 카드 디자인을 눈으로 확인할 때 쓰는 가짜 상태. 값은 2026-09-18 실측
// 그대로다(§12) — 제목의 유니코드 볼드와 전각 기호, 1시간 2분짜리 길이,
// 150×83 썸네일. 꾸며낸 데이터로 확인하면 진짜 들어올 것에서 깨진다.
//
// 프로덕션 경로는 이 파일을 import하지 않는다. `--demo`로만 들어온다.
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { toChoseong } from '../main/search.mjs'
import { hms, normalize } from '../main/text.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))

const RAW_TITLE =
  '[𝐏𝐥𝐚𝐲𝐥𝐢𝐬𝐭] 우연히 듣고 반해버려서… 그냥 저장해버린 노래들 🎧🤍｜감성 힙합/R&B'

export async function demoState(variant = 'playing') {
  const png = await readFile(path.join(HERE, '..', 'design', 'mockups', 'sample-thumb.png'))

  const posSec = 3481
  const durSec = 3731

  const base = {
    state: 'playing',
    appId: 'Chrome',
    app: 'Chrome',
    title: normalize(RAW_TITLE),
    sub: '𝐂𝐡𝐞𝐫𝐫𝐲𝐌𝐢𝐱'.normalize('NFKC'),
    posSec,
    durSec,
    nowText: hms(posSec),
    durText: hms(durSec),
    backSec: 10,
    artUrl: `data:image/png;base64,${png.toString('base64')}`,
    caps: {
      isPlayEnabled: true,
      isPauseEnabled: true,
      isNextEnabled: true,
      isPreviousEnabled: true,
      isPlaybackPositionEnabled: true,
    },
    stamps: [
      // 첫 번째는 낡은 기준점에서 찍힌 것 — 눈금이 흐려야 한다 (D-23)
      { posSec: 410, at: 1, trusted: false },
      { posSec: 1268, at: 2, trusted: true },
      { posSec: 2648, at: 3, trusted: true },
    ],
  }

  if (variant === 'paused') return { ...base, state: 'paused' }
  if (variant === 'stale') return { ...base, state: 'stale' }
  if (variant === 'radio') {
    // 길이를 모르는 스트림 — 진행바가 숨어야 한다 (CARD-12)
    return { ...base, durSec: 0, stamps: [] }
  }
  if (variant === 'nocaps') {
    // 시크를 못 받는 세션 — 되감기 버튼이 잠겨야 한다 (CTL-07)
    return { ...base, caps: { ...base.caps, isPlaybackPositionEnabled: false } }
  }
  return base
}

/**
 * 이력 창을 눈으로 확인할 때 쓰는 샘플. 실측이 말한 모양 그대로다 —
 * 하루 서너 줄, 1시간 안팎의 믹스, 길이를 모르는 스트림 하나.
 */
export function seedDemoStore(store, now = Date.now()) {
  if (!store.ok || store.recentPlays().length) return

  const H = 60 * 60 * 1000
  const rows = [
    { t: '[Playlist] 우연히 듣고 반해버려서… 그냥 저장해버린 노래들 🎧🤍|감성 힙합/R&B', c: 'CherryMix', d: 3731, at: now - 4 * H, listened: 3480, stamps: [410, 1268, 2648, 3100] },
    { t: '비 오는 새벽 감성 R&B 플레이리스트', c: 'CherryMix', d: 3720, at: now - 7 * H, listened: 3720, stamps: [900, 2400] },
    { t: 'lofi hip hop radio — beats to relax/study to', c: 'Lofi Girl', d: null, at: now - 9 * H, listened: 6060, stamps: [] },
    { t: '새벽에 혼자 듣는 감성 알앤비', c: '밤과음악', d: 4320, at: now - 27 * H, listened: 4320, stamps: [1500] },
    { t: '재즈 바 BGM — 늦은 밤', c: 'NightJazz', d: 5400, at: now - 31 * H, listened: 2880, stamps: [] },
  ]

  for (const r of rows) {
    const id = store.startPlay({
      sourceApp: 'Chrome',
      title: r.t,
      titleRaw: r.t,
      titleCho: toChoseong(r.t),
      channel: r.c,
      channelCho: toChoseong(r.c),
      durationSec: r.d,
      startedAt: r.at,
      endedAt: r.at + r.listened * 1000,
      listenedSec: r.listened,
      lastPosSec: r.stamps.at(-1) ?? 0,
      posTrusted: true,
    })
    for (const pos of r.stamps) store.addStamp({ playId: id, posSec: pos, at: r.at + pos * 1000 })
  }
}
