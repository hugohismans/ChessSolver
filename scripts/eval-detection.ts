// Évalue la détection du plateau sur un dossier d'images de synthèse
// (générées par tests/fixtures/generate.cjs, coins exacts dans les .json).
// Usage : npx tsx scripts/eval-detection.ts tests/fixtures
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import jpeg from 'jpeg-js'
import { detectBoard } from '../src/lib/vision/detect'
import { orderCorners, quadDistance, type Quad } from '../src/lib/vision/geometry'
const require = createRequire(import.meta.url)
const dir = process.argv[2]
const cvp = require('@techstark/opencv-js')
const cv = cvp instanceof Promise ? await cvp : cvp
const files = readdirSync(dir).filter((f) => f.endsWith('.jpg')).sort()
let ok = 0
for (const f of files) {
  const raw = jpeg.decode(readFileSync(join(dir, f)), { useTArray: true, formatAsRGBA: true })
  const gt = JSON.parse(readFileSync(join(dir, f.replace('.jpg', '.json')), 'utf8'))
  const gq = orderCorners(gt.quad) as Quad
  const r = detectBoard(cv, { data: new Uint8ClampedArray(raw.data.buffer), width: raw.width, height: raw.height })
  const side = Math.hypot(gq[2].x - gq[3].x, gq[2].y - gq[3].y)
  const err = r.quad ? quadDistance(r.quad, gq) / side : NaN
  // Erreur maximale sur un coin, en cases
  const errSq = err * 8
  if (errSq < 0.25) ok++
  console.log(f, 'conf', r.confidence, 'corners', r.corners, 'chk', r.checkerScore.toFixed(2), 'cand', r.candidates, `${r.ms}ms`, 'err(cases)', errSq.toFixed(3), JSON.stringify(gt.params))
}
console.log(`OK ${ok}/${files.length}`)
