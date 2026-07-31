export interface GunRelayPreset {
  label: string;
  url: string;
}

/** Verified-working public Gun relay peers (WebSocket-confirmed) */
export const GUN_RELAY_PRESETS: GunRelayPreset[] = [
  { label: 'InterPoll Primary', url: 'https://interpoll2.endless.sbs/gun' },
  { label: 'Relay Peer OOO', url: 'https://relay.peer.ooo/gun' },
];

/** Peers enabled by default */
export const DEFAULT_GUN_PEERS: string[] = [
  'https://interpoll2.endless.sbs/gun',
  'https://relay.peer.ooo/gun',
];

export function isValidGunUrl(url: string): boolean {
  try {
    const u = new URL(url.trim());
    return (u.protocol === 'http:' || u.protocol === 'https:') && u.pathname.length > 1;
  } catch {
    return false;
  }
}

export function labelForGunUrl(url: string): string {
  const preset = GUN_RELAY_PRESETS.find(p => p.url === url);
  if (preset) return preset.label;
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
