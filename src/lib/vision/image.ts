// Manipulations d'images côté interface (canvas) : chargement d'une photo,
// réduction, rotation du plateau redressé, découpe des 64 cases.

/** Taille maximale (plus grand côté) des photos traitées : assez pour la
 * précision, raisonnable pour la mémoire d'un téléphone. */
export const PHOTO_MAX = 1600

export function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return c
}

function ctx2d(c: HTMLCanvasElement): CanvasRenderingContext2D {
  const g = c.getContext('2d', { willReadFrequently: true })
  if (!g) throw new Error('Canvas 2D indisponible')
  return g
}

/** Dessine une source (vidéo, image, bitmap) réduite à `max` px dans un canvas. */
export function toCanvas(src: CanvasImageSource, w: number, h: number, max = PHOTO_MAX): HTMLCanvasElement {
  const s = Math.min(1, max / Math.max(w, h))
  const c = makeCanvas(Math.round(w * s), Math.round(h * s))
  const g = ctx2d(c)
  g.imageSmoothingQuality = 'high'
  g.drawImage(src, 0, 0, c.width, c.height)
  return c
}

/** Photo depuis un fichier de la galerie (l'orientation EXIF est appliquée). */
export async function canvasFromFile(file: File): Promise<HTMLCanvasElement> {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' })
  try {
    return toCanvas(bmp, bmp.width, bmp.height)
  } finally {
    bmp.close()
  }
}

export function imageData(c: HTMLCanvasElement): ImageData {
  return ctx2d(c).getImageData(0, 0, c.width, c.height)
}

export function canvasFromImageData(img: ImageData): HTMLCanvasElement {
  const c = makeCanvas(img.width, img.height)
  ctx2d(c).putImageData(img, 0, 0)
  return c
}

/** Fait tourner une image carrée de `quarterTurns` quarts de tour (sens horaire). */
export function rotateSquare(src: HTMLCanvasElement, quarterTurns: number): HTMLCanvasElement {
  const k = ((quarterTurns % 4) + 4) % 4
  const n = src.width
  const c = makeCanvas(n, n)
  const g = ctx2d(c)
  g.translate(n / 2, n / 2)
  g.rotate((k * Math.PI) / 2)
  g.drawImage(src, -n / 2, -n / 2)
  return c
}

export interface Tile {
  square: string // « a8 » ... « h1 »
  index: number // index dans la grille FEN (0 = a8)
  canvas: HTMLCanvasElement
}

/**
 * Découpe le plateau redressé (déjà tourné : blancs en bas) en 64 cases de
 * `size` px. `margin` = marge en cases incluse dans l'image source autour
 * du plateau. `above` = part de la case du dessus ajoutée à la vignette
 * (les pièces hautes débordent vers le haut sur les photos en biais).
 */
export function extractTiles(board: HTMLCanvasElement, opts: { size?: number; margin?: number; above?: number } = {}): Tile[] {
  const { size = 96, margin = 0, above = 0 } = opts
  const sq = board.width / (8 + 2 * margin)
  const tiles: Tile[] = []
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const canvas = makeCanvas(size, size)
      const g = ctx2d(canvas)
      g.imageSmoothingQuality = 'high'
      const x = (margin + c) * sq
      const y = (margin + r - above) * sq
      g.drawImage(board, x, y, sq, sq * (1 + above), 0, 0, size, size)
      tiles.push({ square: `${'abcdefgh'[c]}${8 - r}`, index: r * 8 + c, canvas })
    }
  }
  return tiles
}
