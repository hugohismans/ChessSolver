// Accès prudent au localStorage : il peut être absent ou lever une
// exception (navigation privée, stockage bloqué). L'app doit fonctionner
// normalement sans lui, il ne sert qu'au confort (réglages mémorisés).

export function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    if (raw == null) return fallback
    return { ...fallback, ...JSON.parse(raw) }
  } catch {
    return fallback
  }
}

export function save(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Stockage indisponible : on ignore, les réglages resteront en mémoire
  }
}
