// Worker d'apprentissage : reconnaissance des pièces et entraînement, avec
// TensorFlow.js, hors du thread principal.
//
// Modèle = extracteur MobileNetV2 (gelé, livré avec l'app) + tête dense
// propre à chaque profil. L'entraînement d'un profil ne touche que la tête :
//  1. les vignettes (et leurs variantes augmentées) passent une fois dans
//     l'extracteur, les vecteurs de caractéristiques sont gardés en mémoire ;
//  2. la tête, initialisée avec celle du modèle de base, est entraînée sur
//     ces vecteurs (rapide, même sur téléphone) ;
//  3. la précision est mesurée sur des photos mises de côté, comparée à
//     celle du modèle de base, et la tête est enregistrée dans IndexedDB.

import * as tf from '@tensorflow/tfjs'
import { setWasmPaths } from '@tensorflow/tfjs-backend-wasm'
import { NUM_CLASSES } from './classes'
import { TILE, TILE_BYTES } from '../vision/tiles'
import { BASE_PROFILE, getExamples, getProfile, saveProfile, type Example, type HeadArtifacts, type TrainMetrics } from './storage'

export type MlRequest =
  | { type: 'init'; base: string }
  | { type: 'predict'; tiles: Uint8Array; profileId: string }
  | { type: 'train'; profileId: string }
  | { type: 'stop' }
  | { type: 'backend' }

const ctx = self as unknown as DedicatedWorkerGlobalScope

let baseUrl = ''
let extractor: tf.LayersModel | null = null
let baseHead: tf.LayersModel | null = null
// Têtes déjà chargées, par profil (invalidées quand le profil change)
const heads = new Map<string, { updatedAt: number; model: tf.LayersModel }>()
let stopRequested = false

ctx.onmessage = async (e: MessageEvent<{ id: number; req: MlRequest }>) => {
  const { id, req } = e.data
  if (req.type === 'stop') {
    stopRequested = true
    return
  }
  try {
    switch (req.type) {
      case 'init':
        ctx.postMessage({ id, result: await init(req.base) })
        break
      case 'backend':
        await initPromise
        ctx.postMessage({ id, result: tf.getBackend() })
        break
      case 'predict': {
        const probs = await withFallback(() => predict(req.tiles, req.profileId))
        ctx.postMessage({ id, result: probs }, [probs.buffer])
        break
      }
      case 'train':
        stopRequested = false
        ctx.postMessage({ id, result: await withFallback(() => train(req.profileId, (p) => ctx.postMessage({ id, progress: p }))) })
        break
    }
  } catch (err) {
    ctx.postMessage({ id, error: err instanceof Error ? err.message : String(err) })
  }
}

// ---------------------------------------------------------------------------
// Choix du moteur de calcul
//
// WebGL est le plus rapide, mais certains navigateurs l'acceptent puis
// échouent à compiler les shaders (constaté sur iPhone, dans un worker).
// Chaque moteur doit donc réussir un vrai calcul complet avant d'être
// retenu, et une erreur WebGL en cours de route fait basculer sur WASM.

let initPromise: Promise<{ backend: string }> | null = null

function init(base: string): Promise<{ backend: string }> {
  baseUrl = base
  setWasmPaths(`${base}tfjs/`)
  initPromise ??= (async () => {
    const candidates = [...(typeof OffscreenCanvas !== 'undefined' ? ['webgl'] : []), 'wasm', 'cpu']
    let lastError: unknown = null
    for (const b of candidates) {
      try {
        await useBackend(b)
        return { backend: b }
      } catch (e) {
        lastError = e
        console.warn(`Moteur ${b} indisponible :`, e instanceof Error ? e.message : e)
      }
    }
    throw lastError instanceof Error ? lastError : new Error('Aucun moteur de calcul disponible')
  })()
  return initPromise
}

