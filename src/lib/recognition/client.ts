// Côté interface : appels au worker d'apprentissage (reconnaissance, entraînement).

import type { MlRequest, TrainProgress, TrainResult } from './ml.worker'

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void; progress?: (p: TrainProgress) => void }

export class MlClient {
  private worker: Worker
  private pending = new Map<number, Pending>()
  private nextId = 1
  readonly ready: Promise<{ backend: string }>

  constructor() {
    this.worker = new Worker(new URL('./ml.worker.ts', import.meta.url), { type: 'module' })
    this.worker.onmessage = (e) => {
      const d = e.data
      const p = this.pending.get(d.id)
      if (!p) return
      if ('progress' in d) {
        p.progress?.(d.progress)
        return
      }
      this.pending.delete(d.id)
      if (d.error) p.reject(new Error(d.error))
      else p.resolve(d.result)
    }
    this.worker.onerror = (e) => {
      const err = new Error(e.message || 'Erreur du worker d’apprentissage')
      this.pending.forEach((p) => p.reject(err))
      this.pending.clear()
    }
    const base = new URL(import.meta.env.BASE_URL, document.baseURI).href
    this.ready = this.call<{ backend: string }>({ type: 'init', base })
  }

  private call<T>(req: MlRequest, transfer: Transferable[] = [], progress?: (p: TrainProgress) => void): Promise<T> {
    const id = this.nextId++
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, progress })
      this.worker.postMessage({ id, req }, transfer)
    })
  }

  /** Probabilités des 13 classes pour chaque vignette (N x 13, à plat). */
  async predict(tiles: Uint8Array, profileId: string): Promise<Float32Array> {
    await this.ready
    const copy = tiles.slice()
    return this.call<Float32Array>({ type: 'predict', tiles: copy, profileId }, [copy.buffer])
  }

  async train(profileId: string, progress: (p: TrainProgress) => void): Promise<TrainResult> {
    await this.ready
    return this.call<TrainResult>({ type: 'train', profileId }, [], progress)
  }

  /** Moteur de calcul réellement utilisé (peut changer après un repli). */
  async backend(): Promise<string> {
    await this.ready
    return this.call<string>({ type: 'backend' })
  }

  /** Demande l'arrêt de l'entraînement en cours. */
  stop() {
    this.worker.postMessage({ id: 0, req: { type: 'stop' } satisfies MlRequest })
  }
}

let shared: MlClient | null = null

export function getMl(): MlClient {
  shared ??= new MlClient()
  return shared
}
