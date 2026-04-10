import { describe, it, expect } from 'vitest';
import type { ChainBlock, Vote, Receipt, ActionType } from '../src/types/chain';
import type { NostrEvent, UnsignedEvent, StoredKeyPair } from '../src/types/nostr';
import { EventKind } from '../src/types/nostr';
import type {
  StoredEncryptionKey,
  InviteLinkData,
  EncryptedCommunityData,
  DecryptedCommunityMeta,
  ContentSignature,
} from '../src/types/encryption';

describe('Type definitions', () => {
  describe('chain.ts types', () => {
    it('ChainBlock has required fields', () => {
      const block: ChainBlock = {
        index: 0,
        timestamp: Date.now(),
        previousHash: '0',
        voteHash: 'vh',
        signature: 'sig',
        currentHash: 'ch',
        nonce: 0,
      };
      expect(block.index).toBe(0);
      expect(typeof block.timestamp).toBe('number');
    });

    it('ChainBlock supports optional fields', () => {
      const block: ChainBlock = {
        index: 1,
        timestamp: Date.now(),
        previousHash: '0',
        voteHash: 'vh',
        signature: 'sig',
        currentHash: 'ch',
        nonce: 0,
        pubkey: 'abc',
        eventId: 'evt',
        actionType: 'vote',
        actionLabel: 'My Vote',
      };
      expect(block.pubkey).toBe('abc');
      expect(block.actionType).toBe('vote');
    });

    it('ActionType union accepts valid values', () => {
      const types: ActionType[] = ['vote', 'community-create', 'post-create'];
      expect(types).toHaveLength(3);
    });

    it('Vote has required fields', () => {
      const vote: Vote = {
        pollId: 'p1',
        choice: 'A',
        timestamp: Date.now(),
        deviceId: 'd1',
      };
      expect(vote.pollId).toBe('p1');
    });

    it('Receipt has required fields', () => {
      const receipt: Receipt = {
        blockIndex: 1,
        voteHash: 'vh',
        chainHeadHash: 'ch',
        mnemonic: 'word1 word2 word3',
        timestamp: Date.now(),
        pollId: 'p1',
      };
      expect(receipt.blockIndex).toBe(1);
    });
  });

  describe('nostr.ts types', () => {
    it('EventKind has expected values', () => {
      expect(EventKind.POLL_CREATION).toBe(100);
      expect(EventKind.VOTE_CAST).toBe(101);
      expect(EventKind.POLL_UPDATE).toBe(102);
      expect(EventKind.POST_CREATION).toBe(103);
    });

    it('NostrEvent has required shape', () => {
      const event: NostrEvent = {
        id: 'a'.repeat(64),
        pubkey: 'b'.repeat(64),
        created_at: 1234567890,
        kind: EventKind.POLL_CREATION,
        tags: [['poll_id', 'abc']],
        content: '{}',
        sig: 'c'.repeat(128),
      };
      expect(event.id).toHaveLength(64);
      expect(event.sig).toHaveLength(128);
    });

    it('UnsignedEvent has no id/sig', () => {
      const unsigned: UnsignedEvent = {
        pubkey: 'a'.repeat(64),
        created_at: 1234567890,
        kind: EventKind.VOTE_CAST,
        tags: [],
        content: '{}',
      };
      expect(unsigned).not.toHaveProperty('id');
      expect(unsigned).not.toHaveProperty('sig');
    });

    it('StoredKeyPair has correct shape', () => {
      const kp: StoredKeyPair = {
        privateKey: 'a'.repeat(64),
        publicKey: 'b'.repeat(64),
        createdAt: Date.now(),
      };
      expect(kp.privateKey).toHaveLength(64);
    });
  });

  describe('encryption.ts types', () => {
    it('StoredEncryptionKey has required fields', () => {
      const key: StoredEncryptionKey = {
        id: 'community-1',
        type: 'community',
        key: 'base64key==',
        method: 'invite',
        label: 'Test Community',
        joinedAt: Date.now(),
      };
      expect(key.type).toBe('community');
      expect(key.method).toBe('invite');
    });

    it('InviteLinkData has required fields', () => {
      const link: InviteLinkData = {
        id: 'c1',
        type: 'chatroom',
        key: 'base64url-key',
      };
      expect(link.type).toBe('chatroom');
    });

    it('ContentSignature has correct hex lengths', () => {
      const sig: ContentSignature = {
        authorPubkey: 'a'.repeat(64),
        contentSignature: 'b'.repeat(128),
      };
      expect(sig.authorPubkey).toHaveLength(64);
      expect(sig.contentSignature).toHaveLength(128);
    });
  });
});
