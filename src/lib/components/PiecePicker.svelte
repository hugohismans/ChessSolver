<!--
  Choix de la pièce pour une case : 6 pièces blanches, 6 noires, ou vide.
  Grands boutons pour un usage au pouce. Réutilisé en phase 3 pour corriger
  la reconnaissance case par case.
-->
<script lang="ts">
  import type { Cell, PieceChar } from '../chess/position'
  import { pieceName } from '../chess/names'
  import PieceIcon from './PieceIcon.svelte'

  interface Props {
    current: Cell
    onpick: (cell: Cell) => void
  }
  let { current, onpick }: Props = $props()

  const WHITE: PieceChar[] = ['K', 'Q', 'R', 'B', 'N', 'P']
  const BLACK: PieceChar[] = ['k', 'q', 'r', 'b', 'n', 'p']
</script>

<div class="grid grid-cols-6 gap-2">
  {#each [...WHITE, ...BLACK] as p (p)}
    <button
      class="flex aspect-square items-center justify-center rounded-xl bg-stone-800 ring-teal-400 active:bg-stone-700"
      class:ring-4={current === p}
      aria-label={pieceName(p)}
      aria-pressed={current === p}
      onclick={() => onpick(p)}
    >
      <PieceIcon piece={p} class="h-full w-full p-1" />
    </button>
  {/each}
</div>
<button
  class="mt-3 h-14 w-full rounded-xl bg-stone-800 text-base font-medium ring-teal-400 active:bg-stone-700"
  class:ring-4={current === null}
  onclick={() => onpick(null)}
>
  Case vide
</button>
