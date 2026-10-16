import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import jpeg from 'jpeg-js'
import { boardToPhoto, extractTiles, photoToBoard, TILE, TILE_BYTES } from '../src/lib/vision/tiles'
import { guessRotation, rotationForStart, squareBrightness } from '../src/lib/recognition/orient'
import { CLASSES, NUM_CLASSES, cellToClass, classToCell } from '../src/lib/recognition/classes'
import { parseFen, START_FEN } from '../src/lib/chess/position'
import { detectBoard } from '../src/lib/vision/detect'

const START_LABELS = parseFen(START_FEN).grid.map(cellToClass)

/** Probabilités « parfaites » pour une grille donnée, vue depuis une rotation. */
function fakeProbs(labels: number[], rotation: number): Float32Array {
  const p = new Float32Array(64 * NUM_CLASSES)
  for (let i = 0; i < 64; i++) p[i * NUM_CLASSES + labels[photoToBoard(i, rotation)]] = 1
  return p
}

/** Vignettes unies : cases claires / foncées selon la parité dans le repère photo. */
function fakeTiles(rotation: number): Uint8Array {
  const t = new Uint8Array(64 * TILE_BYTES)
  for (let i = 0; i < 64; i++) {
    const b = photoToBoard(i, rotation)
    const light = (Math.floor(b / 8) + (b % 8)) % 2 === 0 // a8 claire
    t.fill(light ? 220 : 90, i * TILE_BYTES, (i + 1) * TILE_BYTES)
  }
  return t
}

describe('repères photo et échiquier', () => {
  it('photoToBoard est une bijection et boardToPhoto son inverse', () => {
    for (let r = 0; r < 4; r++) {
      const seen = new Set<number>()
      for (let i = 0; i < 64; i++) {
        const b = photoToBoard(i, r)
        seen.add(b)
        expect(boardToPhoto(b, r)).toBe(i)
      }
      expect(seen.size).toBe(64)
    }
  })

  it('un quart de tour horaire envoie le coin haut gauche en haut à droite', () => {
    expect(photoToBoard(0, 1)).toBe(7)
    expect(photoToBoard(0, 2)).toBe(63)
    expect(photoToBoard(0, 3)).toBe(56)
  })

  it('classes : aller-retour case <-> classe', () => {
    expect(CLASSES).toHaveLength(13)
    for (let i = 0; i < 13; i++) expect(cellToClass(classToCell(i))).toBe(i)
  })
})

describe('orientation automatique', () => {
  it('retrouve la rotation de la position de départ', () => {
    for (let r = 0; r < 4; r++) expect(rotationForStart(fakeProbs(START_LABELS, r), START_LABELS)).toBe(r)
  })

  it('devine la rotation d’une partie (couleur de a1, pions, camp des blancs)', () => {
    const mid = parseFen('r1bq1rk1/pp2bppp/2n1pn2/3p4/3P4/2NBPN2/PP3PPP/R2QK2R w KQ - 0 1').grid.map(cellToClass)
    for (let r = 0; r < 4; r++) expect(guessRotation(fakeProbs(mid, r), fakeTiles(r))).toBe(r)
  })

  it('mesure la luminosité de la case sans le débord du haut', () => {
    const b = squareBrightness(fakeTiles(0))
    expect(b[0]).toBeGreaterThan(200)
    expect(b[1]).toBeLessThan(100)
  })
})

describe('découpe des vignettes', () => {
  it('64 vignettes RGB de la bonne taille', async () => {
    const mod = createRequire(import.meta.url)('@techstark/opencv-js')
    const cv = mod instanceof Promise ? await mod : mod
    const raw = jpeg.decode(readFileSync(join(__dirname, 'fixtures', 'photo-02.jpg')), { useTArray: true, formatAsRGBA: true })
    const img = { data: new Uint8ClampedArray(raw.data.buffer), width: raw.width, height: raw.height }
    const det = detectBoard(cv, img)
    const tiles = extractTiles(cv, img, det.quad!)
    expect(tiles.length).toBe(64 * TILE * TILE * 3)
    // Damier visible : les cases claires et foncées alternent
    const b = squareBrightness(tiles)
    const even = b.filter((_, i) => (Math.floor(i / 8) + (i % 8)) % 2 === 0)
    const odd = b.filter((_, i) => (Math.floor(i / 8) + (i % 8)) % 2 === 1)
    const med = (a: number[]) => [...a].sort((x, y) => x - y)[a.length >> 1]
    expect(Math.abs(med(even) - med(odd))).toBeGreaterThan(30)
  })
})

describe('plusieurs photos de la même position', () => {
  it('retrouve la rotation d’une 2e photo prise d’un autre côté', async () => {
    const { fuseViews } = await import('../src/lib/state/recognition.svelte')
    const { rotationToMatch } = await import('../src/lib/recognition/orient')
    const mid = parseFen('r1bq1rk1/pp2bppp/2n1pn2/3p4/3P4/2NBPN2/PP3PPP/R2QK2R w KQ - 0 1').grid.map(cellToClass)
    const first = fuseViews([{ probs: fakeProbs(mid, 0), rotation: 0 }])
    for (let r = 0; r < 4; r++) expect(rotationToMatch(fakeProbs(mid, r), first)).toBe(r)
  })

  it('la fusion corrige une case fausse sur une seule photo', async () => {
    const { fuseViews } = await import('../src/lib/state/recognition.svelte')
    const labels = START_LABELS
    // Photo 1 : un « fantôme » de cavalier sur c3 (case vide en réalité)
    const ghost = [...labels]
    ghost[42] = cellToClass('N')
    const p1 = fakeProbs(ghost, 0)
    // Photo 2 (de l'autre côté), juste ; photo 3, juste aussi
    const p2 = fakeProbs(labels, 2)
    const p3 = fakeProbs(labels, 1)
    const f2 = fuseViews([
      { probs: p1, rotation: 0 },
      { probs: p2, rotation: 2 },
    ])
    // Deux photos en désaccord : confiance basse, la case sera signalée (< 80 %)
    expect(Math.max(...f2.subarray(42 * NUM_CLASSES, 43 * NUM_CLASSES))).toBeLessThan(0.6)
    // Les cases où elles s'accordent restent au-dessus du seuil de signalement (80 %)
    expect(f2[0 * NUM_CLASSES + cellToClass('r')]).toBeGreaterThan(0.8)
    const f3 = fuseViews([
      { probs: p1, rotation: 0 },
      { probs: p2, rotation: 2 },
      { probs: p3, rotation: 1 },
    ])
    const c3 = Array.from(f3.subarray(42 * NUM_CLASSES, 43 * NUM_CLASSES))
    expect(c3.indexOf(Math.max(...c3))).toBe(0) // vide, à 2 voix contre 1
  })
})
