// Détection automatique de l'échiquier dans une photo, avec OpenCV.js.
//
// L'indice le plus fiable d'un échiquier, ce sont ses « coins en X » : les
// 49 points intérieurs où 4 cases se touchent en diagonale (clair, foncé,
// clair, foncé). Ni le cadre en bois, ni les pièces, ni la table n'en
// produisent. Le détecteur procède ainsi :
//
//  1. Réseau : on extrait les coins en X de toute l'image, on choisit une
//     case de départ (4 coins voisins aux signes alternés) puis on fait
//     croître un réseau régulier (homographie) en ajoutant les coins qui
//     tombent là où on les attend.
//     En secours : quadrilatères trouvés dans les contours (cadre, bord du
//     damier), recalés par un « peigne » de 7 lignes équidistantes.
//  2. Placement : les coins visibles ne disent pas toujours où est le bord
//     (une rangée couverte de pièces ne montre aucun coin). On teste chaque
//     décalage possible du plateau 8x8 : le bon a des jonctions en T sur son
//     pourtour (case contre cadre ou table) et aucun coin en X au delà.
//  3. Affinage : on relocalise chacun des 49 coins en X autour de la grille,
//     puis on recalcule l'homographie (moindres carrés, points aberrants
//     rejetés), jusqu'à stabilité. La perspective est corrigée exactement.
//  4. Validation de la forme et score de confiance.
//
// Ce module ne dépend pas du navigateur : `cv` est injecté, ce qui permet de
// le tester sous Node avec le même OpenCV.js.

import {
  applyH,
  area,
  homography,
  homographyLSQ,
  invert3,
  isConvex,
  mul3,
  orderCorners,
  quadDistance,
  type Mat3,
  type Pt,
  type Quad,
} from './geometry'

// OpenCV.js n'a pas de types fiables : on le manipule en `any`, localement.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type CV = any

export interface RGBAImage {
  data: Uint8ClampedArray
  width: number
  height: number
}

export interface DetectResult {
  quad: Quad | null // coins de la zone de jeu 8x8 dans l'image d'origine (a8, h8, h1, a1 si photo prise côté blancs)
  confidence: number // 0 à 1
  corners: number // nombre de coins en X retrouvés (sur 49)
  checkerScore: number // alternance clair / foncé des cases (diagnostic)
  candidates: number // nombre de quadrilatères examinés
  ms: number
}

const WORK_SIZE = 640 // taille de travail (plus grand côté) pour la détection
const COARSE = 384 // taille de l'image redressée pour l'ajustement grossier
const T = 40 // taille d'une case (px) pendant l'affinage
const UNIT: Pt[] = [
  { x: 0, y: 0 },
  { x: 8, y: 0 },
  { x: 8, y: 8 },
  { x: 0, y: 8 },
]

type Track = <T>(m: T) => T

/** Point d'entrée : détecte le plateau dans une image RGBA. */
export function detectBoard(cv: CV, img: RGBAImage): DetectResult {
  const t0 = performance.now()
  const mats: CV[] = []
  const track: Track = (m) => {
    mats.push(m)
    return m
  }
  try {
    // Image de travail en niveaux de gris, réduite, contraste égalisé
    const src = track(cv.matFromImageData(img))
    const scale = Math.min(1, WORK_SIZE / Math.max(img.width, img.height))
    const small = track(new cv.Mat())
    cv.resize(src, small, new cv.Size(Math.round(img.width * scale), Math.round(img.height * scale)), 0, 0, cv.INTER_AREA)
    const gray = track(new cv.Mat())
    cv.cvtColor(small, gray, cv.COLOR_RGBA2GRAY)
    const clahe = new cv.CLAHE(2.0, new cv.Size(8, 8))
    const eq = track(new cv.Mat())
    clahe.apply(gray, eq)
    clahe.delete()

    // Graines : homographies « coordonnées plateau -> image » approximatives,
    // avec la plage de décalages entiers encore possibles
    const seeds: Seed[] = []
    const lattice = findLattice(cv, eq, track)
    if (lattice) seeds.push(lattice)

    // Secours par les contours, seulement si le réseau est pauvre
    let nCandidates = 0
    if (!lattice || lattice.count < 30) {
      const candidates = findCandidates(cv, eq, track)
      nCandidates = candidates.length
      candidates
        .map((q) => coarseFit(cv, eq, q, track))
        .filter((r): r is { quad: Quad; score: number } => r !== null)
        .sort((a, b) => b.score - a.score)
        .slice(0, 3)
        .forEach((c) => seeds.push({ H: homography(UNIT, c.quad), sx: [-1, 1], sy: [-1, 1], count: 0 }))
    }

    // Placement du plateau 8x8, affinage, validation
    let best: Refined | null = null
    for (const seed of seeds) {
      const placed = placeBoard(cv, eq, seed, track)
      if (!placed) continue
      const r = refine(cv, eq, placed.H, track)
      if (!r || !plausible(r.quad, eq.cols, eq.rows)) continue
      r.score = r.score * 0.85 + clamp01(placed.edge) * 0.15
      if (!best || r.score > best.score) best = r
    }

    const quad = best ? orderCorners(best.quad.map((p) => ({ x: p.x / scale, y: p.y / scale }))) : null
    const confidence = best ? best.score : 0
    return {
      quad: confidence > 0.2 ? quad : null,
      confidence: Math.round(confidence * 100) / 100,
      corners: best?.found ?? 0,
      checkerScore: Math.round((best?.checker ?? 0) * 100) / 100,
      candidates: seeds.length + nCandidates,
      ms: Math.round(performance.now() - t0),
    }
  } finally {
    mats.forEach((m) => m.delete?.())
  }
}

function clamp01(v: number) {
  return Math.max(0, Math.min(1, v))
}

// ---------------------------------------------------------------------------
// 1. Candidats

