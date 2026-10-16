// Génère des photos de synthèse d'échiquiers pour tester la détection :
// plateau en perspective sur une table, cadre en bois, pièces debout qui
// débordent sur les cases du dessus, éclairage inégal, bruit et flou.
// Les coins exacts de la zone de jeu sont écrits dans un .json à côté.
//
// Usage (nécessite Playwright et Chromium) :
//   node tests/fixtures/generate.cjs [nombre] [dossier]
const { execSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..', '..')
const { chromium } = require(require.resolve('playwright', {
  paths: [root, execSync('npm root -g').toString().trim()],
}))

const count = Number(process.argv[2] || 8)
const outDir = path.resolve(process.argv[3] || __dirname)
const seedOffset = Number(process.argv[4] || 0)
const maxRot = Number(process.argv[5] || 0.25)
const fixedFen = process.argv[6] // position imposée (facultatif)
const side = process.argv[7] || 'w' // côté de la prise de vue : w, b, ou mix (alterné)

// Chaque pièce du sprite devient un SVG autonome
const sprite = fs.readFileSync(path.join(root, 'src/assets/pieces.svg'), 'utf8')
const pieces = {}
for (const id of ['wk', 'wq', 'wr', 'wb', 'wn', 'wp', 'bk', 'bq', 'br', 'bb', 'bn', 'bp']) {
  const m = sprite.match(new RegExp(`<g id="${id}"[\\s\\S]*?\\n    </g>`))
  pieces[id] = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40">${m[0]}</svg>`
}

const POSITIONS = [
  'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR',
  'r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR',
  'r2q1rk1/pp2bppp/2n1bn2/3p4/3P4/2NBBN2/PP3PPP/R2Q1RK1',
  '8/5k2/8/3K4/8/8/8/8',
]

async function main() {
  const browser = await chromium.launch()
  const page = await browser.newPage()
  await page.setContent('<canvas id="c"></canvas>')
  await page.addScriptTag({ path: path.join(root, 'node_modules/@techstark/opencv-js/dist/opencv.js') })
  await page.evaluate(async () => {
    if (window.cv instanceof Promise) window.cv = await window.cv
  })
  fs.mkdirSync(outDir, { recursive: true })
  for (let n = 0; n < count; n++) {
    const res = await page.evaluate(render, { seed: n + 1 + seedOffset, pieces, fen: fixedFen || POSITIONS[n % POSITIONS.length], maxRot, fromBlack: side === 'b' || (side === 'mix' && n % 2 === 1) })
    const name = `board-${String(n + 1).padStart(2, '0')}`
    fs.writeFileSync(path.join(outDir, `${name}.jpg`), Buffer.from(res.jpg.split(',')[1], 'base64'))
    fs.writeFileSync(path.join(outDir, `${name}.json`), JSON.stringify({ quad: res.quad, fen: res.fen, params: res.params }, null, 2))
    console.log(name, JSON.stringify(res.params))
  }
  await browser.close()
}

// Exécuté dans la page
async function render({ seed, pieces, fen, maxRot, fromBlack }) {
  // Générateur pseudo-aléatoire reproductible
  // mulberry32
  let s = seed * 0x9e3779b9
  const rnd = () => {
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const lerp = (a, b) => a + (b - a) * rnd()

  const W = 1280
  const H = 960
  const S = 100 // taille d'une case dans le plateau à plat
  const B = Math.round(lerp(0, 60)) // largeur du cadre
  const N = 8 * S + 2 * B

  // 1. Plateau à plat (cadre + cases + coordonnées)
  const flat = document.createElement('canvas')
  flat.width = N
  flat.height = N
  const f = flat.getContext('2d')
  const palettes = [
    ['#f0d9b5', '#b58863', '#5b3a1e'],
    ['#eeeed2', '#769656', '#3b2a1a'],
    ['#e8d0aa', '#a0703c', '#2b1d10'],
    ['#dcdcdc', '#555555', '#222222'],
  ]
  const [light, dark, frame] = palettes[Math.floor(rnd() * palettes.length)]
  f.fillStyle = frame
  f.fillRect(0, 0, N, N)
  for (let r = 0; r < 8; r++)
    for (let c = 0; c < 8; c++) {
      f.fillStyle = (r + c) % 2 === 0 ? light : dark
      f.fillRect(B + c * S, B + r * S, S, S)
    }
  // Grain du bois
  for (let i = 0; i < 400; i++) {
    f.strokeStyle = `rgba(0,0,0,${lerp(0.01, 0.05)})`
    f.beginPath()
    const y = lerp(0, N)
    f.moveTo(0, y)
    f.bezierCurveTo(N / 3, y + lerp(-20, 20), (2 * N) / 3, y + lerp(-20, 20), N, y + lerp(-10, 10))
    f.stroke()
  }
  if (B > 25) {
    f.fillStyle = '#e8d9b0'
    f.font = `${B * 0.5}px sans-serif`
    f.textAlign = 'center'
    f.textBaseline = 'middle'
    for (let k = 0; k < 8; k++) {
      f.fillText('abcdefgh'[k], B + k * S + S / 2, N - B / 2)
      f.fillText(String(8 - k), B / 2, B + k * S + S / 2)
    }
  }

  // 2. Placement dans la scène : taille, centre, rotation, inclinaison
  const size = lerp(0.5, 0.78) * Math.min(W, H)
  const cx = W / 2 + lerp(-0.08, 0.08) * W
  const cy = H / 2 + lerp(-0.05, 0.08) * H
  const rot = lerp(-maxRot, maxRot) + (fromBlack ? Math.PI : 0)
  const tilt = lerp(0.62, 1.0) // bord du fond raccourci (perspective)
  const squash = lerp(0.6, 1.0) // écrasement vertical (angle de vue)
  const corners = [
    [-0.5 * tilt, -0.5],
    [0.5 * tilt, -0.5],
    [0.5, 0.5],
    [-0.5, 0.5],
  ].map(([x, y]) => {
    const X = x * size
    const Y = y * size * squash
    return { x: cx + X * Math.cos(rot) - Y * Math.sin(rot), y: cy + X * Math.sin(rot) + Y * Math.cos(rot) }
  })

  // 3. Fond (table) + objet parasite
  const scene = document.createElement('canvas')
  scene.width = W
  scene.height = H
  const g = scene.getContext('2d')
  const tables = ['#6b4a2b', '#8a8a80', '#3a3f45', '#a07850', '#d8d2c4']
  g.fillStyle = tables[Math.floor(rnd() * tables.length)]
  g.fillRect(0, 0, W, H)
  for (let i = 0; i < 300; i++) {
    g.strokeStyle = `rgba(${rnd() < 0.5 ? '0,0,0' : '255,255,255'},${lerp(0.02, 0.06)})`
    g.lineWidth = lerp(1, 4)
    g.beginPath()
    const y = lerp(0, H)
    g.moveTo(0, y)
    g.lineTo(W, y + lerp(-40, 40))
    g.stroke()
  }
  g.fillStyle = `hsl(${lerp(0, 360)}, 40%, ${lerp(25, 70)}%)`
  g.save()
  g.translate(lerp(0, W), rnd() < 0.5 ? lerp(0, H * 0.2) : lerp(H * 0.8, H))
  g.rotate(lerp(-1, 1))
  g.fillRect(-120, -80, 240, 160)
  g.restore()

  // 4. Plateau projeté dans la scène (OpenCV, avec masque)
  const cv = window.cv
  const flatMat = cv.imread(flat)
  const sceneMat = cv.imread(scene)
  const src = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, N, 0, N, N, 0, N])
  const dst = cv.matFromArray(4, 1, cv.CV_32FC2, corners.flatMap((p) => [p.x, p.y]))
  const M = cv.getPerspectiveTransform(src, dst)
  cv.warpPerspective(flatMat, sceneMat, M, new cv.Size(W, H), cv.INTER_LINEAR, cv.BORDER_TRANSPARENT)
  cv.imshow(scene, sceneMat)
  // Coins de la zone de jeu (vérité terrain)
  const inner = cv.matFromArray(4, 1, cv.CV_32FC2, [B, B, B + 8 * S, B, B + 8 * S, B + 8 * S, B, B + 8 * S])
  const innerOut = new cv.Mat()
  cv.perspectiveTransform(inner, innerOut, M)
  const quad = [0, 1, 2, 3].map((i) => ({ x: innerOut.data32F[2 * i], y: innerOut.data32F[2 * i + 1] }))
  const Hm = Array.from(M.data64F)
  ;[flatMat, sceneMat, src, dst, M, inner, innerOut].forEach((m) => m.delete())

  const project = (x, y) => {
    const w = Hm[6] * x + Hm[7] * y + Hm[8]
    return { x: (Hm[0] * x + Hm[1] * y + Hm[2]) / w, y: (Hm[3] * x + Hm[4] * y + Hm[5]) / w }
  }

  // 5. Pièces debout, dessinées du fond vers l'avant
  const imgs = {}
  await Promise.all(
    Object.entries(pieces).map(
      ([id, svg]) =>
        new Promise((ok) => {
          const im = new Image()
          im.onload = () => ok((imgs[id] = im))
          im.src = 'data:image/svg+xml;base64,' + btoa(svg)
        }),
    ),
  )
  const rows = fen.split('/')
  const sprites = []
  const height = lerp(1.1, 1.6) * (1.05 - squash) * 2 + 0.9 // pièces plus hautes si la vue est rasante
  rows.forEach((row, r) => {
    let c = 0
    for (const ch of row) {
      if (/\d/.test(ch)) {
        c += Number(ch)
        continue
      }
      const id = (ch === ch.toUpperCase() ? 'w' : 'b') + ch.toLowerCase()
      const base = project(B + (c + 0.5) * S, B + (r + 0.72) * S)
      const left = project(B + c * S, B + (r + 0.5) * S)
      const right = project(B + (c + 1) * S, B + (r + 0.5) * S)
      const w = Math.hypot(right.x - left.x, right.y - left.y) * 1.05
      const h = w * height
      sprites.push({ id, base, w, h })
      c++
    }
  })
  // Du fond vers l'avant, quel que soit le côté de la prise de vue
  sprites.sort((a, b) => a.base.y - b.base.y)
  for (const { id, base, w, h } of sprites) {
    {
      g.save()
      g.shadowColor = 'rgba(0,0,0,0.45)'
      g.shadowBlur = w * 0.15
      g.shadowOffsetX = w * 0.08
      g.drawImage(imgs[id], base.x - w / 2, base.y - h * 0.92, w, h)
      g.restore()
    }
  }

  // 6. Éclairage inégal, bruit, flou
  const grad = g.createRadialGradient(lerp(0, W), lerp(0, H), 50, W / 2, H / 2, W)
  grad.addColorStop(0, `rgba(255,250,230,${lerp(0, 0.25)})`)
  grad.addColorStop(1, `rgba(0,0,20,${lerp(0, 0.45)})`)
  g.fillStyle = grad
  g.fillRect(0, 0, W, H)
  const id = g.getImageData(0, 0, W, H)
  const amp = lerp(4, 18)
  for (let i = 0; i < id.data.length; i += 4) {
    const n = (rnd() - 0.5) * amp
    id.data[i] += n
    id.data[i + 1] += n
    id.data[i + 2] += n
  }
  g.putImageData(id, 0, 0)
  const out = document.createElement('canvas')
  out.width = W
  out.height = H
  const o = out.getContext('2d')
  o.filter = `blur(${lerp(0, 1.6).toFixed(2)}px)`
  o.drawImage(scene, 0, 0)

  return {
    jpg: out.toDataURL('image/jpeg', 0.82),
    quad,
    fen,
    params: { B, size: Math.round(size), rot: +rot.toFixed(2), tilt: +tilt.toFixed(2), squash: +squash.toFixed(2) },
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
