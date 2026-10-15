// Orientation automatique du plateau photographié (où sont les blancs ?).
//
// Indices utilisés, du plus sûr au moins sûr :
//  1. la case a1 est toujours foncée (« blanc à droite ») : on repère la
//     couleur des cases sur les vignettes, ce qui élimine 2 rotations sur 4 ;
//  2. les pions ne sont jamais sur la 1re ni la 8e rangée ;
//  3. en général les pièces blanches sont plutôt du côté des rangées 1-2
//     (le joueur photographie souvent depuis sa place).

import { CLASSES, NUM_CLASSES } from './classes'
import { photoToBoard, TILE } from '../vision/tiles'

/** Luminosité médiane de la partie « case » de chaque vignette (sans le débord du haut). */
export function squareBrightness(tiles: Uint8Array): number[] {
  const out: number[] = []
  const y0 = Math.round(TILE / 3) // le tiers haut de la vignette est la case du dessus
  for (let i = 0; i < 64; i++) {
    const base = i * TILE * TILE * 3
    const v: number[] = []
    for (let y = y0 + 4; y < TILE - 4; y += 3) {
      for (let x = 4; x < TILE - 4; x += 3) {
        const k = base + (y * TILE + x) * 3
        v.push(tiles[k] * 0.299 + tiles[k + 1] * 0.587 + tiles[k + 2] * 0.114)
      }
    }
    v.sort((a, b) => a - b)
    out.push(v[v.length >> 1])
  }
  return out
}

/**
 * Rotation (quarts de tour horaires appliqués au repère photo) la plus
 * plausible. `probs` : 64 x 13 probabilités dans le repère photo.
 */
export function guessRotation(probs: Float32Array, tiles: Uint8Array): number {
  const bright = squareBrightness(tiles)
  // Parité claire : cases (ligne + colonne) paires ou impaires dans le repère photo
  let even = 0
  let odd = 0
  bright.forEach((b, i) => ((Math.floor(i / 8) + (i % 8)) % 2 === 0 ? (even += b) : (odd += b)))
  const lightParity = even >= odd ? 0 : 1
  const contrast = Math.abs(even - odd) / 32

  const scores = [0, 1, 2, 3].map((rot) => {
    let s = 0
    // 1. a1 (index 56) doit être une case foncée
    const a1 = boardIndexToPhoto(56, rot)
    const a1Light = (Math.floor(a1 / 8) + (a1 % 8)) % 2 === lightParity
    if (contrast > 12) s += a1Light ? -100 : 100
    // 2 et 3. Pièces : pions hors des rangées 1 et 8, blancs plutôt en bas
    for (let i = 0; i < 64; i++) {
      const b = photoToBoard(i, rot)
      const row = Math.floor(b / 8) // 0 = 8e rangée, 7 = 1re rangée
      const p = probs.subarray(i * NUM_CLASSES, (i + 1) * NUM_CLASSES)
      const pawn = p[CLASSES.indexOf('P')] + p[CLASSES.indexOf('p')]
      if (row === 0 || row === 7) s -= 20 * pawn
      let white = 0
      let black = 0
      for (let c = 1; c <= 6; c++) white += p[c]
      for (let c = 7; c <= 12; c++) black += p[c]
      s += (white - black) * (row - 3.5)
    }
    return s
  })
  return scores.indexOf(Math.max(...scores))
}

function boardIndexToPhoto(index: number, rot: number): number {
  for (let i = 0; i < 64; i++) if (photoToBoard(i, rot) === index) return i
  return index
}

/**
 * Rotation qui colle le mieux à la position de départ (calibration) :
 * maximise la vraisemblance des étiquettes attendues.
 */
export function rotationForStart(probs: Float32Array, startLabels: number[]): number {
  const scores = [0, 1, 2, 3].map((rot) => {
    let s = 0
    for (let i = 0; i < 64; i++) {
      const b = photoToBoard(i, rot)
      s += Math.log(probs[i * NUM_CLASSES + startLabels[b]] + 1e-6)
    }
    return s
  })
  return scores.indexOf(Math.max(...scores))
}