function findCandidates(cv: CV, gray: CV, track: Track): Quad[] {
  const W = gray.cols
  const H = gray.rows
  const minArea = W * H * 0.06
  const out: Quad[] = []

  const blur = track(new cv.Mat())
  cv.GaussianBlur(gray, blur, new cv.Size(5, 5), 0)

  // a) Grands contours (cadre, bord du damier)
  const binaries: CV[] = []
  for (const [lo, hi] of [
    [30, 90],
    [60, 180],
  ]) {
    const edges = track(new cv.Mat())
    cv.Canny(blur, edges, lo, hi)
    const k = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 3))
    cv.dilate(edges, edges, k, new cv.Point(-1, -1), 2)
    k.delete()
    binaries.push(edges)
  }
  for (const bin of binaries) out.push(...largeQuads(cv, bin, minArea))

  // b) Cases détectées une à une (seuillage adaptatif, les deux polarités)
  const cell = Math.sqrt(W * H) / 8
  for (const inv of [cv.THRESH_BINARY_INV, cv.THRESH_BINARY]) {
    const th = track(new cv.Mat())
    cv.adaptiveThreshold(blur, th, 255, cv.ADAPTIVE_THRESH_MEAN_C, inv, (Math.round(cell / 2) | 1) + 2, 4)
    // Érosion : sépare les cases qui se touchent par un coin
    const k = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 3))
    cv.erode(th, th, k, new cv.Point(-1, -1), 1)
    k.delete()
    const q = squaresHull(cv, th, W * H)
    if (q) out.push(q)
    out.push(...largeQuads(cv, th, minArea))
  }

  // c) Secours : image entière et carré central (cadre de visée)
  out.push([
    { x: 0, y: 0 },
    { x: W - 1, y: 0 },
    { x: W - 1, y: H - 1 },
    { x: 0, y: H - 1 },
  ])
  const s = Math.min(W, H) * 0.9
  const x0 = (W - s) / 2
  const y0 = (H - s) / 2
  out.push([
    { x: x0, y: y0 },
    { x: x0 + s, y: y0 },
    { x: x0 + s, y: y0 + s },
    { x: x0, y: y0 + s },
  ])
  return dedupe(out, Math.max(W, H) * 0.03)
}

/** Simplifie un contour en quadrilatère convexe, si possible. */
function contourToQuad(cv: CV, contour: CV, minArea: number): Quad | null {
  const hull = new cv.Mat()
  cv.convexHull(contour, hull, false, true)
  const peri = cv.arcLength(hull, true)
  let res: Quad | null = null
  for (const eps of [0.02, 0.035, 0.05, 0.07, 0.1]) {
    const approx = new cv.Mat()
    cv.approxPolyDP(hull, approx, eps * peri, true)
    if (approx.rows === 4) {
      const pts: Pt[] = []
      for (let k = 0; k < 4; k++) pts.push({ x: approx.data32S[2 * k], y: approx.data32S[2 * k + 1] })
      const q = orderCorners(pts)
      if (isConvex(q) && Math.abs(area(q)) > minArea) res = q
      approx.delete()
      break
    }
    approx.delete()
  }
  hull.delete()
  return res
}

function largeQuads(cv: CV, bin: CV, minArea: number): Quad[] {
  const out: Quad[] = []
  const contours = new cv.MatVector()
  const hierarchy = new cv.Mat()
  cv.findContours(bin, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE)
  const list: { i: number; a: number }[] = []
  for (let i = 0; i < contours.size(); i++) {
    const c = contours.get(i)
    const a = cv.contourArea(c)
    if (a > minArea) list.push({ i, a })
    c.delete()
  }
  list.sort((p, q) => q.a - p.a)
  for (const { i } of list.slice(0, 8)) {
    const c = contours.get(i)
    const q = contourToQuad(cv, c, minArea)
    if (q) out.push(q)
    c.delete()
  }
  contours.delete()
  hierarchy.delete()
  return out
}

/**
 * Repère les petites taches quadrilatères de taille homogène (les cases) et
 * renvoie le quadrilatère qui les englobe.
 */
function squaresHull(cv: CV, bin: CV, imgArea: number): Quad | null {
  const contours = new cv.MatVector()
  const hierarchy = new cv.Mat()
  cv.findContours(bin, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE)
  const blobs: { a: number; pts: Pt[] }[] = []
  for (let i = 0; i < contours.size(); i++) {
    const c = contours.get(i)
    const a = cv.contourArea(c)
    if (a > imgArea / 2500 && a < imgArea / 60) {
      const approx = new cv.Mat()
      cv.approxPolyDP(c, approx, 0.08 * cv.arcLength(c, true), true)
      if (approx.rows === 4 && cv.isContourConvex(approx)) {
        const pts: Pt[] = []
        for (let k = 0; k < 4; k++) pts.push({ x: approx.data32S[2 * k], y: approx.data32S[2 * k + 1] })
        blobs.push({ a, pts })
      }
      approx.delete()
    }
    c.delete()
  }
  contours.delete()
  hierarchy.delete()
  if (blobs.length < 6) return null
  // On garde le groupe de taille dominante (médiane ± 60 %)
  const med = [...blobs].sort((p, q) => p.a - q.a)[blobs.length >> 1].a
  const keep = blobs.filter((b) => b.a > med * 0.4 && b.a < med * 1.6)
  if (keep.length < 6) return null
  const flat = keep.flatMap((b) => b.pts.flatMap((p) => [p.x, p.y]))
  const mat = cv.matFromArray(flat.length / 2, 1, cv.CV_32SC2, flat)
  const q = contourToQuad(cv, mat, imgArea * 0.02)
  mat.delete()
  return q
}

function dedupe(qs: Quad[], tol: number): Quad[] {
  const out: Quad[] = []
  for (const q of qs) {
    if (!out.some((o) => quadDistance(o, q) < tol)) out.push(q)
  }
  return out.slice(0, 20)
}

