/**
 * hub.js — the WebSocket peer relay.
 *
 * Protocol contract (reconstructed from src/services/websocketService.ts):
 *
 *   client → relay
 *     {type:'register', peerId}          registers; no ack is awaited
 *     {type:'join-room', roomId}         room membership, 'default' on connect
 *     {type:'ping'}                      every 15s
 *     {type:'request-pow', deviceId, action}
 *     {type:'broadcast', data:{type, data, timestamp, _sig,_pub,_hash,_pow,…}}
 *     {type:'chatroom-message', roomId, data}
 *
 *   relay → client
 *     {type:'welcome'} / {type:'pong'}   ignored by the client, sent anyway
 *     {type:'peer-list', peers:[…]}      drives the peer counter in the UI
 *     {type:'peer-left', peerId}
 *     {type:'error', code:'PEER_ID_TAKEN'|'AUTH_REQUIRED'}
 *     {type:'pow-challenge', challengeId, prefix, difficulty, expiresAt}
 *     the *inner* object of a broadcast, verbatim — the client dispatches on
 *     its top-level `type` and hands `.data` to subscribers.
 *
 * Registration is accepted unconditionally unless REQUIRE_AUTH is set: the
 * production relay gates it behind an OAuth session, which is why an anonymous
 * client always shows 0 peers. A self-hosted instance has no accounts.
 */

import { WebSocketServer } from 'ws';
import { PowChallenge } from '../../pow-challenge.js';
import { validateWsMessage } from '../../ws-validators.js';
import { sanitizeId } from '../../security-utils.js';
import config from './env.js';

const PING_INTERVAL_MS = 20_000;

export class Hub {
  constructor({ rateLimiter }) {
    this.wss = new WebSocketServer({ noServer: true });
    this.rateLimiter = rateLimiter;
    this.pow = new PowChallenge();
    /** peerId → ws */
    this.peers = new Map();
    /** roomId → Set<ws> */
    this.rooms = new Map();
    this.messagesRelayed = 0;

    this.wss.on('connection', (ws, req) => this._onConnection(ws, req));

    this._heartbeat = setInterval(() => {
      for (const ws of this.wss.clients) {
        if (ws.isAlive === false) { ws.terminate(); continue; }
        ws.isAlive = false;
        try { ws.ping(); } catch { /* socket already gone */ }
      }
    }, PING_INTERVAL_MS);
    if (this._heartbeat.unref) this._heartbeat.unref();
  }

  handleUpgrade(req, socket, head) {
    this.wss.handleUpgrade(req, socket, head, ws => {
      this.wss.emit('connection', ws, req);
    });
  }

  get peerCount() {
    return this.peers.size;
  }

  _onConnection(ws, req) {
    ws.isAlive = true;
    ws.peerId = null;
    ws.remoteId = req.socket.remoteAddress || 'unknown';
    ws.on('pong', () => { ws.isAlive = true; });
    ws.on('error', () => { /* close handler does the cleanup */ });
    ws.on('close', () => this._onClose(ws));
    ws.on('message', raw => this._onMessage(ws, raw));
    this._send(ws, { type: 'welcome' });
  }

  _onClose(ws) {
    if (ws.peerId && this.peers.get(ws.peerId) === ws) {
      this.peers.delete(ws.peerId);
      this._broadcastToAll({ type: 'peer-left', peerId: ws.peerId }, ws);
      this._sendPeerList();
    }
    for (const members of this.rooms.values()) members.delete(ws);
  }

