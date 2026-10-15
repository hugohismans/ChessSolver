// Les 13 classes de la reconnaissance : case vide + 6 pièces x 2 couleurs.
// L'ordre est figé : il est partagé avec training/train.py et les modèles
// enregistrés (sortie n° i du réseau = CLASSES[i]).

import type { Cell, PieceChar } from '../chess/position'

export const CLASSES = ['empty', 'P', 'N', 'B', 'R', 'Q', 'K', 'p', 'n', 'b', 'r', 'q', 'k'] as const
export type ClassName = (typeof CLASSES)[number]
export const NUM_CLASSES = CLASSES.length

export function classToCell(i: number): Cell {
  const c = CLASSES[i]
  return c === 'empty' ? null : (c as PieceChar)
}

export function cellToClass(cell: Cell): number {
  return cell ? CLASSES.indexOf(cell) : 0
}
