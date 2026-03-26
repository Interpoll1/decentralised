/**
 * ws-validators.js — WebSocket message schema validation for InterPoll.
 *
 * Strict schemas for each message type. Rejects malformed, oversized,
 * or unexpected messages before they reach business logic.
 */

import { sanitizeId, sanitizeString } from './security-utils.js';

const MAX_SERIALIZED_SIZE = 262144; // 256KB
const MAX_POLL_QUESTION = 500;
const MAX_POLL_DESCRIPTION = 2000;
const MAX_POLL_OPTIONS = 20;
const MAX_OPTION_TEXT = 200;
const MAX_CHAT_CONTENT = 65536; // 64KB
const MAX_ROOM_ID = 100;

const ALLOWED_MESSAGE_TYPES = new Set([
  'ping', 'register', 'join-room', 'broadcast', 'direct',
  'new-poll', 'new-block', 'request-sync', 'sync-response', 'new-event',
  'chatroom-message', 'request-pow',
  // Enhanced relay types
  'chat-start', 'chat-message', 'chat-typing', 'chat-read', 'new-post',
]);

/**
 * Validate a raw WebSocket message.
 * Returns { valid: true, data } or { valid: false, reason }.
 */
export function validateWsMessage(rawMessage) {
  // Size check (raw string)
  if (typeof rawMessage === 'string' && rawMessage.length > MAX_SERIALIZED_SIZE) {
    return { valid: false, reason: 'Message exceeds maximum size' };
  }
  if (Buffer.isBuffer(rawMessage) && rawMessage.length > MAX_SERIALIZED_SIZE) {
    return { valid: false, reason: 'Message exceeds maximum size' };
  }

  let data;
  try {
    data = JSON.parse(rawMessage.toString());
  } catch {
    return { valid: false, reason: 'Invalid JSON' };
  }

  if (!data || typeof data !== 'object') {
    return { valid: false, reason: 'Message must be a JSON object' };
  }

  if (!data.type || typeof data.type !== 'string') {
    return { valid: false, reason: 'Missing or invalid message type' };
  }

  if (!ALLOWED_MESSAGE_TYPES.has(data.type)) {
    return { valid: false, reason: `Unknown message type: ${data.type}` };
  }

  // Type-specific validation
  const validator = TYPE_VALIDATORS[data.type];
  if (validator) {
    const result = validator(data);
    if (!result.valid) return result;
  }

  return { valid: true, data };
}

// ─── Per-type validators ──────────────────────────────────────────────────────