// ---------------------------------------------------------------------------
// Carte des coins en X

/**
 * Réponse « coin en X » sur des blocs de `d` pixels autour de chaque point.
 * Avec a, b, c, d les luminosités moyennes des quadrants haut-gauche,
 * haut-droit, bas-gauche, bas-droit :
 *   réponse = |a + d - b - c| / 2 - |a - d| - |b - c|
 * Elle est forte quand les diagonales sont de même couleur et que les deux
 * couleurs diffèrent (coin de damier). Sur une jonction en T (bord du plateau
 * contre deux cases) ou un bord droit, la pénalité l'emporte : réponse
 * négative, ramenée à 0. Le signe de (a + d - b - c) alterne d'un coin à
 * l'autre du damier.
 */
function xCornerMap(cv: CV, gray: CV, d: number, track: Track): { X: Float32Array; R: Float32Array; w: number; h: number } {
  const w = gray.cols
  const h = gray.rows
  const B = boxMeans(cv, gray, d, track)
  const X = new Float32Array(w * h) // réponse coin en X, signée
  const R = new Float32Array(w * h) // |a + d - b - c| / 2 : forte aussi sur les jonctions en T
  const o = Math.max(1, Math.round(d / 2))
  for (let y = o; y < h - o; y++) {
    for (let x = o; x < w - o; x++) {
      const a = B[(y - o) * w + x - o]
      const b = B[(y - o) * w + x + o]
      const c = B[(y + o) * w + x - o]
      const e = B[(y + o) * w + x + o]
      const s = a + e - b - c
      const raw = Math.abs(s) / 2
      const r = raw - Math.abs(a - e) - Math.abs(b - c)
      X[y * w + x] = r > 0 ? Math.sign(s) * r : 0
      R[y * w + x] = raw
    }
  }
  return { X, R, w, h }
}

/** Moyennes locales sur des blocs de `d` x `d` pixels (filtre boîte). */
function boxMeans(cv: CV, gray: CV, d: number, track: Track): Float32Array {
  const f = track(new cv.Mat())
  gray.convertTo(f, cv.CV_32F)
  const b = track(new cv.Mat())
  const k = Math.max(3, Math.round(d))
  cv.blur(f, b, new cv.Size(k, k))
  return b.data32F as Float32Array
}

interface XPoint {
  x: number
  y: number
  v: number // force de la réponse
  s: number // signe (+1 / -1)
  o: number // orientation du filtre ayant répondu (0 à 3, pas de 22,5°)
}

const ANGLES = 4 // orientations du filtre : 0°, 22,5°, 45°, 67,5°

/**
 * Coins en X sur l'image entière (non redressée). Le plateau pouvant être
 * tourné d'un angle quelconque, on applique le filtre selon 4 orientations
 * et on garde la meilleure réponse en chaque point.
 */
function xCornerPoints(cv: CV, gray: CV, d: number, track: Track): XPoint[] {
  const w = gray.cols
  const h = gray.rows
  const B = boxMeans(cv, gray, d, track)
  const o = d / 2
  // Décalages (entiers) des 4 quadrants pour chaque orientation
  const offs: number[][] = []
  for (let k = 0; k < ANGLES; k++) {
    const t = (k * Math.PI) / 2 / ANGLES
    const c = Math.cos(t)
    const sn = Math.sin(t)
    const rot = (x: number, y: number) => Math.round(y * c + x * sn) * w + Math.round(x * c - y * sn)
    // haut-gauche, haut-droit, bas-gauche, bas-droit (tournés)
    offs.push([rot(-o, -o), rot(o, -o), rot(-o, o), rot(o, o)])
  }
  const m = Math.ceil(o * Math.SQRT2) + 1
  const V = new Float32Array(w * h)
  const S = new Int8Array(w * h)
  const O = new Uint8Array(w * h)
  for (let y = m; y < h - m; y++) {
    for (let x = m; x < w - m; x++) {
      const i = y * w + x
      for (let k = 0; k < ANGLES; k++) {
        const f = offs[k]
        const a = B[i + f[0]]
        const b = B[i + f[1]]
        const c = B[i + f[2]]
        const e = B[i + f[3]]
        const sum = a + e - b - c
        const r = Math.abs(sum) / 2 - Math.abs(a - e) - Math.abs(b - c)
        if (r > V[i]) {
          V[i] = r
          S[i] = sum > 0 ? 1 : -1
          O[i] = k
        }
      }
    }
  }
  // Seuil relatif puis maxima locaux (fenêtre 7x7)
  let max = 0
  for (let i = 0; i < V.length; i++) if (V[i] > max) max = V[i]
  const thr = max * 0.12
  const pts: XPoint[] = []
  const r = 3
  for (let y = m + r; y < h - m - r; y++) {
    for (let x = m + r; x < w - m - r; x++) {
      const v = V[y * w + x]
      if (v < thr) continue
      let isMax = true
      for (let dy = -r; dy <= r && isMax; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const u = V[(y + dy) * w + x + dx]
          if (u > v || (u === v && (dy < 0 || (dy === 0 && dx < 0)))) {
            isMax = false
            break
          }
        }
      }
      if (isMax) pts.push({ x, y, v, s: S[y * w + x], o: O[y * w + x] })
    }
  }
  pts.sort((p, q2) => q2.v - p.v)
  return pts.slice(0, 1500)
}

// ---------------------------------------------------------------------------
// 1 bis. Réseau de coins en X

interface Seed {
  H: Mat3 // coordonnées plateau (cases) -> image de travail, à un décalage entier près
  sx: [number, number] // décalages entiers possibles en x
  sy: [number, number] // et en y
  count: number // nombre de coins en X qui soutiennent ce réseau
}

