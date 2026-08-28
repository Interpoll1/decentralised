/**
 * nostr.ts
 *
 * Lightweight Nostr utilities — bech32 encoding, event ID derivation,
 * and nevent1/npub1 display helpers.
 *
 * No external dependencies beyond @noble/hashes (already in bundle).
 *
 * Nostr spec: https://github.com/nostr-protocol/nostr
 * NIP-19 (bech32 encoding): https://github.com/nostr-protocol/nips/blob/master/19.md
 */

import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';

// ─── Bech32 encoding (NIP-19) ─────────────────────────────────────────────────

const BECH32_CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';

function bech32Polymod(values: number[]): number {
  const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let chk = 1;
  for (const v of values) {
    const b = chk >> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) {
      if ((b >> i) & 1) chk ^= GEN[i];
    }
  }
  return chk;
}

function bech32HrpExpand(hrp: string): number[] {
  const ret: number[] = [];
  for (let i = 0; i < hrp.length; i++) ret.push(hrp.charCodeAt(i) >> 5);
  ret.push(0);
  for (let i = 0; i < hrp.length; i++) ret.push(hrp.charCodeAt(i) & 31);
  return ret;
}

function convertBits(data: Uint8Array, fromBits: number, toBits: number, pad: boolean): number[] {
  let acc = 0, bits = 0;
  const result: number[] = [];
  const maxv = (1 << toBits) - 1;
  for (const value of data) {
    acc = (acc << fromBits) | value;
    bits += fromBits;
    while (bits >= toBits) {
      bits -= toBits;
      result.push((acc >> bits) & maxv);
    }
  }
  if (pad && bits > 0) result.push((acc << (toBits - bits)) & maxv);
  return result;
}