/** Active un moteur, (re)charge le modèle de base et vérifie qu'il calcule juste. */
async function useBackend(name: string) {
  disposeModels()
  if (!(await tf.setBackend(name))) throw new Error(`Moteur ${name} refusé`)
  await tf.ready()
  extractor = await tf.loadLayersModel(`${baseUrl}models/base/extractor/model.json`)
  baseHead = await tf.loadLayersModel(`${baseUrl}models/base/head/model.json`)
  // Test complet : extraction, tête et augmentation, avec lecture du
  // résultat (les erreurs de shaders n'apparaissent qu'à ce moment-là)
  const x = tf.zeros([2, TILE, TILE, 3]) as tf.Tensor4D
  const f = extractor.predict(x) as tf.Tensor
  const p = baseHead.predict(f) as tf.Tensor
  const a = augment(x)
  try {
    const probs = await p.data()
    await a.data()
    if (!probs.every((v) => Number.isFinite(v))) throw new Error(`Calcul invalide sur le moteur ${name}`)
  } finally {
    tf.dispose([x, f, p, a])
  }
}

function disposeModels() {
  extractor?.dispose()
  baseHead?.dispose()
  extractor = null
  baseHead = null
  heads.forEach((h) => h.model.dispose())
  heads.clear()
}

const GPU_ERROR = /shader|webgl|gl_|context|texture|framebuffer|program/i

/** Relance une opération sur WASM si WebGL échoue en cours de route. */
async function withFallback<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (tf.getBackend() !== 'webgl' || !GPU_ERROR.test(msg)) throw e
    console.warn('WebGL en échec, bascule sur WebAssembly :', msg)
    try {
      await useBackend('wasm')
    } catch {
      await useBackend('cpu')
    }
    initPromise = Promise.resolve({ backend: tf.getBackend() })
    return fn()
  }
}

/** Vignettes uint8 (N x TILE x TILE x 3) -> tenseur normalisé [-1, 1]. */
function toTensor(tiles: Uint8Array, n: number): tf.Tensor4D {
  return tf.tidy(() => tf.tensor4d(tiles, [n, TILE, TILE, 3], 'int32').toFloat().div(127.5).sub(1) as tf.Tensor4D)
}

/** Tête du profil : celle enregistrée, sinon celle du modèle de base. */
async function headFor(profileId: string): Promise<tf.LayersModel> {
  if (profileId === BASE_PROFILE) return baseHead!
  const p = await getProfile(profileId)
  if (!p || !p.head) return baseHead!
  const cached = heads.get(profileId)
  if (cached && cached.updatedAt === p.updatedAt) return cached.model
  cached?.model.dispose()
  const model = await tf.loadLayersModel(tf.io.fromMemory(p.head as tf.io.ModelArtifacts))
  heads.set(profileId, { updatedAt: p.updatedAt, model })
  return model
}

async function features(x: tf.Tensor4D): Promise<tf.Tensor2D> {
  return extractor!.predict(x, { batchSize: 32 }) as tf.Tensor2D
}

async function predict(tiles: Uint8Array, profileId: string): Promise<Float32Array> {
  const n = tiles.length / TILE_BYTES
  const head = await headFor(profileId)
  const x = toTensor(tiles, n)
  const f = await features(x)
  const probs = head.predict(f) as tf.Tensor
  const out = (await probs.data()) as Float32Array
  tf.dispose([x, f, probs])
  return out
}

// ---------------------------------------------------------------------------
// Entraînement

export interface TrainProgress {
  phase: 'features' | 'train' | 'save'
  progress: number // 0 à 1
  epoch?: number
  epochs?: number
  valAccuracy?: number
}

export interface TrainResult extends TrainMetrics {
  stopped: boolean
}

const AUGMENT = 4 // variantes augmentées par vignette d'entraînement
const EPOCHS = 40

/**
 * Augmentation : miroir, petite rotation, luminosité, contraste, léger
 * décalage. Appliquée sur des vignettes déjà normalisées dans [-1, 1].
 */
