// Représentation d'une position « éditable » et conversion vers / depuis le FEN.
//
// La grille est un tableau de 64 cases dans l'ordre du FEN : index 0 = a8,
// index 7 = h8, index 56 = a1, index 63 = h1. Chaque case contient le
// caractère FEN de la pièce (« P », « n », ...) ou null si elle est vide.
// Ce format sert d'interface commune entre l'éditeur manuel (phase 1) et la
// reconnaissance par photo (phase 3), qui produira directement une grille.

import { Chess, validateFen, type Square } from 'chess.js'

export type PieceChar = 'P' | 'N' | 'B' | 'R' | 'Q' | 'K' | 'p' | 'n' | 'b' | 'r' | 'q' | 'k'
export type Cell = PieceChar | null
export type Grid = Cell[]
export type Color = 'w' | 'b'

export interface Castling {
  K: boolean // petit roque blanc
  Q: boolean // grand roque blanc
  k: boolean // petit roque noir
  q: boolean // grand roque noir
}

/** Réglages qui ne se voient pas sur l'échiquier mais complètent le FEN. */
export interface PositionMeta {
  turn: Color
  castling: Castling
  enPassant: string | null // case cible, ex. « e3 », ou null
}

export const PIECES: PieceChar[] = ['K', 'Q', 'R', 'B', 'N', 'P', 'k', 'q', 'r', 'b', 'n', 'p']

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'

const FILES = 'abcdefgh'

/** Nom de la case (« e4 ») à partir de son index dans la grille. */
export function squareName(index: number): Square {
  const file = index % 8
  const rank = 8 - Math.floor(index / 8)
  return `${FILES[file]}${rank}` as Square
}

/** Index dans la grille à partir du nom de la case. */
export function squareIndex(name: string): number {
  const file = FILES.indexOf(name[0])
  const rank = Number(name[1])
  return (8 - rank) * 8 + file
}

export function isWhite(p: PieceChar): boolean {
  return p === p.toUpperCase()
}

export function emptyGrid(): Grid {
  return Array<Cell>(64).fill(null)
}

/** Partie « placement des pièces » du FEN (premier champ). */
export function placementFromGrid(grid: Grid): string {
  const rows: string[] = []
  for (let r = 0; r < 8; r++) {
    let row = ''
    let empty = 0
    for (let f = 0; f < 8; f++) {
      const cell = grid[r * 8 + f]
      if (cell) {
        if (empty) row += empty
        empty = 0
        row += cell
      } else {
        empty++
      }
    }
    if (empty) row += empty
    rows.push(row)
  }
  return rows.join('/')
}

/** Lit un FEN (même partiel : seul le placement est obligatoire). */
export function parseFen(fen: string): { grid: Grid; meta: PositionMeta } {
  const [placement, turn = 'w', castling = '-', ep = '-'] = fen.trim().split(/\s+/)
  const grid = emptyGrid()
  const rows = placement.split('/')
  if (rows.length !== 8) throw new Error('FEN invalide : il faut 8 rangées')
  rows.forEach((row, r) => {
    let f = 0
    for (const ch of row) {
      if (/[1-8]/.test(ch)) {
        f += Number(ch)
      } else if (/[pnbrqkPNBRQK]/.test(ch)) {
        if (f > 7) throw new Error('FEN invalide : rangée trop longue')
        grid[r * 8 + f] = ch as PieceChar
        f++
      } else {
        throw new Error(`FEN invalide : caractère « ${ch} »`)
      }
    }
    if (f !== 8) throw new Error('FEN invalide : rangée de longueur incorrecte')
  })
  return {
    grid,
    meta: {
      turn: turn === 'b' ? 'b' : 'w',
      castling: {
        K: castling.includes('K'),
        Q: castling.includes('Q'),
        k: castling.includes('k'),
        q: castling.includes('q'),
      },
      enPassant: ep !== '-' ? ep : null,
    },
  }
}

/**
 * Droits de roque structurellement possibles : roi et tour encore sur leurs
 * cases d'origine. Sert à griser les cases à cocher et à nettoyer le FEN.
 */
export function possibleCastling(grid: Grid): Castling {
  const at = (sq: string) => grid[squareIndex(sq)]
  const wk = at('e1') === 'K'
  const bk = at('e8') === 'k'
  return {
    K: wk && at('h1') === 'R',
    Q: wk && at('a1') === 'R',
    k: bk && at('h8') === 'r',
    q: bk && at('a8') === 'r',
  }
}

/**
 * Cases de prise en passant envisageables pour le camp au trait : un pion
 * adverse vient peut-être d'avancer de deux cases (case de départ et case
 * traversée vides) et un de nos pions est à côté pour le prendre.
 */
