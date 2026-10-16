<!--
  Écran « Position » : saisie ou correction manuelle de la position, puis
  réglages qui ne se voient pas sur la photo (trait, roques, en passant).
  C'est aussi l'écran de correction obligatoire après la reconnaissance.
-->
<script lang="ts">
  import Board, { type Highlight } from './Board.svelte'
  import PieceIcon from './PieceIcon.svelte'
  import PiecePicker from './PiecePicker.svelte'
  import Sheet from './Sheet.svelte'
  import { position } from '../state/position.svelte'
  import { settings } from '../state/settings.svelte'
  import {
    START_FEN,
    emptyGrid,
    parseFen,
    rotateGrid,
    squareIndex,
    squareName,
    type Cell,
    type PieceChar,
  } from '../chess/position'
  import { pieceName } from '../chess/names'
  import { recognition, MAX_VIEWS } from '../state/recognition.svelte'
  import { profiles } from '../state/profiles.svelte'
  import { createProfile, BASE_PROFILE } from '../recognition/storage'

  interface Props {
    onanalyse: (fen: string) => void
    onphoto: () => void
    /** Calibration : bouton « Ajouter au profil » au lieu d'« Analyser ». */
    calibration?: boolean
    oncalibrated?: () => void
    /** Affiche les vignettes reconnues (débogage). */
    onsquares?: () => void
    /** Photo supplémentaire de la même position, pour fiabiliser la reconnaissance. */
    onaddphoto?: () => void
  }
  let { onanalyse, onphoto, calibration = false, oncalibrated, onsquares, onaddphoto }: Props = $props()

  // ---- Correction d'une photo reconnue ----
  const reviewing = $derived(recognition.active)
  const corrections = $derived(reviewing ? recognition.corrections(position.grid) : [])
  const onBase = $derived(settings.activeProfile === BASE_PROFILE)
  let saving = $state(false)
  let toast = $state('')

  /**
   * Fait pivoter les pièces de `quarterTurns` quarts de tour (horaires).
   * Pendant la vérification d'une photo, la reconnaissance pivote avec la
   * grille : les corrections déjà faites restent valables.
   */
  function rotatePieces(quarterTurns: number) {
    position.grid = rotateGrid(position.grid, quarterTurns)
    if (reviewing) for (let t = 0; t < quarterTurns; t++) recognition.rotate()
    // La prise en passant n'a plus de sens (les roques sont revérifiés seuls)
    position.meta = { ...position.meta, enPassant: null }
    orientOpen = false
  }
  let orientOpen = $state(false)

  const nViews = $derived(recognition.views.length)

  /** Retire la dernière photo, en gardant les corrections faites à la main. */
  function removeLastPhoto() {
    const before = recognition.recognized
    const manual = position.grid.map((c, i) => (c !== before[i] ? i : -1)).filter((i) => i >= 0)
    recognition.removeLast()
    const g = recognition.recognized
    for (const i of manual) g[i] = position.grid[i]
    position.grid = g
  }

  /** Enregistre les corrections dans le profil actif (ou un nouveau). */
  async function saveCorrections(): Promise<void> {
    if (!reviewing || !recognition.saveCorrections || !corrections.length) return
    let id = settings.activeProfile
    if (id === BASE_PROFILE) {
      const p = await createProfile('Mon jeu')
      settings.activeProfile = p.id
      id = p.id
    }
    const n = await recognition.save(id, position.grid, corrections, 'correction')
    await profiles.refresh()
    toast = `${n} correction${n > 1 ? 's' : ''} ajoutée${n > 1 ? 's' : ''} au profil « ${profiles.activeName} ».`
    setTimeout(() => (toast = ''), 4000)
  }

  async function analyse() {
    saving = true
    try {
      await saveCorrections()
    } finally {
      saving = false
    }
    recognition.active = false
    onanalyse(position.validation.fen)
  }

  /** Calibration : les 64 cases vérifiées rejoignent le jeu d'exemples. */
  async function addToProfile() {
    saving = true
    try {
      await recognition.save(settings.activeProfile, position.grid, [...Array(64).keys()], 'position')
      await profiles.refresh()
      recognition.clear()
      oncalibrated?.()
    } finally {
      saving = false
    }
  }

  // Outil actif : null = toucher une case ouvre le menu de choix,
  // une pièce = la poser directement, 'erase' = vider la case
  let tool = $state<PieceChar | 'erase' | null>(null)
  let pickSquare = $state<string | null>(null)
  let fenOpen = $state(false)
  let fenInput = $state('')
  let fenError = $state('')
  let copied = $state(false)

  const WHITE: PieceChar[] = ['K', 'Q', 'R', 'B', 'N', 'P']
  const BLACK: PieceChar[] = ['k', 'q', 'r', 'b', 'n', 'p']

  function setCell(square: string, cell: Cell) {
    const g = [...position.grid]
    g[squareIndex(square)] = cell
    position.grid = g
  }

  function onsquare(square: string) {
    if (tool === null) {
      pickSquare = square
      return
    }
    const current = position.grid[squareIndex(square)]
    if (tool === 'erase') setCell(square, null)
    // Toucher une case qui contient déjà la pièce choisie la retire
    else setCell(square, current === tool ? null : tool)
  }

  function selectTool(t: PieceChar | 'erase' | null) {
    tool = tool === t ? null : t
  }

  function reset() {
    position.setFen(START_FEN)
  }
  function clear() {
    const g = emptyGrid()
    position.grid = g
    position.meta = { ...position.meta, castling: { K: false, Q: false, k: false, q: false }, enPassant: null }
  }
  function flip() {
    position.orientation = position.orientation === 'w' ? 'b' : 'w'
  }

  function openFen() {
    fenInput = ''
    fenError = ''
    copied = false
    fenOpen = true
  }
  async function copyFen() {
    try {
      await navigator.clipboard.writeText(position.validation.fen)
      copied = true
    } catch {
      copied = false
    }
  }
  function loadFen() {
    try {
      parseFen(fenInput)
      position.setFen(fenInput)
      fenOpen = false
    } catch (e) {
      fenError = e instanceof Error ? e.message : 'FEN invalide'
    }
  }

  // Surlignages : cases incertaines (reconnaissance), pions mal placés, roi en échec
  const highlights = $derived.by<Highlight[]>(() => {
    const out: Highlight[] = []
    if (reviewing) {
      const conf = recognition.confidence
      const fixed = new Set(corrections)
      conf.forEach((c, i) => {
        if (c < 0.8 && !fixed.has(i)) out.push({ square: squareName(i), kind: 'uncertain' })
      })
    }
    position.grid.forEach((c, i) => {
      if ((c === 'P' || c === 'p') && (i < 8 || i >= 56)) out.push({ square: squareName(i), kind: 'error' })
    })
    const v = position.validation
    if (v.status === 'check' || v.status === 'checkmate') {
      const k = position.meta.turn === 'w' ? 'K' : 'k'
      const i = position.grid.indexOf(k)
      if (i >= 0) out.push({ square: squareName(i), kind: 'check' })
    }
    return out
  })

  const castlingOptions = [
    { key: 'K', label: 'Blancs O-O' },
    { key: 'Q', label: 'Blancs O-O-O' },
    { key: 'k', label: 'Noirs O-O' },
    { key: 'q', label: 'Noirs O-O-O' },
  ] as const

  function toggleCastling(k: 'K' | 'Q' | 'k' | 'q') {
    position.meta = { ...position.meta, castling: { ...position.meta.castling, [k]: !position.meta.castling[k] } }
  }

  const statusText = $derived.by(() => {
    const v = position.validation
    if (!v.ok) return null
    const side = position.meta.turn === 'w' ? 'blancs' : 'noirs'
    if (v.status === 'checkmate') return `Échec et mat : les ${side} sont mats.`
    if (v.status === 'stalemate') return `Pat : les ${side} n'ont aucun coup légal.`
    if (v.status === 'check') return `Les ${side} sont en échec.`
    return `Position valide, trait aux ${side}.`
  })
