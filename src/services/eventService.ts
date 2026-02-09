// src/services/eventService.ts — Nostr-style event signing & verification
import { schnorr } from '@noble/curves/secp256k1.js';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';
import { KeyService } from './keyService';
import type { NostrEvent, UnsignedEvent } from '../types/nostr';
import { EventKind } from '../types/nostr';

export class EventService {

  // ─── Serialization & ID (NIP-01) ───────────────────────────────

  // Canonical serialization: [0, pubkey, created_at, kind, tags, content]
  static serializeEvent(event: UnsignedEvent): string {
    return JSON.stringify([
      0,
      event.pubkey,
      event.created_at,
      event.kind,
      event.tags,
      event.content,
    ]);
  }

  // Compute event ID = SHA-256 of canonical serialization (hex)
  static computeEventId(event: UnsignedEvent): string {
    const serialized = this.serializeEvent(event);
    const hash = sha256(new TextEncoder().encode(serialized));
    return bytesToHex(hash);
  }

  // ─── Signing ───────────────────────────────────────────────────

  // Sign the event ID with the private key using Schnorr
  static signEventId(eventId: string, privateKey: string): string {
    const sig = schnorr.sign(hexToBytes(eventId), hexToBytes(privateKey));
    return bytesToHex(sig);
  }

  // Create a complete signed event from an unsigned template
  static async createSignedEvent(unsigned: UnsignedEvent): Promise<NostrEvent> {
    const id = this.computeEventId(unsigned);
    const privateKey = await KeyService.getPrivateKeyHex();
    const sig = this.signEventId(id, privateKey);

    return { ...unsigned, id, sig };
  }

  // ─── Verification ──────────────────────────────────────────────

  // Verify that the event ID matches the content
  static verifyEventId(event: NostrEvent): boolean {
    const unsigned: UnsignedEvent = {
      pubkey: event.pubkey,
      created_at: event.created_at,
      kind: event.kind,
      tags: event.tags,
      content: event.content,
    };
    const recomputedId = this.computeEventId(unsigned);
    return recomputedId === event.id;
  }

  // Verify the Schnorr signature against the event ID and pubkey
  static verifyEventSignature(event: NostrEvent): boolean {
    try {
      return schnorr.verify(hexToBytes(event.sig), hexToBytes(event.id), hexToBytes(event.pubkey));
    } catch {
      return false;
    }
  }

  // Full verification: ID integrity + signature validity
  static verifyEvent(event: NostrEvent): boolean {
    return this.verifyEventId(event) && this.verifyEventSignature(event);
  }

  // ─── Event Factories ──────────────────────────────────────────

  // Create a Poll Creation event (kind 100)
  static async createPollEvent(pollData: {
    id: string;
    communityId: string;
    question: string;
    description?: string;
    options: string[];
    durationDays: number;
    allowMultipleChoices: boolean;
    showResultsBeforeVoting: boolean;
    requireLogin: boolean;
    isPrivate: boolean;
  }): Promise<NostrEvent> {
    const pubkey = await KeyService.getPublicKeyHex();

    const content = JSON.stringify({
      question: pollData.question,
      description: pollData.description || '',
      options: pollData.options,
      durationDays: pollData.durationDays,
      allowMultipleChoices: pollData.allowMultipleChoices,
      showResultsBeforeVoting: pollData.showResultsBeforeVoting,
      requireLogin: pollData.requireLogin,
      isPrivate: pollData.isPrivate,
    });

    const unsigned: UnsignedEvent = {
      pubkey,
      created_at: Math.floor(Date.now() / 1000),
      kind: EventKind.POLL_CREATION,
      tags: [
        ['poll_id', pollData.id],
        ['community', pollData.communityId],
      ],
      content,
    };

    return this.createSignedEvent(unsigned);
  }

  // Create a Vote Cast event (kind 101)
  static async createVoteEvent(voteData: {
    pollId: string;
    choice: string;
    optionId?: string;
    deviceId: string;
  }): Promise<NostrEvent> {
    const pubkey = await KeyService.getPublicKeyHex();

    const content = JSON.stringify({
      choice: voteData.choice,
      deviceId: voteData.deviceId,
    });

    const tags: string[][] = [
      ['poll_id', voteData.pollId],
    ];
    if (voteData.optionId) {
      tags.push(['option', voteData.optionId]);
    }

    const unsigned: UnsignedEvent = {
      pubkey,
      created_at: Math.floor(Date.now() / 1000),
      kind: EventKind.VOTE_CAST,
      tags,
      content,
    };

    return this.createSignedEvent(unsigned);
  }

  // Create a Poll Update event (kind 102)
  static async createPollUpdateEvent(
    pollId: string,
    updates: Record<string, unknown>,
  ): Promise<NostrEvent> {
    const pubkey = await KeyService.getPublicKeyHex();

    const unsigned: UnsignedEvent = {
      pubkey,
      created_at: Math.floor(Date.now() / 1000),
      kind: EventKind.POLL_UPDATE,
      tags: [['poll_id', pollId]],
      content: JSON.stringify(updates),
    };

    return this.createSignedEvent(unsigned);
  }

  // Create a Post Creation event (kind 103)
  static async createPostEvent(postData: {
    id: string;
    communityId: string;
    title: string;
    content: string;
    imageIPFS?: string;
  }): Promise<NostrEvent> {
    const pubkey = await KeyService.getPublicKeyHex();

    const content = JSON.stringify({
      title: postData.title,
      content: postData.content,
      imageIPFS: postData.imageIPFS || '',
    });

    const unsigned: UnsignedEvent = {
      pubkey,
      created_at: Math.floor(Date.now() / 1000),
      kind: EventKind.POST_CREATION,
      tags: [
        ['post_id', postData.id],
        ['community', postData.communityId],
      ],
      content,
    };

    return this.createSignedEvent(unsigned);
  }
}
