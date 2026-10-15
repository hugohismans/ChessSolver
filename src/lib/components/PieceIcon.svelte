<!-- Petite icône de pièce, réutilise le sprite injecté par PieceSprite. -->
<script lang="ts">
  import type { PieceChar } from '../chess/position'
  let { piece, class: cls = 'h-10 w-10' }: { piece: PieceChar; class?: string } = $props()
  const id = $derived((piece === piece.toUpperCase() ? 'w' : 'b') + piece.toLowerCase())
</script>

<svg viewBox="0 0 40 40" class={cls} aria-hidden="true"><use href={`#${id}`} /></svg>
