<!--
  Écran « Analyse » : Stockfish calcule la position (MultiPV 3), affiche le
  meilleur coup en flèche, l'évaluation et les 3 meilleures lignes.
  On peut jouer le coup conseillé, ou n'importe quel coup en touchant les
  pièces, pour suivre la partie sans reprendre de photo.
-->
<script lang="ts">
  import { Chess, type Square } from 'chess.js'
  import Board, { type Arrow, type Highlight } from './Board.svelte'
  import EvalBar from './EvalBar.svelte'
  import Sheet from './Sheet.svelte'
  import PieceIcon from './PieceIcon.svelte'
  import { getEngine } from '../engine/stockfish'
  import { describeScore, formatScore, toWhitePov, type InfoLine } from '../engine/uci'
  import { numberedLine, parseUci, pvToSan, type UciMove } from '../chess/lines'
  import { sanToFrench } from '../chess/names'
  import { parseFen, type PieceChar } from '../chess/position'
  import { settings, MULTI_PV } from '../state/settings.svelte'
  import { position } from '../state/position.svelte'

  interface Props {
    startFen: string
    onedit: (fen: string) => void
  }
  let { startFen, onedit }: Props = $props()

  // L'instance chess.js n'est pas réactive : on recopie son FEN dans `fen`
  // après chaque coup, ce qui relance l'analyse.
  // svelte-ignore state_referenced_locally
  const game = new Chess(startFen)
  let fen = $state(game.fen())
  let played = $state<{ san: string; from: string; to: string }[]>([])

  let lines = $state<InfoLine[]>([])
  let status = $state<'loading' | 'thinking' | 'done' | 'stopped' | 'error'>('loading')
  let errorMsg = $state('')
  let restart = $state(0)

  let selected = $state<string | null>(null)
  let promotion = $state<{ from: string; to: string } | null>(null)

  const engine = getEngine()
  const turn = $derived(fen.split(' ')[1] as 'w' | 'b')
  const grid = $derived(parseFen(fen).grid)

  // État de fin de partie (pas d'analyse dans ce cas)
  const gameOver = $derived.by(() => {
    const g = new Chess(fen)
    if (g.isCheckmate()) return `Échec et mat. Les ${turn === 'w' ? 'noirs' : 'blancs'} gagnent.`
    if (g.isStalemate()) return 'Pat : partie nulle.'
    if (g.isInsufficientMaterial()) return 'Matériel insuffisant : partie nulle.'
    if (g.isThreefoldRepetition()) return 'Triple répétition : partie nulle.'
    if (g.isDrawByFiftyMoves()) return 'Règle des 50 coups : partie nulle.'
    return null
  })

  // Relance l'analyse à chaque nouvelle position ou changement de profondeur
  $effect(() => {
    const f = fen
    const depth = settings.depth
    void restart
    lines = []
    if (new Chess(f).moves().length === 0) {
      status = 'done'
      return
    }
    let cancelled = false
    status = 'loading'
    engine.ready.then(
      () => {
        if (!cancelled && status === 'loading') status = 'thinking'
      },
      () => undefined,
    )
    engine
      .analyse(f, { depth, multiPv: MULTI_PV }, (l) => {
        if (!cancelled) lines = l
      })
      .then((res) => {
        if (cancelled) return
        if (res.lines.length) lines = res.lines
        status = res.stopped ? 'stopped' : 'done'
      })
      .catch((e: unknown) => {
        if (cancelled) return
        status = 'error'
        errorMsg = e instanceof Error ? e.message : 'Erreur du moteur'
      })
    return () => {
      cancelled = true
      engine.stop()
    }
  })

  const best = $derived(lines[0])
  const bestScore = $derived(best ? toWhitePov(best.score, turn) : null)
  const depthReached = $derived(best?.depth ?? 0)

  // Lignes prêtes à afficher (SAN, numéros de coups, score côté blancs)
  const shownLines = $derived(
    lines.map((l) => ({
      multipv: l.multipv,
      score: toWhitePov(l.score, turn),
      text: numberedLine(fen, pvToSan(fen, l.pv, 12), settings.frenchNotation),
    })),
  )

  const bestSan = $derived.by(() => {
    if (!best) return null
    const san = pvToSan(fen, best.pv, 1)[0]
    return san ? (settings.frenchNotation ? sanToFrench(san) : san) : null
  })
  const bestPiece = $derived.by<PieceChar | null>(() => {
    if (!best) return null
    const p = new Chess(fen).get(best.pv[0].slice(0, 2) as Square)
    if (!p) return null
    return (p.color === 'w' ? p.type.toUpperCase() : p.type) as PieceChar
  })

  const ARROW_STYLES = [
    { color: '#22c55e', width: 1, opacity: 0.9 },
    { color: '#38bdf8', width: 0.72, opacity: 0.6 },
    { color: '#c084fc', width: 0.6, opacity: 0.5 },
  ]
  const arrows = $derived.by<Arrow[]>(() => {
    const list = settings.showAllArrows ? lines : lines.slice(0, 1)
    // On dessine la meilleure en dernier pour qu'elle soit au-dessus
    return list
      .map((l, i) => {
        const m = parseUci(l.pv[0])
        return { from: m.from, to: m.to, ...ARROW_STYLES[i] }
      })
      .reverse()
  })

  const highlights = $derived.by<Highlight[]>(() => {
    const out: Highlight[] = []
    const last = played.at(-1)
    if (last) out.push({ square: last.from, kind: 'last' }, { square: last.to, kind: 'last' })
    const g = new Chess(fen)
    if (g.inCheck()) {
      const k = g.findPiece({ type: 'k', color: g.turn() })[0]
      if (k) out.push({ square: k, kind: 'check' })
    }
    if (selected) {
      out.push({ square: selected, kind: 'selected' })
      for (const m of g.moves({ square: selected as Square, verbose: true })) {
        out.push({ square: m.to, kind: m.captured ? 'capture' : 'target' })
      }
    }
    return out
  })

  function play(m: UciMove) {
    try {
      const mv = game.move(m)
      played = [...played, { san: mv.san, from: mv.from, to: mv.to }]
      fen = game.fen()
    } catch {
      // coup illégal : on ignore
    }
    selected = null
  }

  function onsquare(sq: string) {
    if (gameOver) return
    if (selected) {
      const moves = game.moves({ square: selected as Square, verbose: true }).filter((m) => m.to === sq)
      if (moves.length) {
        if (moves.some((m) => m.promotion)) promotion = { from: selected, to: sq }
        else play({ from: selected, to: sq })
        selected = null
        return
      }
    }
    const p = game.get(sq as Square)
    selected = p && p.color === game.turn() && sq !== selected ? sq : null
  }

  function playBest() {
    if (best) play(parseUci(best.pv[0]))
  }

  function undo() {
    if (!played.length) return
    game.undo()
    played = played.slice(0, -1)
    fen = game.fen()
    selected = null
  }

  function flip() {
    position.orientation = position.orientation === 'w' ? 'b' : 'w'
  }

  const thinking = $derived(status === 'thinking' || status === 'loading')
  const promoPieces = $derived((turn === 'w' ? ['Q', 'R', 'B', 'N'] : ['q', 'r', 'b', 'n']) as PieceChar[])
