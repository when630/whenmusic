// IPC 채널 이름을 한 곳에 모은다 (§9). 문자열을 양쪽에 따로 적으면
// 오타가 조용히 통과하고, 조용히 아무 일도 일어나지 않는다.

export const CH = {
  // main → card
  NOW: 'now', // 현재 스냅샷 + 보간 위치 + 카드 상태
  STAMPS: 'stamps', // 이번 세션의 도장 목록
  UNHOVER: 'card:unhover', // 커서가 카드를 떠났다 — 메인이 대신 본 것

  // card → main
  CTL: 'ctl', // { action, appId, sec? }
  STAMP: 'stamp', // 지금 위치에 도장
  HOVER: 'card:hover', // 카드 위 마우스 — 클릭 통과를 잠깐 끈다
  MOVE: 'card:move', // 끌어서 옮기는 중 (D-26)
  MOVE_END: 'card:move-end', // 놓았다 — 이 자리를 기억한다

  // window ↔ main (전부 invoke/handle — 창은 답을 받아야 그린다)
  QUERY: 'hist:query', // { tab, query, filter } → rows
  RESUME: 'hist:resume', // { playId } | { stampId } — 그 지점부터 이어 재생
  REMOVE: 'hist:remove', // 소프트 삭제 (STOR-04)
  RESTORE: 'hist:restore', // U로 되돌리기
  SEARCH: 'hist:search', // main → window. WHENCOMMAND가 넘긴 검색어
  SETTINGS: 'settings:get',
  SET_SETTING: 'settings:set',
  OPEN_DATA_DIR: 'data:open', // 설정 화면이 데이터 폴더를 열어 준다 (DATA-03)
}

/** `ctl` 채널이 받는 동작. 이 밖의 값은 무시된다. */
export const ACTION = {
  PLAY: 'play',
  PAUSE: 'pause',
  NEXT: 'next',
  PREV: 'prev',
  SEEK: 'seek', // sec = 절대 위치
  BACK: 'back', // sec = 되감을 양 (CTL-03)
  FORWARD: 'forward', // sec = 앞으로 감을 양. 되감기의 짝이다
  PICK: 'pick', // 제어 대상 세션을 바꾼다 (CARD-11)
}
