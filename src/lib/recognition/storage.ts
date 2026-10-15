// Stockage local (IndexedDB) des profils de jeux d'échecs : nom, tête du
// modèle entraînée, exemples (vignettes étiquetées) et métriques.
// Fonctionne aussi bien dans la page que dans un worker (indexedDB global).
// Rien ne quitte l'appareil, sauf export explicite par l'utilisateur.

export const BASE_PROFILE = 'base' // modèle livré avec l'app, non modifiable

/** Modèle TF.js sérialisé (topologie + poids), comme produit par model.save(). */
export interface HeadArtifacts {
  modelTopology: unknown
  weightSpecs: { name: string; shape: number[]; dtype: string }[]
  weightData: ArrayBuffer
}

export interface TrainMetrics {
  valAccuracy: number // précision du profil sur les cases mises de côté
  baseValAccuracy: number // précision du modèle de base sur les mêmes cases
  valExamples: number
  trainExamples: number
  trainedAt: number
}

export interface Profile {
  id: string
  name: string
  createdAt: number
  updatedAt: number
  head: HeadArtifacts | null // null : pas encore entraîné (utilise la tête de base)
  metrics: TrainMetrics | null
}

export type ExampleSource = 'start' | 'position' | 'correction'

export interface Example {
  id?: number
  profileId: string
  label: number // index dans CLASSES
  tile: Uint8Array // RGB, TILE x TILE
  source: ExampleSource
  photo: string // identifiant de la photo d'origine (pour la validation par photo)
  createdAt: number
}

const DB_NAME = 'chesscam'
const DB_VERSION = 1

let dbPromise: Promise<IDBDatabase> | null = null

function db(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const d = req.result
      if (!d.objectStoreNames.contains('profiles')) d.createObjectStore('profiles', { keyPath: 'id' })
      if (!d.objectStoreNames.contains('examples')) {
        const s = d.createObjectStore('examples', { keyPath: 'id', autoIncrement: true })
        s.createIndex('profileId', 'profileId')
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB indisponible'))
  })
  return dbPromise
}

function done<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error ?? new Error('Transaction annulée'))
  })
}

export async function listProfiles(): Promise<Profile[]> {
  const d = await db()
  const all = await done(d.transaction('profiles').objectStore('profiles').getAll() as IDBRequest<Profile[]>)
  return all.sort((a, b) => a.createdAt - b.createdAt)
}

export async function getProfile(id: string): Promise<Profile | null> {
  const d = await db()
  return (await done(d.transaction('profiles').objectStore('profiles').get(id) as IDBRequest<Profile | undefined>)) ?? null
}

export async function saveProfile(p: Profile): Promise<void> {
  const d = await db()
  const tx = d.transaction('profiles', 'readwrite')
  tx.objectStore('profiles').put({ ...p, updatedAt: Date.now() })
  await txDone(tx)
}

