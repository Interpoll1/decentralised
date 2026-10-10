// src/utils/groupTimeline.ts
//
// Folds a group room's message log into what the UI renders. Reactions, edits,
// deletes, pins and votes are ordinary signed messages that name a target
// messageId; they are applied here in log order, last write wins. Authority
// rules live here too: only a message's author may edit or delete it.

import type { DisplayMessage } from '@/services/chatRoomService';
import type { GroupMedia } from '@/types/social';

export interface TimelineUser { id: string; name: string }
export interface TimelineReaction { emoji: string; users: TimelineUser[]; mine: boolean }
export interface TimelinePoll {
  question: string; options: string[]; multi: boolean;
  /** Voters per option index. */
  votes: TimelineUser[][];
  myChoices: number[];
  voters: number;
}
export interface TimelineReply { messageId: string; senderName: string; text: string; missing: boolean }
export interface TimelineItem extends DisplayMessage {
  edited: boolean;
  deleted: boolean;
  pinned: boolean;
  reactions: TimelineReaction[];
  reply?: TimelineReply;
  poll?: TimelinePoll;
  media?: GroupMedia;
  mentionsMe: boolean;
  forwarded: boolean;
}

export function compareTimeline(a: DisplayMessage, b: DisplayMessage): number {
  if (a.timestamp !== b.timestamp) return a.timestamp - b.timestamp;
  if (a.seq !== undefined && b.seq !== undefined && a.seq !== b.seq) return a.seq - b.seq;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function previewText(item: Pick<TimelineItem, 'text' | 'deleted' | 'media' | 'poll'>): string {
  if (item.deleted) return 'Deleted message';
  if (item.poll) return `📊 ${item.poll.question}`;
  if (item.media) {
    const t = item.media.mediaType;
    const label = t.startsWith('image/') ? '📷 Photo' : t.startsWith('video/') ? '🎬 Video' : t.startsWith('audio/') ? '🎤 Voice message' : `📎 ${item.media.mediaName || 'File'}`;
    return item.text ? `${label} · ${item.text}` : label;
  }
  return item.text;
}

export function foldTimeline(messages: DisplayMessage[], me: string): { items: TimelineItem[]; pinned: TimelineItem[] } {
  const ordered = [...messages].sort(compareTimeline);
  const byId = new Map<string, TimelineItem>();
  const items: TimelineItem[] = [];
  const reactions = new Map<string, Map<string, { emoji: string; name: string }>>();
  const votes = new Map<string, Map<string, { choices: number[]; name: string }>>();
  const pins = new Map<string, number>(); // target -> pin order (0 = unpinned)
  let pinOrder = 0;

  for (const m of ordered) {
    const x = m.ext;
    if (!x || x.k === 'msg' || x.k === 'poll') {
      const item: TimelineItem = {
        ...m, edited: false, deleted: false, pinned: false, reactions: [],
        mentionsMe: x?.k === 'msg' && !!x.mentions?.includes(me),
        forwarded: x?.k === 'msg' && !!x.forwarded,
        ...(x?.k === 'msg' && x.media ? { media: x.media } : {}),
        ...(x?.k === 'poll' ? { poll: { question: x.question, options: x.options, multi: x.multi, votes: [], myChoices: [], voters: 0 } } : {}),
      };
      byId.set(m.messageId, item);
      items.push(item);
      continue;
    }
    const target = byId.get(x.target);
    // Actions on messages this device never saw (or not yet) are dropped.
    if (!target) continue;
    switch (x.k) {
      case 'edit':
        if (m.senderId === target.senderId && !target.deleted && !target.poll) { target.text = m.text; target.edited = true; }
        break;
      case 'delete':
        if (m.senderId === target.senderId) { target.deleted = true; target.text = ''; delete target.media; delete target.poll; }
        break;
      case 'react': {
        const per = reactions.get(x.target) ?? new Map();
        if (x.emoji) per.set(m.senderId, { emoji: x.emoji, name: m.senderName }); else per.delete(m.senderId);
        reactions.set(x.target, per);
        break;
      }
      case 'pin': pins.set(x.target, ++pinOrder); break;
      case 'unpin': pins.set(x.target, 0); break;
      case 'vote': {
        if (!target.poll) break;
        const valid = x.choices.filter(c => c < target.poll!.options.length);
        const per = votes.get(x.target) ?? new Map();
        per.set(m.senderId, { choices: target.poll.multi ? valid : valid.slice(0, 1), name: m.senderName });
        votes.set(x.target, per);
        break;
      }
    }
  }

  for (const item of items) {
    if (item.deleted) continue;
    const per = reactions.get(item.messageId);
    if (per) {
      const grouped = new Map<string, TimelineReaction>();
      for (const [id, r] of per) {
        const g = grouped.get(r.emoji) ?? { emoji: r.emoji, users: [], mine: false };
        g.users.push({ id, name: r.name });
        if (id === me) g.mine = true;
        grouped.set(r.emoji, g);
      }
      item.reactions = [...grouped.values()].sort((a, b) => b.users.length - a.users.length);
    }
    if (item.poll) {
      const per = votes.get(item.messageId);
      item.poll.votes = item.poll.options.map(() => []);
      for (const [id, v] of per ?? []) {
        if (v.choices.length) item.poll.voters++;
        for (const c of v.choices) item.poll.votes[c].push({ id, name: v.name });
        if (id === me) item.poll.myChoices = v.choices;
      }
    }
    item.pinned = (pins.get(item.messageId) ?? 0) > 0;
  }

  for (const item of items) {
    const replyTo = item.ext?.k === 'msg' ? item.ext.replyTo : undefined;
    if (!replyTo) continue;
    const target = byId.get(replyTo);
    item.reply = target
      ? { messageId: replyTo, senderName: target.senderName, text: previewText(target), missing: false }
      : { messageId: replyTo, senderName: '', text: 'Original message unavailable', missing: true };
  }

  const pinned = items.filter(i => i.pinned && !i.deleted).sort((a, b) => (pins.get(b.messageId) ?? 0) - (pins.get(a.messageId) ?? 0));
  return { items, pinned };
}
