// InterPoll community Gun relay.
// Installed by install.sh / install.ps1 / vps.sh from https://interpoll.endless.sbs/relay-kit/
//
// Env:
//   PORT            listen port (default 8765)
//   HOST            bind address (default 0.0.0.0)
//   GUN_DATA_DIR    radisk directory (default ./radata)
//   UPSTREAM_PEERS  comma-separated Gun peers to mesh with ('' = standalone)
import Gun from 'gun';
import http from 'http';
import express from 'express';
import cors from 'cors';

const PORT = parseInt(process.env.PORT || '8765', 10);
const HOST = process.env.HOST || '0.0.0.0';
const DATA_DIR = process.env.GUN_DATA_DIR || './radata';
const UPSTREAM = (process.env.UPSTREAM_PEERS ?? 'https://interpoll2.endless.sbs/gun')
  .split(',').map((s) => s.trim()).filter(Boolean);

const app = express();
app.use(cors({ origin: '*' }));
app.get(['/', '/health'], (_req, res) => {
  const peers = Object.values(gun._.opt.peers || {});
  res.json({
    status: 'ok',
    service: 'interpoll-community-relay',
    peers: peers.length,
    connected: peers.filter((p) => p.wire && p.wire.readyState === 1).length,
    upstream: UPSTREAM,
  });
});
app.use(Gun.serve);

const server = http.createServer(app);
const gun = Gun({ web: server, file: DATA_DIR, radisk: true, peers: UPSTREAM });

server.listen(PORT, HOST, () => {
  console.log(`[interpoll-relay] listening on ${HOST}:${PORT}  data=${DATA_DIR}`);
  console.log(`[interpoll-relay] upstream: ${UPSTREAM.join(', ') || '(none)'}`);
  // Gun on Node only dials peers on first read; dial now so data relayed
  // through this node reaches the wider mesh immediately.
  for (const peer of Object.values(gun._.opt.peers)) gun._.opt.mesh.hi(peer);
});

const stop = () => server.close(() => process.exit(0));
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