  _onMessage(ws, raw) {
    if (this.rateLimiter && !this.rateLimiter.checkWs(ws.remoteId).allowed) return;

    const validation = validateWsMessage(raw.toString());
    if (!validation.valid) return;
    const msg = validation.data;

    switch (msg.type) {
      case 'ping':
        this._send(ws, { type: 'pong' });
        return;
      case 'register':
        this._register(ws, msg);
        return;
      case 'join-room':
        this._joinRoom(ws, msg.roomId);
        return;
      case 'request-pow':
        this._issueChallenge(ws, msg);
        return;
      case 'broadcast':
        this._relayBroadcast(ws, msg);
        return;
      case 'chatroom-message':
        this._relayRoom(ws, msg);
        return;
      default:
        // Anything else the client sends raw (direct, sync-response, …) is
        // forwarded as-is so future message types keep working.
        this._broadcastToAll(msg, ws);
    }
  }

  _register(ws, msg) {
    if (config.requireAuth) {
      this._send(ws, { type: 'error', code: 'AUTH_REQUIRED' });
      return;
    }
    const peerId = sanitizeId(msg.peerId);
    if (!peerId) return;

    const existing = this.peers.get(peerId);
    if (existing && existing !== ws && existing.readyState === existing.OPEN) {
      this._send(ws, { type: 'error', code: 'PEER_ID_TAKEN' });
      return;
    }

    if (ws.peerId && ws.peerId !== peerId) this.peers.delete(ws.peerId);
    ws.peerId = peerId;
    this.peers.set(peerId, ws);
    this._sendPeerList();
  }

  _joinRoom(ws, roomIdRaw) {
    const roomId = sanitizeId(roomIdRaw);
    if (!roomId) return;
    if (!this.rooms.has(roomId)) this.rooms.set(roomId, new Set());
    this.rooms.get(roomId).add(ws);
  }

  _issueChallenge(ws, msg) {
    const deviceId = sanitizeId(msg.deviceId) || 'anonymous';
    const action = sanitizeId(msg.action) || 'broadcast';
    const challenge = this.pow.createChallenge(deviceId, action);
    this._send(ws, { type: 'pow-challenge', ...challenge });
  }

  /**
   * Fan out the *inner* payload. `sendToRelay` wraps content as
   * `{type:'broadcast', data:<inner>}`, and the receiving client dispatches on
   * `<inner>.type` — so unwrapping here is what makes new-block, peer-addresses,
   * post-updated and the WebRTC signaling types arrive as the client expects.
   */
  _relayBroadcast(ws, msg) {
    const inner = msg.data;
    if (!inner || typeof inner !== 'object' || typeof inner.type !== 'string') return;
    this.messagesRelayed++;
    this._broadcastToAll(inner, ws);
  }

  _relayRoom(ws, msg) {
    const roomId = sanitizeId(msg.roomId);
    if (!roomId) return;
    const payload = { type: 'chatroom-message', roomId, data: msg.data };
    const members = this.rooms.get(roomId);
    this.messagesRelayed++;
    // Room membership is best-effort: a peer that never sent join-room for this
    // room still gets the message, matching how the production relay behaves.
    if (members && members.size > 1) {
      for (const member of members) if (member !== ws) this._send(member, payload);
      return;
    }
    this._broadcastToAll(payload, ws);
  }

  /**
   * Push a relay-originated event to every client. Used when the relay itself
   * changes state (a lite-client vote) so open tabs update without polling.
   */
  broadcast(payload) {
    this._broadcastToAll(payload, null);
  }

  _broadcastToAll(payload, except) {
    for (const client of this.wss.clients) {
      if (client === except) continue;
      this._send(client, payload);
    }
  }

  _sendPeerList() {
    const peers = [...this.peers.keys()];
    for (const [peerId, ws] of this.peers) {
      this._send(ws, { type: 'peer-list', peers: peers.filter(id => id !== peerId) });
    }
  }

  _send(ws, payload) {
    if (ws.readyState !== ws.OPEN) return;
    try {
      ws.send(JSON.stringify(payload));
    } catch {
      // Peer vanished mid-send; the close handler cleans up.
    }
  }

  shutdown() {
    clearInterval(this._heartbeat);
    this.pow.destroy?.();
    for (const ws of this.wss.clients) ws.close(1001, 'relay shutting down');
    this.wss.close();
  }
}
