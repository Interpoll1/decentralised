import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// --- Mocked service dependencies ---------------------------------------------
// Defined via vi.hoisted so the (hoisted) vi.mock factories below can reference them.
const { ws, gun, relayManager, discovery, mesh, reputation } = vi.hoisted(() => ({
  ws: {
    getConnectionStatus: vi.fn(() => false),
    getPeerCount: vi.fn(() => 0),
    getPeerId: vi.fn(() => 'local-peer'),
    getKnownServers: vi.fn(() => [] as unknown[]),
    onStatusChange: vi.fn(() => () => {}),
  },
  gun: {
    getPeerStats: vi.fn(() => ({ isConnected: false, peerCount: 0, connectedCount: 0 })),
    getDetailedPeerStats: vi.fn(() => [] as Array<{ url: string; connected: boolean }>),
    addPeerDynamic: vi.fn(),
  },
  relayManager: {
    autoFailover: vi.fn(async () => {}),
    recoverFromBlackout: vi.fn(async () => false),
  },
  discovery: {
    refreshFromGun: vi.fn(async () => []),
    publishRendezvous: vi.fn(async () => null),
    subscribeRendezvous: vi.fn(),
    getEntries: vi.fn(() => [] as Array<{ gun: string }>),
  },
  mesh: {
    setEnabled: vi.fn(),
    getStatus: vi.fn(() => ({ enabled: true, peerCount: 0 })),
  },
  reputation: { snapshot: vi.fn(() => [] as unknown[]) },
}));

vi.mock('@/services/websocketService', () => ({ WebSocketService: ws }));
vi.mock('@/services/gunService', () => ({ GunService: gun }));
vi.mock('@/services/relayManager', () => ({ RelayManager: relayManager, default: relayManager }));
vi.mock('@/services/discoveryService', () => ({ DiscoveryService: discovery, default: discovery }));
vi.mock('@/services/meshService', () => ({ MeshService: mesh }));
vi.mock('@/services/peerReputationService', () => ({ PeerReputationService: reputation }));

import { ResilienceService } from '@/services/resilienceService';

function installLocalStorage(): void {
  const store = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => { store.set(k, String(v)); },
    removeItem: (k: string) => { store.delete(k); },
    clear: () => { store.clear(); },
  };
}

function setConnected(connected: boolean, peers = 0): void {
  ws.getConnectionStatus.mockReturnValue(connected);
  ws.getPeerCount.mockReturnValue(peers);
  gun.getPeerStats.mockReturnValue({ isConnected: connected, peerCount: peers, connectedCount: peers });
}

function reset(): void {
  const s = ResilienceService as any;
  s.initialized = false;
  s.rendezvousActive = false;
  s.autoActivated = false;
  s.blackout = false;
  s.blackoutSince = null;
  s.lastReconvergeAt = null;
  s.evaluating = false;
  if (s.republishTimer) { clearInterval(s.republishTimer); s.republishTimer = null; }
  if (s.evaluateTimer) { clearInterval(s.evaluateTimer); s.evaluateTimer = null; }
  s.wsUnsubscribe = null;
}

beforeEach(() => {
  installLocalStorage();
  vi.clearAllMocks();
  setConnected(false, 0);
  reset();
});

afterEach(() => {
  ResilienceService.deactivateRendezvous();
  reset();
});

describe('ResilienceService blackout detection', () => {
  it('reports blackout purely from connectivity — a known-servers entry does NOT suppress it', () => {
    setConnected(false, 0);
    // Regression for the original bug: the self-seeded local known-server used to
    // keep blackout from ever being detected.
    ws.getKnownServers.mockReturnValue([{ websocket: 'wss://me', source: 'local' }]);
    expect((ResilienceService as any).detectBlackout()).toBe(true);
  });

  it('is not blackout when the WebSocket relay is connected', () => {
    setConnected(true, 0);
    expect((ResilienceService as any).detectBlackout()).toBe(false);
  });

  it('is not blackout when a peer is present', () => {
    ws.getConnectionStatus.mockReturnValue(false);
    gun.getPeerStats.mockReturnValue({ isConnected: false, peerCount: 0, connectedCount: 0 });
    ws.getPeerCount.mockReturnValue(1);
    expect((ResilienceService as any).detectBlackout()).toBe(false);
  });
});

