// poc/bench-ctl.js — 상주 PowerShell 제어 호스트의 왕복 지연을 잰다.
// 단발 스폰이 약 250ms였고 그 대부분이 프로세스 생성 + WinRT 초기화다.
// 그 비용을 한 번만 내면 얼마까지 떨어지는지가 Rust 애드온 도입 여부를 가른다.
const { spawn } = require('node:child_process');
const path = require('node:path');

const HOST = path.join(__dirname, 'ctl-host.ps1');
const t0 = Date.now();

const ps = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', HOST], {
  stdio: ['pipe', 'pipe', 'pipe'],
});

let buf = '';
const waiters = [];
ps.stdout.on('data', (d) => {
  buf += d.toString();
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).replace(/\r$/, '');
    buf = buf.slice(i + 1);
    const w = waiters.shift();
    if (w) w(line);
  }
});
ps.stderr.on('data', (d) => process.stderr.write('[ps] ' + d));

const send = (cmd) =>
  new Promise((resolve) => {
    const start = process.hrtime.bigint();
    waiters.push((line) => resolve({ line, ms: Number(process.hrtime.bigint() - start) / 1e6 }));
    ps.stdin.write(cmd + '\n');
  });

const ready = new Promise((resolve) => waiters.push(resolve));

(async () => {
  await ready;
  console.log(`기동(스폰 + WinRT 초기화) : ${Date.now() - t0}ms  — 앱 시작 시 한 번만`);
  console.log('');

  // 읽기 왕복 — WinRT 호출 비용은 제어와 비슷하고 음악을 건드리지 않는다
  const reads = [];
  for (let i = 0; i < 12; i++) {
    const r = await send('pos Chrome');
    reads.push(r.ms);
    if (i === 0) console.log(`첫 명령        : ${r.ms.toFixed(1)}ms   → ${r.line}s`);
  }
  const rest = reads.slice(1).sort((a, b) => a - b);
  const med = rest[Math.floor(rest.length / 2)];
  console.log(`이후 11회       : 중간값 ${med.toFixed(1)}ms · 최소 ${rest[0].toFixed(1)}ms · 최대 ${rest[rest.length - 1].toFixed(1)}ms`);

  // 제어 왕복 1회만 — 실제 명령이 얼마나 빨리 수락되는지
  const before = await send('stat Chrome');
  const p = await send('pause Chrome');
  const after = await send('stat Chrome');
  await send('play Chrome');
  console.log('');
  console.log(`제어(pause) 왕복 : ${p.ms.toFixed(1)}ms   ${p.line}`);
  console.log(`상태 확인        : ${before.line} → ${after.line} → 복구 요청 전송`);

  console.log('');
  console.log(`판정: 단발 스폰 250ms → 상주 ${med.toFixed(0)}ms (${(250 / med).toFixed(0)}배 빠름)`);
  console.log(med < 50 ? '  => 체감 없는 수준. Rust 애드온 없이 충분하다.'
    : med < 120 ? '  => 쓸 만하지만 즉각적이진 않다.'
    : '  => 여전히 느리다. Rust 애드온이 필요하다.');

  ps.stdin.write('quit\n');
  setTimeout(() => { ps.kill(); process.exit(0); }, 400);
})();
