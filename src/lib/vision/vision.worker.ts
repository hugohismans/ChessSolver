// Worker de vision : charge OpenCV.js et fait tous les calculs d'image
// (détection du plateau, redressement) hors du thread principal, pour que
// l'interface reste fluide.

import { detectBoard, warpBoard, type CV, type RGBAImage } from './detect'
import type { Quad } from './geometry'

export type VisionRequest =
  | { type: 'init'; url: string }
  | { type: 'setImage'; image: RGBAImage }
  | { type: 'detect'; image?: RGBAImage }
  | { type: 'warp'; quad: Quad; size: number; margin: number }

let cv: CV | null = null
let photo: RGBAImage | null = null

const ctx = self as unknown as DedicatedWorkerGlobalScope

ctx.onmessage = async (e: MessageEvent<{ id: number; req: VisionRequest }>) => {
  const { id, req } = e.data
  try {
    switch (req.type) {
      case 'init':
        if (!cv) cv = await loadOpenCv(req.url)
        ctx.postMessage({ id, result: true })
        break
      case 'setImage':
        photo = req.image
        ctx.postMessage({ id, result: true })
        break
      case 'detect': {
        const img = req.image ?? photo
        if (!cv || !img) throw new Error('OpenCV ou image absent')
        ctx.postMessage({ id, result: detectBoard(cv, img) })
        break
      }
      case 'warp': {
        if (!cv || !photo) throw new Error('OpenCV ou image absent')
        const out = warpBoard(cv, photo, req.quad, req.size, req.margin)
        ctx.postMessage({ id, result: out }, [out.data.buffer])
        break
      }
    }
  } catch (err) {
    ctx.postMessage({ id, error: err instanceof Error ? err.message : String(err) })
  }
}

/**
 * Télécharge opencv.js (environ 13 Mo, WASM inclus) en signalant la
 * progression, puis l'exécute. Le script définit `cv` sur l'objet global,
 * sous forme de promesse résolue quand le WASM est prêt.
 */
async function loadOpenCv(url: string): Promise<CV> {
  const res = await fetch(url)
  if (!res.ok || !res.body) throw new Error(`Téléchargement d'OpenCV impossible (${res.status})`)
  const total = Number(res.headers.get('content-length')) || 13_300_000
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let loaded = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    loaded += value.length
    ctx.postMessage({ progress: Math.min(0.99, loaded / total) })
  }
  const code = new TextDecoder().decode(await new Blob(chunks as BlobPart[]).arrayBuffer())
  // Exécution en mode non strict, comme un <script> classique
  new Function(code)()
  const g = globalThis as unknown as { cv: CV }
  let m = g.cv
  if (m instanceof Promise) m = await m
  else if (!m.Mat) await new Promise<void>((r) => (m.onRuntimeInitialized = () => r()))
  ctx.postMessage({ progress: 1 })
  return m
}