const TYPE_VALIDATORS = {
  register(data) {
    const peerId = sanitizeId(data.peerId, 128);
    if (!peerId) {
      return { valid: false, reason: 'Invalid peerId: must be 1-128 alphanumeric/hyphen/underscore characters' };
    }
    data.peerId = peerId;
    if (data.userId !== undefined) {
      const userId = sanitizeId(data.userId, 128);
      if (!userId) return { valid: false, reason: 'Invalid userId format' };
      data.userId = userId;
    }
    return { valid: true };
  },

  'join-room'(data) {
    if (data.roomId !== undefined) {
      const roomId = sanitizeId(data.roomId, MAX_ROOM_ID);
      if (!roomId) return { valid: false, reason: 'Invalid roomId format' };
      data.roomId = roomId;
    }
    return { valid: true };
  },

  broadcast(data) {
    if (!data.data || typeof data.data !== 'object') {
      return { valid: false, reason: 'broadcast.data must be an object' };
    }
    if (data.data.type !== undefined && typeof data.data.type !== 'string') {
      return { valid: false, reason: 'broadcast.data.type must be a string' };
    }
    return { valid: true };
  },

  direct(data) {
    if (!data.targetPeer) return { valid: false, reason: 'Missing targetPeer' };
    const target = sanitizeId(data.targetPeer, 128);
    if (!target) return { valid: false, reason: 'Invalid targetPeer format' };
    data.targetPeer = target;
    return { valid: true };
  },

  'new-poll'(data) {
    const poll = data.poll || data;
    if (poll.question !== undefined) {
      if (typeof poll.question !== 'string' || poll.question.length > MAX_POLL_QUESTION) {
        return { valid: false, reason: `Poll question must be a string of max ${MAX_POLL_QUESTION} characters` };
      }
    }
    if (poll.description !== undefined) {
      if (typeof poll.description !== 'string' || poll.description.length > MAX_POLL_DESCRIPTION) {
        return { valid: false, reason: `Poll description too long (max ${MAX_POLL_DESCRIPTION})` };
      }
    }
    if (poll.options !== undefined) {
      if (!Array.isArray(poll.options) || poll.options.length > MAX_POLL_OPTIONS) {
        return { valid: false, reason: `Poll options must be an array of max ${MAX_POLL_OPTIONS} items` };
      }
      for (const opt of poll.options) {
        if (typeof opt === 'object' && opt.text && opt.text.length > MAX_OPTION_TEXT) {
          return { valid: false, reason: `Option text too long (max ${MAX_OPTION_TEXT})` };
        }
      }
    }
    return { valid: true };
  },

  'new-block'(data) {
    // Basic structural validation — block must have type info
    if (data.data && typeof data.data !== 'object') {
      return { valid: false, reason: 'Block data must be an object' };
    }
    return { valid: true };
  },

  'request-sync'(data) {
    if (data.lastIndex !== undefined && typeof data.lastIndex !== 'number') {
      return { valid: false, reason: 'lastIndex must be a number' };
    }
    return { valid: true };
  },

  'sync-response'(data) {
    if (data.blocks !== undefined && !Array.isArray(data.blocks)) {
      return { valid: false, reason: 'blocks must be an array' };
    }
    return { valid: true };
  },

  'new-event'(data) {
    if (data.event !== undefined && typeof data.event !== 'object') {
      return { valid: false, reason: 'event must be an object' };
    }
    return { valid: true };
  },

  'new-post'(data) {
    const post = data.post || data;
    if (post && typeof post !== 'object') {
      return { valid: false, reason: 'Post data must be an object' };
    }
    if (post.title !== undefined && (typeof post.title !== 'string' || post.title.length > 500)) {
      return { valid: false, reason: 'Post title must be a string of max 500 characters' };
    }
    if (post.content !== undefined && (typeof post.content !== 'string' || post.content.length > 50000)) {
      return { valid: false, reason: 'Post content too long (max 50000)' };
    }
    return { valid: true };
  },

  'chatroom-message'(data) {
    if (data.roomId !== undefined) {
      const roomId = sanitizeId(data.roomId, MAX_ROOM_ID);
      if (!roomId) return { valid: false, reason: 'Invalid roomId format' };
      data.roomId = roomId;
    }
    if (data.data !== undefined) {
      const serialized = typeof data.data === 'string' ? data.data : JSON.stringify(data.data);
      if (serialized.length > MAX_CHAT_CONTENT) {
        return { valid: false, reason: `chatroom-message data too large (max ${MAX_CHAT_CONTENT})` };
      }
    }
    return { valid: true };
  },

  'request-pow'(data) {
    if (data.deviceId !== undefined) {
      const deviceId = sanitizeId(data.deviceId, 128);
      if (!deviceId) return { valid: false, reason: 'Invalid deviceId format' };
      data.deviceId = deviceId;
    }
    return { valid: true };
  },

  'chat-start'(data) {
    if (!data.recipientId) return { valid: false, reason: 'Missing recipientId' };
    const recipientId = sanitizeId(data.recipientId, 128);
    if (!recipientId) return { valid: false, reason: 'Invalid recipientId format' };
    data.recipientId = recipientId;
    return { valid: true };
  },

  'chat-message'(data) {
    if (!data.recipientId) return { valid: false, reason: 'Missing recipientId' };
    const recipientId = sanitizeId(data.recipientId, 128);
    if (!recipientId) return { valid: false, reason: 'Invalid recipientId format' };
    data.recipientId = recipientId;
    if (data.encryptedForRecipient && typeof data.encryptedForRecipient === 'string') {
      if (data.encryptedForRecipient.length > MAX_CHAT_CONTENT) {
        return { valid: false, reason: `Chat message too large (max ${MAX_CHAT_CONTENT} bytes)` };
      }
    }
    return { valid: true };
  },

  'chat-typing'(data) {
    if (!data.recipientId) return { valid: false, reason: 'Missing recipientId' };
    const recipientId = sanitizeId(data.recipientId, 128);
    if (!recipientId) return { valid: false, reason: 'Invalid recipientId format' };
    data.recipientId = recipientId;
    return { valid: true };
  },

  'chat-read'(data) {
    if (!data.recipientId) return { valid: false, reason: 'Missing recipientId' };
    const recipientId = sanitizeId(data.recipientId, 128);
    if (!recipientId) return { valid: false, reason: 'Invalid recipientId format' };
    data.recipientId = recipientId;
    return { valid: true };
  },

  ping() {
    return { valid: true };
  },
};
