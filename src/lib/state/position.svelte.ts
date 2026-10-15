// Position en cours d'édition, partagée entre les écrans.
// Plus tard, la reconnaissance par photo remplira cette même grille.

import {
  START_FEN,
  parseFen,
  possibleCastling,
  enPassantCandidates,
  validatePosition,
  type Color,
  type Grid,
  type PositionMeta,
} from '../chess/position'
import { load, save } from './storage'

const KEY = 'chesscam.position'

class EditorPosition {
  grid = $state<Grid>(parseFen(START_FEN).grid)
  meta = $state<PositionMeta>(parseFen(START_FEN).meta)
  /** Côté affiché en bas de l'échiquier. */
  orientation = $state<Color>('w')

  /** Validation recalculée automatiquement à chaque modification. */
  validation = $derived(validatePosition(this.grid, this.meta))
  possibleCastling = $derived(possibleCastling(this.grid))
  epCandidates = $derived(enPassantCandidates(this.grid, this.meta.turn))

  constructor() {
    const saved = load<{ fen?: string; orientation?: Color }>(KEY, {})
    if (saved.fen) {
      try {
        this.setFen(saved.fen)
      } catch {
        // FEN mémorisé corrompu : on garde la position de départ
      }
    }
    if (saved.orientation === 'b') this.orientation = 'b'
  }

  setFen(fen: string) {
    const p = parseFen(fen)
    this.grid = p.grid
    this.meta = p.meta
  }

  persist() {
    save(KEY, { fen: this.validation.fen, orientation: this.orientation })
  }
}

export const position = new EditorPosition()
