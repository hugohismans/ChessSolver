// Pilotage de Stockfish (WebAssembly) via le protocole UCI.
//
// Le moteur tourne dans son propre Web Worker : le fichier stockfish.js est
// lui-même un script de worker, il ne bloque donc jamais le thread principal.
// Cette classe sérialise les recherches : lancer une nouvelle analyse arrête
// proprement la précédente (stop puis attente du « bestmove »).

import { parseBestMove, parseInfo, type InfoLine } from './uci'

export interface SearchOptions {
  depth: number
  multiPv: number
}

export interface SearchResult {
  bestMove: string | null // null si aucun coup légal
  lines: InfoLine[] // triées par multipv (1 = meilleure ligne)
  stopped: boolean // true si arrêtée avant la profondeur demandée
}

type Listener = (line: string) => void

export class StockfishEngine {
  private worker: Worker
  private listeners = new Set<Listener>()
  private current: Promise<SearchResult> | null = null
  private stopRequested = false
  /** Résolue quand le moteur a répondu « uciok » puis « readyok ». */
  readonly ready: Promise<void>
  /** Nom annoncé par le moteur (« Stockfish 19 ... »). */
  name = 'Stockfish'

  constructor(url: string) {
    this.worker = new Worker(url)
    this.worker.onmessage = (e: MessageEvent) => {
      const text = typeof e.data === 'string' ? e.data : String(e.data)
      // Le moteur peut envoyer plusieurs lignes dans un même message
      for (const line of text.split('\n')) {
        if (line) this.listeners.forEach((l) => l(line))
      }
    }
    this.ready = new Promise<void>((resolve, reject) => {
      this.worker.onerror = (e) => reject(new Error(e.message || 'Impossible de charger Stockfish'))
      const off = this.on((line) => {
        if (line.startsWith('id name ')) this.name = line.slice(8)
        if (line === 'uciok') {
          this.send('setoption name UCI_AnalyseMode value true')
          this.send('isready')
        }
        if (line === 'readyok') {
          off()
          resolve()
        }
      })
      this.send('uci')
    })
  }

  private send(cmd: string) {
    this.worker.postMessage(cmd)
  }

  private on(l: Listener): () => void {
    this.listeners.add(l)
    return () => this.listeners.delete(l)
  }

  private waitFor(match: (line: string) => boolean): Promise<string> {
    return new Promise((resolve) => {
      const off = this.on((line) => {
        if (match(line)) {
          off()
          resolve(line)
        }
      })
    })
  }

  /**
   * Analyse une position. `onInfo` est appelé à chaque nouvelle information
   * (toutes lignes MultiPV confondues, déjà triées).
   */
  async analyse(
    fen: string,
    opts: SearchOptions,
    onInfo?: (lines: InfoLine[]) => void,
  ): Promise<SearchResult> {
    await this.ready
    // Une seule recherche à la fois : on interrompt la précédente
    if (this.current) {
      this.stop()
      await this.current.catch(() => undefined)
    }
    this.stopRequested = false

    const lines = new Map<number, InfoLine>()
    const run = (async () => {
      this.send(`setoption name MultiPV value ${opts.multiPv}`)
      this.send('isready')
      await this.waitFor((l) => l === 'readyok')
      // Si on a demandé l'arrêt pendant la préparation, on ne lance rien
      if (this.stopRequested) return { bestMove: null, lines: [], stopped: true }

      const off = this.on((line) => {
        const info = parseInfo(line)
        if (!info) return
        // Les scores « bornes » sont provisoires : on garde l'ancien si on en a un
        if (info.bound && lines.has(info.multipv)) return
        // Une ligne de profondeur plus faible ne remplace pas une meilleure
        const prev = lines.get(info.multipv)
        if (prev && prev.depth > info.depth) return
        lines.set(info.multipv, info)
        onInfo?.(sorted(lines))
      })
      this.send(`position fen ${fen}`)
      this.send(`go depth ${opts.depth}`)
      const bm = await this.waitFor((l) => l.startsWith('bestmove'))
      off()
      const result: SearchResult = {
        bestMove: parseBestMove(bm) ?? null,
        lines: sorted(lines),
        stopped: this.stopRequested,
      }
      return result
    })()

    this.current = run
    try {
      return await run
    } finally {
      if (this.current === run) this.current = null
    }
  }

  /** Demande l'arrêt de la recherche en cours (le moteur répond « bestmove »). */
  stop() {
    this.stopRequested = true
    if (this.current) this.send('stop')
  }

  get busy(): boolean {
    return this.current !== null
  }

  terminate() {
    this.send('quit')
    this.worker.terminate()
  }
}

function sorted(lines: Map<number, InfoLine>): InfoLine[] {
  return [...lines.values()].sort((a, b) => a.multipv - b.multipv)
}

/** URL du moteur copié dans public/engine (voir scripts/copy-engine.mjs). */
export function engineUrl(): string {
  return new URL(`${import.meta.env.BASE_URL}engine/stockfish.js`, document.baseURI).href
}

let shared: StockfishEngine | null = null

/** Instance unique, créée à la demande et partagée par toute l'app. */
export function getEngine(): StockfishEngine {
  shared ??= new StockfishEngine(engineUrl())
  return shared
}
