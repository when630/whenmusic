// 카드 디자인을 눈으로 확인할 때 쓰는 가짜 상태. 값은 2026-09-18 실측
// 그대로다(§12) — 제목의 유니코드 볼드와 전각 기호, 1시간 2분짜리 길이,
// 150×83 썸네일. 꾸며낸 데이터로 확인하면 진짜 들어올 것에서 깨진다.
//
// 프로덕션 경로는 이 파일을 import하지 않는다. `--demo`로만 들어온다.
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

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
      { posSec: 410, at: 1 },
      { posSec: 1268, at: 2 },
      { posSec: 2648, at: 3 },
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
