<!--
  Écran « Photo » : aperçu de la caméra arrière avec repérage du plateau en
  direct, déclencheur, ou import depuis la galerie.
  Les images ne quittent jamais l'appareil.
-->
<script lang="ts">
  import { onDestroy, onMount } from 'svelte'
  import { getVision } from '../vision/client'
  import { canvasFromFile, toCanvas } from '../vision/image'
  import type { Quad } from '../vision/geometry'

  interface Props {
    onphoto: (photo: HTMLCanvasElement) => void
  }
  let { onphoto }: Props = $props()

  let video = $state<HTMLVideoElement>()
  let fileInput = $state<HTMLInputElement>()
  let stream: MediaStream | null = null
  let error = $state('')
  let starting = $state(true)
  let videoSize = $state({ w: 0, h: 0 })

  // Chargement d'OpenCV (une seule fois par session, puis en cache)
  const vision = getVision()
  let cvProgress = $state(0)
  let cvReady = $state(false)
  let cvError = $state('')

  // Repérage en direct
  let liveQuad = $state<Quad | null>(null)
  let liveConf = $state(0)
  let stopped = false

  onMount(() => {
    vision.onprogress = (p) => (cvProgress = p)
    vision.ready.then(
      () => {
        cvReady = true
        liveLoop()
      },
      (e: Error) => (cvError = e.message),
    )
    startCamera()
  })

  onDestroy(() => {
    stopped = true
    vision.onprogress = null
    stream?.getTracks().forEach((t) => t.stop())
  })

  async function startCamera() {
    starting = true
    error = ''
    if (!navigator.mediaDevices?.getUserMedia) {
      error = 'La caméra n’est pas accessible dans ce navigateur. Importez une photo depuis la galerie.'
      starting = false
      return
    }
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1440 } },
      })
      if (stopped) {
        stream.getTracks().forEach((t) => t.stop())
        return
      }
      if (video) {
        video.srcObject = stream
        await video.play()
        videoSize = { w: video.videoWidth, h: video.videoHeight }
      }
    } catch (e) {
      const name = e instanceof DOMException ? e.name : ''
      error =
        name === 'NotAllowedError'
          ? 'Accès à la caméra refusé. Autorisez-le dans les réglages du navigateur, ou importez une photo.'
          : name === 'NotFoundError'
            ? 'Aucune caméra trouvée. Importez une photo depuis la galerie.'
            : 'Impossible de démarrer la caméra. Importez une photo depuis la galerie.'
    } finally {
      starting = false
    }
  }

  /** Analyse un aperçu réduit environ trois fois par seconde. */
  async function liveLoop() {
    while (!stopped) {
      const v = video
      if (v && v.readyState >= 2 && v.videoWidth) {
        const small = toCanvas(v, v.videoWidth, v.videoHeight, 480)
        const g = small.getContext('2d')
        if (g) {
          try {
            const r = await vision.detect(g.getImageData(0, 0, small.width, small.height))
            const k = v.videoWidth / small.width
            liveQuad = r.quad ? (r.quad.map((p) => ({ x: p.x * k, y: p.y * k })) as Quad) : null
            liveConf = r.confidence
          } catch {
            liveQuad = null
          }
        }
      }
      await new Promise((r) => setTimeout(r, 250))
    }
  }

  function shoot() {
    const v = video
    if (!v || !v.videoWidth) return
    onphoto(toCanvas(v, v.videoWidth, v.videoHeight))
  }

  async function onfile(e: Event) {
    const f = (e.target as HTMLInputElement).files?.[0]
    if (!f) return
    try {
      onphoto(await canvasFromFile(f))
    } catch {
      error = 'Cette image n’a pas pu être ouverte.'
    }
  }

  const found = $derived(liveQuad !== null && liveConf >= 0.5)
</script>

<div class="flex flex-col gap-3">
  <div class="relative overflow-hidden rounded-2xl bg-black ring-1 ring-white/10" style:aspect-ratio={videoSize.w ? `${videoSize.w} / ${videoSize.h}` : '3 / 4'}>
    <!-- svelte-ignore a11y_media_has_caption -->
    <video bind:this={video} class="absolute inset-0 h-full w-full" playsinline muted autoplay></video>

    {#if videoSize.w}
      <svg class="pointer-events-none absolute inset-0 h-full w-full" viewBox={`0 0 ${videoSize.w} ${videoSize.h}`} aria-hidden="true">
        {#if liveQuad}
          <polygon
            points={liveQuad.map((p) => `${p.x},${p.y}`).join(' ')}
            fill={found ? 'rgba(34,197,94,0.15)' : 'rgba(250,204,21,0.1)'}
            stroke={found ? '#22c55e' : '#facc15'}
            stroke-width="4"
            vector-effect="non-scaling-stroke"
          />
        {:else}
          <!-- Cadre de visée -->
          {@const s = Math.min(videoSize.w, videoSize.h) * 0.85}
          <rect
            x={(videoSize.w - s) / 2}
            y={(videoSize.h - s) / 2}
            width={s}
            height={s}
            rx="12"
            fill="none"
            stroke="rgba(255,255,255,0.6)"
            stroke-dasharray="14 10"
            stroke-width="2"
            vector-effect="non-scaling-stroke"
          />
        {/if}
      </svg>
    {/if}

    {#if starting}
      <p class="absolute inset-0 flex items-center justify-center text-stone-400">Démarrage de la caméra...</p>
    {/if}

    <!-- État du repérage -->
    <div class="absolute inset-x-0 top-0 flex justify-center p-3">
      <span class="rounded-full bg-black/60 px-3 py-1.5 text-sm backdrop-blur" aria-live="polite">
        {#if cvError}
          Détection indisponible
        {:else if !cvReady}
          Préparation de la détection... {Math.round(cvProgress * 100)} %
        {:else if found}
          <span class="text-green-400">Échiquier repéré, prenez la photo</span>
        {:else}
          Cadrez tout l'échiquier
        {/if}
      </span>
    </div>
  </div>

  {#if error}
    <p class="rounded-xl bg-amber-950/60 px-4 py-3 text-sm text-amber-200 ring-1 ring-amber-900">{error}</p>
  {:else}
    <p class="text-center text-sm text-stone-400">
      Photographiez le plateau d'assez haut, en entier, sans reflet. Un léger angle ne gêne pas.
    </p>
  {/if}

  <!-- Commandes, à portée de pouce -->
  <div class="safe-bottom sticky bottom-0 -mx-4 bg-gradient-to-t from-stone-950 via-stone-950 to-stone-950/0 px-4 pt-4">
    <div class="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
      <button class="btn-secondary h-14! rounded-2xl!" onclick={() => fileInput?.click()}>Galerie</button>
      <button
        class="flex h-20 w-20 items-center justify-center rounded-full bg-white shadow-xl ring-4 ring-stone-600 active:scale-95 disabled:opacity-40"
        aria-label="Prendre la photo"
        disabled={!videoSize.w}
        onclick={shoot}
      >
        <span class="h-16 w-16 rounded-full border-4 {found ? 'border-green-500' : 'border-stone-900'}"></span>
      </button>
      <span></span>
    </div>
  </div>
  <input bind:this={fileInput} type="file" accept="image/*" class="hidden" onchange={onfile} />
</div>