export async function createProfile(name: string): Promise<Profile> {
  const now = Date.now()
  const p: Profile = {
    id: `p${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    name: name.trim() || 'Mon jeu',
    createdAt: now,
    updatedAt: now,
    head: null,
    metrics: null,
  }
  await saveProfile(p)
  return p
}

/** Supprime un profil et tous ses exemples. */
export async function deleteProfile(id: string): Promise<void> {
  const d = await db()
  const tx = d.transaction(['profiles', 'examples'], 'readwrite')
  tx.objectStore('profiles').delete(id)
  const idx = tx.objectStore('examples').index('profileId')
  const keys = await done(idx.getAllKeys(IDBKeyRange.only(id)))
  keys.forEach((k) => tx.objectStore('examples').delete(k))
  await txDone(tx)
}

export async function addExamples(examples: Example[]): Promise<void> {
  if (!examples.length) return
  const d = await db()
  const tx = d.transaction('examples', 'readwrite')
  const s = tx.objectStore('examples')
  for (const e of examples) {
    const { id: _id, ...rest } = e
    s.add(rest)
  }
  await txDone(tx)
}

export async function getExamples(profileId: string): Promise<Example[]> {
  const d = await db()
  const idx = d.transaction('examples').objectStore('examples').index('profileId')
  return done(idx.getAll(IDBKeyRange.only(profileId)) as IDBRequest<Example[]>)
}

/** Supprime les exemples d'une photo (annulation d'un ajout). */
export async function deletePhotoExamples(profileId: string, photo: string): Promise<void> {
  const all = await getExamples(profileId)
  const d = await db()
  const tx = d.transaction('examples', 'readwrite')
  all.filter((e) => e.photo === photo && e.id != null).forEach((e) => tx.objectStore('examples').delete(e.id as number))
  await txDone(tx)
}

export interface ProfileStats {
  total: number
  perClass: number[]
  photos: number
  startPhotos: number
}

export async function profileStats(profileId: string, numClasses: number): Promise<ProfileStats> {
  const all = await getExamples(profileId)
  const perClass = new Array(numClasses).fill(0)
  const photos = new Set<string>()
  const startPhotos = new Set<string>()
  for (const e of all) {
    perClass[e.label]++
    photos.add(e.photo)
    if (e.source === 'start') startPhotos.add(e.photo)
  }
  return { total: all.length, perClass, photos: photos.size, startPhotos: startPhotos.size }
}

// ---------------------------------------------------------------------------
// Export / import d'un profil (fichier .chesscam)
//
// Format : gzip d'un conteneur binaire simple
//   « CHESSCAM1 » | taille de l'en-tête JSON (uint32) | JSON | blocs binaires
// Le JSON décrit le profil, les spécifications des poids et les exemples ;
// les poids de la tête et les vignettes suivent bout à bout.

const MAGIC = 'CHESSCAM1'

export async function exportProfile(id: string): Promise<Blob> {
  const p = await getProfile(id)
  if (!p) throw new Error('Profil introuvable')
  const examples = await getExamples(id)
  const blobs: ArrayBuffer[] = []
  let offset = 0
  const push = (b: ArrayBuffer) => {
    blobs.push(b)
    const o = offset
    offset += b.byteLength
    return o
  }
  const head = p.head
    ? { modelTopology: p.head.modelTopology, weightSpecs: p.head.weightSpecs, weightOffset: push(p.head.weightData), weightLength: p.head.weightData.byteLength }
    : null
  const ex = examples.map((e) => {
    const buf = e.tile.slice().buffer
    return { label: e.label, source: e.source, photo: e.photo, createdAt: e.createdAt, offset: push(buf), length: buf.byteLength }
  })
  const header = new TextEncoder().encode(
    JSON.stringify({ version: 1, profile: { name: p.name, createdAt: p.createdAt, metrics: p.metrics }, head, examples: ex }),
  )
  const len = new Uint8Array(4)
  new DataView(len.buffer).setUint32(0, header.length, true)
  const raw = new Blob([new TextEncoder().encode(MAGIC), len, header, ...blobs])
  const gz = raw.stream().pipeThrough(new CompressionStream('gzip'))
  return new Response(gz).blob()
}

/** Importe un fichier .chesscam comme nouveau profil. */
export async function importProfile(file: Blob): Promise<Profile> {
  const raw = new Uint8Array(await new Response(file.stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer())
  const magic = new TextDecoder().decode(raw.subarray(0, MAGIC.length))
  if (magic !== MAGIC) throw new Error('Ce fichier n’est pas un profil ChessCam')
  const hl = new DataView(raw.buffer, raw.byteOffset + MAGIC.length, 4).getUint32(0, true)
  const start = MAGIC.length + 4
  const header = JSON.parse(new TextDecoder().decode(raw.subarray(start, start + hl)))
  const data = raw.subarray(start + hl)
  const p = await createProfile(`${header.profile.name} (importé)`)
  if (header.head) {
    p.head = {
      modelTopology: header.head.modelTopology,
      weightSpecs: header.head.weightSpecs,
      weightData: data.slice(header.head.weightOffset, header.head.weightOffset + header.head.weightLength).buffer,
    }
  }
  p.metrics = header.profile.metrics ?? null
  await saveProfile(p)
  const now = Date.now()
  await addExamples(
    header.examples.map((e: { label: number; source: ExampleSource; photo: string; createdAt: number; offset: number; length: number }) => ({
      profileId: p.id,
      label: e.label,
      source: e.source,
      photo: e.photo,
      createdAt: e.createdAt ?? now,
      tile: data.slice(e.offset, e.offset + e.length),
    })),
  )
  return p
}
