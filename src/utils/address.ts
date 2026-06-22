/**
 * Abbreviate a Security Manager Ethereum address for display — `0x1234...abcd` —
 * following the GenosDB convention (the SM exposes the active user's address as
 * `state.abbrAddr`; this is the equivalent for ANY address). Per the SM docs, the
 * full 42-character string should never be shown in the UI: it is hard to read and
 * takes up too much space.
 *
 * Non-address strings (usernames, display names, GenosRTC peer ids) are returned
 * unchanged, so it is safe to wrap any "name or address" display value.
 *
 * @param value an address, name, or any display string
 * @returns `0x1234...abcd` for a 0x address, otherwise the input unchanged
 */
export function formatAddress(value?: string | null): string {
  if (!value) return ''
  return /^0x[a-fA-F0-9]{40}$/.test(value) ? `${value.slice(0, 6)}...${value.slice(-4)}` : value
}

/**
 * Deterministic identicon for an address or name: a unique two-stop gradient plus
 * an initial, derived from the string hash. No dependencies — same input always
 * yields the same colors, so a peer is visually recognizable across the UI.
 *
 * @param value an address, name, or any seed string
 * @returns `{ gradient, initial }` for an avatar chip
 */
export function addressAvatar(value?: string | null): { gradient: string; initial: string } {
  const seed = value || '?'
  let hash = 0
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0
  const hue = hash % 360
  const initial = (seed.replace(/^0x/i, '')[0] || '?').toUpperCase()
  return {
    gradient: `linear-gradient(135deg, hsl(${hue} 72% 58%), hsl(${(hue + 48) % 360} 70% 46%))`,
    initial,
  }
}
