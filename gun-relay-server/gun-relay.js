// gun-relay.js
// Self-hosted Gun.js relay server
// Run with: node gun-relay.js

import express from 'express';
import Gun from 'gun';
import http from 'http';
import cors from 'cors';

const PORT = process.env.PORT || 8765;
const app = express();

// Enable CORS for all origins
app.use(cors());

// Serve Gun.js
app.use(Gun.serve);

const server = http.createServer(app);

// Initialize Gun
const gun = Gun({
  web: server,
  radisk: true, // Persist data to disk
  localStorage: false,
  multicast: false
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    peers: Object.keys(gun._.opt.peers || {}).length,
    timestamp: Date.now()
  });
});

// Root endpoint
app.get('/', (req, res) => {
  res.send(`
    <html>
      <head>
        <title>Gun.js P2P Relay</title>
        <style>
          body {
            font-family: system-ui, -apple-system, sans-serif;
            max-width: 800px;
            margin: 50px auto;
            padding: 20px;
            background: #f5f5f5;
          }
          .card {
            background: white;
            padding: 30px;
            border-radius: 10px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
          }
          h1 { color: #333; margin: 0 0 20px; }
          .status { 
            display: inline-block;
            padding: 5px 15px;
            background: #4CAF50;
            color: white;
            border-radius: 20px;
            font-size: 14px;
            margin-bottom: 20px;
          }
          .info { 
            background: #e3f2fd;
            padding: 15px;
            border-radius: 5px;
            margin: 20px 0;
          }
          code {
            background: #263238;
            color: #aed581;
            padding: 2px 8px;
            border-radius: 3px;
            font-family: 'Courier New', monospace;
          }
          .endpoints {
            margin: 20px 0;
          }
          .endpoint {
            padding: 10px;
            background: #fafafa;
            margin: 10px 0;
            border-left: 3px solid #2196F3;
          }
        </style>
      </head>
      <body>
        <div class="card">
          <h1>🔫 Gun.js P2P Relay Server</h1>
          <span class="status">● ONLINE</span>
          
          <div class="info">
            <strong>📡 Server Info:</strong><br>
            Port: <code>${PORT}</code><br>
            Uptime: <code>${Math.floor(process.uptime())} seconds</code><br>
            Connected Peers: <code>${Object.keys(gun._.opt.peers || {}).length}</code>
          </div>

          <h3>Available Endpoints:</h3>
          <div class="endpoints">
            <div class="endpoint">
              <strong>WebSocket:</strong> <code>ws://localhost:${PORT}/gun</code><br>
              <small>Use this in your Gun.js client configuration</small>
            </div>
            <div class="endpoint">
              <strong>Health Check:</strong> <code>GET /health</code><br>
              <small>Returns server status and peer count</small>
            </div>
          </div>

          <div class="info">
            <strong>🚀 How to use in your app:</strong><br>
            <code>Gun(['http://localhost:${PORT}/gun'])</code>
          </div>

          <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee; color: #666; font-size: 14px;">
            <strong>Gun.js</strong> - Decentralized, Offline-First, Realtime Graph Database<br>
            This relay helps peers discover each other but does not control data.
          </div>
        </div>
      </body>
    </html>
  `);
});

server.listen(PORT, () => {
  console.log('');
  console.log('╔════════════════════════════════════════════╗');
  console.log('║   🔫 Gun.js P2P Relay Server Running      ║');
  console.log('╚════════════════════════════════════════════╝');
  console.log('');
  console.log(`📡 WebSocket: ws://localhost:${PORT}/gun`);
  console.log(`🌐 HTTP:      http://localhost:${PORT}`);
  console.log(`💚 Health:    http://localhost:${PORT}/health`);
  console.log('');
  console.log('Press Ctrl+C to stop');
  console.log('');
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n👋 Shutting down Gun relay server...');
  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});

// Log peer connections
setInterval(() => {
  const peerCount = Object.keys(gun._.opt.peers || {}).length;
  if (peerCount > 0) {
    console.log(`📊 Connected peers: ${peerCount}`);
  }
}, 30000); // Every 30 seconds