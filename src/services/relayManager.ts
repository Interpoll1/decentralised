import config from '@/config';
import type { KnownServer } from './websocketService';
import { PeerReputationService } from './peerReputationService';

export interface RelayEndpoint {
  id: string;
  label: string;
  ws: string;
  gun: string;
  api: string;
  priority: number;
  isTor: boolean;
  addedAt: number;
  source?: 'configured' | 'discovered';
  trusted?: boolean;
  lastSeen?: number;
  latencyMs?: number;
  status: 'unknown' | 'online' | 'offline' | 'degraded';
}

export interface TransportStrategySettings {
  preferDecentralized: boolean;
  allowWssFallback: boolean;
  allowDiscoveredAutoSwitch: boolean;
  autoSwitch: boolean;
  discoveryTtlMs: number;
  maxFailuresBeforeCooldown: number;
  cooldownMs: number;
  healthProbeRequired: boolean;
}

export interface RelayListConfig {
  relays: RelayEndpoint[];
  activeRelayId: string | null;
  autoFailover: boolean;
  transport: TransportStrategySettings;
}

const STORAGE_KEY = 'interpoll_relay_list';
const LEGACY_AUTO_FAILOVER_KEY = 'interpoll_auto_failover';
const HEALTH_CHECK_INTERVAL = 60_000;
const PROBE_TIMEOUT = 8_000;
const RUNTIME_SWITCH_DEBOUNCE_MS = 1_500;
const MAX_DISCOVERED_RELAYS = 20;

const DEFAULT_TRANSPORT_SETTINGS: TransportStrategySettings = {
  preferDecentralized: true,
  allowWssFallback: true,
  allowDiscoveredAutoSwitch: false,
  autoSwitch: true,
  discoveryTtlMs: 5 * 60_000,
  maxFailuresBeforeCooldown: 3,
  cooldownMs: 120_000,
  healthProbeRequired: true,
};

interface SwitchFailureState {
  failures: number;
  cooldownUntil: number;
}

export class RelayManager {
  private static config: RelayListConfig = {
    relays: [],
    activeRelayId: null,
    autoFailover: true,
    transport: { ...DEFAULT_TRANSPORT_SETTINGS },
  };
  private static healthCheckTimer: ReturnType<typeof setTimeout> | null = null;
  private static runtimeSwitchTimer: ReturnType<typeof setTimeout> | null = null;
  private static wsStatusUnsubscribe: (() => void) | null = null;
  private static changeListeners: Array<(relays: RelayEndpoint[]) => void> = [];
  private static switchFailures = new Map<string, SwitchFailureState>();
  private static switching = false;
  private static stopped = false;
  private static initialized = false;

  static initialize(): void {
    this.stopped = false;
    this.config = this.load();

    if (this.config.relays.length === 0) {
      const defaultRelay: RelayEndpoint = {
        id: 'default',
        label: 'InterPoll (Render)',
        ws: config.relay.websocket,
        gun: config.relay.gun,
        api: config.relay.api,
        priority: 0,
        isTor: false,
        source: 'configured',
        trusted: true,
        addedAt: Date.now(),
        status: 'unknown',
      };
      this.config.relays.push(defaultRelay);
      this.config.activeRelayId = defaultRelay.id;
      this.persist();
    }

    if (
      this.config.activeRelayId &&
      !this.config.relays.some((r) => r.id === this.config.activeRelayId)
    ) {
      this.config.activeRelayId = this.config.relays[0]?.id ?? null;
      this.persist();
    }

    if (!this.initialized) {
      this.attachWebSocketStatusMonitor();
      this.initialized = true;
    }

    if (this.config.autoFailover) {
      this.startHealthChecks();
    }
  }

  static getRelayList(): RelayEndpoint[] {
    return [...this.config.relays].sort((a, b) => a.priority - b.priority);
  }

  static getTransportSettings(): TransportStrategySettings {
    return { ...this.config.transport };
  }

  static setTransportSettings(partial: Partial<TransportStrategySettings>): void {
    this.config.transport = {
      ...this.config.transport,
      ...partial,
      discoveryTtlMs: Math.max(30_000, partial.discoveryTtlMs ?? this.config.transport.discoveryTtlMs),
      maxFailuresBeforeCooldown: Math.max(1, partial.maxFailuresBeforeCooldown ?? this.config.transport.maxFailuresBeforeCooldown),
      cooldownMs: Math.max(10_000, partial.cooldownMs ?? this.config.transport.cooldownMs),
    };
    this.persist();
  }

