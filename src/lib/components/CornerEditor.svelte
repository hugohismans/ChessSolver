<!--
  Ajustement manuel des 4 coins du plateau sur la photo.
  On fait glisser une poignée (pas besoin de la toucher pile : la plus
  proche du doigt est prise). Le déplacement est relatif, le doigt ne cache
  donc pas le coin, et une loupe montre le détail pendant le geste.
  La grille 8x8 projetée permet de vérifier l'alignement sur les cases.
-->
<script lang="ts">
  import { onDestroy } from 'svelte'
  import { applyH, boardToImage, type Pt, type Quad } from '../vision/geometry'

  interface Props {
    photo: HTMLCanvasElement
    quad: Quad
    onchange: (q: Quad) => void
  }
  let { photo, quad, onchange }: Props = $props()

  const W = $derived(photo.width)
  const H = $derived(photo.height)
  // Marge autour de la photo : un coin peut sortir du cadre
  const pad = $derived(Math.round(Math.max(W, H) * 0.06))

  // L'image est servie au SVG via une URL d'objet (plus léger qu'un data URL)
  let url = $state('')
  $effect(() => {
    let revoked = false
    let made = ''
    photo.toBlob(
      (b) => {
        if (!b || revoked) return
        made = URL.createObjectURL(b)
        url = made
      },
      'image/jpeg',
      0.9,
    )
    return () => {
      revoked = true
      if (made) URL.revokeObjectURL(made)
    }
  })
  onDestroy(() => url && URL.revokeObjectURL(url))

  // Échelle écran : unités image par pixel affiché
  let clientWidth = $state(1)
  const k = $derived((W + 2 * pad) / Math.max(1, clientWidth))

  const gridLines = $derived.by(() => {
    try {
      const Hm = boardToImage(quad)
      const lines: [Pt, Pt][] = []
      for (let i = 0; i <= 8; i++) {
        lines.push([applyH(Hm, { x: i, y: 0 }), applyH(Hm, { x: i, y: 8 })])
        lines.push([applyH(Hm, { x: 0, y: i }), applyH(Hm, { x: 8, y: i })])
      }
      return lines
    } catch {
      return []
    }
  })

  // Geste en cours
  let svgEl = $state<SVGSVGElement>()
  let drag = $state<{ i: number; last: Pt; pointer: number } | null>(null)

  function toImage(e: PointerEvent): Pt {
    const r = svgEl!.getBoundingClientRect()
    return {
      x: ((e.clientX - r.left) / r.width) * (W + 2 * pad) - pad,
      y: ((e.clientY - r.top) / r.height) * (H + 2 * pad) - pad,
    }
  }

  function down(e: PointerEvent) {
    const p = toImage(e)
    // Poignée la plus proche, dans un rayon de 60 px à l'écran
    let best = -1
    let bd = 60 * k
    quad.forEach((c, i) => {
      const d = Math.hypot(c.x - p.x, c.y - p.y)
      if (d < bd) {
        bd = d
        best = i
      }
    })
    if (best < 0) return
    e.preventDefault()
    svgEl!.setPointerCapture(e.pointerId)
    drag = { i: best, last: p, pointer: e.pointerId }
  }

  function move(e: PointerEvent) {
    if (!drag || e.pointerId !== drag.pointer) return
    const p = toImage(e)
    const dx = p.x - drag.last.x
    const dy = p.y - drag.last.y
    drag = { ...drag, last: p }
    const q = quad.map((c, i) =>
      i === drag!.i
        ? { x: Math.min(W + pad, Math.max(-pad, c.x + dx)), y: Math.min(H + pad, Math.max(-pad, c.y + dy)) }
        : c,
    ) as Quad
    onchange(q)
  }

  function up(e: PointerEvent) {
    if (drag && e.pointerId === drag.pointer) drag = null
  }

  // Clavier : Tab choisit le coin, flèches le déplacent
  let focusCorner = $state(0)
  function key(e: KeyboardEvent) {
    const step = (e.shiftKey ? 10 : 2) * k
    const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key]
    if (e.key === 'n') {
      focusCorner = (focusCorner + 1) % 4
      return
    }
    if (!d) return
    e.preventDefault()
    onchange(quad.map((c, i) => (i === focusCorner ? { x: c.x + d[0], y: c.y + d[1] } : c)) as Quad)
  }

  // Loupe : du côté opposé au coin déplacé pour ne pas être sous le doigt
  const ZOOM = 3
  const LOUPE = 128 // px à l'écran
  const loupeLeft = $derived(drag ? quad[drag.i].x > W / 2 : false)
  const loupeBox = $derived.by(() => {
    if (!drag) return ''
    const c = quad[drag.i]
    const half = (LOUPE / 2) * (k / ZOOM)
    return `${c.x - half} ${c.y - half} ${2 * half} ${2 * half}`
  })
  const names = ['haut gauche', 'haut droit', 'bas droit', 'bas gauche']
