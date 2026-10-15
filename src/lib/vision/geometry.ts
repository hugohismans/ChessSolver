// Géométrie plane sans dépendance : homographies (transformations de
// perspective), ordre des coins, quadrilatères. Utilisé côté interface
// (grille projetée pendant l'ajustement des coins) comme dans le worker.

export interface Pt {
  x: number
  y: number
}

/** Les 4 coins du plateau dans l'ordre : haut-gauche, haut-droit, bas-droit, bas-gauche. */
export type Quad = [Pt, Pt, Pt, Pt]

/** Matrice 3x3 stockée ligne par ligne (9 nombres). */
export type Mat3 = number[]

/**
 * Remet 4 points dans l'ordre haut-gauche, haut-droit, bas-droit, bas-gauche
 * (sens horaire à l'écran), quel que soit l'ordre d'entrée.
 */
export function orderCorners(pts: Pt[]): Quad {
  const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length
  const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length
  // Tri par angle autour du centre (sens horaire car l'axe y descend)
  const sorted = [...pts].sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx))
  // On commence par le point le plus en haut à gauche (x + y minimal)
  let start = 0
  sorted.forEach((p, i) => {
    if (p.x + p.y < sorted[start].x + sorted[start].y) start = i
  })
  return [0, 1, 2, 3].map((k) => sorted[(start + k) % 4]) as Quad
}

/** Résout le système linéaire A x = b (élimination de Gauss avec pivot partiel). */
function solve(A: number[][], b: number[]): number[] {
  const n = b.length
  const M = A.map((row, i) => [...row, b[i]])
  for (let c = 0; c < n; c++) {
    let piv = c
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r
    if (Math.abs(M[piv][c]) < 1e-12) throw new Error('Système singulier')
    ;[M[c], M[piv]] = [M[piv], M[c]]
    for (let r = 0; r < n; r++) {
      if (r === c) continue
      const f = M[r][c] / M[c][c]
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]
    }
  }
  return M.map((row, i) => row[n] / row[i])
}

/** Homographie qui envoie les 4 points `src` sur les 4 points `dst`. */
export function homography(src: Pt[], dst: Pt[]): Mat3 {
  const A: number[][] = []
  const b: number[] = []
  for (let i = 0; i < 4; i++) {
    const { x, y } = src[i]
    const { x: u, y: v } = dst[i]
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y])
    b.push(u)
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y])
    b.push(v)
  }
  return [...solve(A, b), 1]
}

/**
 * Homographie au sens des moindres carrés à partir de N >= 4 couples de
 * points (DLT normalisée). Plus robuste que 4 points quand on a beaucoup
 * de mesures un peu bruitées, comme les coins des cases.
 */
export function homographyLSQ(src: Pt[], dst: Pt[]): Mat3 {
  if (src.length < 4) throw new Error('Il faut au moins 4 points')
  // Normalisation : centrage et mise à l'échelle (stabilité numérique)
  const norm = (pts: Pt[]) => {
    const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length
    const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length
    const d = pts.reduce((s, p) => s + Math.hypot(p.x - cx, p.y - cy), 0) / pts.length || 1
    const k = Math.SQRT2 / d
    return { T: [k, 0, -k * cx, 0, k, -k * cy, 0, 0, 1], pts: pts.map((p) => ({ x: (p.x - cx) * k, y: (p.y - cy) * k })) }
  }
  const a = norm(src)
  const b = norm(dst)
  // Équations normales (A^T A) h = A^T b, avec h33 = 1
  const AtA = Array.from({ length: 8 }, () => Array(8).fill(0))
  const Atb = Array(8).fill(0)
  const add = (row: number[], rhs: number) => {
    for (let i = 0; i < 8; i++) {
      Atb[i] += row[i] * rhs
      for (let j = 0; j < 8; j++) AtA[i][j] += row[i] * row[j]
    }
  }
  a.pts.forEach(({ x, y }, i) => {
    const { x: u, y: v } = b.pts[i]
    add([x, y, 1, 0, 0, 0, -u * x, -u * y], u)
    add([0, 0, 0, x, y, 1, -v * x, -v * y], v)
  })
  const Hn = [...solve(AtA, Atb), 1]
  // Dénormalisation : H = Tb^-1 * Hn * Ta
  return normalizeH(mul3(mul3(invert3(b.T), Hn), a.T))
}

