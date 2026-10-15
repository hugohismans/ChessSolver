<!--
  Racine de l'application : en-tête, navigation entre les écrans.
  Phase 1 : Position (saisie manuelle) puis Analyse.
-->
<script lang="ts">
  import PieceSprite from './lib/components/PieceSprite.svelte'
  import Editor from './lib/components/Editor.svelte'
  import Analysis from './lib/components/Analysis.svelte'
  import SettingsSheet from './lib/components/SettingsSheet.svelte'
  import { position } from './lib/state/position.svelte'
  import { settings } from './lib/state/settings.svelte'
  import { getEngine } from './lib/engine/stockfish'

  type Screen = { name: 'edit' } | { name: 'analyse'; fen: string; key: number }

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

  function goAnalyse(fen: string) {
    screen = { name: 'analyse', fen, key: ++analyseKey }
    // Le bouton « retour » du téléphone ramène à l'éditeur au lieu de quitter
    history.pushState({ screen: 'analyse' }, '')
    window.scrollTo({ top: 0 })
  }

  function goEdit(fen?: string) {
    if (fen) position.setFen(fen)
    if (history.state?.screen === 'analyse') history.back()
    screen = { name: 'edit' }
    window.scrollTo({ top: 0 })
  }

  function onpopstate() {
    if (screen.name === 'analyse') screen = { name: 'edit' }
  }
</script>

<svelte:window {onpopstate} />

<PieceSprite />

<div class="mx-auto flex min-h-dvh max-w-lg flex-col px-4">
  <header class="safe-top flex h-14 items-center gap-2">
    {#if screen.name === 'analyse'}
      <button class="-ml-2 flex h-12 items-center gap-1 rounded-xl px-2 text-stone-300 active:bg-stone-800" onclick={() => goEdit()}>
        <span class="text-2xl leading-none">‹</span> Position
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
      <Editor onanalyse={goAnalyse} />
    {:else}
      {#key screen.key}
        <Analysis startFen={screen.fen} onedit={goEdit} />
      {/key}
    {/if}
  </main>
</div>

<SettingsSheet open={settingsOpen} onclose={() => (settingsOpen = false)} />
