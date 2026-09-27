# Community relay kit

Everything behind **Settings → Network → Run a Relay Node**. These files are
served from the production VPS; edit here, then copy them to the VPS (see Deploy).

| Public URL | Source | What it does |
|---|---|---|
| `/install.sh` (also `/install-relay.sh`) | `install.sh` | Home server, Linux/Pi (systemd) or macOS (launchd). Installs Node if missing. |
| `/install.ps1` | `install.ps1` | Home server, Windows (Scheduled Task at startup, firewall rule). ASCII-only so `irm \| iex` decodes cleanly. |
| `/vps.sh` (also `/install-relay-vps.sh`) | `vps.sh` | Cloud VPS: Docker + Caddy (auto-TLS). `curl … \| sudo bash -s relay.example.com [email]` |
| `/relay-kit/relay.js`, `/relay-kit/package.json` | `kit/` | The relay itself, downloaded by all three installers. |
| `wss://interpoll.endless.sbs/tunnel` | `relay-bridge-server.js` | Tunnel bridge for the in-browser relay (`src/services/browserRelayService.ts`). |

The relay (`kit/relay.js`) is a plain Gun relay that meshes with
`UPSTREAM_PEERS` (default `https://interpoll2.endless.sbs/gun`) and dials them
at startup — Gun on Node otherwise connects lazily on first read, so a relay
nobody reads from would never forward writes upstream.

## Browser-tab relay

A tab can't accept connections, so it registers with the bridge and gets
`wss://interpoll.endless.sbs/tunnel/<id>/gun`. Each peer that connects there is
multiplexed over the tab's socket (`open` / `msg` / `close` frames keyed by a
client id) and plugged into the tab's Gun mesh as a virtual peer. Path-based,
so no wildcard DNS or wildcard certificate is needed. Limits: 50 peers per tab,
3 tabs per IP, 1 MiB frames.

## Deploy (VPS, no git remote there)

```
scp install.sh vps.sh install.ps1         root@VPS:/var/www/interpoll/community-relay/
scp kit/relay.js kit/package.json         root@VPS:/var/www/interpoll/community-relay/kit/
scp relay-bridge-server.js                root@VPS:/var/www/interpoll/backend/
ssh root@VPS 'pm2 restart relay-bridge'
```

nginx locations for all of the above live in `/etc/nginx/sites-enabled/interpoll`.
