import Ajv from 'ajv';

const ajv = new Ajv({ allErrors: true, strict: false });

// --- Known WebSocket message types ---

export const KNOWN_WS_TYPES = new Set([
  'ping', 'pong', 'register', 'join-room',
  'broadcast', 'direct',
  'new-poll', 'new-block', 'new-event',
  'request-sync', 'sync-response',
  'chat-start', 'chat-message', 'chat-typing', 'chat-read',
  'chat-delivered', 'chat-read-receipt', 'chatroom-message',
  'rtc-offer', 'rtc-answer', 'rtc-ice',
  'snapshot-offer', 'snapshot-accept', 'snapshot-chunk',
  'snapshot-complete', 'snapshot-cancel',
]);

// --- Integrity fields allowed on any WS message ---

const integrityProperties = {
  _hash: { type: 'string', maxLength: 64 },
  _sig: { type: 'string', maxLength: 128 },
  _pub: { type: 'string', maxLength: 64 },
  _pow: { type: 'string', maxLength: 64 },
  _ts: { type: 'number' },
  _nonce: { oneOf: [{ type: 'string', maxLength: 64 }, { type: 'number' }] },
};

// --- Helper to build a base WS schema ---

function wsBase(typeValue, extraProps = {}, extraRequired = []) {
  return {
    type: 'object',
    required: ['type', ...extraRequired],
    properties: {
      type: { type: 'string', const: typeValue },
      ...integrityProperties,
      ...extraProps,
    },
    additionalProperties: true,
  };
}

// --- WebSocket message schemas ---

const wsSchemas = {
  'ping': {
    type: 'object',
    required: ['type'],
    properties: {
      type: { type: 'string', const: 'ping' },
      ...integrityProperties,
    },
    additionalProperties: false,
  },

  'pong': {
    type: 'object',
    required: ['type'],
    properties: {
      type: { type: 'string', const: 'pong' },
      timestamp: { type: 'number' },
      ...integrityProperties,
    },
    additionalProperties: false,
  },

  'register': wsBase('register', {
    peerId: { type: 'string', minLength: 1, maxLength: 100 },
  }, ['peerId']),

  'join-room': wsBase('join-room', {
    roomId: { type: 'string', minLength: 1, maxLength: 100 },
  }),

  'broadcast': wsBase('broadcast', {
    data: { type: 'object' },
  }, ['data']),

  'direct': wsBase('direct', {
    targetPeer: { type: 'string', minLength: 1, maxLength: 100 },
    data: { type: 'object' },
  }, ['targetPeer', 'data']),

  'new-poll': wsBase('new-poll', {
    pollId: { type: 'string', minLength: 1, maxLength: 200 },
  }, ['pollId']),

  'new-block': wsBase('new-block', {
    blockId: { type: 'string', minLength: 1, maxLength: 200 },
  }),

  'new-event': wsBase('new-event', {
    eventId: { type: 'string', minLength: 1, maxLength: 200 },
  }),

  'request-sync': wsBase('request-sync'),
  'sync-response': wsBase('sync-response'),
  'chat-start': wsBase('chat-start'),
  'chat-message': wsBase('chat-message'),
  'chat-typing': wsBase('chat-typing'),
  'chat-read': wsBase('chat-read'),
  'chat-delivered': wsBase('chat-delivered'),
  'chat-read-receipt': wsBase('chat-read-receipt'),
  'chatroom-message': wsBase('chatroom-message'),
  'rtc-offer': wsBase('rtc-offer'),
  'rtc-answer': wsBase('rtc-answer'),
  'rtc-ice': wsBase('rtc-ice'),
  'snapshot-offer': wsBase('snapshot-offer'),
  'snapshot-accept': wsBase('snapshot-accept'),
  'snapshot-chunk': wsBase('snapshot-chunk'),
  'snapshot-complete': wsBase('snapshot-complete'),
  'snapshot-cancel': wsBase('snapshot-cancel'),
};

// Pre-compile all WS validators
const wsValidators = {};
for (const [type, schema] of Object.entries(wsSchemas)) {
  wsValidators[type] = ajv.compile(schema);
}

// --- HTTP API request schemas ---

const httpSchemas = {
  'vote-authorize': {
    type: 'object',
    required: ['pollId', 'deviceId'],
    properties: {
      pollId: { type: 'string', minLength: 1, maxLength: 100 },
      deviceId: { type: 'string', minLength: 1, maxLength: 100 },
    },
    additionalProperties: true,
  },

  'vote-record': {
    type: 'object',
    required: ['pollId', 'deviceId'],
    properties: {
      pollId: { type: 'string', minLength: 1, maxLength: 100 },
      deviceId: { type: 'string', minLength: 1, maxLength: 100 },
    },
    additionalProperties: true,
  },

  'vote-confirm': {
    type: 'object',
    required: ['pollId', 'deviceId'],
    properties: {
      pollId: { type: 'string', minLength: 1, maxLength: 100 },
      deviceId: { type: 'string', minLength: 1, maxLength: 100 },
    },
    additionalProperties: true,
  },

  'receipt': {
    type: 'object',
    required: ['type', 'payload'],
    properties: {
      type: { type: 'string', const: 'receipt' },
      payload: { type: 'object' },
    },
    additionalProperties: true,
  },

  'index': {
    type: 'object',
    required: ['type', 'id', 'data'],
    properties: {
      type: { type: 'string', minLength: 1, maxLength: 50 },
      id: { type: 'string', minLength: 1, maxLength: 200 },
      data: { type: 'object' },
    },
    additionalProperties: true,
  },
};

const httpValidators = {};
for (const [endpoint, schema] of Object.entries(httpSchemas)) {
  httpValidators[endpoint] = ajv.compile(schema);
}

// --- Public API ---

export function validateMessage(type, payload) {
  if (!KNOWN_WS_TYPES.has(type)) {
    return { valid: false, errors: [`Unknown WebSocket message type: "${type}"`] };
  }
  const validate = wsValidators[type];
  if (!validate) {
    return { valid: false, errors: [`No schema defined for type: "${type}"`] };
  }
  const valid = validate(payload);
  if (valid) return { valid: true, errors: null };
  const errors = validate.errors.map((e) => `${e.instancePath || '/'} ${e.message}`);
  return { valid: false, errors };
}

export function validateHttpRequest(endpoint, payload) {
  const validate = httpValidators[endpoint];
  if (!validate) {
    return { valid: false, errors: [`Unknown HTTP endpoint: "${endpoint}"`] };
  }
  const valid = validate(payload);
  if (valid) return { valid: true, errors: null };
  const errors = validate.errors.map((e) => `${e.instancePath || '/'} ${e.message}`);
  return { valid: false, errors };
}

export function validateSearchQuery(q, maxLen = 200) {
  if (typeof q !== 'string') return null;
  const trimmed = q.trim();
  if (trimmed.length === 0 || trimmed.length > maxLen) return null;
  const sanitized = trimmed.replace(/[\x00-\x1f\x7f]/g, '');
  return sanitized.length > 0 ? sanitized : null;
}

export function validateSoulPath(soul, maxLen = 500) {
  if (typeof soul !== 'string') return false;
  if (soul.length === 0 || soul.length > maxLen) return false;
  if (/\.\./.test(soul)) return false;
  return /^[a-zA-Z0-9/_\-:.]+$/.test(soul);
}
