import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// base relative : le build fonctionne aussi bien à la racine d'un domaine
// (Cloudflare Pages) que dans un sous-dossier (GitHub Pages /ChessSolver/).
export default defineConfig({
  base: './',
  plugins: [
    tailwindcss(),
    svelte(),
    // PWA : application installable, utilisable hors ligne après le premier
    // chargement. Le service worker (Workbox) met en cache l'application,
    // Stockfish, OpenCV.js, TensorFlow.js et le modèle de reconnaissance.
    // Chaque fichier porte une révision : après une mise à jour, seuls les
    // fichiers modifiés sont retéléchargés (OpenCV, 13 Mo, ne l'est pas).
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['favicon.svg', 'icons/*.png'],
      manifest: {
        name: 'ChessCam : photo d’échiquier, meilleur coup',
        short_name: 'ChessCam',
        description: 'Photographiez un échiquier, obtenez le meilleur coup. Tout tourne sur votre appareil.',
        lang: 'fr',
        start_url: './',
        scope: './',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#0c0a09',
        theme_color: '#1c1917',
        categories: ['games', 'utilities'],
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,json,bin,wasm}'],
        // Variante multi-thread de TF.js inutile (pas d'isolation cross-origin)
        globIgnores: ['**/tfjs-backend-wasm-threaded-simd.wasm'],
        maximumFileSizeToCacheInBytes: 20 * 1024 * 1024,
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
        // Première visite : la page passe sous le contrôle du service worker dès
        // que le cache est rempli (les mises à jour, elles, attendent l'accord)
        clientsClaim: true,
      },
    }),
  ],
  build: {
    target: 'es2022',
  },
  worker: {
    format: 'es',
  },
})
