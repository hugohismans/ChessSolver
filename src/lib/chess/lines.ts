// Conversion des variantes UCI (« g1f3 b8c6 ») en notation lisible.

import { Chess } from 'chess.js'
import { sanToFrench } from './names'

export interface UciMove {
  from: string
  to: string
  promotion?: string
}

export function parseUci(uci: string): UciMove {
  return { from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] || undefined }
}

/** Joue la variante depuis le FEN et renvoie les coups en SAN (s'arrête au premier coup illégal). */
export function pvToSan(fen: string, pv: string[], max = 14): string[] {
  const game = new Chess(fen)
  const out: string[] = []
  for (const uci of pv.slice(0, max)) {
    try {
      out.push(game.move(parseUci(uci)).san)
    } catch {
      break
    }
  }
  return out
}

/**
 * Ajoute les numéros de coups : « 12. Cf3 Cc6 13. d4 », ou « 12... Cc6 13. d4 »
 * quand ce sont les noirs qui commencent.
 */
export function numberedLine(fen: string, sans: string[], french: boolean): string {
  const parts = fen.split(/\s+/)
  let turn = parts[1] === 'b' ? 'b' : 'w'
  let n = Number(parts[5]) || 1
  const out: string[] = []
  sans.forEach((san, i) => {
    const s = french ? sanToFrench(san) : san
    if (turn === 'w') out.push(`${n}. ${s}`)
    else out.push(i === 0 ? `${n}... ${s}` : s)
    if (turn === 'b') n++
    turn = turn === 'w' ? 'b' : 'w'
  })
  return out.join(' ')
}
