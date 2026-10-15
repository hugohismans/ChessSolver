import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import tailwindcss from '@tailwindcss/vite'

// base relative : le build fonctionne aussi bien à la racine d'un domaine
// (Cloudflare Pages) que dans un sous-dossier (GitHub Pages /ChessSolver/).
export default defineConfig({
  base: './',
  plugins: [tailwindcss(), svelte()],
  build: {
    target: 'es2022',
  },
  worker: {
    format: 'es',
  },
})
