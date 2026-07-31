import crypto from 'crypto';

export const POW_DIFFICULTY = {
  'new-poll': 16,       // ~65K hashes, ~50ms
  'new-block': 16,
  'new-event': 16,
  'vote-authorize': 18, // ~262K hashes, ~200ms
  'vote-record': 18,
  'vote-confirm': 18,
  'broadcast': 12,      // ~4K hashes, ~3ms
  'chat-message': 10,   // ~1K hashes, ~1ms
  'chatroom-message': 10,
  'index': 14,          // ~16K hashes, ~12ms
  DEFAULT: 12,
};

export const POW_EXEMPT = new Set([
  'ping', 'pong', 'register', 'join-room',
  'chat-typing', 'chat-read', 'chat-delivered', 'chat-read-receipt',
  'rtc-offer', 'rtc-answer', 'rtc-ice',
  'snapshot-accept', 'snapshot-cancel',
]);

export function hasLeadingZeroBits(hashHex, bits) {
  const fullBytes = Math.floor(bits / 8);
  const remainderBits = bits % 8;
  for (let i = 0; i < fullBytes; i++) {
    if (parseInt(hashHex.substring(i * 2, i * 2 + 2), 16) !== 0) return false;
  }
  if (remainderBits > 0) {
    const byte = parseInt(hashHex.substring(fullBytes * 2, fullBytes * 2 + 2), 16);
    const mask = (0xff >> remainderBits) ^ 0xff;
    if ((byte & mask) !== 0) return false;
  }
  return true;
}

export function verifyPoW(message) {
  if (!message || typeof message !== 'object') return false;
  const msgType = message.type || '';
  if (POW_EXEMPT.has(msgType)) return true;
  if (!message._pow || typeof message._pow !== 'string') return false;
  if (!message._hash || typeof message._hash !== 'string') return false;
  if (message._pow.length > 64) return false;
  const difficulty = POW_DIFFICULTY[msgType] || POW_DIFFICULTY.DEFAULT;
  const input = message._hash + ':' + message._pow;
  const hash = crypto.createHash('sha256').update(input).digest('hex');
  return hasLeadingZeroBits(hash, difficulty);
}

export function computePoW(contentHash, difficulty) {
  let nonce = 0;
  while (true) {
    const nonceStr = nonce.toString(16);
    const input = contentHash + ':' + nonceStr;
    const hash = crypto.createHash('sha256').update(input).digest('hex');
    if (hasLeadingZeroBits(hash, difficulty)) return nonceStr;
    nonce++;
  }
}