export function mul3(A: Mat3, B: Mat3): Mat3 {
  const C: number[] = Array(9).fill(0)
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) for (let k = 0; k < 3; k++) C[r * 3 + c] += A[r * 3 + k] * B[k * 3 + c]
  return C
}

function normalizeH(H: Mat3): Mat3 {
  return H.map((v) => v / H[8])
}

export function applyH(H: Mat3, p: Pt): Pt {
  const w = H[6] * p.x + H[7] * p.y + H[8]
  return { x: (H[0] * p.x + H[1] * p.y + H[2]) / w, y: (H[3] * p.x + H[4] * p.y + H[5]) / w }
}

export function invert3(m: Mat3): Mat3 {
  const [a, b, c, d, e, f, g, h, i] = m
  const A = e * i - f * h
  const B = -(d * i - f * g)
  const C = d * h - e * g
  const det = a * A + b * B + c * C
  if (Math.abs(det) < 1e-12) throw new Error('Matrice non inversible')
  const inv = [A, -(b * i - c * h), b * f - c * e, B, a * i - c * g, -(a * f - c * d), C, -(a * h - b * g), a * e - b * d]
  return inv.map((v) => v / det)
}

/**
 * Homographie qui envoie le carré [0, 8] x [0, 8] (coordonnées en cases,
 * a8 en haut à gauche) sur le quadrilatère du plateau dans la photo.
 */
export function boardToImage(q: Quad): Mat3 {
  return homography(
    [
      { x: 0, y: 0 },
      { x: 8, y: 0 },
      { x: 8, y: 8 },
      { x: 0, y: 8 },
    ],
    q,
  )
}

/** Aire signée (formule du lacet), positive si les points tournent en sens horaire à l'écran. */
export function area(q: Pt[]): number {
  let s = 0
  for (let i = 0; i < q.length; i++) {
    const a = q[i]
    const b = q[(i + 1) % q.length]
    s += a.x * b.y - b.x * a.y
  }
  return s / 2
}

/** Vrai si le quadrilatère est convexe (et non croisé). */
export function isConvex(q: Pt[]): boolean {
  let sign = 0
  for (let i = 0; i < q.length; i++) {
    const a = q[i]
    const b = q[(i + 1) % q.length]
    const c = q[(i + 2) % q.length]
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x)
    if (Math.abs(cross) < 1e-9) return false
    const s = Math.sign(cross)
    if (sign && s !== sign) return false
    sign = s
  }
  return true
}

/** Coins par défaut : un carré centré occupant 80 % du petit côté de l'image. */
export function defaultQuad(width: number, height: number): Quad {
  const s = Math.min(width, height) * 0.8
  const x0 = (width - s) / 2
  const y0 = (height - s) / 2
  return [
    { x: x0, y: y0 },
    { x: x0 + s, y: y0 },
    { x: x0 + s, y: y0 + s },
    { x: x0, y: y0 + s },
  ]
}

/** Fait tourner l'ordre des coins d'un quart de tour (le coin haut-gauche devient le suivant). */
export function rotateQuad(q: Quad, quarterTurns: number): Quad {
  const k = ((quarterTurns % 4) + 4) % 4
  return [0, 1, 2, 3].map((i) => q[(i + k) % 4]) as Quad
}

/** Plus grand écart entre les coins de deux quadrilatères (pour les tests et la stabilité). */
export function quadDistance(a: Quad, b: Quad): number {
  return Math.max(...a.map((p, i) => Math.hypot(p.x - b[i].x, p.y - b[i].y)))
}
