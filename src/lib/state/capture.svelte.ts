// Photo en cours de traitement : image, coins du plateau, rotation.
// Partagé par les écrans Photo, Coins et Cases.

import type { Quad } from '../vision/geometry'
import type { DetectResult } from '../vision/detect'

/** Pourquoi la photo est prise : jouer, ou calibrer le profil actif. */
export type CapturePurpose = 'play' | 'calib-start' | 'calib-position'

class Capture {
  purpose = $state<CapturePurpose>('play')
  /** Photo réduite (au plus PHOTO_MAX px), non réactive en profondeur. */
  photo = $state.raw<HTMLCanvasElement | null>(null)
  /** Coins de la zone de jeu dans la photo : haut-gauche, haut-droit, bas-droit, bas-gauche. */
  quad = $state<Quad | null>(null)
  detection = $state.raw<DetectResult | null>(null)
  /**
   * Quarts de tour (sens horaire) à appliquer au plateau redressé pour que
   * les blancs soient en bas. 0 = photo prise du côté des blancs.
   */
  rotation = $state(0)
  /** Plateau redressé (sans rotation), avec une marge d'une demi-case. */
  board = $state.raw<HTMLCanvasElement | null>(null)

  reset() {
    this.photo = null
    this.quad = null
    this.detection = null
    this.board = null
  }
}

export const capture = new Capture()
