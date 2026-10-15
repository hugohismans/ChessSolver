<!--
  Échiquier SVG léger, sans dépendance : affichage des pièces, surlignages,
  flèches et sélection d'une case au toucher. Utilisé par l'éditeur (saisie
  et correction) comme par l'écran d'analyse (jeu des coups).
  Les dessins des pièces viennent du sprite de cm-chessboard (voir PieceSprite).
-->
<script lang="ts" module>
  export interface Arrow {
    from: string
    to: string
    color: string
    width?: number // épaisseur relative (1 = normale)
    opacity?: number
  }
  export type HighlightKind = 'selected' | 'target' | 'capture' | 'last' | 'check' | 'error'
  export interface Highlight {
    square: string
    kind: HighlightKind
  }
</script>

<script lang="ts">
  import { squareIndex, squareName, type Color, type Grid } from '../chess/position'

  interface Props {
    grid: Grid
    orientation?: Color
    arrows?: Arrow[]
    highlights?: Highlight[]
    coordinates?: boolean
    onsquare?: (square: string) => void
    label?: string
  }

  let {
    grid,
    orientation = 'w',
    arrows = [],
    highlights = [],
    coordinates = true,
    onsquare,
    label = 'Échiquier',
  }: Props = $props()

  const S = 100 // taille d'une case dans le repère SVG
  const FILES = 'abcdefgh'

  // Coordonnées d'affichage (colonne, ligne) d'une case selon l'orientation
  function pos(square: string): { x: number; y: number } {
    const i = squareIndex(square)
    let col = i % 8
    let row = Math.floor(i / 8)
    if (orientation === 'b') {
      col = 7 - col
      row = 7 - row
    }
    return { x: col * S, y: row * S }
  }

  // Les 64 cases dans l'ordre d'affichage
  const squares = $derived(
    Array.from({ length: 64 }, (_, i) => {
      const name = squareName(i)
      const { x, y } = pos(name)
      const light = (Math.floor(i / 8) + (i % 8)) % 2 === 0
      return { i, name, x, y, light }
    }),
  )

  const hlColors: Record<HighlightKind, string> = {
    selected: 'rgba(20, 184, 166, 0.55)',
    target: 'rgba(20, 184, 166, 0.0)',
    capture: 'rgba(20, 184, 166, 0.0)',
    last: 'rgba(250, 204, 21, 0.42)',
    check: 'rgba(239, 68, 68, 0.6)',
    error: 'rgba(239, 68, 68, 0.45)',
  }

  /** Polygone d'une flèche épaisse entre les centres de deux cases. */
  function arrowPath(a: Arrow): string {
    const p1 = pos(a.from)
    const p2 = pos(a.to)
    const x1 = p1.x + S / 2
    const y1 = p1.y + S / 2
    const x2 = p2.x + S / 2
    const y2 = p2.y + S / 2
    const dx = x2 - x1
    const dy = y2 - y1
    const len = Math.hypot(dx, dy)
    if (len === 0) return ''
    const ux = dx / len
    const uy = dy / len
    const w = 9 * (a.width ?? 1) // demi-épaisseur du corps
    const hw = 22 * (a.width ?? 1) // demi-largeur de la pointe
    const hl = 34 * (a.width ?? 1) // longueur de la pointe
    const start = 12 // la flèche part un peu après le centre
    const sx = x1 + ux * start
    const sy = y1 + uy * start
    const bx = x2 - ux * hl
    const by = y2 - uy * hl
    const nx = -uy
    const ny = ux
    const pts = [
      [sx + nx * w, sy + ny * w],
      [bx + nx * w, by + ny * w],
      [bx + nx * hw, by + ny * hw],
      [x2, y2],
      [bx - nx * hw, by - ny * hw],
      [bx - nx * w, by - ny * w],
      [sx - nx * w, sy - ny * w],
    ]
    return pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
  }

  // Un seul gestionnaire pour tout le plateau : on calcule la case touchée
  let svgEl: SVGSVGElement
  function handleClick(e: MouseEvent) {
    if (!onsquare) return
    const r = svgEl.getBoundingClientRect()
    let col = Math.floor(((e.clientX - r.left) / r.width) * 8)
    let row = Math.floor(((e.clientY - r.top) / r.height) * 8)
    if (col < 0 || col > 7 || row < 0 || row > 7) return
    if (orientation === 'b') {
      col = 7 - col
      row = 7 - row
    }
    onsquare(squareName(row * 8 + col))
  }

  // Navigation clavier : les flèches déplacent un curseur, Entrée valide
  let cursor = $state<string | null>(null)
  function handleKey(e: KeyboardEvent) {
    if (!onsquare) return
    const cur = cursor ?? (orientation === 'w' ? 'e2' : 'e7')
    let f = FILES.indexOf(cur[0])
    let r = Number(cur[1])
    const sign = orientation === 'w' ? 1 : -1
    if (e.key === 'ArrowUp') r += sign
    else if (e.key === 'ArrowDown') r -= sign
    else if (e.key === 'ArrowLeft') f -= sign
    else if (e.key === 'ArrowRight') f += sign
    else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      cursor = cur
      onsquare(cur)
      return
    } else return
    e.preventDefault()
    cursor = `${FILES[Math.min(7, Math.max(0, f))]}${Math.min(8, Math.max(1, r))}`
  }

  const pieceId = (c: string) => (c === c.toUpperCase() ? 'w' : 'b') + c.toLowerCase()
