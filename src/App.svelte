<!--
  Racine de l'application : en-tête et navigation entre les écrans.
  Flux photo : Photo -> Coins -> reconnaissance -> Position (correction) -> Analyse.
  Calibration : Calibrer -> Photo -> Coins -> Vérifier (départ) ou Corriger (position).
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
  import Calibration from './lib/components/Calibration.svelte'
  import CalibrationCheck from './lib/components/CalibrationCheck.svelte'
  import { recognition } from './lib/state/recognition.svelte'
  import { profiles } from './lib/state/profiles.svelte'
  import { recognizeCapture } from './lib/recognition/run'
  import { getMl } from './lib/recognition/client'
  import type { CapturePurpose } from './lib/state/capture.svelte'
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
    | { name: 'calibrate' }
    | { name: 'calib-check' }
    | { name: 'correct' }

  const TITLES: Record<Screen['name'], string> = {
    edit: 'Position',
    analyse: 'Analyse',
    camera: 'Photo',
    corners: 'Coins du plateau',
    squares: 'Cases reconnues',
    calibrate: 'Calibrer mon jeu',
    'calib-check': 'Vérifier la photo',
    correct: 'Corriger la position',
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
  $effect(() => {
    // Pendant une calibration, la grille sert à corriger la photo : on ne
    // remplace pas la position mémorisée de l'utilisateur
    if (screen.name !== 'correct') position.persist()
  })
  $effect(() => {
    profiles.refresh()
  })

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

  /** Revient à la profondeur `d` de la pile d'écrans. */
  function popTo(d: number) {
    const delta = d - depth()
    if (delta < 0) history.go(delta)
  }

  function onpopstate(e: PopStateEvent) {
    const s = e.state?.screen as Screen | undefined
    leaveCorrection(s?.name)
    // Écrans photo sans photo en mémoire (page rechargée) : retour à l'éditeur
    const needsPhoto = s && ['corners', 'squares', 'calib-check', 'correct'].includes(s.name)
    if (!s || (needsPhoto && !capture.photo)) screen = { name: 'edit' }
    else if (s.name === 'analyse') screen = { ...s, key: ++analyseKey }
    else screen = s
    window.scrollTo({ top: 0 })
  }

  // Position de l'utilisateur mise de côté pendant une correction de calibration
  let stashedFen: string | null = null
  function leaveCorrection(next?: string) {
    if (screen.name === 'correct' && next !== 'squares' && stashedFen) {
      position.setFen(stashedFen)
      stashedFen = null
      recognition.clear()
    }
    if (screen.name === 'calib-check' && next !== 'calib-check') recognition.clear()
  }

  function openCamera(purpose: CapturePurpose) {
    capture.purpose = purpose
    // Préchargement du modèle de reconnaissance pendant la prise de vue
    getMl()
    go({ name: 'camera' })
  }

  /** Coins validés : reconnaissance des pièces, puis écran selon le but. */
  async function cornersValidated() {
    const purpose = capture.purpose
    await recognizeCapture(purpose === 'play' ? 'normal' : 'calibration', purpose === 'calib-start')
    if (purpose === 'calib-start') {
      go({ name: 'calib-check' })
    } else if (purpose === 'calib-position') {
      stashedFen = position.validation.fen
      position.grid = recognition.recognized
      go({ name: 'correct' })
    } else {
      position.grid = recognition.recognized
      position.meta = { turn: 'w', castling: { K: true, Q: true, k: true, q: true }, enPassant: null }
      recognition.saveCorrections = true
      home()
    }
  }

  /** Fin d'une étape de calibration : retour à l'écran Calibrer. */
  function calibrationStepDone() {
    leaveCorrection()
    popTo(1)
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
    {#if screen.name === 'edit'}
      <button
        class="flex h-12 items-center gap-1.5 rounded-xl px-3 text-sm text-stone-300 active:bg-stone-800"
        onclick={() => go({ name: 'calibrate' })}
      >
        <svg viewBox="0 0 24 24" class="h-5 w-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M9 21h6M10 17h4l1-6 2-2-2-4h-6l-2 4 2 2z" />
        </svg>
        <span class="max-w-28 truncate">{profiles.activeName}</span>
      </button>
    {/if}
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
      <Editor onanalyse={goAnalyse} onphoto={() => openCamera('play')} onsquares={() => go({ name: 'squares' })} />
    {:else if screen.name === 'analyse'}
      {#key screen.key}
        <Analysis startFen={screen.fen} onedit={backToEditor} />
      {/key}
    {:else if screen.name === 'camera'}
      <Camera {onphoto} />
    {:else if screen.name === 'corners'}
      <Corners onvalidate={cornersValidated} onretake={retake} />
    {:else if screen.name === 'squares'}
      <Squares onback={() => history.back()} />
    {:else if screen.name === 'calibrate'}
      <Calibration onstartphoto={() => openCamera('calib-start')} onpositionphoto={() => openCamera('calib-position')} />
    {:else if screen.name === 'calib-check'}
      <CalibrationCheck ondone={calibrationStepDone} oncancel={calibrationStepDone} />
    {:else if screen.name === 'correct'}
      <Editor
        calibration
        onanalyse={() => undefined}
        onphoto={() => undefined}
        oncalibrated={calibrationStepDone}
        onsquares={() => go({ name: 'squares' })}
      />
    {/if}
  </main>
</div>

<SettingsSheet open={settingsOpen} onclose={() => (settingsOpen = false)} />