</script>

{#snippet scene(stroke: number, handles: boolean)}
  {#if url}
    <image href={url} x="0" y="0" width={W} height={H} />
  {/if}
  <polygon points={quad.map((p) => `${p.x},${p.y}`).join(' ')} fill="rgba(20,184,166,0.12)" stroke="none" />
  {#each gridLines as [a, b], i (i)}
    <line
      x1={a.x}
      y1={a.y}
      x2={b.x}
      y2={b.y}
      stroke={i < 2 || i >= 16 ? '#2dd4bf' : 'rgba(45,212,191,0.75)'}
      stroke-width={i < 2 || i >= 16 ? stroke * 2 : stroke}
      vector-effect="non-scaling-stroke"
    />
  {/each}
  {#if handles}
    {#each quad as c, i (i)}
      <circle cx={c.x} cy={c.y} r={22 * k} fill="rgba(13,148,136,0.25)" stroke="#5eead4" stroke-width="2" vector-effect="non-scaling-stroke" />
      <circle cx={c.x} cy={c.y} r={3 * k} fill={i === focusCorner ? '#fde047' : '#ffffff'} />
    {/each}
  {:else}
    <!-- Réticule de la loupe -->
    {#if drag}
      {@const c = quad[drag.i]}
      <line x1={c.x - 1000} y1={c.y} x2={c.x + 1000} y2={c.y} stroke="#fde047" stroke-width="1" vector-effect="non-scaling-stroke" />
      <line x1={c.x} y1={c.y - 1000} x2={c.x} y2={c.y + 1000} stroke="#fde047" stroke-width="1" vector-effect="non-scaling-stroke" />
    {/if}
  {/if}
{/snippet}

<div class="relative" bind:clientWidth>
  <!-- Zone interactive (glisser au doigt, flèches au clavier) -->
  <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
  <svg
    bind:this={svgEl}
    viewBox={`${-pad} ${-pad} ${W + 2 * pad} ${H + 2 * pad}`}
    class="block w-full touch-none rounded-xl bg-stone-900 outline-none select-none focus-visible:ring-4 focus-visible:ring-teal-400"
    role="application"
    aria-label={`Coins du plateau. Coin sélectionné : ${names[focusCorner]}. Touche N pour changer de coin, flèches pour le déplacer.`}
    tabindex="0"
    onpointerdown={down}
    onpointermove={move}
    onpointerup={up}
    onpointercancel={up}
    onkeydown={key}
  >
    {@render scene(1.5, true)}
  </svg>

  {#if drag}
    <div
      class="pointer-events-none absolute top-2 overflow-hidden rounded-full shadow-2xl ring-4 ring-white/80"
      class:left-2={loupeLeft}
      class:right-2={!loupeLeft}
      style:width={`${LOUPE}px`}
      style:height={`${LOUPE}px`}
    >
      <svg viewBox={loupeBox} class="h-full w-full bg-stone-900" aria-hidden="true">
        {@render scene(1, false)}
      </svg>
    </div>
  {/if}
</div>