</script>

<svg
  bind:this={svgEl}
  viewBox="0 0 800 800"
  class="block aspect-square w-full touch-manipulation select-none rounded-md shadow-lg outline-none focus-visible:ring-4 focus-visible:ring-teal-400"
  role="grid"
  aria-label={label}
  tabindex={onsquare ? 0 : -1}
  onclick={handleClick}
  onkeydown={handleKey}
>
  <!-- Cases -->
  {#each squares as sq (sq.i)}
    <rect x={sq.x} y={sq.y} width={S} height={S} class={sq.light ? 'fill-board-light' : 'fill-board-dark'} />
  {/each}

  <!-- Surlignages de fond -->
  {#each highlights as h (h.square + h.kind)}
    {@const p = pos(h.square)}
    {#if h.kind === 'target'}
      <circle cx={p.x + S / 2} cy={p.y + S / 2} r="15" fill="rgba(15, 118, 110, 0.55)" />
    {:else if h.kind === 'capture'}
      <circle cx={p.x + S / 2} cy={p.y + S / 2} r="44" fill="none" stroke="rgba(15, 118, 110, 0.6)" stroke-width="8" />
    {:else}
      <rect x={p.x} y={p.y} width={S} height={S} fill={hlColors[h.kind]} />
    {/if}
  {/each}

  <!-- Coordonnées sur le bord -->
  {#if coordinates}
    {#each Array(8) as _, k (k)}
      {@const file = orientation === 'w' ? FILES[k] : FILES[7 - k]}
      {@const rank = orientation === 'w' ? 8 - k : k + 1}
      <text x={k * S + S - 6} y={800 - 7} text-anchor="end" class="coord" class:on-light={k % 2 === 1}>{file}</text>
      <text x="5" y={k * S + 22} class="coord" class:on-light={k % 2 === 0}>{rank}</text>
    {/each}
  {/if}

  <!-- Pièces -->
  {#each squares as sq (sq.i)}
    {@const piece = grid[sq.i]}
    {#if piece}
      <use href={`#${pieceId(piece)}`} transform={`translate(${sq.x} ${sq.y}) scale(2.5)`} />
    {/if}
  {/each}

  <!-- Flèches (au-dessus des pièces) -->
  {#each arrows as a, k (k)}
    <polygon points={arrowPath(a)} fill={a.color} opacity={a.opacity ?? 0.85} pointer-events="none" />
  {/each}

  <!-- Curseur clavier -->
  {#if cursor}
    {@const p = pos(cursor)}
    <rect x={p.x + 3} y={p.y + 3} width={S - 6} height={S - 6} fill="none" stroke="#2dd4bf" stroke-width="6" pointer-events="none" />
  {/if}
</svg>

<style>
  .coord {
    font-size: 19px;
    font-weight: 700;
    fill: var(--color-board-light);
    pointer-events: none;
  }
  .coord.on-light {
    fill: var(--color-board-dark);
  }
</style>
