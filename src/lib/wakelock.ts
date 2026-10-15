// Garde l'écran allumé pendant une tâche (caméra, entraînement).
// Sans effet si le navigateur ne le permet pas.

type Sentinel = { release: () => Promise<void> }

export function keepAwake(): () => void {
  let sentinel: Sentinel | null = null
  let active = true
  const acquire = async () => {
    try {
      const wl = (navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<Sentinel> } }).wakeLock
      if (wl && active && document.visibilityState === 'visible') sentinel = await wl.request('screen')
    } catch {
      sentinel = null
    }
  }
  // Le verrou saute quand l'onglet est masqué : on le reprend au retour
  const onVisible = () => {
    if (document.visibilityState === 'visible') acquire()
  }
  document.addEventListener('visibilitychange', onVisible)
  acquire()
  return () => {
    active = false
    document.removeEventListener('visibilitychange', onVisible)
    sentinel?.release().catch(() => undefined)
    sentinel = null
  }
}

/** Petite vibration de confirmation (téléphones Android). */
export function haptic(ms = 12) {
  try {
    navigator.vibrate?.(ms)
  } catch {
    // ignoré
  }
}
