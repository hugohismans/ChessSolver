<!-- Barre d'évaluation horizontale : part des blancs à gauche, des noirs à droite. -->
<script lang="ts">
  import { formatScore, whiteWinPercent, type Score } from '../engine/uci'
  let { score }: { score: Score | null } = $props()
  const pct = $derived(score ? whiteWinPercent(score) : 50)
</script>

<div
  class="relative h-7 overflow-hidden rounded-lg bg-stone-800 ring-1 ring-white/10"
  role="meter"
  aria-label="Évaluation"
  aria-valuemin={0}
  aria-valuemax={100}
  aria-valuenow={Math.round(pct)}
  aria-valuetext={score ? formatScore(score) : 'en attente'}
>
  <div class="absolute inset-y-0 left-0 bg-stone-100 transition-[width] duration-500 ease-out" style:width={`${pct}%`}></div>
  <div class="absolute inset-y-0 left-1/2 w-px bg-teal-500/60"></div>
  {#if score}
    <span
      class="absolute inset-y-0 flex items-center px-2 text-sm font-bold tabular-nums"
      class:left-0={pct >= 50}
      class:text-stone-900={pct >= 50}
      class:right-0={pct < 50}
      class:text-stone-100={pct < 50}
    >
      {formatScore(score)}
    </span>
  {/if}
</div>
