// src/services/pollService.ts — polls and voting in the zero-trust GenosDB model.
//
// Each vote is its own signed node ({ type:'vote', pollId, optionIds, voter }),
// keyed `${pollId}:${address}` so one identity = one vote (re-voting overwrites).
// Tallies are DERIVED by aggregating vote nodes — there are no vote counts stored
// on the poll, so there are no last-write-wins races. This replaces ~1600 lines of
// Gun workarounds (local backups, offline detection, cache warming, voters/options
// maps, putPromise wrappers) and the manual Schnorr signing of every vote: the
// Security Manager signs each db.put automatically and peers verify it.
import { db } from './gdbServices'
import { grantCommunityModerators } from './moderationGrants'

export interface PollOption {
  id: string
  text: string
  votes: number
  voters: string[]
}

export interface Poll {
  id: string
  communityId: string
  authorId: string
  authorName: string
  authorShowRealName?: boolean
  question: string
  description?: string
  options: PollOption[]
  createdAt: number
  expiresAt: number
  allowMultipleChoices: boolean
  showResultsBeforeVoting: boolean
  requireLogin: boolean
  isPrivate: boolean
  totalVotes: number
  isExpired: boolean
  authorPubkey?: string
  contentSignature?: string
  isEncrypted?: boolean
  encryptedContent?: string
  authTag?: string
}

/** Shape accepted by `createPoll` (options as plain strings, like the UI sends). */
interface CreatePollInput {
  communityId: string
  authorId: string
  authorName: string
  authorShowRealName?: boolean
  question: string
  description?: string
  options: string[]
  durationDays: number
  allowMultipleChoices: boolean
  showResultsBeforeVoting: boolean
  requireLogin: boolean
  isPrivate: boolean
  inviteCodeCount?: number
}

const DAY_MS = 24 * 60 * 60 * 1000

export class PollService {
  /** Create a signed poll node. Vote counts start at zero and are derived later. */
  static async createPoll(data: CreatePollInput, pollId?: string): Promise<Poll> {
    const id = pollId ?? `poll-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`
    const now = Date.now()
    const record = {
      type: 'poll',
      communityId: data.communityId,
      authorId: data.authorId,
      authorName: data.authorName,
      authorShowRealName: data.authorShowRealName ?? false,
      question: data.question,
      description: data.description ?? '',
      options: data.options.map((text, idx) => ({ id: `${id}-option-${idx}`, text })),
      createdAt: now,
      expiresAt: now + (data.durationDays ?? 7) * DAY_MS,
      allowMultipleChoices: !!data.allowMultipleChoices,
      showResultsBeforeVoting: !!data.showResultsBeforeVoting,
      requireLogin: !!data.requireLogin,
      isPrivate: !!data.isPrivate,
    }
    // ACL-owned by the author, so only they — or a moderator the community owner
    // delegates `delete` to — can remove the poll (enforced on every peer).
    await db.sm.acls.set(record, id)
    await grantCommunityModerators(id, data.communityId)

    // Private polls gate voting behind single-use invite codes. These invite-code
    // nodes stay plain `db.put`: a voter updates them on consume (a cross-write the
    // poll owner can't pre-authorize), so they can't be naively ACL-owned.
    if (data.isPrivate && data.inviteCodeCount) {
      await Promise.all(Array.from({ length: data.inviteCodeCount }, () => {
        const code = this.generateCode()
        return db.put({ type: 'inviteCode', pollId: id, code, usedBy: null }, `invite:${id}:${code}`)
      }))
    }

    return this.buildPoll(id, record)
  }

  /**
   * Cast a vote. The voter is the active signing identity (zero-trust: never a
   * caller-supplied id). The node id is deterministic per identity, so a user has
   * exactly one vote per poll and changing it updates in place.
   */
  static async vote(pollId: string, optionIds: string[], _userId?: string, _communityId?: string): Promise<void> {
    const voter = db.sm.getActiveEthAddress()
    if (!voter) throw new Error('Cannot vote: no active identity')
    // ACL-owned by the voter (set, not put, so the first vote creates the owned node);
    // re-voting overwrites in place because the voter is the owner.
    await db.sm.acls.set({ type: 'vote', pollId, optionIds, voter, createdAt: Date.now() }, `${pollId}:${voter}`)
  }

  /** Load a single poll with its derived tally, or null if it does not exist. */
  static async loadPoll(pollId: string, _communityId?: string): Promise<Poll | null> {
    const { result } = await db.get(pollId)
    if (!result?.value || result.value.type !== 'poll') return null
    return this.buildPoll(pollId, result.value)
  }

  /** No API/relay fallback needed — GenosDB syncs P2P. Kept for call-site parity. */
  static async loadPollWithApiFallback(pollId: string, communityId?: string): Promise<Poll | null> {
    return this.loadPoll(pollId, communityId)
  }

