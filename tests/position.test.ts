import { describe, expect, it } from 'vitest'
import {
  START_FEN,
  buildFen,
  enPassantCandidates,
  parseFen,
  placementFromGrid,
  possibleCastling,
  squareIndex,
  squareName,
  validatePosition,
} from '../src/lib/chess/position'

describe('cases', () => {
  it('convertit index et nom de case', () => {
    expect(squareName(0)).toBe('a8')
    expect(squareName(63)).toBe('h1')
    expect(squareIndex('e4')).toBe(36)
    for (let i = 0; i < 64; i++) expect(squareIndex(squareName(i))).toBe(i)
  })
})

describe('FEN', () => {
  it('relit la position de départ à l’identique', () => {
    const { grid, meta } = parseFen(START_FEN)
    expect(buildFen(grid, meta)).toBe(START_FEN)
    expect(placementFromGrid(grid)).toBe('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR')
  })

  it('rejette un FEN mal formé', () => {
    expect(() => parseFen('8/8/8')).toThrow()
    expect(() => parseFen('rnbqkbnrr/8/8/8/8/8/8/8')).toThrow()
  })

  it('retire les droits de roque impossibles', () => {
    const { grid, meta } = parseFen('r3k3/8/8/8/8/8/8/4K2R w KQkq - 0 1')
    expect(possibleCastling(grid)).toEqual({ K: true, Q: false, k: false, q: true })
    expect(buildFen(grid, meta)).toBe('r3k3/8/8/8/8/8/8/4K2R w Kq - 0 1')
  })

  it('ne garde la prise en passant que si elle est possible', () => {
    const { grid } = parseFen('4k3/8/8/3pP3/8/8/8/4K3 w - - 0 1')
    expect(enPassantCandidates(grid, 'w')).toEqual(['d6'])
    const fen = buildFen(grid, { turn: 'w', castling: { K: false, Q: false, k: false, q: false }, enPassant: 'd6' })
    expect(fen.split(' ')[3]).toBe('d6')
    const bad = buildFen(grid, { turn: 'w', castling: { K: false, Q: false, k: false, q: false }, enPassant: 'a6' })
    expect(bad.split(' ')[3]).toBe('-')
  })
})

describe('validation', () => {
  const v = (fen: string) => {
    const { grid, meta } = parseFen(fen)
    return validatePosition(grid, meta)
  }

  it('accepte la position de départ', () => {
    expect(v(START_FEN)).toMatchObject({ ok: true, status: 'normal' })
  })

  it('exige un roi de chaque couleur', () => {
    const r = v('8/8/8/8/8/8/8/4K3 w - - 0 1')
    expect(r.ok).toBe(false)
    expect(r.errors).toContain('Il manque le roi noir.')
  })

  it('refuse un pion sur la dernière rangée', () => {
    expect(v('P3k3/8/8/8/8/8/8/4K3 w - - 0 1').ok).toBe(false)
  })

  it('refuse que le camp sans le trait soit en échec', () => {
    // Le roi noir est en échec par la tour blanche, mais c'est aux blancs de jouer
    const r = v('4k3/8/8/8/8/8/8/4RK2 w - - 0 1')
    expect(r.ok).toBe(false)
    expect(v('4k3/8/8/8/8/8/8/4RK2 b - - 0 1')).toMatchObject({ ok: true, status: 'check' })
  })

  it('reconnaît le mat et le pat', () => {
    expect(v('7k/6Q1/6K1/8/8/8/8/8 b - - 0 1').status).toBe('checkmate')
    expect(v('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1').status).toBe('stalemate')
  })
})

describe('rotation des pièces', () => {
  it('un demi-tour échange a1 et h8, quatre quarts de tour ne changent rien', async () => {
    const { rotateGrid } = await import('../src/lib/chess/position')
    const { grid } = parseFen('7k/8/8/8/8/8/8/K7 w - - 0 1') // roi blanc a1, roi noir h8
    const half = rotateGrid(grid, 2)
    expect(half[squareIndex('h8')]).toBe('K')
    expect(half[squareIndex('a1')]).toBe('k')
    expect(rotateGrid(rotateGrid(grid, 1), 3)).toEqual(grid)
    expect(rotateGrid(grid, 1)[squareIndex('a8')]).toBe('K') // quart de tour horaire : a1 -> a8
  })
})