/**
 * Point compatible avec le réseau ? Orientation de filtre égale ou voisine
 * de celle du point de référence (la perspective fait varier l'angle des
 * coins), et signe alterné selon la parité attendue. Passer de 67,5° à 0°
 * revient à tourner le filtre d'un quart de tour, ce qui inverse le signe.
 */
function signOk(p: XPoint, ref: XPoint, parity: number): boolean {
  const d = (p.o - ref.o + ANGLES) % ANGLES
  if (d === 2) return false
  const wrap = (d === 1 && p.o === 0) || (d === ANGLES - 1 && ref.o === 0)
  return p.s === ref.s * parity * (wrap ? -1 : 1)
}

/** Point strictement à l'intérieur d'un quadrilatère convexe (sommets dans l'ordre). */
function insideQuad(q: Pt[], p: Pt): boolean {
  let sign = 0
  for (let i = 0; i < 4; i++) {
    const a = q[i]
    const b = q[(i + 1) % 4]
    const cr = Math.sign((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x))
    if (cr === 0) return false
    if (sign && cr !== sign) return false
    sign = cr
  }
  return true
}

/** Aire de l'image de la case unité (i, j) par l'homographie. */
function cellArea(H: Mat3, i: number, j: number): number {
  return Math.abs(
    area([applyH(H, { x: i, y: j }), applyH(H, { x: i + 1, y: j }), applyH(H, { x: i + 1, y: j + 1 }), applyH(H, { x: i, y: j + 1 })]),
  )
}

function findLattice(cv: CV, gray: CV, track: Track): Seed | null {
  const W = gray.cols
  const Hh = gray.rows
  // Taille de bloc adaptée à des cases de 15 à 80 px dans l'image de
  // travail : on garde celle qui donne le plus grand réseau
  let best: Seed | null = null
  for (const d of [6, 10]) {
    const s = latticeFromPoints(xCornerPoints(cv, gray, d, track), W, Hh)
    if (s && (!best || s.count > best.count)) best = s
  }
  return best
}