  /** OPFS persists locally and automatically; no manual backup layer is needed. */
  static async loadLocalPollsForCommunity(_communityId: string): Promise<Poll[]> {
    return []
  }

  /**
   * Subscribe to a community's polls with live, derived vote counts.
   *
   * `onPoll` fires for every poll (initial set and subsequent changes), and once
   * more whenever a vote for one of those polls changes. `onInitialDone` fires
   * after the initial set has been delivered.
   */
  static subscribeToPollsInCommunity(
    communityId: string,
    onPoll: (poll: Poll) => void,
    onInitialDone?: () => void,
  ): () => void {
    let active = true
    let pollUnsub: (() => void) | undefined
    let voteUnsub: (() => void) | undefined
    const pollIds = new Set<string>()

    const emit = async (pollId: string) => {
      if (!active) return
      const poll = await this.loadPoll(pollId)
      if (poll && active) onPoll(poll)
    }

    void (async () => {
      const { unsubscribe } = await db.map(
        { query: { type: 'poll', communityId } },
        ({ id, action }) => {
          if (action === 'removed') { pollIds.delete(id); return }
          pollIds.add(id)
          void emit(id)
        },
      )
      pollUnsub = unsubscribe
      if (active) onInitialDone?.()

      // Live vote counts: re-derive a poll whenever one of its votes changes.
      const { unsubscribe: vu } = await db.map(
        { query: { type: 'vote' } },
        ({ value }) => {
          const pid = (value as { pollId?: string })?.pollId
          if (pid && pollIds.has(pid)) void emit(pid)
        },
      )
      voteUnsub = vu
    })()

    return () => { active = false; pollUnsub?.(); voteUnsub?.() }
  }

  /** Private-poll decryption is handled in the encryption slice; passthrough for now. */
  static async decryptPoll(poll: Poll): Promise<Poll> {
    return poll
  }

  /** Build the UI-facing Poll by aggregating its signed vote nodes into tallies. */
  private static async buildPoll(pollId: string, record: any): Promise<Poll> {
    const { results } = await db.map({ query: { type: 'vote', pollId } })
    const votersByOption = new Map<string, string[]>()
    for (const node of results) {
      const v = node.value as { voter?: string; optionIds?: string[] }
      if (!v?.voter || !Array.isArray(v.optionIds)) continue
      for (const optId of v.optionIds) {
        const arr = votersByOption.get(optId) ?? []
        if (!arr.includes(v.voter)) arr.push(v.voter)
        votersByOption.set(optId, arr)
      }
    }
    const options: PollOption[] = (record.options ?? []).map((o: { id: string; text: string }) => {
      const voters = (votersByOption.get(o.id) ?? []).sort()
      return { id: o.id, text: o.text, votes: voters.length, voters }
    })
    const totalVotes = options.reduce((sum, o) => sum + o.votes, 0)
    return {
      ...record,
      id: pollId,
      options,
      totalVotes,
      isExpired: Date.now() > (record.expiresAt ?? 0),
    } as Poll
  }

  // ── Private-poll invite codes (single-use, stored as signed GenosDB nodes) ──

  private static generateCode(): string {
    return Array.from(crypto.getRandomValues(new Uint8Array(8)), b => b.toString(36).padStart(2, '0')).join('').slice(0, 12)
  }

  static async getInviteCodes(pollId: string): Promise<string[]> {
    const { results } = await db.map({ query: { type: 'inviteCode', pollId } })
    return results.filter(n => !n.value.usedBy).map(n => n.value.code as string)
  }

  /** Reserve a single-use code for the active voter. Returns a reservation id, or '' if invalid/taken. */
  static async consumeInviteCode(pollId: string, code: string): Promise<string> {
    const voter = db.sm.getActiveEthAddress()
    if (!voter) return ''
    const id = `invite:${pollId}:${code}`
    const { result } = await db.get(id)
    const node = result?.value
    if (!node) return ''
    if (node.usedBy && node.usedBy !== voter) return ''
    await db.put({ ...node, usedBy: voter }, id)
    return voter
  }

  /** Release a reservation when the vote it gated did not complete. */
  static async releaseInviteCode(pollId: string, code: string, _reservationId?: string): Promise<void> {
    const id = `invite:${pollId}:${code}`
    const { result } = await db.get(id)
    if (result?.value) await db.put({ ...result.value, usedBy: null }, id)
  }

  // Finalization is implicit — consumeInviteCode already persisted the reservation.
  static async finalizeInviteCode(_pollId?: string, _code?: string, _reservationId?: string): Promise<void> {}
  static queueInviteCodeFinalization(_pollId?: string, _code?: string, _reservationId?: string): void {}
  static async flushPendingInviteCodeFinalizations(): Promise<void> {}
}
