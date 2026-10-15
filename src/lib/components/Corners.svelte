<!--
  Écran « Coins » : détection automatique du plateau sur la photo, puis
  vérification et ajustement manuel des 4 coins. Étape toujours montrée :
  un coup d'œil suffit quand la détection a réussi.
-->
<script lang="ts">
  import { onMount } from 'svelte'
  import CornerEditor from './CornerEditor.svelte'
  import { capture } from '../state/capture.svelte'
  import { getVision } from '../vision/client'
  import { defaultQuad, type Quad } from '../vision/geometry'
  import { imageData } from '../vision/image'

  interface Props {
    onvalidate: () => void
    onretake: () => void
  }
  let { onvalidate, onretake }: Props = $props()

  const vision = getVision()
  let busy = $state(false)
  let error = $state('')

  // Dernière photo envoyée au worker (évite de la renvoyer à chaque visite)
  let sentPhoto: HTMLCanvasElement | null = null

  async function ensureSent() {
    const photo = capture.photo
    if (!photo) return
    if (sentPhoto !== photo) {
      await vision.setImage(imageData(photo))
      sentPhoto = photo
    }
  }

  async function detect() {
    const photo = capture.photo
    if (!photo) return
    busy = true
    error = ''
    try {
      await ensureSent()
      const r = await vision.detect()
      capture.detection = r
      capture.quad = r.quad ?? defaultQuad(photo.width, photo.height)
    } catch (e) {
      error = e instanceof Error ? e.message : 'Erreur de détection'
      capture.quad ??= defaultQuad(photo.width, photo.height)
    } finally {
      busy = false
    }
  }

  onMount(() => {
    if (!capture.quad) detect()
  })

  async function validate() {
    busy = true
    try {
      await ensureSent()
      onvalidate()
    } finally {
      busy = false
    }
  }

  const det = $derived(capture.detection)
</script>

<div class="flex flex-col gap-3">
  {#if capture.photo && capture.quad}
    <CornerEditor photo={capture.photo} quad={capture.quad} onchange={(q: Quad) => (capture.quad = q)} />
  {:else if capture.photo}
    <div class="flex aspect-[4/3] items-center justify-center rounded-xl bg-stone-900 text-stone-400">
      Recherche de l'échiquier...
    </div>
  {/if}

  <div aria-live="polite">
    {#if busy && !capture.quad}
      <p class="text-center text-sm text-stone-400">Analyse de la photo...</p>
    {:else if error}
      <p class="rounded-xl bg-red-950/60 px-4 py-3 text-sm text-red-200 ring-1 ring-red-900">{error}</p>
    {:else if det && det.quad}
      <p class="rounded-xl bg-emerald-950/60 px-4 py-3 text-sm text-emerald-200 ring-1 ring-emerald-800">
        Échiquier détecté ({det.corners} coins de cases repérés sur 49).
        Vérifiez que la grille tombe bien sur les cases, sinon déplacez les coins.
      </p>
    {:else if det}
      <p class="rounded-xl bg-amber-950/60 px-4 py-3 text-sm text-amber-200 ring-1 ring-amber-900">
        Échiquier non détecté. Faites glisser les 4 coins sur les coins de la zone de jeu (sans le cadre).
      </p>
    {/if}
  </div>

  <div class="grid grid-cols-2 gap-2">
    <button class="btn-secondary" onclick={onretake}>Reprendre la photo</button>
    <button class="btn-secondary" disabled={busy} onclick={detect}>Détecter à nouveau</button>
  </div>

  <div class="safe-bottom sticky bottom-0 -mx-4 bg-gradient-to-t from-stone-950 via-stone-950 to-stone-950/0 px-4 pt-4">
    <button class="btn-primary w-full" disabled={busy || !capture.quad} onclick={validate}>Valider les coins</button>
  </div>
</div>
