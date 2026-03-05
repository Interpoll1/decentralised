# Running peer.js Through Tor (SOCKS5 Proxy)

## Overview

The headless peer node (`peer.js`) can route all connections through a SOCKS5 proxy (e.g., Tor) for anonymous relay participation. This means the relay server never sees your real IP.

## Prerequisites

1. **Tor service** running locally (default SOCKS5 port: 9050)
   ```bash
   # Ubuntu/Debian
   sudo apt install tor
   sudo systemctl start tor
   
   # macOS
   brew install tor
   tor &
   ```

2. **socks-proxy-agent** npm package (installed on first use)
   ```bash
   npm install socks-proxy-agent
   ```

## Usage

```bash
# Basic usage with Tor
node peer.js --proxy socks5h://127.0.0.1:9050

# With custom relay URLs
node peer.js --proxy socks5h://127.0.0.1:9050 \
  --ws wss://your-relay.onion/ws \
  --gun https://your-gun.onion/gun

# With all options
node peer.js \
  --proxy socks5h://127.0.0.1:9050 \
  --ws wss://relay.example.com/ws \
  --gun https://gun.example.com/gun \
  --api https://api.example.com \
  --data ./my-peer-data
```

> **Note:** Use `socks5h://` (with `h`) to resolve DNS through the proxy. This is important for `.onion` addresses.

## What Gets Proxied

- ✅ WebSocket connections to the relay server
- ✅ GunDB peer connections
- ✅ All HTTP/HTTPS requests
- ❌ Local file I/O (not network traffic)
- ❌ BroadcastChannel (browser-only, not applicable)

## Verification

Check that your peer is connecting through Tor:

```bash
# Verify Tor is running
curl --socks5-hostname 127.0.0.1:9050 https://check.torproject.org/api/ip
# Should return: {"IsTor":true, ...}

# Start peer with verbose output
node peer.js --proxy socks5h://127.0.0.1:9050
# Look for 🧅 icon in the boot banner
```

## Running as a Service

```bash
# systemd unit (save as /etc/systemd/system/interpoll-peer.service)
[Unit]
Description=InterPoll Headless Peer (Tor)
After=tor.service network.target
Requires=tor.service

[Service]
Type=simple
User=interpoll
WorkingDirectory=/opt/interpoll
ExecStart=/usr/bin/node peer.js --proxy socks5h://127.0.0.1:9050
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

## Security Notes

- The peer stores data locally in `./peer-data/` — this is NOT anonymized
- Your relay server will see the Tor exit node IP, not your real IP
- If using `.onion` relay addresses, traffic never leaves the Tor network
- The peer's GunDB peer ID is random and not linked to your identity
