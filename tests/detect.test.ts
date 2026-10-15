import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { beforeAll, describe, expect, it } from 'vitest'
import jpeg from 'jpeg-js'
import { detectBoard, type CV } from '../src/lib/vision/detect'
import { orderCorners, quadDistance, type Quad } from '../src/lib/vision/geometry'

// Photos de synthèse difficiles (perspective, rotation jusqu'à 45°, cadre ou
// non, pièces debout qui masquent des rangées) avec les coins exacts.
const DIR = join(__dirname, 'fixtures')
const files = readdirSync(DIR).filter((f) => f.endsWith('.jpg')).sort()

let cv: CV
beforeAll(async () => {
  const mod = createRequire(import.meta.url)('@techstark/opencv-js')
  cv = mod instanceof Promise ? await mod : mod
})

describe('détection du plateau', () => {
  it.each(files)('%s : coins à moins de 0,35 case', (f) => {
    const raw = jpeg.decode(readFileSync(join(DIR, f)), { useTArray: true, formatAsRGBA: true })
    const truth = orderCorners(JSON.parse(readFileSync(join(DIR, f.replace('.jpg', '.json')), 'utf8')).quad) as Quad
    const r = detectBoard(cv, { data: new Uint8ClampedArray(raw.data.buffer), width: raw.width, height: raw.height })
    expect(r.quad).not.toBeNull()
    // Erreur maximale sur un coin, exprimée en cases
    const side = Math.hypot(truth[2].x - truth[3].x, truth[2].y - truth[3].y)
    expect((quadDistance(r.quad as Quad, truth) / side) * 8).toBeLessThan(0.35)
  })

  it('ne voit pas d’échiquier sur une image uniforme', () => {
    const w = 320
    const h = 240
    const data = new Uint8ClampedArray(w * h * 4).fill(128)
    expect(detectBoard(cv, { data, width: w, height: h }).quad).toBeNull()
  })
})