function bech32Encode(hrp: string, data: number[]): string {
  const combined = [...data, 0, 0, 0, 0, 0, 0];
  const checksum = bech32Polymod([...bech32HrpExpand(hrp), ...data, 0, 0, 0, 0, 0, 0]) ^ 1;
  for (let i = 0; i < 6; i++) combined[data.length + i] = (checksum >> (5 * (5 - i))) & 31;
  return hrp + '1' + combined.map(d => BECH32_CHARSET[d]).join('');
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Encode a 32-byte hex pubkey as npub1…
 */
export function hexToBech32Npub(hexPubkey: string): string {
  const bytes = hexToBytes(hexPubkey);
  const words = convertBits(bytes, 8, 5, true);
  return bech32Encode('npub', words);
}

/**
 * Encode a 32-byte hex event ID as note1…
 */
export function hexToBech32Note(hexId: string): string {
  const bytes = hexToBytes(hexId);
  const words = convertBits(bytes, 8, 5, true);
  return bech32Encode('note', words);
}

/**
 * Build an nevent1 TLV encoding for a Nostr event:
 *   TLV 0x00 = event ID (32 bytes)
 *   TLV 0x01 = relay hint (optional, UTF-8)
 *   TLV 0x02 = author pubkey (optional, 32 bytes)
 */
export function buildNevent1(hexId: string, relayHint?: string, hexPubkey?: string): string {
  const tlv: number[] = [];

  // Type 0: event id
  const idBytes = hexToBytes(hexId);
  tlv.push(0x00, idBytes.length, ...idBytes);

  // Type 1: relay hint
  if (relayHint) {
    const relayBytes = new TextEncoder().encode(relayHint);
    tlv.push(0x01, relayBytes.length, ...relayBytes);
  }

  // Type 2: author pubkey
  if (hexPubkey) {
    const pkBytes = hexToBytes(hexPubkey);
    tlv.push(0x02, pkBytes.length, ...pkBytes);
  }

  const words = convertBits(new Uint8Array(tlv), 8, 5, true);
  return bech32Encode('nevent', words);
}

/**
 * Derive a Nostr event ID (SHA-256 of the canonical serialisation).
 * kind 101 = Interpoll vote event (custom kind in the 100–9999 range)
 * kind 1   = short text note (for posts/polls shared as Nostr notes)
 */
export interface NostrEventInput {
  pubkey:    string;   // hex 32-byte pubkey
  createdAt: number;   // Unix seconds
  kind:      number;   // Nostr kind
  tags:      string[][];
  content:   string;
}

export function deriveNostrEventId(event: NostrEventInput): string {
  const serialised = JSON.stringify([
    0,
    event.pubkey,
    event.createdAt,
    event.kind,
    event.tags,
    event.content,
  ]);
  const hash = sha256(new TextEncoder().encode(serialised));
  return bytesToHex(hash);
}

/**
 * Build a complete Nostr event object ready for signing.
 * The returned object has `id` pre-computed.
 * Sign `id` with your Schnorr private key to get `sig`.
 */
export function buildNostrEvent(
  input: NostrEventInput,
): NostrEventInput & { id: string } {
  const id = deriveNostrEventId(input);
  return { ...input, id };
}

/**
 * Convert an Interpoll poll to a Nostr kind-1 short-text event.
 * Polls are shared as human-readable text; votes use kind-101.
 */
export function pollToNostrEvent(poll: {
  id:          string;
  question:    string;
  description?: string;
  options:     { text: string }[];
  authorPubkey: string;
  createdAt:   number;
  communityId?: string;
  relayUrl?:   string;
}): NostrEventInput & { id: string } {
  const optionLines = poll.options
    .map((o, i) => `${i + 1}. ${o.text}`)
    .join('\n');

  const content = [
    poll.question,
    poll.description ? `\n${poll.description}` : '',
    `\n\nOptions:\n${optionLines}`,
    poll.relayUrl ? `\n\nVote at: ${poll.relayUrl}/vote/${poll.id}` : '',
  ].join('').trim();

  const tags: string[][] = [
    ['t', 'poll'],
    ['t', 'interpoll'],
  ];
  if (poll.communityId) tags.push(['t', poll.communityId]);
  if (poll.relayUrl)    tags.push(['r', poll.relayUrl]);

  return buildNostrEvent({
    pubkey:    poll.authorPubkey,
    createdAt: Math.floor(poll.createdAt / 1000),
    kind:      1,
    tags,
    content,
  });
}

/**
 * Convert an Interpoll post to a Nostr kind-1 event.
 */
export function postToNostrEvent(post: {
  id:          string;
  title:       string;
  content?:    string;
  authorPubkey: string;
  createdAt:   number;
  communityId?: string;
  relayUrl?:   string;
}): NostrEventInput & { id: string } {
  const content = [
    `**${post.title}**`,
    post.content ? `\n\n${post.content}` : '',
    post.relayUrl ? `\n\n${post.relayUrl}/community/${post.communityId}/post/${post.id}` : '',
  ].join('').trim();

  const tags: string[][] = [
    ['t', 'interpoll'],
    ['subject', post.title],
  ];
  if (post.communityId) tags.push(['t', post.communityId]);
  if (post.relayUrl)    tags.push(['r', post.relayUrl]);

  return buildNostrEvent({
    pubkey:    post.authorPubkey,
    createdAt: Math.floor(post.createdAt / 1000),
    kind:      1,
    tags,
    content,
  });
}

/**
 * Convert an Interpoll vote receipt to a Nostr kind-101 event.
 * kind-101 is an Interpoll-specific kind for vote attestations.
 */
export function receiptToNostrEvent(receipt: {
  pollId:     string;
  voteHash:   string;
  blockIndex: number;
  pubkey:     string;
  timestamp:  number;
  mnemonic?:  string;
}): NostrEventInput & { id: string } {
  const content = JSON.stringify({
    pollId:     receipt.pollId,
    voteHash:   receipt.voteHash,
    blockIndex: receipt.blockIndex,
    mnemonic:   receipt.mnemonic,
  });

  return buildNostrEvent({
    pubkey:    receipt.pubkey,
    createdAt: Math.floor(receipt.timestamp / 1000),
    kind:      101,
    tags:      [['e', receipt.pollId], ['t', 'interpoll-vote']],
    content,
  });
}

/**
 * Shorten a Nostr bech32 ID for display: first 12 + … + last 6 chars.
 */
export function shortenNostrId(id: string, prefixLen = 12, suffixLen = 6): string {
  if (!id || id.length <= prefixLen + suffixLen + 3) return id;
  return `${id.slice(0, prefixLen)}…${id.slice(-suffixLen)}`;
}

/**
 * Nostr client URL builder — njump.me is a universal Nostr event viewer.
 */
export function nostrClientUrl(eventId: string): string {
  return `https://njump.me/${eventId}`;
}

/**
 * Snort.social deep-link (alternative client).
 */
export function snortUrl(eventId: string): string {
  return `https://snort.social/e/${eventId}`;
}
