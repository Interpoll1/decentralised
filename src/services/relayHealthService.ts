import type { RelayEndpoint } from './relayManager';

export interface ProbeOutcome {
  reachable: boolean;
  latencyMs: number;
  error?: string;
}

export interface RelayProbeResult {
  relayId: string;
  ws: ProbeOutcome;
  gun: ProbeOutcome;
  api: ProbeOutcome;
  overall: 'online' | 'offline' | 'degraded';
  probedAt: number;
}

export class RelayHealthService {
  static isTorBrowser(): boolean {
    try {
      const noPlugins = navigator.plugins.length === 0;
      const fullWidthWindow = window.screen.width === window.innerWidth;
      const fullHeightWindow = window.screen.height === window.innerHeight;
      return noPlugins && fullWidthWindow && fullHeightWindow;
    } catch {
      return false;
    }
  }

  private static async fetchWithTimeout(url: string, timeoutMs: number): Promise<ProbeOutcome> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const start = performance.now();

    try {
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timer);
      const latencyMs = Math.round(performance.now() - start);
      return { reachable: res.ok, latencyMs, error: res.ok ? undefined : `HTTP ${res.status}` };
    } catch (e) {
      clearTimeout(timer);
      const latencyMs = Math.round(performance.now() - start);
      const error = controller.signal.aborted ? 'Connection timed out' : String(e);
      return { reachable: false, latencyMs, error };
    }
  }

  static async probeWebSocket(url: string, timeoutMs = 5000): Promise<ProbeOutcome> {
    if (url.includes('.onion') && !RelayHealthService.isTorBrowser()) {
      return { reachable: false, latencyMs: 0, error: 'Tor Browser required for .onion addresses' };
    }

    const start = performance.now();
    return new Promise((resolve) => {
      let settled = false;
      const settle = (result: ProbeOutcome) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(result);
      };

      const timer = setTimeout(() => {
        try { ws.close(); } catch { /* ignore */ }
        settle({ reachable: false, latencyMs: timeoutMs, error: 'Connection timed out' });
      }, timeoutMs);

      let ws: WebSocket;
      try {
        ws = new WebSocket(url);
      } catch (e) {
        settle({ reachable: false, latencyMs: 0, error: String(e) });
        return;
      }

      ws.onopen = () => {
        const latencyMs = Math.round(performance.now() - start);
        ws.close();
        settle({ reachable: true, latencyMs });
      };
      ws.onclose = (event) => {
        const latencyMs = Math.round(performance.now() - start);
        if (event.code !== 1000) {
          settle({ reachable: false, latencyMs, error: `WebSocket closed (code ${event.code})` });
        } else {
          // Server closed cleanly before onopen — treat as unreachable
          settle({ reachable: false, latencyMs, error: 'Server closed before handshake' });
        }
      };
      ws.onerror = () => {
        // Error details arrive via onclose — intentional no-op
      };
    });
  }

  static async probeGun(url: string, timeoutMs = 5000): Promise<ProbeOutcome> {
    return RelayHealthService.fetchWithTimeout(url, timeoutMs);
  }

  static async probeApi(url: string, timeoutMs = 5000): Promise<ProbeOutcome> {
    const deadline = performance.now() + timeoutMs;

    const healthResult = await RelayHealthService.fetchWithTimeout(`${url}/health`, timeoutMs);
    if (healthResult.reachable) return healthResult;

    // Fall back to base URL with remaining time budget
    const remaining = Math.max(0, Math.round(deadline - performance.now()));
    if (remaining <= 0) {
      return { reachable: false, latencyMs: timeoutMs, error: 'Connection timed out' };
    }
    return RelayHealthService.fetchWithTimeout(url, remaining);
  }

  static async probeRelay(relay: RelayEndpoint): Promise<RelayProbeResult> {
    const [ws, gun, api] = await Promise.all([
      RelayHealthService.probeWebSocket(relay.ws),
      RelayHealthService.probeGun(relay.gun),
      RelayHealthService.probeApi(relay.api),
    ]);

    const reachableCount = [ws.reachable, gun.reachable, api.reachable].filter(Boolean).length;
    let overall: RelayProbeResult['overall'];
    if (reachableCount === 3) overall = 'online';
    else if (reachableCount === 0) overall = 'offline';
    else overall = 'degraded';

    return { relayId: relay.id, ws, gun, api, overall, probedAt: Date.now() };
  }

  static async probeAll(relays: RelayEndpoint[], concurrency = 3): Promise<RelayProbeResult[]> {
    const results: RelayProbeResult[] = [];
    for (let i = 0; i < relays.length; i += concurrency) {
      const batch = relays.slice(i, i + concurrency);
      const settled = await Promise.allSettled(batch.map((r) => RelayHealthService.probeRelay(r)));
      for (const entry of settled) {
        if (entry.status === 'fulfilled') results.push(entry.value);
      }
    }
    return results;
  }

  static detectCensorship(
    results: RelayProbeResult[],
    relays: RelayEndpoint[],
  ): { blocked: RelayEndpoint[]; reachable: RelayEndpoint[]; torRequired: RelayEndpoint[] } {
    const relayMap = new Map(relays.map((r) => [r.id, r]));
    const blocked: RelayEndpoint[] = [];
    const reachable: RelayEndpoint[] = [];
    const torRequired: RelayEndpoint[] = [];

    for (const result of results) {
      const relay = relayMap.get(result.relayId);
      if (!relay) continue;

      if (relay.isTor && result.overall === 'offline') {
        torRequired.push(relay);
      } else if (result.overall === 'offline') {
        blocked.push(relay);
      } else {
        reachable.push(relay);
      }
    }

    return { blocked, reachable, torRequired };
  }
}
