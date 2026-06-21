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
// GenosDB ships a self-contained `dist/` (gdb entry + its sm/genosrtc/… plugins),
// and resolves those plugins at runtime via `new URL('./*.min.js', import.meta.url)`.
// We therefore load it intact from a single served folder (<base>/genosdb/) instead
// of letting the bundler split + hash it — which would scatter the siblings and
// break that relative resolution. The folder is served from node_modules in dev and
// copied verbatim into the build by the `genosdb-static` plugin in vite.config.ts.
const { gdb } = await import(/* @vite-ignore */ `${import.meta.env.BASE_URL}genosdb/index.js`)

/** Database identifier — also serves as the P2P room name. */
export const GDB_NAME = 'interpoll-genosdb'

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
 * Roles for an OPEN, governance-driven platform — two complementary layers:
 *
 *  1. This RBAC ladder + `governanceRules` = network-wide trust that is EARNED
 *     through public, identical-for-everyone rules and granted by a signed
 *     superadmin. It is deliberately NOT a censorship hierarchy: there is no
 *     global `delete`/`deleteAny`, so no actor can quietly erase another's post.
 *  2. Node-level ACLs (added per community) will let each community moderate its
 *     OWN space — the creator owns it and can delegate moderators — so removal is
 *     community-scoped, never central. (See GenosDB zero-trust + governance docs.)
 *
 * `guest` is open (write+link) so anyone participates the moment they exist.
 * `member` and `trusted` are reputation tiers the governance engine grants and
 * revokes. `superadmin` is the governance signer/notary: it signs only the role
 * changes the public rules dictate, and it must be online merely to GRANT a
 * promotion — once signed, the role becomes synced graph state and propagates and
 * persists across peers even after the superadmin goes offline.
 */
const ROLES = {
  superadmin: { can: ['assignRole'], inherits: ['trusted'] },
  trusted: { can: ['write', 'link', 'sync'], inherits: ['member'] },
  member: { can: ['write', 'link', 'sync'], inherits: ['guest'] },
  guest: { can: ['read', 'sync', 'write', 'link'] },
}

/**
 * Public advancement rules (the "constitution"), evaluated against `user:<address>`
 * nodes by the governance engine while a superadmin is online. Last-match-wins:
 * climbing a tier overrides the floor, and losing a condition auto-demotes — no
 * explicit demotion rules needed.
 */
const GOVERNANCE_RULES = [
  // Onboarding: a settled guest becomes a member (time-based for now; becomes
  // activity-based once the app writes postCount/reputation into the user node).
  { if: { role: 'guest' }, offsetTimestamp: 10000, then: { assignRole: 'member' } },
  // Floor: any onboarded member stays at least `member`.
  { if: { role: { $in: ['member', 'trusted'] } }, then: { assignRole: 'member' } },
  // Climb: enough posts -> `trusted` (auto-demotes if the count drops). The author
  // increments postCount on their own user node when they publish (UserService).
  { if: { role: { $in: ['member', 'trusted'] }, postCount: { $gte: 3 } }, then: { assignRole: 'trusted' } },
]

export const db = await gdb(GDB_NAME, {
  rtc: true,
  sm: { superAdmins: SUPER_ADMINS, customRoles: ROLES, governanceRules: GOVERNANCE_RULES },
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
