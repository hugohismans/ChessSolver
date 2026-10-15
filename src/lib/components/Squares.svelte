<!--
  Écran « Cases » (débogage de la phase 2) : plateau redressé, orientation
  (blancs en bas) et découpe en 64 vignettes, celles qui seront données au
  modèle de reconnaissance en phase 3.
-->
<script lang="ts">
  import { onMount } from 'svelte'
  import TileCanvas from './TileCanvas.svelte'
  import { capture } from '../state/capture.svelte'
  import { getVision } from '../vision/client'
  import { canvasFromImageData, extractTiles, rotateSquare } from '../vision/image'

  interface Props {
    onback: () => void
    onnext: () => void
  }
  let { onback, onnext }: Props = $props()

  const MARGIN = 0.5 // demi-case de marge autour du plateau redressé
  const SQ = 96 // pixels par case

  let busy = $state(true)
  let error = $state('')
  let tall = $state(false) // vignettes avec débord vers la case du dessus

  onMount(async () => {
    if (!capture.quad) return
    try {
      const img = await getVision().warp(capture.quad, Math.round((8 + 2 * MARGIN) * SQ), MARGIN)
      capture.board = canvasFromImageData(img)
    } catch (e) {
      error = e instanceof Error ? e.message : 'Redressement impossible'
    } finally {
      busy = false
    }
  })

  const rotated = $derived(capture.board ? rotateSquare(capture.board, capture.rotation) : null)
  const tiles = $derived(rotated ? extractTiles(rotated, { size: SQ, margin: MARGIN, above: tall ? 0.5 : 0 }) : [])

  // Position de la grille dans l'image redressée, en %
  const m = (MARGIN / (8 + 2 * MARGIN)) * 100
  const step = (1 / (8 + 2 * MARGIN)) * 100
</script>

<div class="flex flex-col gap-3">
  {#if busy}
    <div class="flex aspect-square items-center justify-center rounded-xl bg-stone-900 text-stone-400">Redressement du plateau...</div>
  {:else if error}
    <p class="rounded-xl bg-red-950/60 px-4 py-3 text-sm text-red-200 ring-1 ring-red-900">{error}</p>
  {:else if rotated}
    <div class="relative">
      <TileCanvas canvas={rotated} class="block aspect-square w-full rounded-xl" label="Plateau redressé" />
      <!-- Grille et coordonnées par-dessus -->
      <svg class="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        {#each Array(9) as _, i (i)}
          <line x1={m + i * step} y1={m} x2={m + i * step} y2={100 - m} stroke="#2dd4bf" stroke-width="0.25" />
          <line x1={m} y1={m + i * step} x2={100 - m} y2={m + i * step} stroke="#2dd4bf" stroke-width="0.25" />
        {/each}
      </svg>
      <div class="pointer-events-none absolute inset-0 text-[10px] font-bold text-teal-300">
        {#each Array(8) as _, i (i)}
          <span class="absolute" style:left={`${m + (i + 0.45) * step}%`} style:bottom="0.5%">{'abcdefgh'[i]}</span>
          <span class="absolute" style:left="1%" style:top={`${m + (i + 0.35) * step}%`}>{8 - i}</span>
        {/each}
      </div>
    </div>

    <div class="grid grid-cols-[1fr_auto] items-center gap-3 rounded-xl bg-stone-900 p-3 ring-1 ring-white/5">
      <p class="text-sm text-stone-300">Les pièces blanches doivent être en bas (rangées 1 et 2). Sinon, tournez le plateau.</p>
      <button class="btn-secondary px-4" onclick={() => (capture.rotation = (capture.rotation + 1) % 4)}>
        <svg viewBox="0 0 24 24" class="h-5 w-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
          <path d="M20 11a8 8 0 1 0-2.3 5.7" /><path d="M20 4v7h-7" />
        </svg>
        Tourner
      </button>
    </div>

    <section aria-labelledby="cases">
      <div class="mb-1.5 flex items-center justify-between">
        <h3 id="cases" class="section-title mb-0!">Les 64 cases ({SQ}x{SQ} px)</h3>
        <label class="flex items-center gap-2 text-xs text-stone-400">
          <input type="checkbox" class="h-4 w-4 accent-teal-400" bind:checked={tall} /> Débord vers le haut
        </label>
      </div>
      <div class="grid grid-cols-8 gap-0.5 rounded-lg bg-stone-800 p-0.5">
        {#each tiles as t (t.square + tall + capture.rotation)}
          <div class="relative">
            <TileCanvas canvas={t.canvas} class="block aspect-square w-full" label={`Case ${t.square}`} />
            <span class="absolute top-0 left-0.5 text-[9px] font-bold text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.9)]">{t.square}</span>
          </div>
        {/each}
      </div>
    </section>

    <p class="rounded-xl bg-stone-900 px-4 py-3 text-sm text-stone-400 ring-1 ring-white/5">
      La reconnaissance automatique des pièces arrive à l'étape suivante du projet. Pour l'instant, saisissez la position sur
      l'échiquier.
    </p>
  {/if}

  <div class="safe-bottom sticky bottom-0 -mx-4 bg-gradient-to-t from-stone-950 via-stone-950 to-stone-950/0 px-4 pt-4">
    <div class="grid grid-cols-[1fr_2fr] gap-2">
      <button class="btn-secondary h-14! rounded-2xl!" onclick={onback}>Coins</button>
      <button class="btn-primary" disabled={busy} onclick={onnext}>Saisir la position</button>
    </div>
  </div>
</div>