function augment(x: tf.Tensor4D): tf.Tensor4D {
  return tf.tidy(() => {
    const n = x.shape[0]
    let y = x
    // Miroir horizontal pour la moitié des vignettes
    // (masque 0/1 par vignette, diffusé sur l'image : marche sur tous les moteurs)
    const flip = tf.randomUniform([n, 1, 1, 1]).less(0.5).toFloat()
    y = tf.image.flipLeftRight(y).mul(flip).add(y.mul(tf.scalar(1).sub(flip))) as tf.Tensor4D
    // Rotation légère (± 6°) : rotateWithOffset prend un seul angle, on tourne par sous-lots
    // (sous-lots de tailles quelconques, n n'étant pas forcément divisible)
    const k = Math.min(4, n)
    const sizes = Array.from({ length: k }, (_, i) => Math.floor(n / k) + (i < n % k ? 1 : 0))
    const parts = tf.split(y, sizes)
    // Coins découverts remplis en gris (0 après normalisation)
    y = tf.concat(parts.map((p) => tf.image.rotateWithOffset(p as tf.Tensor4D, ((Math.random() - 0.5) * 12 * Math.PI) / 180, 0))) as tf.Tensor4D
    // Luminosité et contraste aléatoires par vignette
    const bright = tf.randomUniform([n, 1, 1, 1], -0.2, 0.2)
    const contrast = tf.randomUniform([n, 1, 1, 1], 0.75, 1.25)
    const mean = y.mean([1, 2, 3], true)
    y = y.sub(mean).mul(contrast).add(mean).add(bright) as tf.Tensor4D
    // Léger recadrage aléatoire puis remise à la taille
    const boxes: number[][] = []
    for (let i = 0; i < n; i++) {
      const s = 0.06 * Math.random()
      const dx = (Math.random() - 0.5) * s
      const dy = (Math.random() - 0.5) * s
      boxes.push([s / 2 + dy, s / 2 + dx, 1 - s / 2 + dy, 1 - s / 2 + dx])
    }
    y = tf.image.cropAndResize(
      y,
      boxes,
      boxes.map((_, i) => i),
      [TILE, TILE],
    )
    return y.clipByValue(-1, 1) as tf.Tensor4D
  })
}

/** Laisse le worker traiter les messages en attente (bouton stop). */
const yieldLoop = () => new Promise((r) => setTimeout(r, 0))

/** Sépare les exemples en entraînement / validation, par photo. */
function split(examples: Example[]): { train: Example[]; val: Example[] } {
  const photos = [...new Set(examples.map((e) => e.photo))]
  // Mélange déterministe (même partage d'un entraînement à l'autre)
  photos.sort((a, b) => hash(a) - hash(b))
  if (photos.length >= 2) {
    const nVal = Math.max(1, Math.round(photos.length * 0.2))
    const valSet = new Set(photos.slice(0, nVal))
    return { train: examples.filter((e) => !valSet.has(e.photo)), val: examples.filter((e) => valSet.has(e.photo)) }
  }
  // Une seule photo : on met de côté une vignette sur cinq
  return { train: examples.filter((_, i) => i % 5 !== 0), val: examples.filter((_, i) => i % 5 === 0) }
}

function hash(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}

function stack(examples: Example[]): Uint8Array {
  const out = new Uint8Array(examples.length * TILE_BYTES)
  examples.forEach((e, i) => out.set(e.tile, i * TILE_BYTES))
  return out
}

async function accuracy(head: tf.LayersModel, f: tf.Tensor2D, labels: number[]): Promise<number> {
  if (!labels.length) return 0
  const pred = tf.tidy(() => (head.predict(f) as tf.Tensor).argMax(1))
  const p = await pred.data()
  pred.dispose()
  let ok = 0
  labels.forEach((l, i) => (ok += p[i] === l ? 1 : 0))
  return ok / labels.length
}

