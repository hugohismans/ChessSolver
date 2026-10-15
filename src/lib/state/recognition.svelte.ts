// Résultat de la reconnaissance de la dernière photo, et suivi des
// corrections faites par l'utilisateur sur l'écran Position.

import { parseFen, START_FEN, type Grid } from '../chess/position'
import { classToCell, NUM_CLASSES, cellToClass } from '../recognition/classes'
import { photoToBoard, TILE_BYTES } from '../vision/tiles'
import { addExamples, type ExampleSource } from '../recognition/storage'

export type RecognitionMode = 'normal' | 'calibration'

class Recognition {
  /** L'écran Position corrige une photo reconnue. */
  active = $state(false)
  mode = $state<RecognitionMode>('normal')
  /** Vignettes et probabilités, dans le repère photo. */
  tiles = $state.raw<Uint8Array | null>(null)
  probs = $state.raw<Float32Array | null>(null)
  /** Quarts de tour (horaires) pour passer du repère photo au repère échiquier. */
  rotation = $state(0)
  profileId = ''
  profileName = $state('')
  photoId = ''
  /** Ajouter les corrections au profil actif. */
  saveCorrections = $state(true)

  /** Grille proposée par le modèle (repère échiquier). */
  get recognized(): Grid {
    const g: Grid = Array(64).fill(null)
    if (!this.probs) return g
    for (let i = 0; i < 64; i++) g[photoToBoard(i, this.rotation)] = classToCell(argmax(this.probs, i))
    return g
  }

  /** Confiance (probabilité max) de chaque case, repère échiquier. */
  get confidence(): number[] {
    const c = Array(64).fill(1)
    if (!this.probs) return c
    for (let i = 0; i < 64; i++) {
      const p = this.probs.subarray(i * NUM_CLASSES, (i + 1) * NUM_CLASSES)
      c[photoToBoard(i, this.rotation)] = Math.max(...p)
    }
    return c
  }

  /** Vignette de la case `boardIndex` (repère échiquier). */
  tile(boardIndex: number): Uint8Array | null {
    if (!this.tiles) return null
    for (let i = 0; i < 64; i++) {
      if (photoToBoard(i, this.rotation) === boardIndex) return this.tiles.slice(i * TILE_BYTES, (i + 1) * TILE_BYTES)
    }
    return null
  }

  /** Cases où la grille actuelle diffère de la proposition du modèle. */
  corrections(grid: Grid): number[] {
    const r = this.recognized
    return grid.map((c, i) => (c !== r[i] ? i : -1)).filter((i) => i >= 0)
  }

  /**
   * Enregistre des exemples dans le profil : `squares` (repère échiquier)
   * étiquetées d'après `grid`.
   */
  async save(profileId: string, grid: Grid, squares: number[], source: ExampleSource) {
    const now = Date.now()
    const examples = squares
      .map((b) => ({ b, tile: this.tile(b) }))
      .filter((e): e is { b: number; tile: Uint8Array } => e.tile !== null)
      .map(({ b, tile }) => ({ profileId, label: cellToClass(grid[b]), tile, source, photo: this.photoId, createdAt: now }))
    await addExamples(examples)
    return examples.length
  }

  clear() {
    this.active = false
    this.mode = 'normal'
    this.tiles = null
    this.probs = null
  }
}

function argmax(p: Float32Array, i: number): number {
  let best = 0
  for (let k = 1; k < NUM_CLASSES; k++) if (p[i * NUM_CLASSES + k] > p[i * NUM_CLASSES + best]) best = k
  return best
}

export const START_LABELS = parseFen(START_FEN).grid.map(cellToClass)

export const recognition = new Recognition()
