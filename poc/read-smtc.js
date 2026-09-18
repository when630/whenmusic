// poc/read-smtc.js — SMTC 애드온이 Node에서 실제로 무엇을 주는지 확인한다.
// 확인 목표 세 가지:
//   1. 읽기가 되는가 (세션·메타데이터·타임라인)
//   2. 썸네일이 쓸 만한 이미지인가 — PowerShell WinRT에서는 측정에 실패했던 항목
//   3. 이벤트가 실제로 흐르는가 (곡·위치가 바뀔 때 알려주는가)
// 제어는 이 애드온에 없다. 미디어 키 주입으로 따로 검증했다(scratchpad/probe-control.ps1).
const fs = require('node:fs');
const path = require('node:path');
const { SMTCMonitor } = require('@coooookies/windows-smtc-monitor');

const OUT = process.argv[2] || '.';
const STATUS = ['CLOSED', 'OPENED', 'CHANGING', 'STOPPED', 'PLAYING', 'PAUSED'];

// 실제 픽셀 크기와 포맷을 읽는다. 1×1 자리표시자인지 쓸 만한 아트인지,
// 그리고 정사각(앨범 커버)인지 16:9(영상 썸네일)인지가 여기서 갈린다.
// 실측 2026-09-18: 브라우저 유튜브는 PNG 150×83으로 왔다 — 16:9다.
function imgSize(buf) {
  if (buf.length < 30) return null;
  // PNG — 매직 8바이트 뒤 IHDR의 width/height는 빅엔디언
  if (buf[0] === 0x89 && buf.toString('ascii', 1, 4) === 'PNG') {
    return { fmt: 'PNG', w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  }
  // BMP
  if (buf[0] === 0x42 && buf[1] === 0x4d) {
    return { fmt: 'BMP', w: buf.readInt32LE(18), h: Math.abs(buf.readInt32LE(22)) };
  }
  // JPEG — SOF 마커를 찾아야 하므로 크기는 생략하고 포맷만 밝힌다
  if (buf[0] === 0xff && buf[1] === 0xd8) return { fmt: 'JPEG', w: 0, h: 0 };
  return null;
}

function ext(fmt) {
  return fmt === 'PNG' ? 'png' : fmt === 'BMP' ? 'bmp' : fmt === 'JPEG' ? 'jpg' : 'bin';
}

function dump(label, info) {
  const m = info.media;
  console.log(`\n===== ${label} =====`);
  console.log(`sourceAppId : ${info.sourceAppId}`);
  console.log(`title       : ${JSON.stringify(m.title)}`);
  console.log(`artist      : ${JSON.stringify(m.artist)}`);
  console.log(`albumTitle  : ${JSON.stringify(m.albumTitle)}`);
  console.log(`albumArtist : ${JSON.stringify(m.albumArtist)}`);
  console.log(`genres      : ${JSON.stringify(m.genres)}  trackNo: ${m.trackNumber}/${m.albumTrackCount}`);
  console.log(`playback    : ${STATUS[info.playback.playbackStatus]} (type ${info.playback.playbackType})`);
  const t = info.timeline;
  console.log(`timeline    : ${t.position.toFixed(1)}s / ${t.duration.toFixed(1)}s`);

  if (m.thumbnail && m.thumbnail.length) {
    const sz = imgSize(m.thumbnail);
    const kb = (m.thumbnail.length / 1024).toFixed(1);
    let desc = '  (형식 미상)';
    if (sz) {
      const ratio = sz.h ? (sz.w / sz.h).toFixed(2) : '?';
      const shape = sz.h === 0 ? '' : Math.abs(sz.w / sz.h - 1) < 0.05 ? ' 정사각(앨범 커버)' : ` ${ratio}:1 — 영상 썸네일`;
      desc = `  ${sz.fmt} ${sz.w}x${sz.h}${shape}`;
    }
    console.log(`thumbnail   : ${kb} KB${desc}`);
    const file = path.join(OUT, `thumb-${info.sourceAppId.replace(/[^\w.-]/g, '_')}.${ext(sz && sz.fmt)}`);
    fs.writeFileSync(file, m.thumbnail);
    console.log(`            -> ${file}`);
  } else {
    console.log('thumbnail   : (없음)');
  }
}

// ── 1·2. 스냅샷
const sessions = SMTCMonitor.getMediaSessions();
console.log(`세션 ${sessions.length}개`);
sessions.forEach((s, i) => dump(`SESSION ${i + 1}`, s));

const cur = SMTCMonitor.getCurrentMediaSession();
console.log(`\n현재 세션: ${cur ? cur.sourceAppId : '(없음)'}`);

// ── 3. 이벤트 8초 관찰
console.log('\n----- 이벤트 8초 관찰 -----');
const mon = new SMTCMonitor();
let n = 0;
const log = (kind) => (appId, props) => {
  n++;
  let extra = '';
  if (kind === 'timeline') extra = `${props.position.toFixed(1)}s / ${props.duration.toFixed(1)}s`;
  else if (kind === 'media') extra = `${props.artist} — ${props.title}`;
  else if (kind === 'playback') extra = STATUS[props.playbackStatus];
  console.log(`[${new Date().toISOString().slice(11, 19)}] ${kind.padEnd(9)} ${appId}  ${extra}`);
};
mon.on('session-media-changed', log('media'));
mon.on('session-timeline-changed', log('timeline'));
mon.on('session-playback-changed', log('playback'));
mon.on('session-added', (id) => console.log(`+ added   ${id}`));
mon.on('session-removed', (id) => console.log(`- removed ${id}`));

setTimeout(() => {
  mon.destroy();
  console.log(`\n이벤트 ${n}건 수신. ${n > 0 ? '이벤트 흐름 정상.' : '이벤트가 오지 않았다 — 폴링이 필요할 수 있다.'}`);
  process.exit(0);
}, 8000);