describe('ResilienceService escalation ladder', () => {
  it('runs failover + gossip but does NOT escalate to rendezvous before the grace period', async () => {
    setConnected(false, 0);
    await (ResilienceService as any).evaluate();

    expect(relayManager.autoFailover).toHaveBeenCalledTimes(1);
    expect(discovery.refreshFromGun).toHaveBeenCalledTimes(1);
    // Grace not elapsed → no rendezvous, no aggressive recovery yet.
    expect(discovery.publishRendezvous).not.toHaveBeenCalled();
    expect(relayManager.recoverFromBlackout).not.toHaveBeenCalled();
    expect(ResilienceService.getStatus().rendezvousActive).toBe(false);
    expect(ResilienceService.getStatus().blackout).toBe(true);
  });

  it('escalates to rendezvous + blackout recovery once isolated past the grace period', async () => {
    setConnected(false, 0);
    // Simulate having been isolated longer than BLACKOUT_GRACE_MS.
    (ResilienceService as any).blackoutSince = Date.now() - 40_000;

    await (ResilienceService as any).evaluate();

    expect(mesh.setEnabled).toHaveBeenCalledWith(true);
    expect(discovery.subscribeRendezvous).toHaveBeenCalled();
    expect(discovery.publishRendezvous).toHaveBeenCalled();
    expect(relayManager.recoverFromBlackout).toHaveBeenCalledTimes(1);
    expect(ResilienceService.getStatus().rendezvousActive).toBe(true);
  });

  it('stands down auto-activated rendezvous once connectivity returns', async () => {
    const s = ResilienceService as any;
    s.rendezvousActive = true;
    s.autoActivated = true;
    setConnected(true, 0);

    await s.evaluate();

    expect(ResilienceService.getStatus().rendezvousActive).toBe(false);
    expect(s.blackoutSince).toBeNull();
  });

  it('does not invoke aggressive recovery while connectivity is healthy', async () => {
    setConnected(true, 1);
    await (ResilienceService as any).evaluate();
    expect(relayManager.recoverFromBlackout).not.toHaveBeenCalled();
    expect(discovery.publishRendezvous).not.toHaveBeenCalled();
  });
});

describe('ResilienceService signaling-substrate widening', () => {
  it('adds new discovery-learned Gun relays to the live pool (keeps mesh signaling alive)', async () => {
    gun.getDetailedPeerStats.mockReturnValue([{ url: 'https://a/gun', connected: true }]);
    discovery.getEntries.mockReturnValue([
      { gun: 'https://a/gun' }, // already connected → skipped
      { gun: 'https://b/gun' },
      { gun: 'https://c/gun' },
    ]);
    setConnected(true, 1); // healthy: widening still runs proactively

    await (ResilienceService as any).evaluate();

    expect(gun.addPeerDynamic).toHaveBeenCalledWith('https://b/gun');
    expect(gun.addPeerDynamic).toHaveBeenCalledWith('https://c/gun');
    expect(gun.addPeerDynamic).not.toHaveBeenCalledWith('https://a/gun');
  });

  it('respects the max-live-peers cap', async () => {
    // Already at capacity (8) → nothing added.
    gun.getDetailedPeerStats.mockReturnValue(
      Array.from({ length: 8 }, (_, i) => ({ url: `https://p${i}/gun`, connected: true })),
    );
    discovery.getEntries.mockReturnValue([{ gun: 'https://new/gun' }]);

    (ResilienceService as any).widenSignalingSubstrate();

    expect(gun.addPeerDynamic).not.toHaveBeenCalled();
  });
});
