/**
 * GenosDB service — the app's entire data, P2P sync and persistence layer.
 *
 * Replaces the former Gun-based service: manual namespacing, relay probing,
 * WebSocket health tracking, RAM eviction and flood throttling are all gone.
 * GenosDB provides scoped OPFS storage, Nostr-based signaling and reactive
 * queries natively — so this file is the single initialization point.
 *
 * Usage:
 *   import { db } from '@/services/gdbServices';
 *   const id = await db.put({ type: 'poll', question: '...' });
 *   await db.map({ query: { type: 'poll' } }, ({ id, value, action }) => { ... });
 */
import { gdb } from 'genosdb'

/** Database identifier — also serves as the P2P room name. */
export const GDB_NAME = 'interpoll'

/**
 * Bootstrap superadmin Ethereum addresses.
 *
 * The Security Manager requires at least one superadmin to initialise the RBAC
 * system. These addresses can assign roles to other peers; everyone else starts
 * as a signed `user`. Replace/extend for your own deployment.
 */
export const SUPER_ADMINS = ['0xE5639DfE345F8ab845bEBE63a1C7322F9c6fF5c7']

/**
 * Single shared GenosDB instance — the app's entire data, identity and P2P layer.
 *
 * Top-level await initialises it once at module load; every importer receives
 * the ready instance.
 *
 * - `rtc: true` — real-time P2P sync over decentralized Nostr signaling
 *   (no relay servers to run, no peer URLs to probe or manage).
 * - `sm` — Security Manager: WebAuthn/BIP39 identity, automatic signing of every
 *   operation, and RBAC. Replaces the hand-rolled Schnorr keypair, manual
 *   sign/verify and device-id identity of the former Gun-based stack.
 */
/**
 * Open-participation roles. InterPoll is a public platform, so the base `guest`
 * role can `write` and `link` — every signed identity can post, vote and comment
 * the moment it exists, with no admin promotion step. Authenticity is unchanged
 * (each operation is still signed and verified by peers); we only relax
 * *authorization* so the network is open by default. Elevated roles remain for
 * moderation/administration.
 */
const OPEN_ROLES = {
  superadmin: { can: ['assignRole', 'deleteAny'], inherits: ['admin'] },
  admin: { can: ['delete'], inherits: ['manager'] },
  manager: { can: ['publish'], inherits: ['user'] },
  user: { can: ['write', 'link', 'sync'], inherits: ['guest'] },
  guest: { can: ['read', 'sync', 'write', 'link'] },
}

export const db = await gdb(GDB_NAME, {
  rtc: true,
  sm: { superAdmins: SUPER_ADMINS, customRoles: OPEN_ROLES },
})

// Expose the instance for debugging/inspection (matches the GenosDB examples).
if (typeof window !== 'undefined') (window as any).db = db

// ── Live network status (GenosRTC room peers) ────────────────────────────────
const roomPeers = new Set<string>()
db.room?.on?.('peer:join', (id: string) => roomPeers.add(id))
db.room?.on?.('peer:leave', (id: string) => roomPeers.delete(id))

export interface NetworkStats {
  isConnected: boolean
  peerCount: number
  connectedCount: number
}

/** Current P2P network status, derived from GenosRTC room membership. */
export function getNetworkStats(): NetworkStats {
  const peerCount = roomPeers.size
  return { isConnected: peerCount > 0, peerCount, connectedCount: peerCount }
}

/** Connected peer ids (for network UIs). */
export function getPeers(): string[] {
  return [...roomPeers]
}
