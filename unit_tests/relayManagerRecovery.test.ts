import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock only the discovery source; RelayManager itself is the real unit under test.
const { discovery } = vi.hoisted(() => ({
  discovery: { getEntries: vi.fn(() => [] as unknown[]) },
}));
vi.mock('@/services/discoveryService', () => ({ DiscoveryService: discovery, default: discovery }));

import { RelayManager } from '@/services/relayManager';

function installLocalStorage(): void {
  const store = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => { store.set(k, String(v)); },
    removeItem: (k: string) => { store.delete(k); },
    clear: () => { store.clear(); },
  };
}

function verifiedEntry() {
  return {
    version: 1,
    nodeId: 'peer-b',
    peerId: 'peer-b',
    websocket: 'wss://relay-b.example',
    gun: 'https://relay-b.example/gun',
    api: 'https://relay-b.example',
    capabilities: ['ws-sync'],
    timestamp: Date.now(),
    ttlMs: 300_000,
    signerPubkey: 'a'.repeat(64),
    signature: 'b'.repeat(128),
    expiresAt: Date.now() + 300_000,
  };
}

beforeEach(() => {
  installLocalStorage();
  vi.clearAllMocks();
  const rm = RelayManager as any;
  rm.config = { relays: [], activeRelayId: 'active', autoFailover: false, transport: {} };
  rm.switching = false;
  rm.switchFailures = new Map();
  rm.changeListeners = [];
});

describe('RelayManager.recoverFromBlackout', () => {
  it('registers, probes, and switches to a verified rendezvous-discovered relay', async () => {
    discovery.getEntries.mockReturnValue([verifiedEntry()]);
    const probeSpy = vi.spyOn(RelayManager, 'probeRelay').mockImplementation(async (r: any) => ({ ...r, status: 'online' }));
    const switchSpy = vi.spyOn(RelayManager, 'switchToRelay').mockResolvedValue(undefined as any);

    const result = await RelayManager.recoverFromBlackout();

    expect(result).toBe(true);
    expect(probeSpy).toHaveBeenCalledTimes(1);
    expect(switchSpy).toHaveBeenCalledTimes(1);
    // Switched to the newly-registered discovered relay pointing at the peer's ws.
    const switchedId = switchSpy.mock.calls[0][0];
    const registered = (RelayManager as any).config.relays.find((r: any) => r.id === switchedId);
    expect(registered?.ws).toBe('wss://relay-b.example');
    expect(registered?.source).toBe('discovered');
  });

  it('returns false when discovery has no entries', async () => {
    discovery.getEntries.mockReturnValue([]);
    const switchSpy = vi.spyOn(RelayManager, 'switchToRelay').mockResolvedValue(undefined as any);
    expect(await RelayManager.recoverFromBlackout()).toBe(false);
    expect(switchSpy).not.toHaveBeenCalled();
  });

  it('skips offline candidates and does not switch', async () => {
    discovery.getEntries.mockReturnValue([verifiedEntry()]);
    vi.spyOn(RelayManager, 'probeRelay').mockImplementation(async (r: any) => ({ ...r, status: 'offline' }));
    const switchSpy = vi.spyOn(RelayManager, 'switchToRelay').mockResolvedValue(undefined as any);
    expect(await RelayManager.recoverFromBlackout()).toBe(false);
    expect(switchSpy).not.toHaveBeenCalled();
  });

  it('does nothing while a switch is already in progress', async () => {
    (RelayManager as any).switching = true;
    discovery.getEntries.mockReturnValue([verifiedEntry()]);
    expect(await RelayManager.recoverFromBlackout()).toBe(false);
    expect(discovery.getEntries).not.toHaveBeenCalled();
  });
});
