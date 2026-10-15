// Application installable (PWA) : service worker, mises à jour, installation,
// état du réseau et du stockage.

import { registerSW } from 'virtual:pwa-register'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

class Pwa {
  /** Tout est en cache : l'app fonctionne hors ligne. */
  offlineReady = $state(false)
  /** Message ponctuel « prête hors ligne » (premier chargement). */
  justReady = $state(false)
  /** Une nouvelle version attend d'être activée. */
  needRefresh = $state(false)
  online = $state(typeof navigator === 'undefined' ? true : navigator.onLine)
  /** Le navigateur propose l'installation (Chrome, Edge, Android). */
  canInstall = $state(false)
  installed = $state(false)
  /** iPhone / iPad : installation manuelle par le menu Partager. */
  readonly ios = typeof navigator !== 'undefined' && /iPad|iPhone|iPod/.test(navigator.userAgent)

  private updateSW: ((reload?: boolean) => Promise<void>) | null = null
  private deferred: BeforeInstallPromptEvent | null = null

  init() {
    this.installed =
      matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true
    addEventListener('online', () => (this.online = true))
    addEventListener('offline', () => (this.online = false))
    addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault()
      this.deferred = e as BeforeInstallPromptEvent
      this.canInstall = true
    })
    addEventListener('appinstalled', () => {
      this.installed = true
      this.canInstall = false
    })
    if (!('serviceWorker' in navigator)) return
    // Déjà contrôlée par le service worker : le cache est en place
    if (navigator.serviceWorker.controller) this.offlineReady = true
    this.updateSW = registerSW({
      immediate: true,
      onNeedRefresh: () => (this.needRefresh = true),
      onOfflineReady: () => {
        this.offlineReady = true
        this.justReady = true
        setTimeout(() => (this.justReady = false), 6000)
      },
    })
  }

  /** Active la nouvelle version et recharge la page. */
  async update() {
    // Rechargement dès que la nouvelle version prend le contrôle, avec un
    // secours si l'événement ne vient pas (mise à jour détectée autrement)
    navigator.serviceWorker?.addEventListener('controllerchange', () => location.reload(), { once: true })
    setTimeout(() => location.reload(), 4000)
    await this.updateSW?.(false)
  }

  async install() {
    if (!this.deferred) return
    await this.deferred.prompt()
    const choice = await this.deferred.userChoice
    if (choice.outcome === 'accepted') this.installed = true
    this.deferred = null
    this.canInstall = false
  }
}

export const pwa = new Pwa()

/** Demande au navigateur de ne pas effacer les données (profils, cache). */
export async function persistStorage(): Promise<boolean> {
  try {
    return (await navigator.storage?.persist?.()) ?? false
  } catch {
    return false
  }
}

/** Espace utilisé et persistance du stockage. */
export async function storageInfo(): Promise<{ usage: number; persisted: boolean } | null> {
  try {
    const est = await navigator.storage.estimate()
    const persisted = (await navigator.storage.persisted?.()) ?? false
    return { usage: est.usage ?? 0, persisted }
  } catch {
    return null
  }
}
