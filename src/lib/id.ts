export function createId(): string {
  const g = globalThis as { crypto?: Crypto }
  if (g.crypto && typeof g.crypto.randomUUID === 'function') {
    return g.crypto.randomUUID()
  }
  return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10)
}
