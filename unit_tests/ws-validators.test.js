import { describe, it, expect } from 'vitest';
import { validateWsMessage } from '../ws-validators.js';

describe('validateWsMessage', () => {
  describe('basic validation', () => {
    it('rejects oversized messages', () => {
      const huge = JSON.stringify({ type: 'ping', data: 'x'.repeat(300000) });
      const result = validateWsMessage(huge);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('maximum size');
    });

    it('rejects invalid JSON', () => {
      const result = validateWsMessage('not json {{{');
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('Invalid JSON');
    });

    it('rejects non-object messages', () => {
      const result = validateWsMessage('"just a string"');
      expect(result.valid).toBe(false);
    });

    it('rejects missing type', () => {
      const result = validateWsMessage(JSON.stringify({ data: 'test' }));
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('type');
    });

    it('rejects unknown message type', () => {
      const result = validateWsMessage(JSON.stringify({ type: 'hack-server' }));
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('Unknown');
    });

    it('accepts valid ping', () => {
      const result = validateWsMessage(JSON.stringify({ type: 'ping' }));
      expect(result.valid).toBe(true);
    });
  });

  describe('register', () => {
    it('accepts valid register', () => {
      const result = validateWsMessage(
        JSON.stringify({ type: 'register', peerId: 'abc-123' }),
      );
      expect(result.valid).toBe(true);
      expect(result.data.peerId).toBe('abc-123');
    });

    it('rejects register with invalid peerId', () => {
      const result = validateWsMessage(
        JSON.stringify({ type: 'register', peerId: '<script>alert(1)</script>' }),
      );
      expect(result.valid).toBe(false);
    });

    it('rejects register with oversized peerId', () => {
      const result = validateWsMessage(
        JSON.stringify({ type: 'register', peerId: 'a'.repeat(200) }),
      );
      expect(result.valid).toBe(false);
    });
  });

  describe('broadcast', () => {
    it('accepts valid broadcast', () => {
      const result = validateWsMessage(
        JSON.stringify({ type: 'broadcast', data: { type: 'test', payload: 'hi' } }),
      );
      expect(result.valid).toBe(true);
    });

    it('rejects broadcast without data object', () => {
      const result = validateWsMessage(
        JSON.stringify({ type: 'broadcast', data: 'not-an-object' }),
      );
      expect(result.valid).toBe(false);
    });
  });

  describe('direct', () => {
    it('accepts valid direct message', () => {
      const result = validateWsMessage(
        JSON.stringify({ type: 'direct', targetPeer: 'peer-123' }),
      );
      expect(result.valid).toBe(true);
    });

    it('rejects direct without targetPeer', () => {
      const result = validateWsMessage(JSON.stringify({ type: 'direct' }));
      expect(result.valid).toBe(false);
    });

    it('rejects direct with invalid targetPeer', () => {
      const result = validateWsMessage(
        JSON.stringify({ type: 'direct', targetPeer: '../../../etc' }),
      );
      expect(result.valid).toBe(false);
    });
  });

  describe('new-poll', () => {
    it('accepts valid poll', () => {
      const result = validateWsMessage(
        JSON.stringify({
          type: 'new-poll',
          poll: { question: 'Best lang?', options: [{ text: 'JS' }, { text: 'TS' }] },
        }),
      );
      expect(result.valid).toBe(true);
    });

    it('rejects poll with oversized question', () => {
      const result = validateWsMessage(
        JSON.stringify({
          type: 'new-poll',
          poll: { question: 'x'.repeat(501) },
        }),
      );
      expect(result.valid).toBe(false);
    });

    it('rejects poll with too many options', () => {
      const options = Array(21)
        .fill(null)
        .map((_, i) => ({ text: `opt-${i}` }));
      const result = validateWsMessage(
        JSON.stringify({ type: 'new-poll', poll: { options } }),
      );
      expect(result.valid).toBe(false);
    });

    it('rejects poll with oversized option text', () => {
      const result = validateWsMessage(
        JSON.stringify({
          type: 'new-poll',
          poll: { options: [{ text: 'x'.repeat(201) }] },
        }),
      );
      expect(result.valid).toBe(false);
    });
  });

  describe('new-post', () => {
    it('accepts valid post', () => {
      const result = validateWsMessage(
        JSON.stringify({ type: 'new-post', post: { title: 'Hello', content: 'World' } }),
      );
      expect(result.valid).toBe(true);
    });

    it('rejects post with oversized title', () => {
      const result = validateWsMessage(
        JSON.stringify({ type: 'new-post', post: { title: 'x'.repeat(501) } }),
      );
      expect(result.valid).toBe(false);
    });

    it('rejects post with oversized content', () => {
      const result = validateWsMessage(
        JSON.stringify({ type: 'new-post', post: { content: 'x'.repeat(50001) } }),
      );
      expect(result.valid).toBe(false);
    });
  });

  describe('join-room', () => {
    it('accepts valid join-room', () => {
      const result = validateWsMessage(
        JSON.stringify({ type: 'join-room', roomId: 'room-42' }),
      );
      expect(result.valid).toBe(true);
    });

    it('rejects invalid roomId', () => {
      const result = validateWsMessage(
        JSON.stringify({ type: 'join-room', roomId: '<evil>' }),
      );
      expect(result.valid).toBe(false);
    });
  });

  describe('request-sync', () => {
    it('accepts valid request-sync', () => {
      const result = validateWsMessage(
        JSON.stringify({ type: 'request-sync', lastIndex: 42 }),
      );
      expect(result.valid).toBe(true);
    });

    it('rejects non-number lastIndex', () => {
      const result = validateWsMessage(
        JSON.stringify({ type: 'request-sync', lastIndex: 'abc' }),
      );
      expect(result.valid).toBe(false);
    });
  });

  describe('chatroom-message', () => {
    it('accepts valid chatroom-message', () => {
      const result = validateWsMessage(
        JSON.stringify({ type: 'chatroom-message', roomId: 'room-1', data: { text: 'hi' } }),
      );
      expect(result.valid).toBe(true);
    });

    it('rejects oversized chatroom data', () => {
      const result = validateWsMessage(
        JSON.stringify({ type: 'chatroom-message', data: 'x'.repeat(70000) }),
      );
      expect(result.valid).toBe(false);
    });
  });

  describe('chat-start / chat-message / chat-typing / chat-read', () => {
    for (const msgType of ['chat-start', 'chat-message', 'chat-typing', 'chat-read']) {
      it(`${msgType}: accepts valid message`, () => {
        const result = validateWsMessage(
          JSON.stringify({ type: msgType, recipientId: 'peer-abc' }),
        );
        expect(result.valid).toBe(true);
      });

      it(`${msgType}: rejects missing recipientId`, () => {
        const result = validateWsMessage(JSON.stringify({ type: msgType }));
        expect(result.valid).toBe(false);
      });

      it(`${msgType}: rejects invalid recipientId`, () => {
        const result = validateWsMessage(
          JSON.stringify({ type: msgType, recipientId: '../../etc' }),
        );
        expect(result.valid).toBe(false);
      });
    }
  });

  describe('request-pow', () => {
    it('accepts valid request-pow', () => {
      const result = validateWsMessage(
        JSON.stringify({ type: 'request-pow', deviceId: 'dev-1' }),
      );
      expect(result.valid).toBe(true);
    });

    it('rejects invalid deviceId', () => {
      const result = validateWsMessage(
        JSON.stringify({ type: 'request-pow', deviceId: 'a b c' }),
      );
      expect(result.valid).toBe(false);
    });
  });

  describe('Buffer input', () => {
    it('accepts Buffer input', () => {
      const buf = Buffer.from(JSON.stringify({ type: 'ping' }));
      const result = validateWsMessage(buf);
      expect(result.valid).toBe(true);
    });

    it('rejects oversized Buffer', () => {
      const buf = Buffer.alloc(300000, 'a');
      const result = validateWsMessage(buf);
      expect(result.valid).toBe(false);
    });
  });
});
