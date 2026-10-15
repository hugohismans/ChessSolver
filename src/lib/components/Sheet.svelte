<!--
  Panneau qui monte du bas de l'écran (accessible au pouce).
  Fermeture : bouton, tap sur le fond ou touche Échap.
-->
<script lang="ts">
  import type { Snippet } from 'svelte'

  interface Props {
    open: boolean
    title: string
    onclose: () => void
    children: Snippet
  }
  let { open, title, onclose, children }: Props = $props()

  function onkey(e: KeyboardEvent) {
    if (open && e.key === 'Escape') onclose()
  }
</script>

<svelte:window onkeydown={onkey} />

{#if open}
  <div class="fixed inset-0 z-40 flex flex-col justify-end">
    <button class="absolute inset-0 bg-black/60" aria-label="Fermer" onclick={onclose}></button>
    <div
      class="safe-bottom relative mx-auto w-full max-w-lg rounded-t-2xl bg-stone-900 px-4 pt-3 shadow-2xl ring-1 ring-white/10"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div class="mx-auto mb-2 h-1.5 w-12 rounded-full bg-stone-700"></div>
      <div class="mb-3 flex items-center justify-between">
        <h2 class="text-lg font-semibold">{title}</h2>
        <button class="-mr-2 h-12 w-12 rounded-full text-2xl text-stone-400 active:bg-stone-800" aria-label="Fermer" onclick={onclose}>×</button>
      </div>
      <div class="max-h-[70vh] overflow-y-auto pb-2">
        {@render children()}
      </div>
    </div>
  </div>
{/if}
