// tools/make-icon.mjs — 아이콘을 굽는다.
//
// 형제 앱은 디자인 도구로 만든 원본 PNG(assets/icon/<app>.png)를 줄여 쓴다.
// 이 앱은 아직 그 원본이 없어서 **코드로 그린다.** 원본이 생기면 WHENWORK
// tools/make-icon.mjs 방식(원본을 줄이고 글리프만 떼어내기)으로 갈아끼운다.
//
//   build/icon.png   512px — 설치 파일·실행 파일·창이 쓴다
//   build/tray.png   32px  — 트레이 글리프. 배경 없이 흰 도형만
//   build/tray@2x.png 64px
//
// 외부 의존성을 두지 않으려고 PNG 인코더를 직접 넣었다(zlib만 쓴다).
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import zlib from 'node:zlib'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.join(HERE, '..', 'build')

// --- PNG 쓰기 --------------------------------------------------------------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(buf) {
  let c = 0xffffffff
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)

  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))

  return Buffer.concat([len, body, crc])
}

function writePng(file, { width, height, rgba }) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA

  // 각 행 앞에 필터 바이트 0을 붙인다 — 필터를 쓰지 않는다
  const raw = Buffer.alloc((width * 4 + 1) * height)
  for (let y = 0; y < height; y++) {
    const at = y * (width * 4 + 1)
    raw[at] = 0
    rgba.copy(raw, at + 1, y * width * 4, (y + 1) * width * 4)
  }

  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(
    file,
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', ihdr),
      chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
      chunk('IEND', Buffer.alloc(0)),
    ])
  )
}

// --- 그리기 ----------------------------------------------------------------

// 4배로 그린 뒤 줄인다 — 곡선 가장자리를 계단 없이 얻는 가장 짧은 길이다.
const SS = 4

function canvas(size) {
  return { size, px: new Float32Array(size * size * 4) }
}

function put(c, x, y, [r, g, b], a = 1) {
  if (x < 0 || y < 0 || x >= c.size || y >= c.size) return
  const i = (y * c.size + x) * 4
  const inv = 1 - a
  c.px[i] = c.px[i] * inv + r * a
  c.px[i + 1] = c.px[i + 1] * inv + g * a
  c.px[i + 2] = c.px[i + 2] * inv + b * a
  c.px[i + 3] = c.px[i + 3] * inv + a
}

/** 둥근 사각형 안쪽인가. 모서리에서는 원의 방정식을 쓴다. */
function inRoundRect(x, y, { left, top, right, bottom, radius }) {
  if (x < left || x > right || y < top || y > bottom) return false

  const cx = Math.min(Math.max(x, left + radius), right - radius)
  const cy = Math.min(Math.max(y, top + radius), bottom - radius)
  const dx = x - cx
  const dy = y - cy

  return dx * dx + dy * dy <= radius * radius
}

function downscale(c, out) {
  const step = c.size / out
  const rgba = Buffer.alloc(out * out * 4)

  for (let y = 0; y < out; y++) {
    for (let x = 0; x < out; x++) {
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      let n = 0

      for (let sy = 0; sy < step; sy++) {
        for (let sx = 0; sx < step; sx++) {
          const i = ((y * step + sy) * c.size + (x * step + sx)) * 4
          r += c.px[i]
          g += c.px[i + 1]
          b += c.px[i + 2]
          a += c.px[i + 3]
          n++
        }
      }

      const at = (y * out + x) * 4
      rgba[at] = Math.round((r / n) * 255)
      rgba[at + 1] = Math.round((g / n) * 255)
      rgba[at + 2] = Math.round((b / n) * 255)
      rgba[at + 3] = Math.round((a / n) * 255)
    }
  }

  return { width: out, height: out, rgba }
}

// 형제 앱 아이콘과 같은 문법 — 둥근 사각형 그라디언트 위에 흰 도형.
// 색은 이 앱이 더한 --music(#bb9af7) 쪽으로 기울인다.
const FROM = [0.49, 0.35, 0.85] // #7d59d9
const TO = [0.73, 0.60, 0.97] // #bb9af7

const BARS = [0.42, 0.72, 1.0, 0.62, 0.34] // 이퀄라이저 높이 비율

function drawIcon({ size, background = true }) {
  const S = size * SS
  const c = canvas(S)

  const pad = background ? S * 0.09 : 0
  const rect = {
    left: pad,
    top: pad,
    right: S - pad,
    bottom: S - pad,
    radius: S * 0.22,
  }

  if (background) {
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        if (!inRoundRect(x + 0.5, y + 0.5, rect)) continue
        const t = (x / S) * 0.5 + (y / S) * 0.5
        put(c, x, y, [
          FROM[0] + (TO[0] - FROM[0]) * t,
          FROM[1] + (TO[1] - FROM[1]) * t,
          FROM[2] + (TO[2] - FROM[2]) * t,
        ])
      }
    }
  }

  // 이퀄라이저 막대 — "무엇이 흐르고 있다"를 한 글자로 말하는 도형이다.
  // 음표는 곡을 뜻하는데 이 앱은 곡을 다루지 않는다(D-03).
  const inner = background ? S * 0.52 : S * 0.86
  const barW = inner / (BARS.length * 2 - 1)
  const startX = (S - inner) / 2
  const midY = S / 2
  const white = [1, 1, 1]

  BARS.forEach((h, i) => {
    const x0 = startX + i * barW * 2
    const half = (inner * h) / 2
    const r = barW / 2

    for (let y = Math.floor(midY - half); y <= Math.ceil(midY + half); y++) {
      for (let x = Math.floor(x0); x <= Math.ceil(x0 + barW); x++) {
        if (
          inRoundRect(x + 0.5, y + 0.5, {
            left: x0,
            top: midY - half,
            right: x0 + barW,
            bottom: midY + half,
            radius: r,
          })
        ) {
          put(c, x, y, white)
        }
      }
    }
  })

  return c
}

writePng(path.join(OUT, 'icon.png'), downscale(drawIcon({ size: 512 }), 512))
writePng(path.join(OUT, 'tray.png'), downscale(drawIcon({ size: 32, background: false }), 32))
writePng(path.join(OUT, 'tray@2x.png'), downscale(drawIcon({ size: 64, background: false }), 64))

console.log('build/icon.png · build/tray.png · build/tray@2x.png')