</script>

<div class="flex flex-col gap-3">
  <EvalBar score={bestScore} />

  <Board
    {grid}
    orientation={position.orientation}
    {arrows}
    {highlights}
    coordinates={settings.showCoordinates}
    {onsquare}
    label="Échiquier d'analyse : touchez une pièce puis sa case d'arrivée pour jouer"
  />

  <!-- Meilleur coup -->
  <section class="rounded-2xl bg-stone-900 p-4 ring-1 ring-white/5" aria-live="polite">
    {#if gameOver}
      <p class="text-lg font-semibold">{gameOver}</p>
    {:else if status === 'error'}
      <p class="font-semibold text-red-300">Le moteur n'a pas pu démarrer.</p>
      <p class="mt-1 text-sm text-stone-400">{errorMsg}</p>
    {:else}
      <div class="flex items-center gap-3">
        <div class="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl bg-green-900/50 ring-1 ring-green-700">
          {#if bestPiece}<PieceIcon piece={bestPiece} class="h-14 w-14" />{/if}
        </div>
        <div class="min-w-0 flex-1">
          <p class="text-xs font-semibold tracking-wide text-stone-400 uppercase">Meilleur coup</p>
          <p class="truncate text-3xl font-bold tabular-nums">{bestSan ?? '...'}</p>
        </div>
        {#if bestScore}
          <div class="text-right">
            <p class="text-2xl font-bold tabular-nums">{formatScore(bestScore)}</p>
          </div>
        {/if}
      </div>
      <div class="mt-2 flex items-center justify-between gap-2 text-sm text-stone-400">
        <span>{bestScore ? describeScore(bestScore) : status === 'loading' ? 'Chargement du moteur...' : 'Calcul en cours...'}</span>
        <span class="flex shrink-0 items-center gap-1.5 tabular-nums">
          {#if thinking}<span class="h-2 w-2 animate-pulse rounded-full bg-teal-400"></span>{/if}
          Prof. {depthReached}/{settings.depth}
        </span>
      </div>
      <div class="mt-2 h-1 overflow-hidden rounded-full bg-stone-800">
        <div class="h-full bg-teal-500 transition-all" style:width={`${Math.min(100, (depthReached / settings.depth) * 100)}%`}></div>
      </div>
    {/if}
  </section>

  <!-- Les 3 meilleures lignes -->
  {#if shownLines.length}
    <section aria-labelledby="lignes">
      <h3 id="lignes" class="section-title">Meilleures lignes</h3>
      <ol class="flex flex-col gap-1.5">
        {#each shownLines as l, i (l.multipv)}
          <li class="flex items-start gap-3 rounded-xl bg-stone-900 px-3 py-2.5 ring-1 ring-white/5">
            <span
              class="mt-0.5 w-16 shrink-0 rounded-md px-1.5 py-0.5 text-center text-sm font-bold tabular-nums"
              class:bg-stone-100={l.score.type === 'cp' ? l.score.value >= 0 : l.score.value > 0}
              class:text-stone-900={l.score.type === 'cp' ? l.score.value >= 0 : l.score.value > 0}
              class:bg-stone-700={l.score.type === 'cp' ? l.score.value < 0 : l.score.value <= 0}
              style:box-shadow={`inset 3px 0 0 ${ARROW_STYLES[i]?.color ?? 'transparent'}`}
            >
              {formatScore(l.score)}
            </span>
            <span class="line-clamp-2 text-sm leading-snug text-stone-200">{l.text}</span>
          </li>
        {/each}
      </ol>
    </section>
  {/if}

  <!-- Coups joués depuis l'écran d'analyse -->
  {#if played.length}
    <section aria-labelledby="joues">
      <h3 id="joues" class="section-title">Coups joués</h3>
      <p class="text-sm text-stone-300">
        {numberedLine(startFen, played.map((p) => p.san), settings.frenchNotation)}
      </p>
    </section>
  {/if}

  <div class="grid grid-cols-2 gap-2">
    <button class="btn-secondary" onclick={() => onedit(fen)}>Modifier la position</button>
    <button class="btn-secondary" onclick={flip}>Retourner</button>
  </div>

  <!-- Actions principales en bas, à portée de pouce -->
  <div class="safe-bottom sticky bottom-0 -mx-4 bg-gradient-to-t from-stone-950 via-stone-950 to-stone-950/0 px-4 pt-4">
    <div class="grid grid-cols-[1fr_2fr_1fr] gap-2">
      <button class="btn-secondary h-14! rounded-2xl!" disabled={!played.length} onclick={undo} aria-label="Annuler le dernier coup">
        Annuler
      </button>
      <button class="btn-primary" disabled={!best || !!gameOver} onclick={playBest}>Jouer le coup</button>
      {#if thinking}
        <button class="btn-secondary h-14! rounded-2xl! text-red-300!" onclick={() => engine.stop()}>Stop</button>
      {:else}
        <button class="btn-secondary h-14! rounded-2xl!" disabled={!!gameOver} onclick={() => restart++}>Relancer</button>
      {/if}
    </div>
  </div>
</div>

<Sheet open={promotion !== null} title="Promotion" onclose={() => (promotion = null)}>
  <div class="grid grid-cols-4 gap-2">
    {#each promoPieces as p (p)}
      <button
        class="flex aspect-square items-center justify-center rounded-xl bg-stone-800 active:bg-stone-700"
        onclick={() => {
          if (promotion) play({ ...promotion, promotion: p.toLowerCase() })
          promotion = null
        }}
      >
        <PieceIcon piece={p} class="h-full w-full p-1" />
      </button>
    {/each}
  </div>
</Sheet>