function latticeFromPoints(pts: XPoint[], W: number, Hh: number): Seed | null {
  if (pts.length < 9) return null

  // Index spatial pour trouver vite le point le plus proche d'une position
  const cell = 16
  const gw = Math.ceil(W / cell)
  const grid = new Map<number, number[]>()
  pts.forEach((p, i) => {
    const k = Math.floor(p.y / cell) * gw + Math.floor(p.x / cell)
    const list = grid.get(k)
    if (list) list.push(i)
    else grid.set(k, [i])
  })
  const nearest = (x: number, y: number, tol: number, ok: (p: XPoint) => boolean, used: Set<number>): number => {
    let best = -1
    let bd = tol
    const r = Math.min(8, Math.ceil(tol / cell))
    const cx = Math.floor(x / cell)
    const cy = Math.floor(y / cell)
    for (let gy = cy - r; gy <= cy + r; gy++) {
      for (let gx = cx - r; gx <= cx + r; gx++) {
        if (gx < 0 || gy < 0 || gx >= gw) continue
        for (const i of grid.get(gy * gw + gx) ?? []) {
          if (used.has(i)) continue
          const d = Math.hypot(pts[i].x - x, pts[i].y - y)
          if (d < bd && ok(pts[i])) {
            bd = d
            best = i
          }
        }
      }
    }
    return best
  }

  let best: { H: Mat3; cells: Map<string, number>; span: [number, number, number, number] } | null = null
  // Cases de départ : coins forts et proches du centre (on cadre le plateau
  // au milieu de la photo)
  const order = pts
    .map((p, i) => ({ i, w: p.v * (1.2 - Math.hypot(p.x / W - 0.5, p.y / Hh - 0.5)) }))
    .sort((a, b) => b.w - a.w)
    .slice(0, 60)
    .map((o) => o.i)
  outer: for (const pi of order) {
    const p = pts[pi]
    // Voisins les plus proches
    const neigh = pts
      .map((q, i) => ({ i, d: Math.hypot(q.x - p.x, q.y - p.y) }))
      .filter((n) => n.i !== pi && n.d > 4)
      .sort((a, b) => a.d - b.d)
      .slice(0, 8)
      .filter((n) => signOk(pts[n.i], p, -1))
      .slice(0, 4)
    for (let a = 0; a < neigh.length; a++) {
      for (let b = a + 1; b < neigh.length; b++) {
        const q1 = pts[neigh[a].i]
        const q2 = pts[neigh[b].i]
        const u = { x: q1.x - p.x, y: q1.y - p.y }
        const v = { x: q2.x - p.x, y: q2.y - p.y }
        const lu = Math.hypot(u.x, u.y)
        const lv = Math.hypot(v.x, v.y)
        const sin = Math.abs(u.x * v.y - u.y * v.x) / (lu * lv)
        if (sin < 0.5 || lu / lv > 2 || lv / lu > 2) continue
        // Quatrième coin de la case, en diagonale de p (même signe)
        const used = new Set([pi, neigh[a].i, neigh[b].i])
        const ri = nearest(p.x + u.x + v.x, p.y + u.y + v.y, 0.3 * Math.min(lu, lv), (r) => signOk(r, p, 1), used)
        if (ri < 0) continue
        // Une vraie case ne contient aucun autre coin en X : sinon c'est un
        // sous-réseau oblique (cases allongées qui sautent des coins)
        const cellPts = [p, q1, pts[ri], q2]
        const inside = pts.some((t, ti) => {
          if (used.has(ti) || ti === ri || t.v < p.v * 0.3) return false
          const cx = (p.x + q1.x + q2.x + pts[ri].x) / 4
          const cy = (p.y + q1.y + q2.y + pts[ri].y) / 4
          // Point rapproché du centre de 20 % : on ignore les bords de la case
          const sx = cx + (t.x - cx) * 1.25
          const sy = cy + (t.y - cy) * 1.25
          return insideQuad(cellPts, { x: sx, y: sy })
        })
        if (inside) continue
        const g = grow(
          homography(
            [
              { x: 0, y: 0 },
              { x: 1, y: 0 },
              { x: 0, y: 1 },
              { x: 1, y: 1 },
            ],
            [p, q1, q2, pts[ri]],
          ),
          new Map([
            ['0,0', pi],
            ['1,0', neigh[a].i],
            ['0,1', neigh[b].i],
            ['1,1', ri],
          ]),
          p,
        )
        // Plus de coins d'abord ; à égalité, les plus petites cases
        if (g && (!best || g.cells.size > best.cells.size || (g.cells.size === best.cells.size && cellArea(g.H, 0, 0) < cellArea(best.H, 0, 0))))
          best = g
        if (best && best.cells.size >= 40) break outer
      }
    }
  }
  if (!best || best.cells.size < 9) return null

  // Coordonnées plateau provisoires : le premier coin trouvé est sur la
  // ligne 1. Les décalages possibles vont d'une case de plus de chaque côté,
  // car une ligne du bord (jonctions en T) a pu être prise pour une ligne
  // intérieure.
  const [imin, imax, jmin, jmax] = best.span
  const shift: Mat3 = [1, 0, imin - 1, 0, 1, jmin - 1, 0, 0, 1]
  return {
    H: mul3(best.H, shift),
    sx: [-1, 7 - (imax - imin)],
    sy: [-1, 7 - (jmax - jmin)],
    count: best.cells.size,
  }

  /** Fait croître le réseau à partir d'une case, en ajoutant les coins attendus. */
  function grow(H0: Mat3, cells: Map<string, number>, ref: XPoint) {
    let H = H0
    const used = new Set(cells.values())
    const area0 = cellArea(H0, 0, 0)
    for (let iter = 0; iter < 14; iter++) {
      const keys = [...cells.keys()].map((k) => k.split(',').map(Number))
      const is = keys.map((k) => k[0])
      const js = keys.map((k) => k[1])
      const [i0, i1, j0, j1] = [Math.min(...is), Math.max(...is), Math.min(...js), Math.max(...js)]
      // Bornes courantes, mises à jour à chaque ajout
      let [a0, a1, b0, b1] = [i0, i1, j0, j1]
      let added = 0
      for (let j = j0 - 1; j <= j1 + 1; j++) {
        for (let i = i0 - 1; i <= i1 + 1; i++) {
          if (cells.has(`${i},${j}`)) continue
          // Un plateau n'a que 7 lignes intérieures dans chaque sens
          if (Math.max(a1, i) - Math.min(a0, i) > 6 || Math.max(b1, j) - Math.min(b0, j) > 6) continue
          const p = applyH(H, { x: i, y: j })
          const px = applyH(H, { x: i + 1, y: j })
          const py = applyH(H, { x: i, y: j + 1 })
          const scale = Math.min(Math.hypot(px.x - p.x, px.y - p.y), Math.hypot(py.x - p.x, py.y - p.y))
          // Une case fait entre 4 px et un tiers de l'image
          if (!(scale > 4 && scale < Math.max(W, Hh) / 3) || p.x < 0 || p.y < 0 || p.x >= W || p.y >= Hh) continue
          const parity = (i + j) % 2 === 0 ? 1 : -1
          const k = nearest(p.x, p.y, scale * 0.25, (q) => signOk(q, ref, parity), used)
          if (k >= 0) {
            cells.set(`${i},${j}`, k)
            used.add(k)
            added++
            a0 = Math.min(a0, i)
            a1 = Math.max(a1, i)
            b0 = Math.min(b0, j)
            b1 = Math.max(b1, j)
          }
        }
      }
      if (!added) break
      try {
        const entries = [...cells.entries()]
        H = homographyLSQ(
          entries.map(([key]) => {
            const [i, j] = key.split(',').map(Number)
            return { x: i, y: j }
          }),
          entries.map(([, k]) => pts[k]),
        )
      } catch {
        return null
      }
      // Garde-fou : un réseau qui dégénère (cases écrasées ou gonflées,
      // points mal placés) est abandonné
      const a = cellArea(H, 0, 0)
      if (!(a > area0 * 0.4 && a < area0 * 2.5)) return null
      let worst = 0
      for (const [key, k] of cells) {
        const [i, j] = key.split(',').map(Number)
        const q = applyH(H, { x: i, y: j })
        worst = Math.max(worst, Math.hypot(q.x - pts[k].x, q.y - pts[k].y))
      }
      if (worst > Math.sqrt(area0) * 0.35) return null
    }
    const keys = [...cells.keys()].map((k) => k.split(',').map(Number))
    const is = keys.map((k) => k[0])
    const js = keys.map((k) => k[1])
    return {
      H,
      cells,
      span: [Math.min(...is), Math.max(...is), Math.min(...js), Math.max(...js)] as [number, number, number, number],
    }
  }
}

// ---------------------------------------------------------------------------
// 2 bis. Placement du plateau 8x8 sur le réseau

/**
 * Choisit le décalage entier du plateau. Pour chaque hypothèse, on regarde :
 * des coins en X sur les 7x7 points intérieurs, des jonctions en T (case
 * contre cadre ou table) sur le pourtour, et pas de coin en X sur le pourtour.
 */
