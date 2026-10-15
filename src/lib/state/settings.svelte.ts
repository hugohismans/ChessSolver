// Réglages utilisateur, réactifs (runes Svelte 5) et mémorisés localement.

import { load, save } from './storage'

const KEY = 'chesscam.settings'

interface SettingsData {
  depth: number // profondeur d'analyse Stockfish
  showAllArrows: boolean // flèches pour les 3 lignes, ou seulement la meilleure
  showCoordinates: boolean
  frenchNotation: boolean // C, F, T, D, R au lieu de N, B, R, Q, K
  activeProfile: string // profil de reconnaissance utilisé ('base' = modèle livré)
}

const DEFAULTS: SettingsData = { depth: 18, showAllArrows: true, showCoordinates: true, frenchNotation: true, activeProfile: 'base' }

export const DEPTH_MIN = 8
export const DEPTH_MAX = 30
export const MULTI_PV = 3

class Settings {
  depth = $state(DEFAULTS.depth)
  showAllArrows = $state(DEFAULTS.showAllArrows)
  showCoordinates = $state(DEFAULTS.showCoordinates)
  frenchNotation = $state(DEFAULTS.frenchNotation)
  activeProfile = $state(DEFAULTS.activeProfile)

  constructor() {
    const d = load(KEY, DEFAULTS)
    this.depth = Math.min(DEPTH_MAX, Math.max(DEPTH_MIN, Number(d.depth) || DEFAULTS.depth))
    this.showAllArrows = !!d.showAllArrows
    this.showCoordinates = !!d.showCoordinates
    this.frenchNotation = !!d.frenchNotation
    this.activeProfile = typeof d.activeProfile === 'string' ? d.activeProfile : 'base'
  }

  persist() {
    save(KEY, {
      depth: this.depth,
      showAllArrows: this.showAllArrows,
      showCoordinates: this.showCoordinates,
      frenchNotation: this.frenchNotation,
      activeProfile: this.activeProfile,
    } satisfies SettingsData)
  }
}

export const settings = new Settings()
