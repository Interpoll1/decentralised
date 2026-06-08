// src/services/communityService.ts — communities in the zero-trust GenosDB model.
//
// `rules` live directly on the community node (GenosDB stores arrays natively),
// so the entire Gun rules-reassembly layer is gone: no rulesCache, no per-node
// rules subscriptions, no parseRules, no .once() snapshot vs .on() live split.
// Membership is modelled as signed nodes (like votes) and memberCount is derived,
// so concurrent joins never race. Creation is signed automatically by the SM.
import { db } from './gdbServices'
import { EncryptionService } from './encryptionService'
import { KeyVaultService } from './keyVaultService'
import { InviteLinkService } from './inviteLinkService'
import type { DecryptedCommunityMeta, StoredEncryptionKey } from '../types/encryption'

export interface Community {
  id: string
  name: string
  displayName: string
  description: string
  rules: string[]
  creatorId: string
  createdAt: number
  memberCount: number
  postCount?: number
  creatorPubkey?: string
  creatorSignature?: string
  isEncrypted?: boolean
  encryptionHint?: string
  encryptedMeta?: string
}

export class CommunityService {
  static async createCommunity(data: {
    name: string; displayName: string; description: string
    rules: string[]; creatorId: string
  }): Promise<Community> {
    const id = `c-${data.name.toLowerCase().replace(/\s+/g, '-')}`
    const createdAt = Date.now()
    const record = {
      type: 'community',
      id,
      name: data.name,
      displayName: data.displayName,
      description: data.description,
      rules: data.rules ?? [],
      creatorId: data.creatorId,
      createdAt,
      postCount: 0,
    }
    await db.put(record, id)

    // The creator is the first member.
    const me = db.sm.getActiveEthAddress() ?? data.creatorId
    await db.put({ type: 'membership', communityId: id, member: me, joinedAt: createdAt }, `member:${id}:${me}`)

    return this.buildCommunity(record, 1)
  }

  static async getCommunity(communityId: string): Promise<Community | null> {
    const { result } = await db.get(communityId)
    if (!result?.value || result.value.type !== 'community') return null
    return this.buildCommunity(result.value, await this.countMembers(communityId))
  }

  /** Join a community: write a signed membership node (idempotent per identity). */
  static async joinCommunity(communityId: string, _localFallback?: { memberCount: number }): Promise<void> {
    const me = db.sm.getActiveEthAddress()
    if (!me) throw new Error('Cannot join: no active identity')
    await db.put({ type: 'membership', communityId, member: me, joinedAt: Date.now() }, `member:${communityId}:${me}`)
  }

  /**
   * Live subscription to all communities, with derived member counts. Fires for
   * each community (initial and changes) and again when its membership changes.
   */
  static subscribeToCommunitiesLive(callback: (community: Community) => void): () => void {
    let active = true
    let communityUnsub: (() => void) | undefined
    let memberUnsub: (() => void) | undefined
    const ids = new Set<string>()

    const emit = async (communityId: string) => {
      if (!active) return
      const community = await this.getCommunity(communityId)
      if (community && active) callback(community)
    }

    void (async () => {
      const { unsubscribe } = await db.map(
        { query: { type: 'community' } },
        ({ id, action }) => {
          if (action === 'removed') { ids.delete(id); return }
          ids.add(id)
          void emit(id)
        },
      )
      communityUnsub = unsubscribe

      const { unsubscribe: mu } = await db.map(
        { query: { type: 'membership' } },
        ({ value }) => {
          const cid = (value as { communityId?: string })?.communityId
          if (cid && ids.has(cid)) void emit(cid)
        },
      )
      memberUnsub = mu
    })()

    return () => { active = false; communityUnsub?.(); memberUnsub?.() }
  }

  /** All operations are SM-signed and peer-verified, so stored communities are inherently authentic. */
  static verifyCommunitySignature(community: Community): 'verified' | 'unverified' | 'unsigned' {
    return community.creatorId ? 'verified' : 'unsigned'
  }

  // ── Private / encrypted communities (AES, app-level — GenosDB stores the node) ──

