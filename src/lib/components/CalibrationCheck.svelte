<!--
  Vérification d'une photo de la position de départ avant de l'ajouter
  aux exemples : chaque vignette est montrée avec l'étiquette qu'elle va
  recevoir. L'orientation est déduite de la photo ; si elle est fausse,
  « Tourner » la corrige. Les vignettes où le modèle actuel n'est pas du
  tout d'accord sont signalées (souvent un plateau mal orienté ou décalé).
-->
<script lang="ts">
  import TileCanvas from './TileCanvas.svelte'
  import PieceIcon from './PieceIcon.svelte'
  import { recognition, START_LABELS } from '../state/recognition.svelte'
  import { settings } from '../state/settings.svelte'
  import { profiles } from '../state/profiles.svelte'
  import { parseFen, START_FEN, squareName } from '../chess/position'
  import { NUM_CLASSES } from '../recognition/classes'
  import { boardToPhoto, TILE_BYTES } from '../vision/tiles'
  import { rgbToCanvas } from '../vision/rgb'

  let { ondone, oncancel }: { ondone: () => void; oncancel: () => void } = $props()

  const start = parseFen(START_FEN).grid
  let saving = $state(false)

  const tiles = $derived.by(() => {
    const t = recognition.tiles
    const p = recognition.probs
    if (!t || !p) return []
    return Array.from({ length: 64 }, (_, b) => {
      const i = boardToPhoto(b, recognition.rotation)
      return {
        b,
        canvas: rgbToCanvas(t.subarray(i * TILE_BYTES, (i + 1) * TILE_BYTES)),
        // Probabilité donnée par le modèle actuel à l'étiquette attendue
        agree: p[i * NUM_CLASSES + START_LABELS[b]],
      }
    })
  })
  const doubtful = $derived(tiles.filter((t) => t.agree < 0.05).length)

  async function add() {
    saving = true
    try {
      await recognition.save(settings.activeProfile, start, [...Array(64).keys()], 'start')
      await profiles.refresh()
      recognition.clear()
      ondone()
    } finally {
      saving = false
    }
  }
</script>

<div class="flex flex-col gap-3">
  <p class="text-sm text-stone-300">
    Vérifiez que chaque case porte la bonne pièce, blancs en bas. Sinon, tournez.
  </p>
  <div class="grid grid-cols-8 gap-0.5 rounded-lg bg-stone-800 p-0.5">
    {#each tiles as t (t.b)}
      <div class="relative" class:ring-2={t.agree < 0.05} class:ring-red-500={t.agree < 0.05}>
        <TileCanvas canvas={t.canvas} class="block aspect-square w-full" label={`Case ${squareName(t.b)}`} />
        {#if start[t.b]}
          <span class="absolute right-0 bottom-0 rounded-tl bg-black/55"><PieceIcon piece={start[t.b]!} class="h-4 w-4" /></span>
        {/if}
      </div>
    {/each}
  </div>
  {#if doubtful > 8}
    <p class="rounded-xl bg-amber-950/60 px-4 py-3 text-sm text-amber-200 ring-1 ring-amber-900">
      Le modèle actuel ne reconnaît pas {doubtful} de ces cases (encadrées en rouge). C'est normal pour un jeu qu'il ne
      connaît pas encore : vérifiez simplement que les pièces blanches sont en bas et que chaque vignette montre bien sa case.
    </p>
  {/if}

  <button class="btn-secondary" onclick={() => recognition.rotate()}>Tourner</button>

  <div class="safe-bottom sticky bottom-0 -mx-4 bg-gradient-to-t from-stone-950 via-stone-950 to-stone-950/0 px-4 pt-4">
    <div class="grid grid-cols-[1fr_2fr] gap-2">
      <button class="btn-secondary h-14! rounded-2xl!" onclick={oncancel}>Annuler</button>
      <button class="btn-primary" disabled={saving} onclick={add}>Ajouter les 64 cases</button>
    </div>
  </div>
</div>