async function train(profileId: string, progress: (p: TrainProgress) => void): Promise<TrainResult> {
  if (!extractor || !baseHead) throw new Error('Modèle non chargé')
  const profile = await getProfile(profileId)
  if (!profile) throw new Error('Profil introuvable')
  const examples = await getExamples(profileId)
  if (examples.length < 64) throw new Error('Il faut au moins une photo de la position de départ.')
  const { train: tr, val } = split(examples)

  // 1. Caractéristiques : vignettes d'origine + variantes augmentées
  const feats: tf.Tensor2D[] = []
  const labels: number[] = []
  const passes = 1 + AUGMENT
  const total = tr.length * passes + val.length
  let doneCount = 0
  const B = 64
  for (let pass = 0; pass < passes; pass++) {
    for (let i = 0; i < tr.length; i += B) {
      if (stopRequested) return stopped(feats)
      const chunk = tr.slice(i, i + B)
      const x = toTensor(stack(chunk), chunk.length)
      const xa = pass === 0 ? x : augment(x)
      feats.push(await features(xa))
      if (xa !== x) xa.dispose()
      x.dispose()
      labels.push(...chunk.map((e) => e.label))
      doneCount += chunk.length
      progress({ phase: 'features', progress: doneCount / total })
      await yieldLoop()
    }
  }
  const valFeats: tf.Tensor2D[] = []
  for (let i = 0; i < val.length; i += B) {
    if (stopRequested) return stopped([...feats, ...valFeats])
    const chunk = val.slice(i, i + B)
    const x = toTensor(stack(chunk), chunk.length)
    valFeats.push(await features(x))
    x.dispose()
    doneCount += chunk.length
    progress({ phase: 'features', progress: doneCount / total })
    await yieldLoop()
  }
  const X = tf.concat(feats) as tf.Tensor2D
  tf.dispose(feats)
  const Y = tf.oneHot(tf.tensor1d(labels, 'int32'), NUM_CLASSES)
  const XV = (valFeats.length ? tf.concat(valFeats) : tf.zeros([0, X.shape[1]])) as tf.Tensor2D
  tf.dispose(valFeats)
  const valLabels = val.map((e) => e.label)
  const baseValAccuracy = await accuracy(baseHead, XV, valLabels)

  // 2. Tête initialisée avec celle du modèle de base
  const head = await tf.loadLayersModel(`${baseUrl}models/base/head/model.json`)
  head.compile({ optimizer: tf.train.adam(5e-4), loss: 'categoricalCrossentropy', metrics: ['accuracy'] })
  // Poids des classes : les cases vides, très nombreuses, comptent moins
  const counts = new Array(NUM_CLASSES).fill(0)
  labels.forEach((l) => counts[l]++)
  const classWeight: Record<number, number> = {}
  counts.forEach((c, i) => (classWeight[i] = c ? Math.min(5, Math.sqrt(labels.length / NUM_CLASSES / c)) : 1))

  let best = { acc: -1, weights: null as tf.Tensor[] | null }
  await head.fit(X, Y, {
    epochs: EPOCHS,
    batchSize: 32,
    shuffle: true,
    classWeight,
    verbose: 0,
    callbacks: {
      onBatchEnd: async () => {
        if (stopRequested) head.stopTraining = true
      },
      onEpochEnd: async (epoch) => {
        const acc = val.length ? await accuracy(head, XV, valLabels) : 0
        // On garde les poids de la meilleure époque sur la validation
        if (acc >= best.acc) {
          best.weights?.forEach((w) => w.dispose())
          best = { acc, weights: head.getWeights().map((w) => w.clone()) }
        }
        progress({ phase: 'train', progress: (epoch + 1) / EPOCHS, epoch: epoch + 1, epochs: EPOCHS, valAccuracy: acc })
        await yieldLoop()
      },
    },
  })
  tf.dispose([X, Y, XV])
  if (stopRequested) {
    best.weights?.forEach((w) => w.dispose())
    head.dispose()
    return { stopped: true, valAccuracy: 0, baseValAccuracy, valExamples: val.length, trainExamples: tr.length, trainedAt: 0 }
  }
  if (best.weights) {
    head.setWeights(best.weights)
    best.weights.forEach((w) => w.dispose())
  }

  // 3. Enregistrement de la tête dans le profil
  progress({ phase: 'save', progress: 1 })
  let artifacts: HeadArtifacts | null = null
  await head.save(
    tf.io.withSaveHandler(async (a) => {
      artifacts = {
        modelTopology: a.modelTopology,
        weightSpecs: a.weightSpecs as HeadArtifacts['weightSpecs'],
        weightData: Array.isArray(a.weightData) ? tf.io.concatenateArrayBuffers(a.weightData) : (a.weightData as ArrayBuffer),
      }
      return { modelArtifactsInfo: { dateSaved: new Date(), modelTopologyType: 'JSON' } }
    }),
  )
  head.dispose()
  const metrics: TrainMetrics = {
    valAccuracy: Math.max(0, best.acc),
    baseValAccuracy,
    valExamples: val.length,
    trainExamples: tr.length,
    trainedAt: Date.now(),
  }
  await saveProfile({ ...profile, head: artifacts, metrics })
  heads.get(profileId)?.model.dispose()
  heads.delete(profileId)
  return { ...metrics, stopped: false }
}

function stopped(t: tf.Tensor[]): TrainResult {
  tf.dispose(t)
  return { stopped: true, valAccuracy: 0, baseValAccuracy: 0, valExamples: 0, trainExamples: 0, trainedAt: 0 }
}
