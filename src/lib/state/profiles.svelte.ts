// Liste des profils de jeux (réactive) et profil actif.

import { BASE_PROFILE, listProfiles, profileStats, type Profile, type ProfileStats } from '../recognition/storage'
import { NUM_CLASSES } from '../recognition/classes'
import { settings } from './settings.svelte'

class Profiles {
  list = $state.raw<Profile[]>([])
  stats = $state.raw<ProfileStats | null>(null)
  loaded = $state(false)

  /** Profil actif (null = modèle de base). */
  get active(): Profile | null {
    return this.list.find((p) => p.id === settings.activeProfile) ?? null
  }

  get activeName(): string {
    return this.active?.name ?? 'Modèle de base'
  }

  async refresh() {
    try {
      this.list = await listProfiles()
      // Profil actif supprimé entre-temps : retour au modèle de base
      if (settings.activeProfile !== BASE_PROFILE && !this.list.some((p) => p.id === settings.activeProfile)) {
        settings.activeProfile = BASE_PROFILE
      }
      this.stats = this.active ? await profileStats(this.active.id, NUM_CLASSES) : null
    } catch {
      this.list = []
      this.stats = null
    }
    this.loaded = true
  }
}

export const profiles = new Profiles()
