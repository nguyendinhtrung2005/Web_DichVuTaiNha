/** Only optimize known public assets; keep remote/auth/data/blob sources as-is. */
export function canOptimizeCustomerImage(source: unknown): boolean {
  return typeof source === 'string' && /^\/images\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+\.(?:png|jpe?g|webp|avif)$/i.test(source)
}
