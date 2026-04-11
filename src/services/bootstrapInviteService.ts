import { GunService } from './gunService';
import { RelayManager } from './relayManager';

export interface BootstrapEndpoint {
  websocket: string;
  gun: string;
  api: string;
  label?: string;
  isTor?: boolean;
  priority?: number;
}

export interface BootstrapSignatureMetadata {
  alg: string;
  sig: string;
  keyId?: string;
  signedFields?: string[];
}

export interface BootstrapInviteStatus {
  wsConnected: boolean;
  gunConnected: boolean;
  peerCount: number;
  blockHeight: number;
  postCount: number;
  pollCount: number;
  generatedAt: number;
}

export interface BootstrapInviteHandoff {
  sourcePeerId?: string;
  connectedServer?: BootstrapEndpoint;
  status?: BootstrapInviteStatus;
}

export interface BootstrapInviteArtifactV1 {
  kind: 'interpoll-bootstrap';
  version: 1;
  issuedAt: number;
  expiresAt?: number;
  endpoint: BootstrapEndpoint;
  handoff?: BootstrapInviteHandoff;
  capabilities?: {
    seedsRelayList?: boolean;
    supportsGunDiscovery?: boolean;
    requiresManualConfirm?: boolean;
  };
  signature?: BootstrapSignatureMetadata;
  meta?: {
    createdBy?: string;
    note?: string;
  };
}

const BOOTSTRAP_PREFIX = 'interpoll-bootstrap://';
const GUN_DISCOVERY_KEYS = ['bootstrap', 'bootstrap-v1', 'relays', 'servers', 'primary'];

function base64UrlEncode(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlDecode(text: string): string {
  const normalized = text.replace(/-/g, '+').replace(/_/g, '/');
  const padding = '='.repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(normalized + padding);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function normalizeEndpoint(value: unknown): BootstrapEndpoint | null {
  if (!value || typeof value !== 'object') return null;
  const input = value as Record<string, unknown>;

  const websocket = typeof input.websocket === 'string'
    ? input.websocket
    : typeof input.ws === 'string'
      ? input.ws
      : '';
  const gun = typeof input.gun === 'string' ? input.gun : '';
  const api = typeof input.api === 'string' ? input.api : '';
  const label = typeof input.label === 'string' ? input.label : undefined;
  const isTor = typeof input.isTor === 'boolean' ? input.isTor : undefined;
  const priority = typeof input.priority === 'number' ? input.priority : undefined;

  if (!websocket || !gun || !api) return null;
  return { websocket, gun, api, label, isTor, priority };
}

function collectEndpoints(value: unknown, out: BootstrapEndpoint[]): void {
  if (!value) return;
  const endpoint = normalizeEndpoint(value);
  if (endpoint) {
    out.push(endpoint);
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) collectEndpoints(item, out);
    return;
  }

  if (typeof value === 'object') {
    for (const nested of Object.values(value as Record<string, unknown>)) {
      collectEndpoints(nested, out);
    }
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(fallback), timeoutMs);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch(() => {
        clearTimeout(timer);
        resolve(fallback);
      });
  });
}

function readGunNodeOnce(node: { once: (cb: (data: unknown) => void) => void }, timeoutMs: number): Promise<unknown> {
  return withTimeout(
    new Promise((resolve) => {
      node.once((data: unknown) => resolve(data));
    }),
    timeoutMs,
    null,
  );
}

export class BootstrapInviteService {
  static createInvite(
    endpoint: BootstrapEndpoint,
    opts?: {
      expiresAt?: number;
      signature?: BootstrapSignatureMetadata;
      note?: string;
      createdBy?: string;
      handoff?: BootstrapInviteHandoff;
    },
  ): string {
    const artifact: BootstrapInviteArtifactV1 = {
      kind: 'interpoll-bootstrap',
      version: 1,
      issuedAt: Date.now(),
      expiresAt: opts?.expiresAt,
      endpoint,
      handoff: opts?.handoff,
      capabilities: {
        seedsRelayList: true,
        supportsGunDiscovery: true,
        requiresManualConfirm: true,
      },
      signature: opts?.signature,
      meta: {
        createdBy: opts?.createdBy,
        note: opts?.note,
      },
    };

    const compact = JSON.stringify(artifact);
    return `${BOOTSTRAP_PREFIX}${base64UrlEncode(compact)}`;
  }

