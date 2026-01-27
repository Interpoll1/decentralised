// relay-server.js
// Simple WebSocket relay for cross-device/cross-browser P2P sync
// Install: npm install ws
// Run: node relay-server.js

import { WebSocketServer } from 'ws';
import http from 'http';

const PORT = 8080;
const server = http.createServer();
const wss = new WebSocketServer({ server });

const clients = new Map(); // peerId -> WebSocket
const rooms = new Map();   // roomId -> Set of peerIds

wss.on('connection', (ws, req) => {
  let peerId = null;
  
  console.log('🔌 New connection from', req.socket.remoteAddress);

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message.toString());
      
      switch (data.type) {
        case 'register':
          peerId = data.peerId;
          clients.set(peerId, ws);
          console.log(`✅ Peer registered: ${peerId} (Total: ${clients.size})`);
          
          // Send list of active peers
          broadcast({
            type: 'peer-list',
            peers: Array.from(clients.keys())
          });
          break;
          
        case 'join-room':
          const roomId = data.roomId || 'default';
          if (!rooms.has(roomId)) {
            rooms.set(roomId, new Set());
          }
          rooms.get(roomId).add(peerId);
          console.log(`🚪 ${peerId} joined room: ${roomId}`);
          break;
          
        case 'broadcast':
          // Relay to all other peers
          console.log(`📡 Broadcasting ${data.data?.type || 'message'} from ${peerId}`);
          broadcastToOthers(peerId, data.data);
          break;
          
        case 'direct':
          // Send to specific peer
          const targetWs = clients.get(data.targetPeer);
          if (targetWs && targetWs.readyState === 1) { // 1 = OPEN
            targetWs.send(JSON.stringify(data.data));
          }
          break;
          
        // Handle direct P2P messages (not wrapped in 'broadcast')
        case 'new-poll':
        case 'new-block':
        case 'request-sync':
        case 'sync-response':
          console.log(`📡 Broadcasting ${data.type} from ${peerId}`);
          broadcastToOthers(peerId, data);
          break;
          
        default:
          console.log('Unknown message type:', data.type);
      }
    } catch (error) {
      console.error('Error handling message:', error);
    }
  });

  ws.on('close', () => {
    if (peerId) {
      clients.delete(peerId);
      
      // Remove from all rooms
      rooms.forEach((peers, roomId) => {
        peers.delete(peerId);
        if (peers.size === 0) {
          rooms.delete(roomId);
        }
      });
      
      console.log(`❌ Peer disconnected: ${peerId} (Total: ${clients.size})`);
      
      // Notify others
      broadcast({
        type: 'peer-left',
        peerId: peerId
      });
    }
  });

  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
  });
  
  // Send welcome message
  ws.send(JSON.stringify({
    type: 'welcome',
    message: 'Connected to P2P relay',
    timestamp: Date.now()
  }));
});

function broadcast(message) {
  clients.forEach((ws) => {
    if (ws.readyState === 1) { // 1 = OPEN
      ws.send(JSON.stringify(message));
    }
  });
}

function broadcastToOthers(excludePeerId, message) {
  clients.forEach((ws, peerId) => {
    if (peerId !== excludePeerId && ws.readyState === 1) { // 1 = OPEN
      ws.send(JSON.stringify(message));
    }
  });
}

server.listen(PORT, () => {
  console.log('🚀 P2P Relay Server running on ws://localhost:' + PORT);
  console.log('📡 Waiting for connections...');
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n👋 Shutting down relay server...');
  wss.clients.forEach((ws) => {
    ws.close();
  });
  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});