function placeBoard(cv: CV, gray: CV, seed: Seed, track: Track): { H: Mat3; edge: number } | null {
  const P = 32 // pixels par case dans l'image redressée
  const [sx0, sx1] = seed.sx
  const [sy0, sy1] = seed.sy
  // Zone utile en coordonnées provisoires (u, v), une case de marge
  const u0 = -sx1 - 1
  const u1 = 9 - sx0
  const v0 = -sy1 - 1
  const v1 = 9 - sy0
  const src = [
    applyH(seed.H, { x: u0, y: v0 }),
    applyH(seed.H, { x: u1, y: v0 }),
    applyH(seed.H, { x: u1, y: v1 }),
    applyH(seed.H, { x: u0, y: v1 }),
  ]
  const Wd = (u1 - u0) * P
  const Hd = (v1 - v0) * P
  let Hw: Mat3
  try {
    Hw = homography(src, [
      { x: 0, y: 0 },
      { x: Wd, y: 0 },
      { x: Wd, y: Hd },
      { x: 0, y: Hd },
    ])
  } catch {
    return null
  }
  const M = track(cv.matFromArray(3, 3, cv.CV_64F, Hw))
  const warped = track(new cv.Mat())
  cv.warpPerspective(gray, warped, M, new cv.Size(Wd, Hd), cv.INTER_LINEAR, cv.BORDER_CONSTANT, new cv.Scalar(128))
  const { X, R } = xCornerMap(cv, warped, P * 0.45, track)

  // Mesures aux points entiers du réseau (maximum local dans ±0,2 case)
  const win = Math.round(P * 0.2)
  const nu = u1 - u0 + 1
  const nv = v1 - v0 + 1
  const xs = new Float32Array(nu * nv)
  const ts = new Float32Array(nu * nv)
  for (let v = v0; v <= v1; v++) {
    for (let u = u0; u <= u1; u++) {
      const cx = (u - u0) * P
      const cy = (v - v0) * P
      let bx = 0
      let bt = 0
      for (let y = Math.max(0, cy - win); y <= Math.min(Hd - 1, cy + win); y++) {
        for (let x = Math.max(0, cx - win); x <= Math.min(Wd - 1, cx + win); x++) {
          const i = y * Wd + x
          const ax = Math.abs(X[i])
          if (ax > bx) bx = ax
          const t = R[i] - ax
          if (t > bt) bt = t
        }
      }
      xs[(v - v0) * nu + (u - u0)] = bx
      ts[(v - v0) * nu + (u - u0)] = bt
    }
  }
  const at = (arr: Float32Array, u: number, v: number) => arr[(v - v0) * nu + (u - u0)]
  // Échelle de référence : réponse typique d'un bon coin
  const sorted = [...xs].sort((a, b) => b - a)
  const ref = sorted[Math.min(sorted.length - 1, 8)] || 1

  let best: { sx: number; sy: number; score: number; edge: number } | null = null
  for (let sy = sy0; sy <= sy1; sy++) {
    for (let sx = sx0; sx <= sx1; sx++) {
      // Plateau : lignes intérieures u = 1 - sx ... 7 - sx, bords u = -sx et 8 - sx
      let inner = 0
      for (let v = 1 - sy; v <= 7 - sy; v++) for (let u = 1 - sx; u <= 7 - sx; u++) inner += at(xs, u, v)
      inner /= 49
      let edgeT = 0
      let edgeX = 0
      for (let k = 1; k <= 7; k++) {
        for (const [u, v] of [
          [-sx, k - sy],
          [8 - sx, k - sy],
          [k - sx, -sy],
          [k - sx, 8 - sy],
        ]) {
          edgeT += at(ts, u, v)
          edgeX += at(xs, u, v)
        }
      }
      edgeT /= 28
      edgeX /= 28
      const score = (inner + 0.6 * edgeT - 0.8 * edgeX) / ref
      if (!best || score > best.score) best = { sx, sy, score, edge: edgeT / ref }
    }
  }
  if (!best) return null
  // Coordonnées plateau b = u + s, donc u = b - s
  const T: Mat3 = [1, 0, -best.sx, 0, 1, -best.sy, 0, 0, 1]
  return { H: mul3(seed.H, T), edge: best.edge }
}

/** Forme plausible pour un échiquier photographié ? */
function plausible(q: Quad, W: number, H: number): boolean {
  if (!isConvex(q)) return false
  const a = Math.abs(area(q))
  if (a < W * H * 0.02) return false
  // Angles entre 25° et 155°
  for (let i = 0; i < 4; i++) {
    const p = q[(i + 3) % 4]
    const c = q[i]
    const n = q[(i + 1) % 4]
    const v1 = { x: p.x - c.x, y: p.y - c.y }
    const v2 = { x: n.x - c.x, y: n.y - c.y }
    const cos = (v1.x * v2.x + v1.y * v2.y) / (Math.hypot(v1.x, v1.y) * Math.hypot(v2.x, v2.y))
    if (Math.abs(cos) > Math.cos((25 * Math.PI) / 180)) return false
  }
  // Côtés opposés de longueurs comparables
  const len = (i: number) => Math.hypot(q[(i + 1) % 4].x - q[i].x, q[(i + 1) % 4].y - q[i].y)
  if (Math.max(len(0), len(2)) / Math.min(len(0), len(2)) > 3.5) return false
  if (Math.max(len(1), len(3)) / Math.min(len(1), len(3)) > 3.5) return false
  // Coins pas trop loin hors de l'image (un bout de plateau peut dépasser)
  return q.every((p) => p.x > -0.25 * W && p.y > -0.25 * H && p.x < 1.25 * W && p.y < 1.25 * H)
}

// ---------------------------------------------------------------------------
// 2. Ajustement grossier

/** Redresse l'image pour que `src` (4 points) devienne le carré [0, size]². */
function warpGray(cv: CV, gray: CV, src: Pt[], size: number, track: Track): { warped: CV; H: Mat3 } | null {
  let H: Mat3
  try {
    H = homography(src, [
      { x: 0, y: 0 },
      { x: size, y: 0 },
      { x: size, y: size },
      { x: 0, y: size },
    ])
  } catch {
    return null
  }
  const M = track(cv.matFromArray(3, 3, cv.CV_64F, H))
  const warped = track(new cv.Mat())
  cv.warpPerspective(gray, warped, M, new cv.Size(size, size), cv.INTER_LINEAR, cv.BORDER_CONSTANT, new cv.Scalar(128))
  return { warped, H }
}