  static parseInvite(input: string): BootstrapInviteArtifactV1 {
    const trimmed = input.trim();
    if (!trimmed) {
      throw new Error('Bootstrap invite is empty');
    }

    let rawPayload = trimmed;
    if (trimmed.startsWith(BOOTSTRAP_PREFIX)) {
      const encoded = trimmed.slice(BOOTSTRAP_PREFIX.length);
      try {
        rawPayload = base64UrlDecode(encoded);
      } catch {
        throw new Error('Bootstrap invite is not valid base64url payload');
      }
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawPayload);
    } catch {
      throw new Error('Bootstrap invite is not valid JSON/base64url payload');
    }

    if (!parsed || typeof parsed !== 'object') {
      throw new Error('Bootstrap invite has invalid structure');
    }

    const obj = parsed as Record<string, unknown>;
    if (obj.kind !== 'interpoll-bootstrap' || obj.version !== 1) {
      throw new Error('Unsupported bootstrap artifact version');
    }

    const endpoint = normalizeEndpoint(obj.endpoint);
    if (!endpoint) {
      throw new Error('Bootstrap invite endpoint is incomplete');
    }

    const issuedAt = typeof obj.issuedAt === 'number' ? obj.issuedAt : Date.now();
    const expiresAt = typeof obj.expiresAt === 'number' ? obj.expiresAt : undefined;
    if (expiresAt && expiresAt < Date.now()) {
      throw new Error('Bootstrap invite is expired');
    }

    const handoffRaw = obj.handoff;
    const handoff = (handoffRaw && typeof handoffRaw === 'object')
      ? (() => {
          const handoffObj = handoffRaw as Record<string, unknown>;
          const sourcePeerId = typeof handoffObj.sourcePeerId === 'string'
            ? handoffObj.sourcePeerId
            : undefined;
          const connectedServer = handoffObj.connectedServer
            ? (normalizeEndpoint(handoffObj.connectedServer) ?? undefined)
            : undefined;

          const statusRaw = handoffObj.status;
          const hasValidStatus = statusRaw && typeof statusRaw === 'object'
            && typeof (statusRaw as Record<string, unknown>).wsConnected === 'boolean'
            && typeof (statusRaw as Record<string, unknown>).gunConnected === 'boolean'
            && typeof (statusRaw as Record<string, unknown>).peerCount === 'number'
            && typeof (statusRaw as Record<string, unknown>).blockHeight === 'number'
            && typeof (statusRaw as Record<string, unknown>).postCount === 'number'
            && typeof (statusRaw as Record<string, unknown>).pollCount === 'number'
            && typeof (statusRaw as Record<string, unknown>).generatedAt === 'number';
          const status = hasValidStatus
            ? {
                wsConnected: (statusRaw as Record<string, unknown>).wsConnected as boolean,
                gunConnected: (statusRaw as Record<string, unknown>).gunConnected as boolean,
                peerCount: (statusRaw as Record<string, unknown>).peerCount as number,
                blockHeight: (statusRaw as Record<string, unknown>).blockHeight as number,
                postCount: (statusRaw as Record<string, unknown>).postCount as number,
                pollCount: (statusRaw as Record<string, unknown>).pollCount as number,
                generatedAt: (statusRaw as Record<string, unknown>).generatedAt as number,
              }
            : undefined;

          return { sourcePeerId, connectedServer, status };
        })()
      : undefined;

    const capabilitiesRaw = obj.capabilities;
    const capabilities = (capabilitiesRaw && typeof capabilitiesRaw === 'object')
      ? {
          seedsRelayList: typeof (capabilitiesRaw as Record<string, unknown>).seedsRelayList === 'boolean'
            ? (capabilitiesRaw as Record<string, unknown>).seedsRelayList as boolean
            : undefined,
          supportsGunDiscovery: typeof (capabilitiesRaw as Record<string, unknown>).supportsGunDiscovery === 'boolean'
            ? (capabilitiesRaw as Record<string, unknown>).supportsGunDiscovery as boolean
            : undefined,
          requiresManualConfirm: typeof (capabilitiesRaw as Record<string, unknown>).requiresManualConfirm === 'boolean'
            ? (capabilitiesRaw as Record<string, unknown>).requiresManualConfirm as boolean
            : undefined,
        }
      : undefined;

