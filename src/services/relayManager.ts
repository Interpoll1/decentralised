import config from '@/config';

export interface RelayEndpoint {
  id: string;
  label: string;
  ws: string;
  gun: string;
  api: string;
  priority: number;
  isTor: boolean;
  addedAt: number;
  lastSeen?: number;
  latencyMs?: number;
  status: 'unknown' | 'online' | 'offline' | 'degraded';
}

export interface RelayListConfig {
  relays: RelayEndpoint[];
  activeRelayId: string | null;
  autoFailover: boolean;
}

const STORAGE_KEY = 'interpoll_relay_list';
const HEALTH_CHECK_INTERVAL = 60_000;
const PROBE_TIMEOUT = 8_000;

export class RelayManager {
  private static config: RelayListConfig = {
    relays: [],
    activeRelayId: null,
    autoFailover: true,
  };
  private static healthCheckTimer: ReturnType<typeof setTimeout> | null = null;
  private static changeListeners: Array<(relays: RelayEndpoint[]) => void> = [];
  private static switching = false;
  private static stopped = false;

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
        addedAt: Date.now(),
        status: 'unknown',
      };
      this.config.relays.push(defaultRelay);
      this.config.activeRelayId = defaultRelay.id;
      this.persist();
    }

    // Fix dangling activeRelayId reference
    if (
      this.config.activeRelayId &&
      !this.config.relays.some((r) => r.id === this.config.activeRelayId)
    ) {
      this.config.activeRelayId = this.config.relays[0]?.id ?? null;
      this.persist();
    }

    if (this.config.autoFailover) {
      this.startHealthChecks();
    }
  }

  static getRelayList(): RelayEndpoint[] {
    return [...this.config.relays].sort((a, b) => a.priority - b.priority);
  }

  static addRelay(relay: Omit<RelayEndpoint, 'id' | 'addedAt' | 'status'>): string {
    const id = this.generateId();
    const endpoint: RelayEndpoint = {
      ...relay,
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
      this.persist();
      this.notifyListeners();
    } catch (e) {
      this.config.activeRelayId = previousId;
      config.setRelayOverrides(previousOverrides);
      try {
        const { WebSocketService: WS } = await import('./websocketService');
        const { GunService: GS } = await import('./gunService');
        WS.reconnect(previousOverrides.websocket);
        GS.reconnect(previousOverrides.gun);
      } catch { /* best-effort rollback */ }
      console.error('[RelayManager] Switch failed, rolling back', e);
      throw e;
    } finally {
      this.switching = false;
    }
  }

  static async probeRelay(relay: RelayEndpoint): Promise<RelayEndpoint> {
    const probe = { ...relay };
    let wsOk = false;
    let apiOk = false;
    let latency = Infinity;

    // WebSocket probe
    try {
      const start = performance.now();
      await new Promise<void>((resolve, reject) => {
        const ws = new WebSocket(probe.ws);
        let settled = false;
        const timer = setTimeout(() => {
          if (!settled) { settled = true; ws.close(); reject(new Error('timeout')); }
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

    // API probe
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT);
      const healthUrl = probe.api.endsWith('/') ? `${probe.api}health` : `${probe.api}/health`;
      const res = await fetch(healthUrl, { signal: controller.signal });
      clearTimeout(timer);
      if (res.ok) {
        apiOk = true;
      } else if (res.status >= 400 && res.status < 500) {
        // /health endpoint likely doesn't exist — try base URL
        const controller2 = new AbortController();
        const timer2 = setTimeout(() => controller2.abort(), PROBE_TIMEOUT);
        const res2 = await fetch(probe.api, { signal: controller2.signal });
        clearTimeout(timer2);
        apiOk = res2.ok;
      }
    } catch {
      // Network failure — server unreachable
    }

    if (wsOk && apiOk) {
      probe.status = 'online';
    } else if (wsOk || apiOk) {
      probe.status = 'degraded';
    } else {
      probe.status = 'offline';
    }

    probe.latencyMs = latency === Infinity ? undefined : latency;
    if (probe.status !== 'offline') {
      probe.lastSeen = Date.now();
    }

    // Apply results to the managed relay if it exists
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
    const sorted = this.getRelayList();
    const candidate = sorted.find((r) => r.status === 'online' && r.id !== this.config.activeRelayId);
    if (candidate) {
      console.warn(`[RelayManager] Auto-failover: switching to "${candidate.label}" (${candidate.id})`);
      await this.switchToRelay(candidate.id);
    } else {
      console.warn('[RelayManager] Auto-failover: no online relay available');
    }
  }

  static cleanup(): void {
    this.stopped = true;
    if (this.healthCheckTimer) {
      clearTimeout(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }
    this.changeListeners = [];
    this.switching = false;
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

  // -- Private helpers --

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
            relays: parsed.relays as RelayEndpoint[],
            activeRelayId: parsed.activeRelayId ?? null,
            autoFailover: parsed.autoFailover !== false,
          };
        }
      }
    } catch {
      // Corrupt data — reset
    }
    return { relays: [], activeRelayId: null, autoFailover: true };
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
        if (active && (active.status === 'offline' || active.status === 'degraded')) {
          await this.autoFailover();
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
}

export default RelayManager;
