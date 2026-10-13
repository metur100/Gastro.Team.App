// Generates the app icon, adaptive icon foreground, splash mark and notification icon as PNGs
// using only Node built-ins. Run: node scripts/generate-assets.mjs
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'

const TEAL = [12, 99, 88, 255]
const WHITE = [255, 255, 255, 255]
const MINT = [94, 234, 212, 255]

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
const crc32 = (buf) => {
  let c = 0xffffffff
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}
function png(size, pixel) {
  const raw = Buffer.alloc(size * (size * 4 + 1))
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x + 0.5, y + 0.5)
      const i = y * (size * 4 + 1) + 1 + x * 4
      raw[i] = r; raw[i + 1] = g; raw[i + 2] = b; raw[i + 3] = a
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))])
}

const inRoundRect = (x, y, x0, y0, x1, y1, r) => {
  const cx = Math.min(Math.max(x, x0 + r), x1 - r)
  const cy = Math.min(Math.max(y, y0 + r), y1 - r)
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r
}
const inCircle = (x, y, cx, cy, r) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r

/** The brand mark (three schedule lines + dot) in a unit box [0,64]. */
function mark(x, y, line = WHITE, dot = MINT) {
  const bars = [[18, 22, 46], [18, 32, 38], [18, 42, 30]]
  for (const [x0, cy, x1] of bars) if (inRoundRect(x, y, x0 - 2.5, cy - 2.5, x1 + 2.5, cy + 2.5, 2.5)) return line
  if (inCircle(x, y, 44, 42, 6)) return dot
  return null
}

const TRANSPARENT = [0, 0, 0, 0]
mkdirSync('assets', { recursive: true })

// App icon: full-bleed teal (stores apply their own corner mask) with the mark.
writeFileSync('assets/icon.png', png(1024, (x, y) => mark((x / 1024) * 64, (y / 1024) * 64) ?? TEAL))
// Android adaptive foreground: mark inside the 66% safe zone on transparent background.
writeFileSync('assets/adaptive-icon.png', png(1024, (x, y) => {
  const s = 1024 * 0.6, o = (1024 - s) / 2
  const u = ((x - o) / s) * 64, v = ((y - o) / s) * 64
  return u >= 0 && u <= 64 && v >= 0 && v <= 64 ? mark(u, v) ?? TRANSPARENT : TRANSPARENT
}))
// Splash mark (shown on teal background).
writeFileSync('assets/splash-icon.png', png(512, (x, y) => mark((x / 512) * 64, (y / 512) * 64) ?? TRANSPARENT))
// Notification icon: white silhouette on transparent (Android requirement).
writeFileSync('assets/notification-icon.png', png(96, (x, y) => (mark((x / 96) * 64, (y / 96) * 64, WHITE, WHITE) ? WHITE : TRANSPARENT)))
// Web favicon for expo web.
writeFileSync('assets/favicon.png', png(48, (x, y) => (inRoundRect(x, y, 0, 0, 48, 48, 10) ? mark((x / 48) * 64, (y / 48) * 64) ?? TEAL : TRANSPARENT)))
console.log('Assets written to ./assets')
