<!--
  Écran « Cases » (débogage) : plateau redressé et les 64 vignettes
  réellement données au modèle, avec la pièce reconnue et la confiance.
  Les vignettes incluent le haut de la case du dessus, dans le sens de la
  photo, car les pièces debout débordent vers le haut.
-->
<script lang="ts">
  import { onMount } from 'svelte'
  import TileCanvas from './TileCanvas.svelte'
  import PieceIcon from './PieceIcon.svelte'
  import { capture } from '../state/capture.svelte'
  import { recognition } from '../state/recognition.svelte'
  import { getVision } from '../vision/client'
  import { canvasFromImageData, rotateSquare } from '../vision/image'
  import { rgbToCanvas } from '../vision/rgb'
  import { TILE_BYTES } from '../vision/tiles'
  import { classToCell, NUM_CLASSES } from '../recognition/classes'
  import { boardToPhoto } from '../vision/tiles'
  import { squareName } from '../chess/position'

  let { onback }: { onback: () => void } = $props()

  const MARGIN = 0.5 // demi-case de marge autour du plateau redressé
  const SQ = 64 // pixels par case pour l'aperçu

  let busy = $state(true)
  let error = $state('')

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

  const rotated = $derived(capture.board ? rotateSquare(capture.board, recognition.rotation) : null)

  // Vignettes du modèle, rangées dans l'ordre de l'échiquier (a8 en haut à gauche)
  const tiles = $derived.by(() => {
    const t = recognition.tiles
    const p = recognition.probs
    if (!t || !p) return []
    return Array.from({ length: 64 }, (_, b) => {
      const i = boardToPhoto(b, recognition.rotation)
      const probs = p.subarray(i * NUM_CLASSES, (i + 1) * NUM_CLASSES)
      let k = 0
      for (let j = 1; j < NUM_CLASSES; j++) if (probs[j] > probs[k]) k = j
      return { b, canvas: rgbToCanvas(t.subarray(i * TILE_BYTES, (i + 1) * TILE_BYTES)), cell: classToCell(k), conf: probs[k] }
    })
  })

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
  {/if}

  {#if tiles.length}
    <section aria-labelledby="cases">
      <h3 id="cases" class="section-title">Vignettes vues par le modèle</h3>
      <div class="grid grid-cols-8 gap-0.5 rounded-lg bg-stone-800 p-0.5">
        {#each tiles as t (t.b)}
          <div class="relative" class:ring-2={t.conf < 0.8} class:ring-yellow-400={t.conf < 0.8}>
            <TileCanvas canvas={t.canvas} class="block aspect-square w-full" label={`Case ${squareName(t.b)}`} />
            <span class="absolute top-0 left-0.5 text-[9px] font-bold text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.9)]">{squareName(t.b)}</span>
            {#if t.cell}
              <span class="absolute right-0 bottom-0 rounded-tl bg-black/55"><PieceIcon piece={t.cell} class="h-4 w-4" /></span>
            {/if}
            <span class="absolute bottom-0 left-0.5 text-[8px] font-bold text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.9)]">{Math.round(t.conf * 100)}</span>
          </div>
        {/each}
      </div>
      <p class="mt-1 text-xs text-stone-500">Nombre : confiance en %. Encadré jaune : moins de 80 %.</p>
    </section>
  {/if}

  <div class="safe-bottom sticky bottom-0 -mx-4 bg-gradient-to-t from-stone-950 via-stone-950 to-stone-950/0 px-4 pt-4">
    <button class="btn-primary w-full" onclick={onback}>Retour à la position</button>
  </div>
</div>
