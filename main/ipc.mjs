// IPC 채널 이름을 한 곳에 모은다 (§9). 문자열을 양쪽에 따로 적으면
// 오타가 조용히 통과하고, 조용히 아무 일도 일어나지 않는다.

export const CH = {
  // main → card
  NOW: 'now', // 현재 스냅샷 + 보간 위치 + 카드 상태
  STAMPS: 'stamps', // 이번 세션의 도장 목록

  // card → main
  CTL: 'ctl', // { action, appId, sec? }
  STAMP: 'stamp', // 지금 위치에 도장
  HOVER: 'card:hover', // 카드 위 마우스 — 클릭 통과를 잠깐 끈다
}

/** `ctl` 채널이 받는 동작. 이 밖의 값은 무시된다. */
export const ACTION = {
  PLAY: 'play',
  PAUSE: 'pause',
  NEXT: 'next',
  PREV: 'prev',
  SEEK: 'seek', // sec = 절대 위치
  BACK: 'back', // sec = 되감을 양 (CTL-03)
  PICK: 'pick', // 제어 대상 세션을 바꾼다 (CARD-11)
}
