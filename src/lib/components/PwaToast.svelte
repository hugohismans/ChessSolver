<!-- Messages de l'application installable : mise à jour, prête hors ligne. -->
<script lang="ts">
  import { pwa } from '../state/pwa.svelte'
  let later = $state(false)
</script>

{#if pwa.needRefresh && !later}
  <div class="safe-bottom fixed inset-x-0 bottom-0 z-50 mx-auto max-w-lg px-4" role="status">
    <div class="mb-3 flex items-center gap-3 rounded-2xl bg-stone-800 p-3 shadow-2xl ring-1 ring-teal-700">
      <p class="flex-1 text-sm">Une nouvelle version de ChessCam est disponible.</p>
      <button class="btn-secondary h-11! bg-stone-700!" onclick={() => (later = true)}>Plus tard</button>
      <button class="btn-primary h-11! rounded-xl! text-base!" onclick={() => pwa.update()}>Mettre à jour</button>
    </div>
  </div>
{:else if pwa.justReady}
  <div class="safe-bottom pointer-events-none fixed inset-x-0 bottom-0 z-50 mx-auto max-w-lg px-4" role="status">
    <p class="mb-24 rounded-2xl bg-stone-800 px-4 py-3 text-sm shadow-2xl ring-1 ring-white/10">
      ChessCam fonctionne maintenant hors ligne.
    </p>
  </div>
{/if}
