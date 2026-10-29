// Generates the Google Play graphics in store-assets/android/ (opaque PNG/JPEG, no transparency):
//   icon-512.png                      512x512 app icon (from apps/mobile/assets/icon.png)
//   feature-graphic-1024x500.png      feature graphic
//   phone-screenshots/phone-NN-*.jpg  1080x1920 framed phone screenshots (from raw emulator captures)
//
// Needs @napi-rs/canvas (not a project dependency), e.g. in a scratch folder:
//   npm i @napi-rs/canvas@0.1.65 && NODE_PATH=<scratch>/node_modules node scripts/store-assets.mjs <rawScreenshotDir>
// Raw captures: `adb exec-out screencap -p > <dir>/<name>.png` on the release build signed in as the review account.
// Fonts default to Segoe UI (Windows); override with GT_FONT_BOLD / GT_FONT_REGULAR.
import { createRequire } from 'node:module'
import { mkdirSync, writeFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { deflateSync } from 'node:zlib'

const require = createRequire(path.join(process.env.NODE_PATH ?? process.cwd(), 'noop.js'))
const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas')

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..')
const out = path.join(root, 'store-assets', 'android')
const rawDir = process.argv[2]
GlobalFonts.registerFromPath(process.env.GT_FONT_BOLD ?? 'C:/Windows/Fonts/segoeuib.ttf', 'GTBold')
GlobalFonts.registerFromPath(process.env.GT_FONT_REGULAR ?? 'C:/Windows/Fonts/segoeui.ttf', 'GTRegular')

// Opaque 24-bit RGB PNG (Play requires the feature graphic without alpha channel).
function rgbPng(canvas) {
  const { width: w, height: h } = canvas, px = canvas.getContext('2d').getImageData(0, 0, w, h).data
  const raw = Buffer.alloc(h * (w * 3 + 1))
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const s = (y * w + x) * 4, d = y * (w * 3 + 1) + 1 + x * 3; raw[d] = px[s]; raw[d + 1] = px[s + 1]; raw[d + 2] = px[s + 2] }
  const table = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0 })
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = table[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]) }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))])
}

const TEAL = '#0c6358', TEAL_DARK = '#084a42', MINT = '#5eead4'
mkdirSync(out, { recursive: true })
const icon = await loadImage(path.join(root, 'apps', 'mobile', 'assets', 'icon.png'))

// 512x512 icon (opaque: draw on teal first)
{
  const c = createCanvas(512, 512), ctx = c.getContext('2d')
  ctx.fillStyle = TEAL; ctx.fillRect(0, 0, 512, 512); ctx.drawImage(icon, 0, 0, 512, 512)
  writeFileSync(path.join(out, 'icon-512.png'), c.toBuffer('image/png'))
}

// 1024x500 feature graphic
{
  const W = 1024, H = 500, c = createCanvas(W, H), ctx = c.getContext('2d')
  const g = ctx.createLinearGradient(0, 0, W, H); g.addColorStop(0, TEAL); g.addColorStop(1, TEAL_DARK)
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H)
  ctx.globalAlpha = 0.08; ctx.fillStyle = '#ffffff'
  ctx.beginPath(); ctx.arc(900, 80, 220, 0, Math.PI * 2); ctx.fill()
  ctx.beginPath(); ctx.arc(980, 520, 160, 0, Math.PI * 2); ctx.fill()
  ctx.globalAlpha = 1
  ctx.save(); ctx.beginPath(); ctx.roundRect(80, 150, 200, 200, 44); ctx.clip(); ctx.drawImage(icon, 80, 150, 200, 200); ctx.restore()
  ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.roundRect(80, 150, 200, 200, 44); ctx.stroke()
  ctx.fillStyle = '#ffffff'; ctx.font = '76px GTBold'; ctx.fillText('GastroTeam', 330, 235)
  ctx.fillStyle = MINT; ctx.font = '36px GTBold'; ctx.fillText('Schichtplan für Gastro-Teams', 332, 290)
  ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.font = '28px GTRegular'
  ctx.fillText('Schichten · Verfügbarkeit · Urlaub · Schichttausch', 332, 345)
  writeFileSync(path.join(out, 'feature-graphic-1024x500.png'), rgbPng(c))
}

// Framed phone screenshots 1080x1920
const shots = [
  ['heute', 'Dein Tag auf einen Blick', 'Nächste Schicht, Wochenstunden und Team heute'],
  ['schichten', 'Alle Schichten im Griff', 'Veröffentlichte Schichten mit Station und Pause'],
  ['schicht-detail', 'Schichten einfach tauschen', 'Gezielt oder allen anbieten – mit Freigabe'],
  ['tausch', 'Offene Schichten übernehmen', 'Angebote aus dem Team mit einem Tipp annehmen'],
  ['verfuegbarkeit', 'Verfügbarkeit eintragen', 'Wöchentliche Zeiten und Wunschzeiten'],
  ['anfragen', 'Urlaub beantragen', 'Status jeder Anfrage immer im Blick'],
  ['freigaben', 'Freigaben für Leitungen', 'Urlaub und Schichttausch mit einem Tipp entscheiden'],
  ['benachrichtigungen', 'Nichts mehr verpassen', 'Neue Pläne, Änderungen und Entscheidungen'],
]
if (rawDir) {
  const dir = path.join(out, 'phone-screenshots'); mkdirSync(dir, { recursive: true })
  const W = 1080, H = 1920
  let i = 1
  for (const [name, title, subtitle] of shots) {
    const src = path.join(rawDir, `${name}.png`)
    if (!existsSync(src)) { console.warn('missing', src); continue }
    const img = await loadImage(src)
    const c = createCanvas(W, H), ctx = c.getContext('2d')
    const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, TEAL); g.addColorStop(1, TEAL_DARK)
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H)
    ctx.textAlign = 'center'; ctx.fillStyle = '#ffffff'; ctx.font = '66px GTBold'; ctx.fillText(title, W / 2, 150)
    ctx.fillStyle = '#ccfbf1'; ctx.font = '36px GTRegular'; ctx.fillText(subtitle, W / 2, 212)
    const h = 1600, w = Math.round(img.width * h / img.height), x = (W - w) / 2, y = 280, r = 48
    ctx.save(); ctx.shadowColor = 'rgba(0,0,0,0.35)'; ctx.shadowBlur = 50; ctx.shadowOffsetY = 18
    ctx.beginPath(); ctx.roundRect(x, y, w, h, r); ctx.fillStyle = '#ffffff'; ctx.fill(); ctx.restore()
    ctx.save(); ctx.beginPath(); ctx.roundRect(x, y, w, h, r); ctx.clip(); ctx.drawImage(img, x, y, w, h); ctx.restore()
    const file = path.join(dir, `phone-${String(i++).padStart(2, '0')}-${name}.jpg`)
    writeFileSync(file, c.toBuffer('image/jpeg', 92))
    console.log(file)
  }
}