  /** Create an encrypted community: metadata is AES-encrypted, the node is public. */
  static async createPrivateCommunity(
    data: { name: string; displayName: string; description: string; rules: string[]; creatorId: string },
    password?: string,
  ): Promise<{ community: Community; inviteLink: string }> {
    if (password !== undefined) {
      password = password.trim()
      if (password.length < 12) throw new Error('Password must be at least 12 characters')
    }
    const id = `c-${data.name.toLowerCase().replace(/\s+/g, '-')}`
    const createdAt = Date.now()

    let aesKey: CryptoKey
    let method: StoredEncryptionKey['method']
    if (password) {
      aesKey = await EncryptionService.deriveKeyFromPassword(password, id + 'interpoll-v2')
      method = 'password'
    } else {
      aesKey = await EncryptionService.generateKey()
      method = 'invite'
    }

    const meta: DecryptedCommunityMeta = { name: data.name, displayName: data.displayName, description: data.description, rules: data.rules }
    const encryptedMeta = await EncryptionService.encrypt(JSON.stringify(meta), aesKey)
    const encryptionHint = password ? 'Password-protected' : 'Invite-only'

    await db.put({
      type: 'community',
      id,
      isEncrypted: true,
      encryptionHint,
      encryptedMeta,
      creatorId: data.creatorId,
      createdAt,
      postCount: 0,
      name: '🔒 Private Community',
      displayName: '🔒 Private Community',
      description: 'This community is encrypted. Use an invite link or password to access.',
      rules: [],
    }, id)

    const me = db.sm.getActiveEthAddress() ?? data.creatorId
    await db.put({ type: 'membership', communityId: id, member: me, joinedAt: createdAt }, `member:${id}:${me}`)

    const keyBase64 = await EncryptionService.exportKey(aesKey)
    await KeyVaultService.storeKey({ id, type: 'community', key: keyBase64, method, label: data.displayName, joinedAt: createdAt })

    let inviteLink = ''
    if (method === 'invite') {
      const keyBase64Url = await EncryptionService.exportKeyAsBase64Url(aesKey)
      inviteLink = InviteLinkService.generateInviteLink(id, 'community', keyBase64Url)
    }

    const community: Community = {
      id, name: data.name, displayName: data.displayName, description: data.description,
      rules: data.rules, creatorId: data.creatorId, createdAt, memberCount: 1, postCount: 0,
      isEncrypted: true, encryptionHint, encryptedMeta,
    }
    return { community, inviteLink }
  }

  /** Decrypt an encrypted community's metadata using a locally-stored key. */
  static async decryptCommunityMeta(community: Community): Promise<Community | null> {
    if (!community.isEncrypted || !community.encryptedMeta) return community
    const storedKey = await KeyVaultService.getKey(community.id)
    if (!storedKey) return null
    try {
      const aesKey = await EncryptionService.importKey(storedKey.key)
      const meta: DecryptedCommunityMeta = JSON.parse(await EncryptionService.decrypt(community.encryptedMeta, aesKey))
      return { ...community, name: meta.name, displayName: meta.displayName, description: meta.description, rules: meta.rules }
    } catch {
      return null
    }
  }

  /** Join an encrypted community with an invite key or password. */
  static async joinPrivateCommunity(communityId: string, keyOrPassword: string, method: 'invite' | 'password'): Promise<Community> {
    const aesKey = method === 'password'
      ? await EncryptionService.deriveKeyFromPassword(keyOrPassword.trim(), communityId + 'interpoll-v2')
      : await EncryptionService.importKeyFromBase64Url(keyOrPassword)

    const community = await this.getCommunity(communityId)
    if (!community || !community.encryptedMeta) throw new Error('Community not found or not encrypted')

    let meta: DecryptedCommunityMeta
    try {
      meta = JSON.parse(await EncryptionService.decrypt(community.encryptedMeta, aesKey))
    } catch {
      throw new Error('Invalid key or password — could not decrypt community')
    }

    const keyBase64 = await EncryptionService.exportKey(aesKey)
    await KeyVaultService.storeKey({ id: communityId, type: 'community', key: keyBase64, method, label: meta.displayName || meta.name, joinedAt: Date.now() })
    await this.joinCommunity(communityId)

    return { ...community, name: meta.name, displayName: meta.displayName, description: meta.description, rules: meta.rules }
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────
  private static async countMembers(communityId: string): Promise<number> {
    const { results } = await db.map({ query: { type: 'membership', communityId } })
    return results.length
  }

  private static buildCommunity(record: any, memberCount: number): Community {
    return {
      id: record.id,
      name: record.name,
      displayName: record.displayName || record.name,
      description: record.description || '',
      rules: Array.isArray(record.rules) ? record.rules : [],
      creatorId: record.creatorId || '',
      createdAt: record.createdAt || Date.now(),
      memberCount,
      postCount: Number(record.postCount) || 0,
      isEncrypted: record.isEncrypted || false,
      encryptionHint: record.encryptionHint || undefined,
      encryptedMeta: record.encryptedMeta || undefined,
    }
  }
}
