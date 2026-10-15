// Côté interface : petite couche RPC au-dessus du worker de vision.

import type { DetectResult, RGBAImage } from './detect'
import type { Quad } from './geometry'
import type { VisionRequest } from './vision.worker'

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void }

export class VisionClient {
  private worker: Worker
  private pending = new Map<number, Pending>()
  private nextId = 1
  /** Progression du chargement d'OpenCV (0 à 1). */
  onprogress: ((p: number) => void) | null = null
  readonly ready: Promise<void>

  constructor() {
    this.worker = new Worker(new URL('./vision.worker.ts', import.meta.url), { type: 'module' })
    this.worker.onmessage = (e) => {
      const d = e.data
      if ('progress' in d) {
        this.onprogress?.(d.progress)
        return
      }
      const p = this.pending.get(d.id)
      if (!p) return
      this.pending.delete(d.id)
      if (d.error) p.reject(new Error(d.error))
      else p.resolve(d.result)
    }
    this.worker.onerror = (e) => {
      const err = new Error(e.message || 'Erreur du worker de vision')
      this.pending.forEach((p) => p.reject(err))
      this.pending.clear()
    }
    const url = new URL(`${import.meta.env.BASE_URL}opencv/opencv.js`, document.baseURI).href
    this.ready = this.call<boolean>({ type: 'init', url }).then(() => undefined)
  }

  private call<T>(req: VisionRequest, transfer: Transferable[] = []): Promise<T> {
    const id = this.nextId++
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject })
      this.worker.postMessage({ id, req }, transfer)
    })
  }

  /** Envoie la photo au worker, qui la garde pour la détection et le redressement. */
  async setImage(img: ImageData): Promise<void> {
    await this.ready
    // Copie : l'appelant garde son ImageData intact
    const copy = { data: new Uint8ClampedArray(img.data), width: img.width, height: img.height }
    await this.call({ type: 'setImage', image: copy }, [copy.data.buffer])
  }

  /** Détection sur la photo en cours, ou sur une image passée (aperçu caméra). */
  async detect(img?: ImageData): Promise<DetectResult> {
    await this.ready
    if (!img) return this.call<DetectResult>({ type: 'detect' })
    const image: RGBAImage = { data: img.data, width: img.width, height: img.height }
    return this.call<DetectResult>({ type: 'detect', image }, [img.data.buffer])
  }

  /** Plateau redressé : image carrée de `size` px, marge en cases autour. */
  async warp(quad: Quad, size: number, margin = 0): Promise<ImageData> {
    await this.ready
    const r = await this.call<RGBAImage>({ type: 'warp', quad: plain(quad), size, margin })
    return new ImageData(new Uint8ClampedArray(r.data), r.width, r.height)
  }

  /** Les 64 vignettes pour la reconnaissance (repère photo, RGB). */
  async tiles(quad: Quad): Promise<Uint8Array> {
    await this.ready
    return this.call<Uint8Array>({ type: 'tiles', quad: plain(quad) })
  }
}

/** Retire les proxys réactifs de Svelte avant l'envoi au worker. */
function plain(q: Quad): Quad {
  return q.map((p) => ({ x: p.x, y: p.y })) as Quad
}

let shared: VisionClient | null = null

/** Instance unique, créée à la première demande (chargement d'OpenCV). */
export function getVision(): VisionClient {
  shared ??= new VisionClient()
  return shared
}
