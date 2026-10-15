<!-- Réglages généraux : profondeur d'analyse, affichage, notation. -->
<script lang="ts">
  import Sheet from './Sheet.svelte'
  import { settings, DEPTH_MIN, DEPTH_MAX } from '../state/settings.svelte'
  import { getEngine } from '../engine/stockfish'

  let { open, onclose }: { open: boolean; onclose: () => void } = $props()

  let engineName = $state('Stockfish')
  $effect(() => {
    if (open) getEngine().ready.then(() => (engineName = getEngine().name), () => undefined)
  })

  function step(d: number) {
    settings.depth = Math.min(DEPTH_MAX, Math.max(DEPTH_MIN, settings.depth + d))
  }
</script>

<Sheet {open} title="Réglages" {onclose}>
  <section class="mb-5">
    <h3 class="section-title">Profondeur d'analyse</h3>
    <div class="flex items-center gap-3">
      <button class="btn-secondary w-12 text-xl" aria-label="Diminuer la profondeur" onclick={() => step(-1)}>−</button>
      <input
        type="range"
        class="flex-1 accent-teal-400"
        min={DEPTH_MIN}
        max={DEPTH_MAX}
        bind:value={settings.depth}
        aria-label="Profondeur"
      />
      <button class="btn-secondary w-12 text-xl" aria-label="Augmenter la profondeur" onclick={() => step(1)}>+</button>
      <span class="w-8 text-right text-xl font-bold tabular-nums">{settings.depth}</span>
    </div>
    <p class="mt-1 text-xs text-stone-500">Plus c'est profond, plus c'est précis, mais plus c'est long. Par défaut : 18.</p>
  </section>

  <section class="mb-5 flex flex-col gap-2">
    <h3 class="section-title">Affichage</h3>
    <label class="toggle">
      <span>Flèches pour les 3 meilleures lignes</span>
      <input type="checkbox" bind:checked={settings.showAllArrows} />
    </label>
    <label class="toggle">
      <span>Coordonnées sur l'échiquier</span>
      <input type="checkbox" bind:checked={settings.showCoordinates} />
    </label>
    <label class="toggle">
      <span>Notation française (C, F, T, D, R)</span>
      <input type="checkbox" bind:checked={settings.frenchNotation} />
    </label>
  </section>

  <section class="mb-2 text-sm text-stone-400">
    <h3 class="section-title">Confidentialité</h3>
    <p>Tout est calculé sur votre appareil : aucune image ni position n'est envoyée à un serveur.</p>
    <p class="mt-2 text-xs text-stone-500">Moteur : {engineName} (WebAssembly, GPL v3). Pièces : Cburnett, CC BY-SA 3.0.</p>
  </section>
</Sheet>

<style>
  .toggle {
    display: flex;
    min-height: 3rem;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    border-radius: 0.75rem;
    background: var(--color-stone-800);
    padding: 0 1rem;
    font-size: 0.875rem;
  }
  .toggle input {
    width: 1.5rem;
    height: 1.5rem;
    accent-color: var(--color-teal-400);
  }
</style>