export function enPassantCandidates(grid: Grid, turn: Color): string[] {
  const out: string[] = []
  // Rangée (index de ligne dans la grille) où se trouve le pion qui a avancé
  const pawnRow = turn === 'w' ? 3 : 4 // 5e rangée pour un pion noir, 4e pour un blanc
  const enemyPawn: PieceChar = turn === 'w' ? 'p' : 'P'
  const ourPawn: PieceChar = turn === 'w' ? 'P' : 'p'
  const dir = turn === 'w' ? -1 : 1 // sens vers la case de départ du pion adverse
  for (let f = 0; f < 8; f++) {
    if (grid[pawnRow * 8 + f] !== enemyPawn) continue
    const passed = (pawnRow + dir) * 8 + f
    const origin = (pawnRow + 2 * dir) * 8 + f
    if (grid[passed] || grid[origin]) continue
    const left = f > 0 && grid[pawnRow * 8 + f - 1] === ourPawn
    const right = f < 7 && grid[pawnRow * 8 + f + 1] === ourPawn
    if (left || right) out.push(squareName(passed))
  }
  return out
}

/** Construit le FEN complet en ne gardant que les droits cohérents. */
export function buildFen(grid: Grid, meta: PositionMeta): string {
  const possible = possibleCastling(grid)
  let castling = ''
  for (const k of ['K', 'Q', 'k', 'q'] as const) {
    if (meta.castling[k] && possible[k]) castling += k
  }
  const ep =
    meta.enPassant && enPassantCandidates(grid, meta.turn).includes(meta.enPassant)
      ? meta.enPassant
      : '-'
  return `${placementFromGrid(grid)} ${meta.turn} ${castling || '-'} ${ep} 0 1`
}

export interface Validation {
  fen: string
  ok: boolean
  errors: string[] // empêchent l'analyse
  status: 'normal' | 'check' | 'checkmate' | 'stalemate' | 'invalid'
}

/**
 * Vérifie qu'une position est légale (au sens « atteignable raisonnablement »).
 * Les messages sont rédigés pour l'utilisateur final.
 */
export function validatePosition(grid: Grid, meta: PositionMeta): Validation {
  const fen = buildFen(grid, meta)
  const errors: string[] = []
  const count = (p: PieceChar) => grid.filter((c) => c === p).length

  if (count('K') !== 1) errors.push(count('K') === 0 ? 'Il manque le roi blanc.' : 'Il y a plusieurs rois blancs.')
  if (count('k') !== 1) errors.push(count('k') === 0 ? 'Il manque le roi noir.' : 'Il y a plusieurs rois noirs.')

  const backRanks = [...grid.slice(0, 8), ...grid.slice(56)]
  if (backRanks.some((c) => c === 'P' || c === 'p')) {
    errors.push('Un pion ne peut pas être sur la première ou la dernière rangée.')
  }
  if (count('P') > 8) errors.push('Plus de 8 pions blancs.')
  if (count('p') > 8) errors.push('Plus de 8 pions noirs.')
  const whites = grid.filter((c) => c && isWhite(c)).length
  const blacks = grid.filter((c) => c && !isWhite(c)).length
  if (whites > 16) errors.push('Plus de 16 pièces blanches.')
  if (blacks > 16) errors.push('Plus de 16 pièces noires.')

  if (errors.length) return { fen, ok: false, errors, status: 'invalid' }

  // Le camp qui n'a pas le trait ne doit pas être en échec (sinon le roi
  // pourrait être capturé). On inverse le trait et on demande à chess.js.
  const other: Color = meta.turn === 'w' ? 'b' : 'w'
  const flipped = `${placementFromGrid(grid)} ${other} - - 0 1`
  try {
    const c = new Chess(flipped, { skipValidation: true })
    if (c.inCheck()) {
      errors.push(
        meta.turn === 'w'
          ? 'Le roi noir est en échec alors que c’est aux blancs de jouer. Vérifiez le trait.'
          : 'Le roi blanc est en échec alors que c’est aux noirs de jouer. Vérifiez le trait.',
      )
    }
  } catch {
    errors.push('Position illisible.')
  }
  if (errors.length) return { fen, ok: false, errors, status: 'invalid' }

  // Dernière barrière : la validation officielle de chess.js
  const v = validateFen(fen)
  if (!v.ok) return { fen, ok: false, errors: [v.error ?? 'FEN invalide.'], status: 'invalid' }

  const game = new Chess(fen)
  const status = game.isCheckmate()
    ? 'checkmate'
    : game.isStalemate()
      ? 'stalemate'
      : game.inCheck()
        ? 'check'
        : 'normal'
  return { fen, ok: true, errors, status }
}

/** Retourne la grille vue de l'autre côté (utile pour l'orientation photo). */
export function rotateGrid(grid: Grid): Grid {
  return [...grid].reverse()
}