function coarseFit(cv: CV, gray: CV, q: Quad, track: Track): { quad: Quad; score: number } | null {
  // On agrandit le candidat de 15 % de chaque côté : le plateau peut
  // déborder un peu d'un candidat trop serré
  const m = 0.15
  const toImg = homography(
    [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ],
    q,
  )
  const src = [
    applyH(toImg, { x: -m, y: -m }),
    applyH(toImg, { x: 1 + m, y: -m }),
    applyH(toImg, { x: 1 + m, y: 1 + m }),
    applyH(toImg, { x: -m, y: 1 + m }),
  ]
  const w = warpGray(cv, gray, src, COARSE, track)
  if (!w) return null

  // Côté du plateau entre 55 % et 130 % de celui du candidat
  const cand = COARSE / (1 + 2 * m)
  const minStep = (cand * 0.55) / 8
  const maxStep = Math.min((cand * 1.3) / 8, COARSE / 8)
  const { X: C } = xCornerMap(cv, w.warped, ((minStep + maxStep) / 2) * 0.5, track)
  const px = new Float32Array(COARSE)
  const py = new Float32Array(COARSE)
  for (let y = 0; y < COARSE; y++) {
    for (let x = 0; x < COARSE; x++) {
      const v = Math.abs(C[y * COARSE + x])
      px[x] += v
      py[y] += v
    }
  }
  const fx = comb(px, minStep, maxStep)
  const fy = comb(py, minStep, maxStep)
  if (!fx || !fy) return null
  if (Math.max(fx.step, fy.step) / Math.min(fx.step, fy.step) > 1.3) return null

  // Les lignes 1 à 7 sont les lignes intérieures : le bord est un pas avant
  const back = invert3(w.H)
  const x0 = fx.first - fx.step
  const y0 = fy.first - fy.step
  const quad = [
    applyH(back, { x: x0, y: y0 }),
    applyH(back, { x: x0 + 8 * fx.step, y: y0 }),
    applyH(back, { x: x0 + 8 * fx.step, y: y0 + 8 * fy.step }),
    applyH(back, { x: x0, y: y0 + 8 * fy.step }),
  ] as Quad
  return { quad, score: Math.min(fx.score, fy.score) }
}

/**
 * Cherche 7 lignes équidistantes (pas `step`, première à `first`) qui
 * maximisent le profil. Score = moyenne sur les lignes / moyenne générale.
 */
function comb(profile: Float32Array, minStep: number, maxStep: number): { first: number; step: number; score: number } | null {
  const n = profile.length
  let mean = 0
  for (let i = 0; i < n; i++) mean += profile[i]
  mean /= n
  if (mean <= 0) return null
  // Maximum local sur ±2 px pour tolérer les arrondis
  const pm = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    let v = 0
    for (let k = -2; k <= 2; k++) v = Math.max(v, profile[Math.min(n - 1, Math.max(0, i + k))])
    pm[i] = v / mean
  }
  let best: { first: number; step: number; score: number } | null = null
  for (let step = minStep; step <= maxStep; step += 0.25) {
    // Les bords du plateau (première ligne - 1 pas, dernière + 1 pas) doivent rester dans l'image
    for (let first = step; first + 7 * step < n; first += 1) {
      let s = 0
      for (let k = 0; k < 7; k++) s += pm[Math.round(first + k * step)]
      s /= 7
      if (!best || s > best.score) best = { first, step, score: s }
    }
  }
  return best
}

// ---------------------------------------------------------------------------
// 3. Affinage par les 49 coins en X

interface Refined {
  quad: Quad
  found: number
  checker: number
  score: number
}

