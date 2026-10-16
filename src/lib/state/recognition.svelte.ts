// Résultat de la reconnaissance, et suivi des corrections faites par
// l'utilisateur sur l'écran Position.
//
// Une même position peut être photographiée 2 ou 3 fois (« vues ») : les
// probabilités de chaque case sont moyennées entre les photos. Une photo
// prise d'un autre côté du plateau est la plus utile, car les erreurs
// typiques (tête d'une pièce haute qui déborde sur la case de derrière) ne
// tombent pas sur les mêmes cases selon le point de vue.

import { parseFen, START_FEN, type Grid } from '../chess/position'
import { classToCell, NUM_CLASSES, cellToClass } from '../recognition/classes'
import { boardToPhoto, TILE_BYTES } from '../vision/tiles'
import { addExamples, type Example, type ExampleSource } from '../recognition/storage'

export type RecognitionMode = 'normal' | 'calibration'

/** Une photo reconnue. */
export interface View {
  tiles: Uint8Array // 64 vignettes, repère photo
  probs: Float32Array // 64 x 13 probabilités, repère photo
  rotation: number // quarts de tour (horaires) : repère photo -> repère échiquier
  photoId: string
}

export const MAX_VIEWS = 3

class Recognition {
  /** L'écran Position corrige une photo reconnue. */
  active = $state(false)
  mode = $state<RecognitionMode>('normal')
  views = $state.raw<View[]>([])
  profileId = ''
  profileName = $state('')
  /** Ajouter les corrections au profil actif. */
  saveCorrections = $state(true)

  /** Dernière photo (celle affichée par les écrans de débogage et de calibration). */
  get last(): View | null {
    return this.views.at(-1) ?? null
  }
  get tiles(): Uint8Array | null {
    return this.last?.tiles ?? null
  }
  get probs(): Float32Array | null {
    return this.last?.probs ?? null
  }
  get rotation(): number {
    return this.last?.rotation ?? 0
  }

  /** Retire la dernière photo ajoutée (si elle a dégradé le résultat). */
  removeLast() {
    if (this.views.length > 1) this.views = this.views.slice(0, -1)
  }

  /** Tourne le résultat d'un quart de tour (toutes les photos ensemble). */
  rotate() {
    this.views = this.views.map((v) => ({ ...v, rotation: (v.rotation + 1) % 4 }))
  }

  /** Probabilités fusionnées (moyenne des photos), repère échiquier, 64 x 13. */
  get fused(): Float32Array {
    return fuseViews(this.views)
  }

  /** Grille proposée (repère échiquier). */
  get recognized(): Grid {
    const f = this.fused
    return Array.from({ length: 64 }, (_, b) => (this.views.length ? classToCell(argmax(f, b)) : null))
  }

  /** Confiance de chaque case (probabilité fusionnée de la classe retenue). */
  get confidence(): number[] {
    const f = this.fused
    return Array.from({ length: 64 }, (_, b) => (this.views.length ? f[b * NUM_CLASSES + argmax(f, b)] : 1))
  }

  /** Cases où la grille actuelle diffère de la proposition du modèle. */
  corrections(grid: Grid): number[] {
    const r = this.recognized
    return grid.map((c, i) => (c !== r[i] ? i : -1)).filter((i) => i >= 0)
  }

  /**
   * Enregistre des exemples dans le profil : les cases `squares` (repère
   * échiquier) étiquetées d'après `grid`, avec la vignette de chaque photo.
   */
  async save(profileId: string, grid: Grid, squares: number[], source: ExampleSource): Promise<number> {
    const now = Date.now()
    const examples: Example[] = []
    for (const v of this.views) {
      for (const b of squares) {
        const i = boardToPhoto(b, v.rotation)
        examples.push({
          profileId,
          label: cellToClass(grid[b]),
          tile: v.tiles.slice(i * TILE_BYTES, (i + 1) * TILE_BYTES),
          source,
          photo: v.photoId,
          createdAt: now,
        })
      }
    }
    await addExamples(examples)
    return examples.length
  }

  clear() {
    this.active = false
    this.mode = 'normal'
    this.views = []
  }
}

/**
 * Fusion des photos, dans le repère échiquier : moyenne géométrique des
 * probabilités (bornées à 1 %), renormalisée. Une pièce qu'une autre photo
 * juge impossible est fortement pénalisée, et une case où les photos se
 * contredisent ressort avec une confiance basse (signalée en jaune).
 * Mesuré sur des photos de synthèse : avec 2 ou 3 photos, presque toutes
 * les erreurs restantes sont signalées, contre une minorité avec une seule.
 */
export function fuseViews(views: Pick<View, 'probs' | 'rotation'>[]): Float32Array {
  const out = new Float32Array(64 * NUM_CLASSES)
  if (!views.length) return out
  if (views.length === 1) {
    // Une seule photo : ses probabilités telles quelles
    for (let b = 0; b < 64; b++) {
      const i = boardToPhoto(b, views[0].rotation)
      out.set(views[0].probs.subarray(i * NUM_CLASSES, (i + 1) * NUM_CLASSES), b * NUM_CLASSES)
    }
    return out
  }
  const FLOOR = 0.01
  for (const v of views) {
    for (let b = 0; b < 64; b++) {
      const i = boardToPhoto(b, v.rotation)
      for (let k = 0; k < NUM_CLASSES; k++) out[b * NUM_CLASSES + k] += Math.log(Math.max(FLOOR, v.probs[i * NUM_CLASSES + k])) / views.length
    }
  }
  for (let b = 0; b < 64; b++) {
    let sum = 0
    for (let k = 0; k < NUM_CLASSES; k++) sum += out[b * NUM_CLASSES + k] = Math.exp(out[b * NUM_CLASSES + k])
    for (let k = 0; k < NUM_CLASSES; k++) out[b * NUM_CLASSES + k] /= sum
  }
  return out
}

function argmax(p: Float32Array, i: number): number {
  let best = 0
  for (let k = 1; k < NUM_CLASSES; k++) if (p[i * NUM_CLASSES + k] > p[i * NUM_CLASSES + best]) best = k
  return best
}

export const START_LABELS = parseFen(START_FEN).grid.map(cellToClass)

export const recognition = new Recognition()