</script>

<div class="flex flex-col gap-3">
  {#if reviewing}
    <section class="rounded-2xl bg-teal-950/60 p-3 ring-1 ring-teal-800" aria-labelledby="revue">
      <h2 id="revue" class="text-sm font-semibold text-teal-100">
        {calibration ? 'Calibration : corrigez la position' : 'Position reconnue, à vérifier'}
      </h2>
      <p class="mt-0.5 text-xs text-teal-200/80">
        Profil « {recognition.profileName} »{nViews > 1 ? `, ${nViews} photos combinées` : ''}. Touchez une case pour la
        corriger. Les cases encadrées en jaune sont incertaines.
      </p>
      {#if onaddphoto && !calibration && nViews < MAX_VIEWS}
        <button class="btn-secondary mt-2 h-11! w-full bg-teal-900! text-teal-50!" onclick={onaddphoto}>
          <svg viewBox="0 0 24 24" class="h-5 w-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M3 8a2 2 0 0 1 2-2h2l2-2h6l2 2h2a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><circle cx="12" cy="13" r="4" />
          </svg>
          Ajouter une photo ({nViews}/{MAX_VIEWS})
        </button>
        {#if nViews === 1}
          <p class="mt-1 text-xs text-teal-200/70">
            Une 2e photo, idéalement prise d'un autre côté du plateau, corrige la plupart des erreurs.
          </p>
        {/if}
      {/if}
      <div class="mt-2 grid gap-2 {nViews > 1 ? 'grid-cols-3' : 'grid-cols-2'}">
        <button class="btn-secondary h-10!" onclick={() => (orientOpen = true)}>Orienter</button>
        {#if onsquares}<button class="btn-secondary h-10!" onclick={onsquares}>Voir les cases</button>{/if}
        {#if nViews > 1}
          <button class="btn-secondary h-10!" onclick={removeLastPhoto}>Retirer la photo {nViews}</button>
        {/if}
      </div>
      {#if !calibration}
        <label class="mt-2 flex min-h-11 items-center gap-3 text-sm text-teal-50">
          <input type="checkbox" class="h-5 w-5 shrink-0 accent-teal-400" bind:checked={recognition.saveCorrections} />
          <span>
            {#if onBase}
              Enregistrer mes corrections ({corrections.length}) dans un nouveau profil « Mon jeu »
            {:else}
              Ajouter mes corrections ({corrections.length}) au profil « {profiles.activeName} »
            {/if}
          </span>
        </label>
      {/if}
    </section>
  {/if}

  <Board
    grid={position.grid}
    orientation={position.orientation}
    {highlights}
    coordinates={settings.showCoordinates}
    {onsquare}
    label="Échiquier éditable : touchez une case pour choisir sa pièce"
  />

  <!-- Palette : pièce à poser d'un toucher -->
  <div class="grid grid-cols-7 gap-1.5" role="toolbar" aria-label="Pièces à poser">
    <button
      class="tool text-xs leading-tight"
      class:active={tool === null}
      aria-pressed={tool === null}
      onclick={() => (tool = null)}
    >
      Menu
    </button>
    {#each WHITE as p (p)}
      <button class="tool" class:active={tool === p} aria-pressed={tool === p} aria-label={`Poser ${pieceName(p)}`} onclick={() => selectTool(p)}>
        <PieceIcon piece={p} class="h-full w-full" />
      </button>
    {/each}
    <button class="tool text-xs leading-tight" class:active={tool === 'erase'} aria-pressed={tool === 'erase'} onclick={() => selectTool('erase')}>
      Gomme
    </button>
    {#each BLACK as p (p)}
      <button class="tool" class:active={tool === p} aria-pressed={tool === p} aria-label={`Poser ${pieceName(p)}`} onclick={() => selectTool(p)}>
        <PieceIcon piece={p} class="h-full w-full" />
      </button>
    {/each}
  </div>
  <p class="-mt-1 text-center text-xs text-stone-400">
    {#if tool === null}
      Touchez une case pour choisir sa pièce.
    {:else if tool === 'erase'}
      Touchez les cases à vider.
    {:else}
      Touchez les cases où poser : {pieceName(tool)}.
    {/if}
  </p>

  <div class="grid grid-cols-4 gap-2">
    <button class="btn-secondary" onclick={reset}>Départ</button>
    <button class="btn-secondary" onclick={clear}>Vider</button>
    <button class="btn-secondary" onclick={() => (orientOpen = true)}>Orienter</button>
    <button class="btn-secondary" onclick={openFen}>FEN</button>
  </div>

  <!-- Trait -->
  <section aria-labelledby="trait">
    <h3 id="trait" class="section-title">Trait</h3>
    <div class="grid grid-cols-2 gap-2">
      {#each [['w', 'Aux blancs'], ['b', 'Aux noirs']] as [c, label] (c)}
        <button
          class="seg"
          class:active={position.meta.turn === c}
          aria-pressed={position.meta.turn === c}
          onclick={() => (position.meta = { ...position.meta, turn: c as 'w' | 'b', enPassant: null })}
        >
          <span class="inline-block h-4 w-4 rounded-full ring-2 ring-stone-500 {c === 'w' ? 'bg-white' : 'bg-black'}"></span>
          {label}
        </button>
      {/each}
    </div>
  </section>

  <!-- Roques -->
  <section aria-labelledby="roque">
    <h3 id="roque" class="section-title">Droits de roque</h3>
    <div class="grid grid-cols-2 gap-2">
      {#each castlingOptions as o (o.key)}
        {@const possible = position.possibleCastling[o.key]}
        <button
          class="seg"
          class:active={possible && position.meta.castling[o.key]}
          disabled={!possible}
          aria-pressed={possible && position.meta.castling[o.key]}
          onclick={() => toggleCastling(o.key)}
        >
          {o.label}
        </button>
      {/each}
    </div>
    <p class="mt-1 text-xs text-stone-500">Grisé quand le roi ou la tour n'est plus sur sa case de départ.</p>
  </section>

  <!-- En passant, seulement si une prise est envisageable -->
  {#if position.epCandidates.length}
    <section aria-labelledby="ep">
      <h3 id="ep" class="section-title">Prise en passant possible ?</h3>
      <div class="flex flex-wrap gap-2">
        <button
          class="seg flex-1"
          class:active={!position.meta.enPassant}
          onclick={() => (position.meta = { ...position.meta, enPassant: null })}
        >
          Non
        </button>
        {#each position.epCandidates as sq (sq)}
          <button
            class="seg flex-1"
            class:active={position.meta.enPassant === sq}
            onclick={() => (position.meta = { ...position.meta, enPassant: sq })}
          >
            Sur {sq}
          </button>
        {/each}
      </div>
    </section>
  {/if}

  <!-- État de la position -->
  <div aria-live="polite">
    {#if position.validation.ok}
      <p class="rounded-xl bg-emerald-950/60 px-4 py-3 text-sm text-emerald-200 ring-1 ring-emerald-800">{statusText}</p>
    {:else}
      <div class="rounded-xl bg-red-950/60 px-4 py-3 text-sm text-red-200 ring-1 ring-red-900">
        <p class="font-semibold">Position illégale</p>
        <ul class="mt-1 list-disc pl-5">
          {#each position.validation.errors as err (err)}
            <li>{err}</li>
          {/each}
        </ul>
      </div>
    {/if}
  </div>

  {#if toast}
    <p class="rounded-xl bg-stone-800 px-4 py-3 text-sm text-stone-100" role="status">{toast}</p>
  {/if}

  <!-- Bouton principal, collé en bas pour le pouce -->
  <div class="safe-bottom sticky bottom-0 -mx-4 bg-gradient-to-t from-stone-950 via-stone-950 to-stone-950/0 px-4 pt-4">
    <div class="grid gap-2 {calibration ? 'grid-cols-1' : 'grid-cols-[1fr_2fr]'}">
      {#if !calibration}
      <button class="btn-secondary h-14! rounded-2xl! text-base!" onclick={onphoto}>
        <svg viewBox="0 0 24 24" class="h-6 w-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M3 8a2 2 0 0 1 2-2h2l2-2h6l2 2h2a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><circle cx="12" cy="13" r="4" />
        </svg>
        Photo
      </button>
      {/if}
      {#if calibration}
        <button class="btn-primary" disabled={saving} onclick={addToProfile}>Ajouter au profil</button>
      {:else}
        <button
          class="btn-primary"
          disabled={saving || !position.validation.ok || position.validation.status === 'checkmate' || position.validation.status === 'stalemate'}
          onclick={analyse}
        >
          Analyser
        </button>
      {/if}
    </div>
  </div>
</div>

<Sheet open={pickSquare !== null} title={`Case ${pickSquare ?? ''}`} onclose={() => (pickSquare = null)}>
  {#if pickSquare}
    <PiecePicker
      current={position.grid[squareIndex(pickSquare)]}
      onpick={(c) => {
        if (pickSquare) setCell(pickSquare, c)
        pickSquare = null
      }}
    />
  {/if}
</Sheet>

<Sheet open={orientOpen} title="Orientation" onclose={() => (orientOpen = false)}>
  <div class="flex flex-col gap-2">
    <button class="btn-secondary h-auto! min-h-14 flex-col items-start! px-4! py-2.5 text-left" onclick={() => rotatePieces(2)}>
      <span class="text-base font-semibold">Pivoter les pièces d'un demi-tour</span>
      <span class="font-normal text-stone-400">Le plateau était à l'envers : a1 et h8 échangés, les blancs repassent en bas.</span>
    </button>
    <button class="btn-secondary h-auto! min-h-14 flex-col items-start! px-4! py-2.5 text-left" onclick={() => rotatePieces(1)}>
      <span class="text-base font-semibold">Pivoter les pièces d'un quart de tour</span>
      <span class="font-normal text-stone-400">Photo prise depuis le côté du plateau.</span>
    </button>
    <button
      class="btn-secondary h-auto! min-h-14 flex-col items-start! px-4! py-2.5 text-left"
      onclick={() => {
        flip()
        orientOpen = false
      }}
    >
      <span class="text-base font-semibold">Voir depuis le côté {position.orientation === 'w' ? 'des noirs' : 'des blancs'}</span>
      <span class="font-normal text-stone-400">Change seulement l'affichage, la position ne bouge pas.</span>
    </button>
  </div>
</Sheet>

<Sheet open={fenOpen} title="Position au format FEN" onclose={() => (fenOpen = false)}>
  <p class="mb-1 text-sm text-stone-400">Position actuelle</p>
  <p class="break-all rounded-lg bg-stone-800 p-3 font-mono text-sm select-all">{position.validation.fen}</p>
  <button class="btn-secondary mt-2 w-full" onclick={copyFen}>{copied ? 'Copié' : 'Copier'}</button>
  <label class="mt-4 block text-sm text-stone-400" for="fen-in">Charger un FEN</label>
  <textarea
    id="fen-in"
    class="mt-1 w-full rounded-lg bg-stone-800 p-3 font-mono text-sm outline-none ring-teal-400 focus:ring-2"
    rows="2"
    placeholder="rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"
    bind:value={fenInput}
  ></textarea>
  {#if fenError}<p class="mt-1 text-sm text-red-300">{fenError}</p>{/if}
  <button class="btn-primary mt-2 w-full" disabled={!fenInput.trim()} onclick={loadFen}>Charger</button>
</Sheet>
