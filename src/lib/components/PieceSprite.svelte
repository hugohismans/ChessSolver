<!--
  Injecte une seule fois le sprite SVG des pièces dans la page, pour que
  l'échiquier et les boutons puissent faire <use href="#wk">.
  Pièces : Cburnett (Wikimedia Commons, CC BY-SA 3.0), adaptées par
  cm-chessboard (MIT). Le sprite est inclus dans le bundle : il marche
  hors ligne sans requête supplémentaire.
-->
<script lang="ts">
  import sprite from '../../assets/pieces.svg?raw'
</script>

<div class="pointer-events-none absolute h-0 w-0 overflow-hidden" aria-hidden="true">
  {@html sprite}
</div>
