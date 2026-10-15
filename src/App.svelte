<!--
  Racine de l'application : en-tête et navigation entre les écrans.
  Flux photo : Photo -> Coins -> Cases -> Position (correction) -> Analyse.
  Chaque écran empile une entrée d'historique : le bouton « retour » du
  téléphone revient à l'écran précédent au lieu de quitter l'app.
-->
<script lang="ts">
  import PieceSprite from './lib/components/PieceSprite.svelte'
  import Editor from './lib/components/Editor.svelte'
  import Analysis from './lib/components/Analysis.svelte'
  import Camera from './lib/components/Camera.svelte'
  import Corners from './lib/components/Corners.svelte'
  import Squares from './lib/components/Squares.svelte'
  import SettingsSheet from './lib/components/SettingsSheet.svelte'
  import { position } from './lib/state/position.svelte'
  import { settings } from './lib/state/settings.svelte'
  import { capture } from './lib/state/capture.svelte'
  import { getEngine } from './lib/engine/stockfish'

  type Screen =
    | { name: 'edit' }
    | { name: 'analyse'; fen: string; key: number }
    | { name: 'camera' }
    | { name: 'corners' }
    | { name: 'squares' }

  const TITLES: Record<Screen['name'], string> = {
    edit: 'Position',
    analyse: 'Analyse',
    camera: 'Photo',
    corners: 'Coins du plateau',
    squares: 'Cases',
  }

  let screen = $state<Screen>({ name: 'edit' })
  let settingsOpen = $state(false)
  let analyseKey = 0

  // Chargement anticipé du moteur : il est prêt quand on lance l'analyse
  $effect(() => {
    getEngine()
  })

  // Mémorisation locale des réglages et de la position
  $effect(() => settings.persist())
  $effect(() => position.persist())

  /** Va vers un écran en ajoutant une entrée d'historique. */
  function go(next: Screen) {
    screen = next
    history.pushState({ screen: $state.snapshot(next), depth: depth() + 1 }, '')
    window.scrollTo({ top: 0 })
  }

  /** Remplace l'écran courant sans ajouter d'entrée d'historique. */
  function replace(next: Screen) {
    screen = next
    history.replaceState({ screen: $state.snapshot(next), depth: depth() }, '')
  }

  /** Profondeur de l'écran courant dans la pile (0 = éditeur). */
  function depth(): number {
    return history.state?.depth ?? 0
  }

  /** Revient à l'éditeur en dépilant tous les écrans. */
  function home() {
    const d = depth()
    screen = { name: 'edit' }
    if (d > 0) history.go(-d)
    window.scrollTo({ top: 0 })
  }

  function onpopstate(e: PopStateEvent) {
    const s = e.state?.screen as Screen | undefined
    // Écrans photo sans photo en mémoire (page rechargée) : retour à l'éditeur
    if (!s || ((s.name === 'corners' || s.name === 'squares') && !capture.photo)) screen = { name: 'edit' }
    else if (s.name === 'analyse') screen = { ...s, key: ++analyseKey }
    else screen = s
    window.scrollTo({ top: 0 })
  }

  function goAnalyse(fen: string) {
    go({ name: 'analyse', fen, key: ++analyseKey })
  }

  function backToEditor(fen?: string) {
    if (fen) position.setFen(fen)
    history.back()
  }

  function onphoto(photo: HTMLCanvasElement) {
    capture.reset()
    capture.photo = photo
    // La photo remplace l'écran caméra dans l'historique
    replace({ name: 'corners' })
  }

  function retake() {
    capture.reset()
    replace({ name: 'camera' })
  }

  function squaresDone() {
    // Phase 2 : pas encore de reconnaissance, on passe à la saisie
    home()
  }
</script>

<svelte:window {onpopstate} />

<PieceSprite />

<div class="mx-auto flex min-h-dvh max-w-lg flex-col px-4">
  <header class="safe-top flex h-14 items-center gap-2">
    {#if screen.name !== 'edit'}
      <button
        class="-ml-2 flex h-12 items-center gap-1 rounded-xl pr-3 pl-2 text-stone-300 active:bg-stone-800"
        aria-label="Retour"
        onclick={() => history.back()}
      >
        <span class="text-2xl leading-none">‹</span>
        <span class="font-semibold text-stone-100">{TITLES[screen.name]}</span>
      </button>
    {:else}
      <h1 class="text-xl font-bold tracking-tight">Chess<span class="text-teal-400">Cam</span></h1>
    {/if}
    <span class="flex-1"></span>
    <button
      class="-mr-2 flex h-12 w-12 items-center justify-center rounded-xl text-stone-300 active:bg-stone-800"
      aria-label="Réglages"
      onclick={() => (settingsOpen = true)}
    >
      <svg viewBox="0 0 24 24" class="h-6 w-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </svg>
    </button>
  </header>

  <main class="flex-1">
    {#if screen.name === 'edit'}
      <Editor onanalyse={goAnalyse} onphoto={() => go({ name: 'camera' })} />
    {:else if screen.name === 'analyse'}
      {#key screen.key}
        <Analysis startFen={screen.fen} onedit={backToEditor} />
      {/key}
    {:else if screen.name === 'camera'}
      <Camera {onphoto} />
    {:else if screen.name === 'corners'}
      <Corners onvalidate={() => go({ name: 'squares' })} onretake={retake} />
    {:else if screen.name === 'squares'}
      <Squares onback={() => history.back()} onnext={squaresDone} />
    {/if}
  </main>
</div>

<SettingsSheet open={settingsOpen} onclose={() => (settingsOpen = false)} />
