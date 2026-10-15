// Vérifie que le modèle exporté au format TF.js donne les mêmes
// probabilités que Keras (fichiers de référence écrits par train.py).
// Usage : npx tsx training/check-export.ts [public/models/base] [training/data]
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import * as tf from '@tensorflow/tfjs'

const [modelDir = 'public/models/base', dataDir = 'training/data'] = process.argv.slice(2)

/** Charge un modèle « layers » depuis le disque, sans tfjs-node. */
async function load(dir: string) {
  const json = JSON.parse(readFileSync(join(dir, 'model.json'), 'utf8'))
  const bin = readFileSync(join(dir, json.weightsManifest[0].paths[0]))
  const weightSpecs = json.weightsManifest.flatMap((g: { weights: tf.io.WeightsManifestEntry[] }) => g.weights)
  return tf.loadLayersModel(
    tf.io.fromMemory({ modelTopology: json.modelTopology, weightSpecs, weightData: bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.length) }),
  )
}

/** Lecture minimale d'un .npy uint8. */
function npy(path: string): { data: Uint8Array; shape: number[] } {
  const buf = readFileSync(path)
  const hl = buf.readUInt16LE(8)
  const header = buf.subarray(10, 10 + hl).toString('latin1')
  const shape = header.match(/\(([^)]*)\)/)![1].split(',').filter((s) => s.trim()).map(Number)
  return { data: new Uint8Array(buf.subarray(10 + hl)), shape }
}

await tf.setBackend('cpu')
const extractor = await load(join(modelDir, 'extractor'))
const head = await load(join(modelDir, 'head'))
const x = npy(join(dataDir, 'check_x.npy'))
const ref: number[][] = JSON.parse(readFileSync(join(dataDir, 'check_probs.json'), 'utf8')).probs
const input = tf.tensor4d(x.data, x.shape as [number, number, number, number], 'int32').toFloat().div(127.5).sub(1)
const probs = (await (head.predict(extractor.predict(input) as tf.Tensor) as tf.Tensor).array()) as number[][]
let maxDiff = 0
let same = 0
probs.forEach((p, i) => {
  p.forEach((v, k) => (maxDiff = Math.max(maxDiff, Math.abs(v - ref[i][k]))))
  if (p.indexOf(Math.max(...p)) === ref[i].indexOf(Math.max(...ref[i]))) same++
})
console.log(`Écart max ${maxDiff.toExponential(2)}, mêmes classes ${same}/${probs.length}`)
if (maxDiff > 0.01 || same !== probs.length) process.exit(1)