  static addRelay(relay: Omit<RelayEndpoint, 'id' | 'addedAt' | 'status'>): string {
    if (!this.isEndpointSetSafe(relay.ws, relay.gun, relay.api)) {
      throw new Error('Relay endpoints use unsafe or invalid protocols for this environment');
    }

    const id = this.generateId();
    const endpoint: RelayEndpoint = {
      ...relay,
      source: relay.source ?? 'configured',
      trusted: relay.trusted ?? true,
      id,
      addedAt: Date.now(),
      status: 'unknown',
    };
    this.config.relays.push(endpoint);
    this.persist();
    this.notifyListeners();
    return id;
  }

  static removeRelay(id: string): void {
    if (this.config.relays.length <= 1) {
      console.warn('[RelayManager] Cannot remove the last relay');
      return;
    }
    const before = this.config.relays.length;
    this.config.relays = this.config.relays.filter((r) => r.id !== id);
    if (this.config.relays.length === before) return;

    if (this.config.activeRelayId === id) {
      this.config.activeRelayId = this.getRelayList()[0]?.id ?? null;
    }
    this.switchFailures.delete(id);
    this.persist();
    this.notifyListeners();
  }

  static setRelayPriority(id: string, priority: number): void {
    const relay = this.config.relays.find((r) => r.id === id);
    if (!relay) return;
    relay.priority = priority;
    this.persist();
    this.notifyListeners();
  }

  static getActiveRelay(): RelayEndpoint | null {
    if (!this.config.activeRelayId) return null;
    return this.config.relays.find((r) => r.id === this.config.activeRelayId) ?? null;
  }

  static async switchToRelay(id: string): Promise<void> {
    if (id === this.config.activeRelayId) return;
    if (this.switching) {
      console.warn('[RelayManager] Switch already in progress');
      return;
    }

    const relay = this.config.relays.find((r) => r.id === id);
    if (!relay) {
      console.warn(`[RelayManager] Relay ${id} not found`);
      return;
    }

    if (this.isInCooldown(id)) {
      console.warn(`[RelayManager] Relay ${id} is in cooldown; skipping switch`);
      return;
    }

    if (!this.isEndpointSetSafe(relay.ws, relay.gun, relay.api)) {
      this.noteFailure(id);
      throw new Error(`Unsafe relay endpoint protocols for ${relay.label}`);
    }

    if (this.config.transport.healthProbeRequired) {
      const probe = await this.probeRelay(relay);
      if (probe.status === 'offline') {
        this.noteFailure(id);
        throw new Error(`Relay ${relay.label} is not healthy enough to switch (${probe.status})`);
      }
    }

    this.switching = true;
    const previousId = this.config.activeRelayId;
    const previousOverrides = config.getRelayOverrides();
    try {
      config.setRelayOverrides({
        websocket: relay.ws,
        gun: relay.gun,
        api: relay.api,
      });

      const { WebSocketService } = await import('./websocketService');
      const { GunService } = await import('./gunService');
      WebSocketService.reconnect(relay.ws);
      GunService.reconnect(relay.gun);

      this.config.activeRelayId = id;
      this.clearFailure(id);
      this.persist();
      this.notifyListeners();
    } catch (e) {
      this.noteFailure(id);
      this.config.activeRelayId = previousId;
      config.resetRelayOverrides();
      config.setRelayOverrides(previousOverrides);
      try {
        const { WebSocketService: WS } = await import('./websocketService');
        const { GunService: GS } = await import('./gunService');
        WS.reconnect(previousOverrides.websocket);
        GS.reconnect(previousOverrides.gun);
      } catch {
        // Best-effort rollback
      }
      console.error('[RelayManager] Switch failed, rolling back', e);
      throw e;
    } finally {
      this.switching = false;
    }
  }

