// Conversion d'une vignette RGB (TILE x TILE x 3) en canvas affichable.
import { TILE } from './tiles'
import { makeCanvas } from './image'

export function rgbToCanvas(rgb: Uint8Array, size = TILE): HTMLCanvasElement {
  const c = makeCanvas(size, size)
  const img = new ImageData(size, size)
  for (let i = 0, j = 0; i < size * size; i++, j += 3) {
    img.data[i * 4] = rgb[j]
    img.data[i * 4 + 1] = rgb[j + 1]
    img.data[i * 4 + 2] = rgb[j + 2]
    img.data[i * 4 + 3] = 255
  }
  c.getContext('2d')?.putImageData(img, 0, 0)
  return c
}
