// Noms français des pièces, pour l'accessibilité et les menus.
import type { PieceChar } from './position'

const NAMES: Record<string, string> = {
  k: 'roi',
  q: 'dame',
  r: 'tour',
  b: 'fou',
  n: 'cavalier',
  p: 'pion',
}

export function pieceName(p: PieceChar): string {
  return `${NAMES[p.toLowerCase()]} ${p === p.toUpperCase() ? 'blanc' : 'noir'}`
}

/**
 * Notation algébrique française : R (roi), D (dame), T (tour), F (fou),
 * C (cavalier). chess.js produit la notation anglaise (K, Q, R, B, N).
 */
export function sanToFrench(san: string): string {
  return san.replace(/[KQRBN]/g, (c) => ({ K: 'R', Q: 'D', R: 'T', B: 'F', N: 'C' })[c] as string)
}
