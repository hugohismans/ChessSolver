// Copie les fichiers lourds venant de node_modules vers public/, pour qu'ils
// soient servis tels quels (sans passer par le bundler) et chargés à la
// demande :
//  - Stockfish (WASM, version « lite single-thread ») -> public/engine
//    Cette variante ne demande pas SharedArrayBuffer, donc aucun en-tête
//    COOP/COEP : elle tourne telle quelle sur GitHub Pages ou Cloudflare Pages.
//  - OpenCV.js (WASM embarqué dans le .js) -> public/opencv
import { copyFileSync, mkdirSync, existsSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const nm = join(root, 'node_modules')

// Le script du worker Stockfish cherche son .wasm en remplaçant « .js » par
// « .wasm » dans sa propre URL : les deux fichiers doivent porter le même nom.
const files = [
  ['stockfish/bin/stockfish-19-lite-single.js', 'engine/stockfish.js'],
  ['stockfish/bin/stockfish-19-lite-single.wasm', 'engine/stockfish.wasm'],
  ['@techstark/opencv-js/dist/opencv.js', 'opencv/opencv.js'],
]
for (const [from, to] of files) {
  const s = join(nm, from)
  const d = join(root, 'public', to)
  if (!existsSync(s)) {
    console.error(`Fichier introuvable : ${s}. Lancez « npm install ».`)
    process.exit(1)
  }
  mkdirSync(dirname(d), { recursive: true })
  // Évite une copie inutile si le fichier est déjà à jour
  if (existsSync(d) && statSync(d).size === statSync(s).size) continue
  copyFileSync(s, d)
  console.log(`Copié : ${to}`)
}
