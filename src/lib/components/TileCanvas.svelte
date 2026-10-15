<!-- Affiche un canvas déjà dessiné (vignette de case, plateau redressé). -->
<script lang="ts">
  let { canvas, class: cls = '', label = '' }: { canvas: HTMLCanvasElement; class?: string; label?: string } = $props()
  let el = $state<HTMLCanvasElement>()
  $effect(() => {
    if (!el) return
    el.width = canvas.width
    el.height = canvas.height
    el.getContext('2d')?.drawImage(canvas, 0, 0)
  })
</script>

<canvas bind:this={el} class={cls} aria-label={label} role={label ? 'img' : undefined}></canvas>
