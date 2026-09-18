// poc/probe-sync.js — 도장 기능의 성립 조건을 확인한다.
//
// 실측된 문제: SMTC의 timeline.position은 재생 중에도 갱신되지 않는다(3초 뒤에도 같은 값).
// 그러면 "지금 이 순간"에 도장을 찍을 때 찍을 위치를 모른다. 확인할 것 두 가지:
//   1. playback 상태가 바뀌면 position이 갱신되는가  → 보간 기준점을 얻을 수 있는가
//   2. session-playback-changed 이벤트가 실제로 오는가 → 그 시점을 알 수 있는가
// 재생에 개입하므로 일시정지 후 바로 되돌린다(약 0.4초 끊김).
const { execFileSync } = require('node:child_process');
const { SMTCMonitor } = require('@coooookies/windows-smtc-monitor');

const STATUS = ['CLOSED', 'OPENED', 'CHANGING', 'STOPPED', 'PLAYING', 'PAUSED'];
const t0 = Date.now();
const ms = () => String(Date.now() - t0).padStart(5) + 'ms';
const pos = () => {
  const s = SMTCMonitor.getCurrentMediaSession();
  return s ? s.timeline.position : null;
};

// VK_MEDIA_PLAY_PAUSE(0xB3)를 한 번 누른다. 애드온에 제어가 없어 이 경로를 쓴다.
function tapPlayPause() {
  execFileSync('powershell.exe', ['-NoProfile', '-Command', `
Add-Type -Namespace W -Name K -MemberDefinition '[DllImport("user32.dll")] public static extern void keybd_event(byte b,byte s,uint f,System.UIntPtr e);'
[W.K]::keybd_event(0xB3,0,0,[System.UIntPtr]::Zero); [W.K]::keybd_event(0xB3,0,2,[System.UIntPtr]::Zero)`],
    { stdio: 'ignore' });
}

const mon = new SMTCMonitor();
const events = [];
mon.on('session-playback-changed', (id, pb) => {
  events.push('playback');
  console.log(`${ms()}  EVENT playback-changed  ${id} → ${STATUS[pb.playbackStatus]}`);
});
mon.on('session-timeline-changed', (id, tl) => {
  events.push('timeline');
  console.log(`${ms()}  EVENT timeline-changed  ${id} → ${tl.position.toFixed(2)}s`);
});

const before = pos();
console.log(`${ms()}  기준 position : ${before?.toFixed(2)}s`);

setTimeout(() => { console.log(`${ms()}  → 미디어 키 (일시정지)`); tapPlayPause(); }, 600);
setTimeout(() => { console.log(`${ms()}  일시정지 후 position : ${pos()?.toFixed(2)}s`); }, 1400);
setTimeout(() => { console.log(`${ms()}  → 미디어 키 (재생 복구)`); tapPlayPause(); }, 1800);
setTimeout(() => { console.log(`${ms()}  재생 복구 후 position : ${pos()?.toFixed(2)}s`); }, 2600);

setTimeout(() => {
  const after = pos();
  console.log(`\n${ms()}  3초 더 기다린 뒤 position : ${after?.toFixed(2)}s`);
  const moved = after !== null && before !== null && Math.abs(after - before) > 0.5;
  console.log('');
  console.log(`이벤트 수신    : ${events.length}건  [${[...new Set(events)].join(', ') || '없음'}]`);
  console.log(`position 갱신  : ${moved ? '됨 (' + (after - before).toFixed(2) + 's 이동)' : '안 됨'}`);
  console.log('');
  if (moved && events.length) {
    console.log('=> 상태 변화가 position을 갱신하고 이벤트로 알려준다. 그 시점을 기준점으로 보간하면 된다.');
  } else if (moved) {
    console.log('=> position은 갱신되지만 이벤트가 없다. 폴링으로 변화를 감지해야 한다.');
  } else {
    console.log('=> 상태 변화로도 position이 갱신되지 않는다. 정확한 위치를 얻을 경로가 없다.');
  }
  mon.destroy();
  process.exit(0);
}, 5800);
