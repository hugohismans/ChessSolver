// Découpe des 64 vignettes données au modèle de reconnaissance.
//
// Le même code sert dans l'app (worker de vision) et dans le script de
// préparation du jeu de données de base (training/build-dataset.ts) : les
// vignettes d'entraînement et celles vues en usage sont ainsi identiques.
//
// Repère « photo » : la ligne 0 est le bord du plateau le plus haut dans la
// photo (le plus éloigné de l'objectif). Les pièces debout débordent vers le
// haut de la photo, donc chaque vignette inclut une part de la case du
// dessus (TILE_ABOVE) dans ce repère, avant toute rotation.

import { applyH, homography, type Quad } from './geometry'
import type { CV, RGBAImage } from './detect'

export const TILE = 96 // côté d'une vignette en pixels
export const TILE_ABOVE = 0.5 // part de la case du dessus incluse (en cases)
export const TILE_BYTES = TILE * TILE * 3 // RGB

/**
 * Renvoie les 64 vignettes (RGB, TILE x TILE) dans l'ordre du repère photo :
 * index = ligne * 8 + colonne. Chaque vignette couvre la case et TILE_ABOVE
 * case au-dessus, ramenées à un carré.
 */
export function extractTiles(cv: CV, img: RGBAImage, quad: Quad, size = TILE, above = TILE_ABOVE): Uint8Array {
  // Un seul redressement de la zone [0, 8] x [-above, 8] (en cases)
  const toImg = homography(
    [
      { x: 0, y: 0 },
      { x: 8, y: 0 },
      { x: 8, y: 8 },
      { x: 0, y: 8 },
    ],
    quad,
  )
  const W = 8 * size
  const H = Math.round((8 + above) * size)
  const src = [
    applyH(toImg, { x: 0, y: -above }),
    applyH(toImg, { x: 8, y: -above }),
    applyH(toImg, { x: 8, y: 8 }),
    applyH(toImg, { x: 0, y: 8 }),
  ]
  const Hm = homography(src, [
    { x: 0, y: 0 },
    { x: W, y: 0 },
    { x: W, y: H },
    { x: 0, y: H },
  ])
  const rgba = cv.matFromImageData(img)
  const rgb = new cv.Mat()
  const M = cv.matFromArray(3, 3, cv.CV_64F, Hm)
  const board = new cv.Mat()
  const tile = new cv.Mat()
  const out = new Uint8Array(64 * size * size * 3)
  try {
    cv.cvtColor(rgba, rgb, cv.COLOR_RGBA2RGB)
    cv.warpPerspective(rgb, board, M, new cv.Size(W, H), cv.INTER_AREA, cv.BORDER_REPLICATE)
    const h = Math.round((1 + above) * size)
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const roi = board.roi(new cv.Rect(c * size, r * size, size, h))
        cv.resize(roi, tile, new cv.Size(size, size), 0, 0, cv.INTER_AREA)
        roi.delete()
        out.set(tile.data, (r * 8 + c) * size * size * 3)
      }
    }
    return out
  } finally {
    rgba.delete()
    rgb.delete()
    M.delete()
    board.delete()
    tile.delete()
  }
}

/**
 * Passe du repère photo au repère échiquier (index FEN, a8 = 0) après
 * `rotation` quarts de tour dans le sens horaire (blancs ramenés en bas).
 */
export function photoToBoard(index: number, rotation: number): number {
  const r = Math.floor(index / 8)
  const c = index % 8
  switch (((rotation % 4) + 4) % 4) {
    case 1:
      return c * 8 + (7 - r)
    case 2:
      return (7 - r) * 8 + (7 - c)
    case 3:
      return (7 - c) * 8 + r
    default:
      return index
  }
}

/** Inverse de photoToBoard. */
export function boardToPhoto(index: number, rotation: number): number {
  for (let i = 0; i < 64; i++) if (photoToBoard(i, rotation) === index) return i
  return index
}
