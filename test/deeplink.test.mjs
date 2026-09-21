// when-protocol 연동의 순수 부분. 규약은 when630/when-protocol.
import test from 'node:test'
import assert from 'node:assert/strict'
import { COMMANDS, SCHEME, buildManifest, fromArgv, parseDeepLink } from '../main/deeplink.mjs'

test('딥링크를 명령과 인자로 가른다', () => {
  assert.deepEqual(parseDeepLink('whenmusic://now'), { command: 'now', args: {} })
  assert.deepEqual(parseDeepLink('whenmusic://stamp'), { command: 'stamp', args: {} })
  assert.deepEqual(parseDeepLink('whenmusic://history?q=%ED%9E%99%ED%95%A9'), {
    command: 'history',
    args: { q: '힙합' },
  })
})

test('경로 꼴로 와도 받는다', () => {
  assert.equal(parseDeepLink('whenmusic:///history')?.command, 'history')
  assert.equal(parseDeepLink('whenmusic://HISTORY')?.command, 'history')
})

test('남의 스킴과 모르는 명령은 null이다 — 남의 링크를 받지 않는다', () => {
  assert.equal(parseDeepLink('whennote://search?q=x'), null)
  assert.equal(parseDeepLink('whenmusic://quit'), null)
  assert.equal(parseDeepLink('https://example.com'), null)
  assert.equal(parseDeepLink('그냥 글자'), null)
  assert.equal(parseDeepLink(null), null)
})

test('빈 인자는 싣지 않는다 — 앱이 빈 값을 따로 다루지 않게', () => {
  assert.deepEqual(parseDeepLink('whenmusic://history?q=')?.args, {})
})

test('argv에서 URL을 찾아낸다', () => {
  assert.equal(
    fromArgv(['C:/app/electron.exe', '.', 'whenmusic://stamp']),
    'whenmusic://stamp'
  )
  assert.equal(fromArgv(['electron.exe', '--smoke']), null)
  assert.equal(fromArgv([]), null)
  assert.equal(fromArgv(null), null)
})

test('명령 id는 규약이 정한 모양을 지킨다', () => {
  for (const c of COMMANDS) {
    assert.match(c.id, /^[a-z][a-z0-9-]{1,31}$/)
    assert.ok(c.title && c.description)
  }
  assert.match(SCHEME, /^[a-z][a-z0-9-]{1,31}$/)
})

test('매니페스트에 win32만 담는다 — macOS에는 없는 앱이다 (PLAT-06)', () => {
  const m = buildManifest({ platformName: 'win32', packaged: false })

  assert.equal(m.protocol, 1)
  assert.equal(m.id, 'whenmusic')
  assert.equal(m.scheme, 'whenmusic')
  assert.equal(m.name, 'WHENMUSIC')
  assert.deepEqual(Object.keys(m.verify), ['win32'])
  assert.match(m.verify.win32, /WHENMUSIC\.exe$/)
  assert.equal(m.commands.length, COMMANDS.length)
})

test('패키징본은 지금 실행 파일을 가리킨다', () => {
  const m = buildManifest({
    platformName: 'win32',
    packaged: true,
    exePath: 'D:\\Programs\\WHENMUSIC\\WHENMUSIC.exe',
  })
  assert.equal(m.verify.win32, 'D:\\Programs\\WHENMUSIC\\WHENMUSIC.exe')
})

test('개발 실행이면 실행 파일 경로를 쓰지 않는다 — electron.exe를 적으면 거짓말이 된다', () => {
  const m = buildManifest({
    platformName: 'win32',
    packaged: false,
    exePath: 'D:\\when630\\whenmusic\\node_modules\\electron\\dist\\electron.exe',
  })
  assert.match(m.verify.win32, /^%LOCALAPPDATA%/)
})

test('매니페스트는 JSON으로 온전히 오간다', () => {
  const m = buildManifest({ platformName: 'win32' })
  assert.deepEqual(JSON.parse(JSON.stringify(m)), m)
})