  static async probeRelay(relay: RelayEndpoint): Promise<RelayEndpoint> {
    const probe = { ...relay };
    let wsOk = false;
    let gunOk = false;
    let gunReachable = false;
    let apiOk = false;
    let latency = Infinity;

    if (!this.isEndpointSetSafe(probe.ws, probe.gun, probe.api)) {
      probe.status = 'offline';
      return probe;
    }

    try {
      const start = performance.now();
      await new Promise<void>((resolve, reject) => {
        const ws = new WebSocket(probe.ws);
        let settled = false;
        const timer = setTimeout(() => {
          if (!settled) {
            settled = true;
            ws.close();
            reject(new Error('timeout'));
          }
        }, PROBE_TIMEOUT);
        ws.onopen = () => {
          if (settled) return;
          settled = true;
          latency = Math.round(performance.now() - start);
          clearTimeout(timer);
          ws.close();
          resolve();
        };
        ws.onerror = () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          ws.close();
          reject(new Error('ws error'));
        };
        ws.onclose = () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          reject(new Error('ws closed'));
        };
      });
      wsOk = true;
    } catch {
      // WebSocket unreachable
    }

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT);
      const gunProbeUrl = probe.gun.includes('?')
        ? `${probe.gun}&relay_probe=1`
        : `${probe.gun}?relay_probe=1`;
      const res = await fetch(gunProbeUrl, {
        method: 'GET',
        signal: controller.signal,
        headers: { Accept: '*/*' },
        mode: 'no-cors',
        cache: 'no-store',
      });
      clearTimeout(timer);
      gunReachable = true;
      // no-cors probes return opaque responses (status 0) in browsers.
      // Keep those as reachable-but-unverified (degraded), not healthy.
      gunOk = res.ok || res.status === 404;
    } catch {
      // Gun endpoint unreachable
    }

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT);
      const healthUrl = probe.api.endsWith('/') ? `${probe.api}health` : `${probe.api}/health`;
      const res = await fetch(healthUrl, { signal: controller.signal });
      clearTimeout(timer);
      if (res.ok) {
        apiOk = true;
      } else if (res.status >= 400 && res.status < 500) {
        const controller2 = new AbortController();
        const timer2 = setTimeout(() => controller2.abort(), PROBE_TIMEOUT);
        const res2 = await fetch(probe.api, { signal: controller2.signal });
        clearTimeout(timer2);
        apiOk = res2.ok;
      }
    } catch {
      // Network failure — server unreachable
    }

    if (wsOk && gunOk && apiOk) {
      probe.status = 'online';
    } else if (wsOk && apiOk && gunReachable) {
      probe.status = 'degraded';
    } else if ((wsOk && gunOk) || (wsOk && apiOk) || (gunOk && apiOk)) {
      probe.status = 'degraded';
    } else {
      probe.status = 'offline';
    }

    probe.latencyMs = latency === Infinity ? undefined : latency;
    if (probe.status !== 'offline') {
      probe.lastSeen = Date.now();
    }

    // Feed the outcome into persistent reputation so failover can prefer
    // proven-good relays and demote flaky ones over time.
    if (probe.status === 'offline') {
      PeerReputationService.recordFailure(relay.id);
    } else {
      PeerReputationService.recordSuccess(relay.id);
    }

    const managed = this.config.relays.find((r) => r.id === relay.id);
    if (managed) {
      managed.status = probe.status;
      managed.latencyMs = probe.latencyMs;
      managed.lastSeen = probe.lastSeen;
      this.persist();
    }

    return probe;
  }

  static async probeAllRelays(): Promise<RelayEndpoint[]> {
    const results = await Promise.all(this.config.relays.map((r) => this.probeRelay(r)));
    this.persist();
    this.notifyListeners();
    return results;
  }

  static async autoFailover(): Promise<void> {
    await this.orchestrateConnectionSwitch('auto-failover');
  }

  /**
   * Aggressive last-resort recovery, used ONLY by ResilienceService during a
   * confirmed total blackout. Unlike normal failover, this dials
   * signature-verified relay endpoints that peers advertised via rendezvous / Gun
   * discovery — deliberately bypassing the conservative `allowDiscoveredAutoSwitch`
   * default and the `source === 'peer'` restriction in `getCandidateOrder`. The
   * justification is scoped to blackout: the only alternative is zero connectivity,
   * and every entry is already Schnorr-verified and protocol-safe (via
   * `DiscoveryService.normalizeAndValidate`). A hostile relay can censor/delay but
   * cannot forge signed content. Returns true if it managed to connect.
   */
  static async recoverFromBlackout(): Promise<boolean> {
    if (this.switching) return false;

    let entries: import('./discoveryService').DiscoveryEntry[];
    try {
      const { DiscoveryService } = await import('./discoveryService');
      entries = DiscoveryService.getEntries();
    } catch {
      return false;
    }
    if (!entries.length) return false;

    // Register each verified endpoint as a discovered relay (dedup by ws URL).
    const candidates: RelayEndpoint[] = [];
    for (const entry of entries) {
      const relay = this.upsertDiscoveredRelay({
        websocket: entry.websocket,
        gun: entry.gun,
        api: entry.api,
        addedBy: entry.peerId || entry.nodeId || 'rendezvous',
        firstSeen: entry.timestamp,
        source: 'gun',
        signatureValid: true,
        lastVerifiedAt: entry.timestamp,
        expiresAt: entry.expiresAt,
      });
      if (relay && relay.id !== this.config.activeRelayId) candidates.push(relay);
    }
    if (!candidates.length) return false;

    for (const candidate of this.byReputation(candidates)) {
      if (this.isInCooldown(candidate.id)) continue;
      const probed = await this.probeRelay(candidate);
      if (probed.status === 'offline') {
        this.noteFailure(candidate.id);
        continue;
      }
      try {
        await this.switchToRelay(candidate.id);
        return true;
      } catch {
        // Try the next verified candidate.
      }
    }
    return false;
  }

  static cleanup(): void {
    this.stopped = true;
    if (this.healthCheckTimer) {
      clearTimeout(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }
    if (this.runtimeSwitchTimer) {
      clearTimeout(this.runtimeSwitchTimer);
      this.runtimeSwitchTimer = null;
    }
    if (this.wsStatusUnsubscribe) {
      this.wsStatusUnsubscribe();
      this.wsStatusUnsubscribe = null;
    }
    this.changeListeners = [];
    this.switching = false;
    this.initialized = false;
  }

  static getGunPeerUrls(): string[] {
    return this.config.relays
      .filter((r) => r.status === 'online' || r.status === 'unknown')
      .map((r) => r.gun);
  }

  static onRelayListChange(callback: (relays: RelayEndpoint[]) => void): () => void {
    this.changeListeners.push(callback);
    return () => {
      this.changeListeners = this.changeListeners.filter((cb) => cb !== callback);
    };
  }

  static isEndpointSetSafe(ws: string, gun: string, api: string): boolean {
    let wsUrl: URL;
    let gunUrl: URL;
    let apiUrl: URL;

    try {
      wsUrl = new URL(ws);
      gunUrl = new URL(gun);
      apiUrl = new URL(api);
    } catch {
      return false;
    }

    if (!['ws:', 'wss:'].includes(wsUrl.protocol)) return false;
    if (!['http:', 'https:'].includes(gunUrl.protocol)) return false;
    if (!['http:', 'https:'].includes(apiUrl.protocol)) return false;

    const envSecure = typeof location !== 'undefined' && location.protocol === 'https:';
    const localhostHosts = new Set(['localhost', '127.0.0.1', '::1']);
    const isLocal = (u: URL) => localhostHosts.has(u.hostname);

    if (!envSecure) {
      return true;
    }

    const wsSafe = wsUrl.protocol === 'wss:' || isLocal(wsUrl);
    const gunSafe = gunUrl.protocol === 'https:' || isLocal(gunUrl);
    const apiSafe = apiUrl.protocol === 'https:' || isLocal(apiUrl);
    return wsSafe && gunSafe && apiSafe;
  }

  private static persist(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.config));
    } catch (e) {
      console.warn('[RelayManager] Failed to persist relay list', e);
    }
  }

  private static load(): RelayListConfig {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const legacyAutoFailover = localStorage.getItem(LEGACY_AUTO_FAILOVER_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (
          Array.isArray(parsed.relays) &&
          parsed.relays.every((r: unknown) => {
            const e = r as Record<string, unknown>;
            return (
              typeof e.id === 'string' &&
              typeof e.ws === 'string' &&
              typeof e.gun === 'string' &&
              typeof e.api === 'string' &&
              typeof e.priority === 'number'
            );
          }) &&
          (parsed.activeRelayId === null || typeof parsed.activeRelayId === 'string')
        ) {
          return {
             relays: (parsed.relays as RelayEndpoint[]).map((relay) => ({
               ...relay,
               source: relay.source ?? 'configured',
               trusted: relay.trusted ?? (relay.source !== 'discovered'),
             })),
            activeRelayId: parsed.activeRelayId ?? null,
            autoFailover: typeof parsed.autoFailover === 'boolean'
              ? parsed.autoFailover
              : legacyAutoFailover !== 'false',
            transport: {
              ...DEFAULT_TRANSPORT_SETTINGS,
              ...(parsed.transport as Partial<TransportStrategySettings> | undefined),
            },
          };
        }
      }
    } catch {
      // Corrupt data — reset
    }

    return {
      relays: [],
      activeRelayId: null,
      autoFailover: localStorage.getItem(LEGACY_AUTO_FAILOVER_KEY) !== 'false',
      transport: { ...DEFAULT_TRANSPORT_SETTINGS },
    };
  }

  private static generateId(): string {
    return `relay-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  private static notifyListeners(): void {
    const list = this.getRelayList();
    for (const cb of this.changeListeners) {
      try {
        cb(list);
      } catch (e) {
        console.warn('[RelayManager] Listener error', e);
      }
    }
  }

  private static startHealthChecks(): void {
    if (this.healthCheckTimer) return;
    const tick = async () => {
      try {
        await this.probeAllRelays();
        const active = this.getActiveRelay();
        if (
          active &&
          (active.status === 'offline' || active.status === 'degraded') &&
          this.config.autoFailover &&
          this.config.transport.autoSwitch
        ) {
          await this.orchestrateConnectionSwitch('health-check');
        }
      } catch (e) {
        console.warn('[RelayManager] Health-check cycle failed', e);
      } finally {
        if (!this.stopped) {
          this.healthCheckTimer = setTimeout(tick, HEALTH_CHECK_INTERVAL);
        }
      }
    };
    this.healthCheckTimer = setTimeout(tick, HEALTH_CHECK_INTERVAL);
  }

  private static attachWebSocketStatusMonitor(): void {
    void (async () => {
      try {
        const { WebSocketService } = await import('./websocketService');
        this.wsStatusUnsubscribe = WebSocketService.onStatusChange(({ connected }) => {
          if (connected) {
            if (this.runtimeSwitchTimer) {
              clearTimeout(this.runtimeSwitchTimer);
              this.runtimeSwitchTimer = null;
            }
            return;
          }

          if (!this.config.autoFailover || !this.config.transport.autoSwitch) {
            return;
          }
          if (this.runtimeSwitchTimer) {
            clearTimeout(this.runtimeSwitchTimer);
          }
          this.runtimeSwitchTimer = setTimeout(() => {
            this.runtimeSwitchTimer = null;
            void this.orchestrateConnectionSwitch('runtime-disconnect');
          }, RUNTIME_SWITCH_DEBOUNCE_MS);
        });
      } catch (e) {
        console.warn('[RelayManager] Unable to attach WebSocket monitor', e);
      }
    })();
  }

  private static async orchestrateConnectionSwitch(reason: string): Promise<void> {
    if (this.switching) return;

    const candidates = await this.getCandidateOrder();
    for (const candidate of candidates) {
      if (candidate.id === this.config.activeRelayId) continue;
      if (this.isInCooldown(candidate.id)) continue;

      const probed = await this.probeRelay(candidate);
      if (probed.status === 'offline') {
        this.noteFailure(candidate.id);
        continue;
      }

      try {
        await this.switchToRelay(candidate.id);
        return;
      } catch (e) {
        console.warn(`[RelayManager] Switch attempt failed (${reason}) for ${candidate.id}`, e);
      }
    }

    console.warn(`[RelayManager] No candidate passed strategy checks for ${reason}`);
  }

  private static async getCandidateOrder(): Promise<RelayEndpoint[]> {
    const configured = this.byReputation(
      this.getRelayList().filter((r) => r.id !== this.config.activeRelayId),
    );

    if (!this.config.transport.preferDecentralized) {
      return configured;
    }

    if (!this.config.transport.allowDiscoveredAutoSwitch) {
      return configured;
    }

    const discovered = this.byReputation(await this.getFreshVerifiedDiscoveredRelays());
    if (!this.config.transport.allowWssFallback) {
      return discovered;
    }

    const discoveredIds = new Set(discovered.map((r) => r.id));
    const fallbackConfigured = configured.filter((r) => !discoveredIds.has(r.id));
    return [...discovered, ...fallbackConfigured];
  }

  /**
   * Stable reorder that keeps the existing priority ordering as the primary key
   * and uses persistent reputation only as a tiebreaker (proven-good relays win
   * ties). Never reshuffles relays of differing priority.
   */
  private static byReputation(relays: RelayEndpoint[]): RelayEndpoint[] {
    return [...relays]
      .map((relay, index) => ({ relay, index, score: PeerReputationService.scoreFor(relay.id) }))
      .sort((a, b) => a.relay.priority - b.relay.priority || b.score - a.score || a.index - b.index)
      .map((entry) => entry.relay);
  }

  private static async getFreshVerifiedDiscoveredRelays(): Promise<RelayEndpoint[]> {
    try {
      const { WebSocketService } = await import('./websocketService');
      const discovered = WebSocketService
        .getKnownServers()
        .filter((server) => this.isDiscoveredServerEligible(server))
        .map((server) => this.upsertDiscoveredRelay(server))
        .filter((relay): relay is RelayEndpoint => relay !== null)
        .sort((a, b) => a.priority - b.priority);
      return discovered;
    } catch (e) {
      console.warn('[RelayManager] Failed to load discovered relays', e);
      return [];
    }
  }

  private static isDiscoveredServerEligible(server: KnownServer): boolean {
    if (!server.signatureValid || server.source !== 'peer') {
      return false;
    }

    const now = Date.now();
    if (typeof server.expiresAt === 'number' && server.expiresAt < now) {
      return false;
    }

    const verifiedAt = typeof server.lastVerifiedAt === 'number' ? server.lastVerifiedAt : server.firstSeen;
    return now - verifiedAt <= this.config.transport.discoveryTtlMs;
  }

  private static upsertDiscoveredRelay(server: KnownServer): RelayEndpoint | null {
    if (!this.isEndpointSetSafe(server.websocket, server.gun, server.api)) {
      return null;
    }

    const existing = this.config.relays.find((r) => r.ws === server.websocket);
    if (existing) {
      existing.source = existing.source ?? (server.source === 'peer' ? 'discovered' : 'configured');
      if (typeof server.firstSeen === 'number') {
        existing.lastSeen = server.firstSeen;
      }
      return existing;
    }

    let hostname = 'relay';
    try {
      hostname = new URL(server.websocket).hostname;
    } catch {
      // keep fallback label
    }

    const relay: RelayEndpoint = {
      id: this.generateId(),
      label: `Discovered (${hostname})`,
      ws: server.websocket,
      gun: server.gun,
      api: server.api,
      priority: -100,
      isTor: false,
      source: 'discovered',
      trusted: false,
      addedAt: Date.now(),
      lastSeen: server.firstSeen,
      status: 'unknown',
    };

    const discoveredRelays = this.config.relays.filter((r) => r.source === 'discovered');
    if (discoveredRelays.length >= MAX_DISCOVERED_RELAYS) {
      discoveredRelays
        .sort((a, b) => (a.lastSeen ?? a.addedAt) - (b.lastSeen ?? b.addedAt))
        .slice(0, discoveredRelays.length - MAX_DISCOVERED_RELAYS + 1)
        .forEach((oldRelay) => {
          this.config.relays = this.config.relays.filter((r) => r.id !== oldRelay.id);
        });
    }

    this.config.relays.push(relay);
    this.persist();
    this.notifyListeners();
    return relay;
  }

  private static noteFailure(relayId: string): void {
    const state = this.switchFailures.get(relayId) ?? { failures: 0, cooldownUntil: 0 };
    state.failures += 1;

    if (state.failures >= this.config.transport.maxFailuresBeforeCooldown) {
      state.cooldownUntil = Date.now() + this.config.transport.cooldownMs;
      state.failures = 0;
      console.warn(`[RelayManager] Cooldown active for relay ${relayId}`);
    }

    this.switchFailures.set(relayId, state);
  }

  private static clearFailure(relayId: string): void {
    this.switchFailures.delete(relayId);
  }

  private static isInCooldown(relayId: string): boolean {
    const state = this.switchFailures.get(relayId);
    if (!state) return false;
    if (state.cooldownUntil <= Date.now()) {
      this.switchFailures.delete(relayId);
      return false;
    }
    return true;
  }
}

export default RelayManager;
