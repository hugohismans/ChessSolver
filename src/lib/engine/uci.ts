// Analyse des lignes texte renvoyées par Stockfish (protocole UCI).
// Fonctions pures, sans dépendance au navigateur, donc testables facilement.

export interface Score {
  type: 'cp' | 'mate'
  value: number // centipawns, ou nombre de coups avant le mat (négatif = on se fait mater)
}

export interface InfoLine {
  depth: number
  multipv: number
  score: Score
  bound: 'lower' | 'upper' | null // score provisoire (fail-high / fail-low)
  pv: string[] // coups au format UCI, ex. « e2e4 », « e7e8q »
  nodes?: number
  nps?: number
}

/**
 * Lit une ligne « info ... » contenant un score et une variante principale.
 * Renvoie null pour les autres lignes (info currmove, info string, etc.).
 */
export function parseInfo(line: string): InfoLine | null {
  if (!line.startsWith('info ')) return null
  const t = line.split(/\s+/)
  let depth = 0
  let multipv = 1
  let score: Score | null = null
  let bound: InfoLine['bound'] = null
  let pv: string[] = []
  let nodes: number | undefined
  let nps: number | undefined
  for (let i = 1; i < t.length; i++) {
    switch (t[i]) {
      case 'depth':
        depth = Number(t[++i])
        break
      case 'multipv':
        multipv = Number(t[++i])
        break
      case 'nodes':
        nodes = Number(t[++i])
        break
      case 'nps':
        nps = Number(t[++i])
        break
      case 'score':
        score = { type: t[i + 1] === 'mate' ? 'mate' : 'cp', value: Number(t[i + 2]) }
        i += 2
        break
      case 'lowerbound':
        bound = 'lower'
        break
      case 'upperbound':
        bound = 'upper'
        break
      case 'pv':
        pv = t.slice(i + 1).filter(Boolean)
        i = t.length
        break
    }
  }
  if (!score || pv.length === 0 || depth === 0) return null
  return { depth, multipv, score, bound, pv, nodes, nps }
}

/** Lit « bestmove e2e4 ponder e7e5 ». Renvoie null si aucun coup (mat / pat). */
export function parseBestMove(line: string): string | null | undefined {
  if (!line.startsWith('bestmove')) return undefined
  const m = line.split(/\s+/)[1]
  return !m || m === '(none)' ? null : m
}

/** Ramène un score exprimé pour le camp au trait au point de vue des blancs. */
export function toWhitePov(score: Score, turn: 'w' | 'b'): Score {
  return turn === 'w' ? score : { type: score.type, value: -score.value }
}

/**
 * Pourcentage de chances de gain des blancs (0 à 100), formule utilisée par
 * lichess. Sert à dimensionner la barre d'évaluation.
 */
export function whiteWinPercent(score: Score): number {
  if (score.type === 'mate') return score.value > 0 ? 100 : score.value < 0 ? 0 : 50
  const cp = Math.max(-1000, Math.min(1000, score.value))
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1)
}

/** Texte court : « +0,35 », « -2,10 », « #3 », « #-2 ». Point de vue des blancs. */
export function formatScore(score: Score): string {
  if (score.type === 'mate') return score.value > 0 ? `#${score.value}` : `#-${Math.abs(score.value)}`
  const v = score.value / 100
  const s = Math.abs(v).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return `${v > 0 ? '+' : v < 0 ? '-' : ''}${s}`
}

/** Texte long pour l'utilisateur, point de vue des blancs. */
export function describeScore(score: Score): string {
  if (score.type === 'mate') {
    if (score.value === 0) return 'Mat sur l’échiquier'
    const who = score.value > 0 ? 'les blancs' : 'les noirs'
    return `Mat en ${Math.abs(score.value)} pour ${who}`
  }
  const cp = score.value
  if (Math.abs(cp) < 30) return 'Position équilibrée'
  const who = cp > 0 ? 'blancs' : 'noirs'
  if (Math.abs(cp) < 100) return `Léger avantage aux ${who}`
  if (Math.abs(cp) < 300) return `Net avantage aux ${who}`
  return `Avantage décisif aux ${who}`
}