    const signatureRaw = obj.signature;
    const signature = (signatureRaw && typeof signatureRaw === 'object')
      ? {
          alg: typeof (signatureRaw as Record<string, unknown>).alg === 'string'
            ? (signatureRaw as Record<string, unknown>).alg as string
            : '',
          sig: typeof (signatureRaw as Record<string, unknown>).sig === 'string'
            ? (signatureRaw as Record<string, unknown>).sig as string
            : '',
          keyId: typeof (signatureRaw as Record<string, unknown>).keyId === 'string'
            ? (signatureRaw as Record<string, unknown>).keyId as string
            : undefined,
          signedFields: Array.isArray((signatureRaw as Record<string, unknown>).signedFields)
            ? (signatureRaw as Record<string, unknown>).signedFields
              .filter((field): field is string => typeof field === 'string')
            : undefined,
        }
      : undefined;

    if (signature && (!signature.alg || !signature.sig)) {
      throw new Error('Bootstrap signature metadata is malformed');
    }

    const metaRaw = obj.meta;
    const meta = (metaRaw && typeof metaRaw === 'object')
      ? {
          createdBy: typeof (metaRaw as Record<string, unknown>).createdBy === 'string'
            ? (metaRaw as Record<string, unknown>).createdBy as string
            : undefined,
          note: typeof (metaRaw as Record<string, unknown>).note === 'string'
            ? (metaRaw as Record<string, unknown>).note as string
            : undefined,
        }
      : undefined;

    return {
      kind: 'interpoll-bootstrap',
      version: 1,
      issuedAt,
      expiresAt,
      endpoint,
      handoff,
      capabilities,
      signature,
      meta,
    };
  }

  static validateEndpoint(endpoint: BootstrapEndpoint): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    try {
      const ws = new URL(endpoint.websocket);
      if (!['wss:', 'ws:'].includes(ws.protocol)) {
        errors.push('WebSocket URL must use ws:// or wss://');
      }
    } catch {
      errors.push('WebSocket URL is invalid');
    }

    try {
      const gun = new URL(endpoint.gun);
      if (!['https:', 'http:'].includes(gun.protocol)) {
        errors.push('Gun URL must use http:// or https://');
      }
    } catch {
      errors.push('Gun URL is invalid');
    }

    try {
      const api = new URL(endpoint.api);
      if (!['https:', 'http:'].includes(api.protocol)) {
        errors.push('API URL must use http:// or https://');
      }
    } catch {
      errors.push('API URL is invalid');
    }

    if (errors.length === 0 && !RelayManager.isEndpointSetSafe(endpoint.websocket, endpoint.gun, endpoint.api)) {
      errors.push('Endpoint protocols are unsafe for the current environment');
    }

    return { valid: errors.length === 0, errors };
  }

  static async discoverFromGun(timeoutMs = 4000): Promise<BootstrapEndpoint[]> {
    const gun = GunService.getGun();
    const root = gun.get('server-config');
    const endpoints: BootstrapEndpoint[] = [];

    const rootData = await readGunNodeOnce(root, timeoutMs);
    collectEndpoints(rootData, endpoints);

    const branchResults = await Promise.all(
      GUN_DISCOVERY_KEYS.map((key) => readGunNodeOnce(root.get(key), timeoutMs)),
    );
    for (const data of branchResults) {
      collectEndpoints(data, endpoints);
    }

    const deduped = new Map<string, BootstrapEndpoint>();
    for (const endpoint of endpoints) {
      const validation = this.validateEndpoint(endpoint);
      if (!validation.valid) continue;
      const dedupeKey = `${endpoint.websocket}|${endpoint.gun}|${endpoint.api}`;
      if (!deduped.has(dedupeKey)) deduped.set(dedupeKey, endpoint);
    }

    return Array.from(deduped.values());
  }
}
