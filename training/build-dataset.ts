// Prépare le jeu de données du modèle de base à partir d'un export COCO
// Roboflow (photos d'échiquiers annotées par boîtes englobantes).
//
// Pour chaque photo : détection du plateau (le même code que l'app),
// attribution de chaque pièce annotée à sa case, puis découpe des 64
// vignettes avec le même code que l'app. Résultat : des fichiers .npy
// lisibles directement par training/train.py.
//
// Usage : npx tsx training/build-dataset.ts <dossier_export_coco> [training/data]

import { mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import jpeg from 'jpeg-js'
import { detectBoard } from '../src/lib/vision/detect'
import { applyH, homography } from '../src/lib/vision/geometry'
import { extractTiles, TILE } from '../src/lib/vision/tiles'
import { CLASSES } from '../src/lib/recognition/classes'

const [srcDir, outDir = join(import.meta.dirname, 'data')] = process.argv.slice(2)
if (!srcDir) {
  console.error('Usage : npx tsx training/build-dataset.ts <dossier_export_coco> [dossier_sortie]')
  process.exit(1)
}

const require = createRequire(import.meta.url)
const cvMod = require('@techstark/opencv-js')
const cv = cvMod instanceof Promise ? await cvMod : cvMod

// Noms des catégories Roboflow -> classe
const NAMES: Record<string, string> = {
  'white-pawn': 'P',
  'white-knight': 'N',
  'white-bishop': 'B',
  'white-rook': 'R',
  'white-queen': 'Q',
  'white-king': 'K',
  'black-pawn': 'p',
  'black-knight': 'n',
  'black-bishop': 'b',
  'black-rook': 'r',
  'black-queen': 'q',
  'black-king': 'k',
}

interface Coco {
  images: { id: number; file_name: string; width: number; height: number }[]
  annotations: { image_id: number; category_id: number; bbox: [number, number, number, number] }[]
  categories: { id: number; name: string }[]
}

/** Écrit un tableau uint8 au format .npy (lisible par numpy.load). */
function writeNpy(path: string, data: Uint8Array, shape: number[]) {
  let header = `{'descr': '|u1', 'fortran_order': False, 'shape': (${shape.join(', ')}${shape.length === 1 ? ',' : ''}), }`
  // En-tête aligné sur 64 octets, terminé par un saut de ligne
  const total = 10 + header.length + 1
  header += ' '.repeat((64 - (total % 64)) % 64) + '\n'
  const buf = Buffer.alloc(10 + header.length + data.length)
  buf.write('\x93NUMPY', 0, 'latin1')
  buf[6] = 1
  buf[7] = 0
  buf.writeUInt16LE(header.length, 8)
  buf.write(header, 10, 'latin1')
  Buffer.from(data.buffer, data.byteOffset, data.length).copy(buf, 10 + header.length)
  writeFileSync(path, buf)
}

mkdirSync(outDir, { recursive: true })
const summary: Record<string, unknown> = {}

for (const split of ['train', 'valid', 'test']) {
  const dir = join(srcDir, split)
  if (!existsSync(dir)) continue
  const coco = JSON.parse(readFileSync(join(dir, '_annotations.coco.json'), 'utf8')) as Coco
  const catName = new Map(coco.categories.map((c) => [c.id, c.name]))
  const byImage = new Map<number, Coco['annotations']>()
  for (const a of coco.annotations) {
    const list = byImage.get(a.image_id) ?? []
    list.push(a)
    byImage.set(a.image_id, list)
  }

  const xs: Uint8Array[] = []
  const ys: number[] = []
  const groups: number[] = [] // numéro de photo (pour séparer validation / entraînement par photo)
  let skipped = 0
  for (const im of coco.images) {
    const file = join(dir, im.file_name)
    if (!existsSync(file)) continue
    const raw = jpeg.decode(readFileSync(file), { useTArray: true, formatAsRGBA: true, maxMemoryUsageInMB: 1024 })
    const img = { data: new Uint8ClampedArray(raw.data.buffer), width: raw.width, height: raw.height }
    const det = detectBoard(cv, img)
    if (!det.quad) {
      skipped++
      continue
    }
    // Image -> coordonnées plateau (en cases, repère photo)
    const toBoard = homography(det.quad, [
      { x: 0, y: 0 },
      { x: 8, y: 0 },
      { x: 8, y: 8 },
      { x: 0, y: 8 },
    ])
    const labels = new Array(64).fill(0)
    let ok = true
    for (const a of byImage.get(im.id) ?? []) {
      const cls = NAMES[catName.get(a.category_id) ?? '']
      if (!cls) {
        ok = false // annotation ambiguë (couleur inconnue) : photo écartée
        break
      }
      const [x, y, w, h] = a.bbox
      // Pied de la pièce : bas de la boîte, un peu remonté (base ronde vue en biais)
      const p = applyH(toBoard, { x: x + w / 2, y: y + h - 0.12 * w })
      const c = Math.floor(p.x)
      const r = Math.floor(p.y)
      if (c < 0 || c > 7 || r < 0 || r > 7 || labels[r * 8 + c] !== 0) {
        ok = false // hors plateau ou deux pièces sur la même case : photo écartée
        break
      }
      labels[r * 8 + c] = CLASSES.indexOf(cls as (typeof CLASSES)[number])
    }
    if (!ok) {
      skipped++
      continue
    }
    const tiles = extractTiles(cv, img, det.quad)
    xs.push(tiles)
    ys.push(...labels)
    for (let i = 0; i < 64; i++) groups.push(xs.length - 1)
  }

  const n = ys.length
  const x = new Uint8Array(n * TILE * TILE * 3)
  xs.forEach((t, i) => x.set(t, i * 64 * TILE * TILE * 3))
  writeNpy(join(outDir, `${split}_x.npy`), x, [n, TILE, TILE, 3])
  writeNpy(join(outDir, `${split}_y.npy`), Uint8Array.from(ys), [n])
  writeNpy(join(outDir, `${split}_g.npy`), Uint8Array.from(groups.map((g) => g % 256)), [n])
  const counts = Object.fromEntries(CLASSES.map((c, i) => [c, ys.filter((y) => y === i).length]))
  summary[split] = { photos: xs.length, skipped, tiles: n, counts }
  console.log(split, JSON.stringify(summary[split]))
}
writeFileSync(join(outDir, 'summary.json'), JSON.stringify({ classes: CLASSES, tile: TILE, ...summary }, null, 2))
// Liste des fichiers produits
console.log('Fichiers :', readdirSync(outDir).join(', '))