function refine(cv: CV, gray: CV, start: Mat3, track: Track): Refined | null {
  let quad = UNIT.map((u) => applyH(start, u)) as Quad
  let found: { k: number; l: number; p: Pt; v: number }[] = []
  let parity = 0
  let rms = T
  const SIZE = 10 * T // plateau + une case de marge de chaque côté
  for (let iter = 0; iter < 4; iter++) {
    const toImg = homography(UNIT, quad)
    const src = [
      applyH(toImg, { x: -1, y: -1 }),
      applyH(toImg, { x: 9, y: -1 }),
      applyH(toImg, { x: 9, y: 9 }),
      applyH(toImg, { x: -1, y: 9 }),
    ]
    const w = warpGray(cv, gray, src, SIZE, track)
    if (!w) return null
    const { X: C } = xCornerMap(cv, w.warped, T * 0.45, track)
    // Fenêtre de recherche plus large au premier tour
    const win = Math.round(T * (iter === 0 ? 0.35 : 0.25))
    const pts: { k: number; l: number; p: Pt; v: number; s: number }[] = []
    for (let l = 1; l <= 7; l++) {
      for (let k = 1; k <= 7; k++) {
        const ex = (k + 1) * T
        const ey = (l + 1) * T
        let bv = 0
        let bx = ex
        let by = ey
        for (let y = ey - win; y <= ey + win; y++) {
          for (let x = ex - win; x <= ex + win; x++) {
            const v = Math.abs(C[y * SIZE + x])
            if (v > bv) {
              bv = v
              bx = x
              by = y
            }
          }
        }
        // Position sous-pixel (parabole sur les voisins)
        const at = (x: number, y: number) => Math.abs(C[y * SIZE + x])
        const sub = (a: number, b: number, c: number) => (a - 2 * b + c !== 0 ? (0.5 * (a - c)) / (a - 2 * b + c) : 0)
        const dx = clampSub(sub(at(bx - 1, by), bv, at(bx + 1, by)))
        const dy = clampSub(sub(at(bx, by - 1), bv, at(bx, by + 1)))
        pts.push({ k, l, p: { x: bx + dx, y: by + dy }, v: bv, s: Math.sign(C[by * SIZE + bx]) })
      }
    }
    // Seuil : une fraction de la réponse typique des meilleurs coins
    const sorted = pts.map((p) => p.v).sort((a, b) => b - a)
    const ref = sorted[Math.min(sorted.length - 1, 9)] || 1
    let good = pts.filter((p) => p.v > ref * 0.3)
    // Le signe doit alterner en damier : on garde la parité majoritaire
    const even = good.filter((p) => p.s === ((p.k + p.l) % 2 === 0 ? 1 : -1)).length
    const flip = even >= good.length - even ? 1 : -1
    good = good.filter((p) => p.s === flip * ((p.k + p.l) % 2 === 0 ? 1 : -1))
    parity = good.length / Math.max(1, pts.filter((p) => p.v > ref * 0.3).length)
    if (good.length < 8) return null

    // Homographie case -> image redressée, avec rejet des points aberrants
    let Hb: Mat3 | null = null
    for (let pass = 0; pass < 3; pass++) {
      try {
        Hb = homographyLSQ(
          good.map((g) => ({ x: g.k, y: g.l })),
          good.map((g) => g.p),
        )
      } catch {
        return null
      }
      const res = good.map((g) => {
        const q = applyH(Hb as Mat3, { x: g.k, y: g.l })
        return Math.hypot(q.x - g.p.x, q.y - g.p.y)
      })
      const med = [...res].sort((a, b) => a - b)[res.length >> 1]
      const lim = Math.max(2, med * 3)
      const next = good.filter((_, i) => res[i] <= lim)
      if (next.length === good.length || next.length < 8) break
      good = next
    }
    if (!Hb) return null
    found = good
    // Résidu moyen (px dans l'image redressée, T px par case)
    rms = Math.sqrt(
      good.reduce((acc, g) => {
        const q = applyH(Hb as Mat3, { x: g.k, y: g.l })
        return acc + (q.x - g.p.x) ** 2 + (q.y - g.p.y) ** 2
      }, 0) / good.length,
    )
    const back = invert3(w.H)
    const next = UNIT.map((u) => applyH(back, applyH(Hb as Mat3, u))) as Quad
    if (!isConvex(next)) return null
    const moved = quadDistance(next, quad)
    quad = next
    if (moved < 0.3) break
  }

  const checker = checkerScore(cv, gray, quad, track)
  // Confiance : part des 49 coins retrouvés, cohérence du damier et des
  // signes, multipliée par la régularité géométrique (un vrai damier tombe
  // à 1 ou 2 px près, de faux coins sur les pièces sont dispersés)
  const regular = clamp01((0.2 * T - rms) / (0.12 * T))
  const score =
    (clamp01((found.length - 8) / 25) * 0.6 + clamp01((checker - 0.15) / 0.4) * 0.25 + clamp01((parity - 0.6) / 0.35) * 0.15) * regular
  return { quad, found: found.length, checker, score }
}

function clampSub(v: number) {
  return Math.max(-0.5, Math.min(0.5, v))
}

/**
 * Alternance clair / foncé des cases : corrélation entre la luminosité
 * médiane de chaque case et la parité (ligne + colonne). Proche de 1 pour
 * un damier vide, plus faible avec des pièces, proche de 0 sinon.
 */
function checkerScore(cv: CV, gray: CV, quad: Quad, track: Track): number {
  const S = 8 * 24
  const w = warpGray(cv, gray, quad, S, track)
  if (!w) return 0
  const data = w.warped.data as Uint8Array
  const vals: number[] = []
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const px: number[] = []
      for (let y = r * 24 + 5; y < r * 24 + 19; y += 2) for (let x = c * 24 + 5; x < c * 24 + 19; x += 2) px.push(data[y * S + x])
      px.sort((a, b) => a - b)
      vals.push(px[px.length >> 1])
    }
  }
  const mean = vals.reduce((s, v) => s + v, 0) / 64
  const sd = Math.sqrt(vals.reduce((s, v) => s + (v - mean) ** 2, 0) / 64) || 1
  let corr = 0
  vals.forEach((v, i) => {
    const sign = (Math.floor(i / 8) + (i % 8)) % 2 === 0 ? 1 : -1
    corr += sign * (v - mean)
  })
  return Math.abs(corr / 64 / sd)
}

// ---------------------------------------------------------------------------
// Redressement final en couleur

/**
 * Aplati la zone de jeu en une image carrée de `size` pixels, avec
 * éventuellement une marge (en cases) autour, utile pour les pièces hautes
 * qui débordent sur la case du dessus.
 */
export function warpBoard(cv: CV, img: RGBAImage, q: Quad, size: number, marginSquares = 0): RGBAImage {
  const toImg = homography(UNIT, q)
  const m = marginSquares
  const src = [
    applyH(toImg, { x: -m, y: -m }),
    applyH(toImg, { x: 8 + m, y: -m }),
    applyH(toImg, { x: 8 + m, y: 8 + m }),
    applyH(toImg, { x: -m, y: 8 + m }),
  ]
  const Hm = homography(src, [
    { x: 0, y: 0 },
    { x: size, y: 0 },
    { x: size, y: size },
    { x: 0, y: size },
  ])
  const srcMat = cv.matFromImageData(img)
  const M = cv.matFromArray(3, 3, cv.CV_64F, Hm)
  const out = new cv.Mat()
  try {
    cv.warpPerspective(srcMat, out, M, new cv.Size(size, size), cv.INTER_AREA, cv.BORDER_CONSTANT, new cv.Scalar(0, 0, 0, 255))
    return { data: new Uint8ClampedArray(out.data), width: size, height: size }
  } finally {
    srcMat.delete()
    M.delete()
    out.delete()
  }
}

