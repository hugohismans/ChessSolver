// Copie le moteur Stockfish (WASM, version « lite single-thread ») depuis
// node_modules vers public/engine. Cette variante ne demande pas
// SharedArrayBuffer, donc aucun en-tête COOP/COEP : elle tourne telle quelle
// sur GitHub Pages ou Cloudflare Pages.
import { copyFileSync, mkdirSync, existsSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const src = join(root, 'node_modules', 'stockfish', 'bin')
const dest = join(root, 'public', 'engine')
mkdirSync(dest, { recursive: true })

// Le script du worker cherche son .wasm en remplaçant « .js » par « .wasm »
// dans sa propre URL : les deux fichiers doivent donc porter le même nom.
const files = [
  ['stockfish-19-lite-single.js', 'stockfish.js'],
  ['stockfish-19-lite-single.wasm', 'stockfish.wasm'],
]
for (const [from, to] of files) {
  const s = join(src, from)
  const d = join(dest, to)
  if (!existsSync(s)) {
    console.error(`Fichier moteur introuvable : ${s}. Lancez « npm install ».`)
    process.exit(1)
  }
  // Évite une copie inutile si le fichier est déjà à jour
  if (existsSync(d) && statSync(d).size === statSync(s).size) continue
  copyFileSync(s, d)
  console.log(`Moteur copié : ${to}`)
}
