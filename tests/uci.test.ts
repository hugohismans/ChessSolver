import { describe, expect, it } from 'vitest'
import { describeScore, formatScore, parseBestMove, parseInfo, toWhitePov, whiteWinPercent } from '../src/lib/engine/uci'
import { numberedLine, pvToSan } from '../src/lib/chess/lines'
import { sanToFrench } from '../src/lib/chess/names'

describe('UCI', () => {
  it('lit une ligne info avec MultiPV', () => {
    const l = parseInfo(
      'info depth 18 seldepth 25 multipv 2 score cp -35 nodes 123456 nps 500000 hashfull 10 tbhits 0 time 250 pv e7e5 g1f3 b8c6',
    )
    expect(l).toMatchObject({ depth: 18, multipv: 2, score: { type: 'cp', value: -35 }, pv: ['e7e5', 'g1f3', 'b8c6'], bound: null })
  })

  it('lit un score de mat et les bornes', () => {
    expect(parseInfo('info depth 5 multipv 1 score mate -3 pv a1a2')?.score).toEqual({ type: 'mate', value: -3 })
    expect(parseInfo('info depth 5 score cp 20 lowerbound pv a1a2')?.bound).toBe('lower')
  })

  it('ignore les lignes sans variante', () => {
    expect(parseInfo('info depth 10 currmove e2e4 currmovenumber 1')).toBeNull()
    expect(parseInfo('info string NNUE evaluation using nn.nnue')).toBeNull()
    expect(parseInfo('readyok')).toBeNull()
  })

  it('lit bestmove', () => {
    expect(parseBestMove('bestmove e2e4 ponder e7e5')).toBe('e2e4')
    expect(parseBestMove('bestmove (none)')).toBeNull()
    expect(parseBestMove('info depth 1')).toBeUndefined()
  })

  it('formate les scores du point de vue des blancs', () => {
    expect(toWhitePov({ type: 'cp', value: 50 }, 'b')).toEqual({ type: 'cp', value: -50 })
    expect(formatScore({ type: 'cp', value: 135 })).toBe('+1,35')
    expect(formatScore({ type: 'cp', value: -7 })).toBe('-0,07')
    expect(formatScore({ type: 'mate', value: -2 })).toBe('#-2')
    expect(describeScore({ type: 'mate', value: 3 })).toBe('Mat en 3 pour les blancs')
    expect(whiteWinPercent({ type: 'cp', value: 0 })).toBe(50)
    expect(whiteWinPercent({ type: 'mate', value: 1 })).toBe(100)
  })
})

describe('notation', () => {
  it('convertit une variante UCI en SAN numérotée', () => {
    const fen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
    const sans = pvToSan(fen, ['g1f3', 'g8f6', 'e2e4'])
    expect(sans).toEqual(['Nf3', 'Nf6', 'e4'])
    expect(numberedLine(fen, sans, true)).toBe('1. Cf3 Cf6 2. e4')
    const fenB = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1'
    expect(numberedLine(fenB, ['e5', 'Nf3'], false)).toBe('1... e5 2. Nf3')
  })

  it('traduit les pièces en français', () => {
    expect(sanToFrench('Qxf7#')).toBe('Dxf7#')
    expect(sanToFrench('e8=Q+')).toBe('e8=D+')
    expect(sanToFrench('O-O')).toBe('O-O')
    expect(sanToFrench('Bxb5')).toBe('Fxb5')
  })
})
