# InterPoll Community Relay — Setup Guide

Anyone can run a relay node. The more relays exist, the more resilient the
network becomes. Choose the path that matches your setup.

---

## Which path is right for you?

| | Browser tab | Home server | Cloud / VPS |
|---|---|---|---|
| **Setup time** | 0 minutes | ~10 minutes | ~15 minutes |
| **Cost** | Free | Free (your hardware) | ~$5/month |
| **Always on** | ❌ Only while tab open | ✅ Yes | ✅ Yes |
| **Internet access** | ✅ Via bridge | ⚠️ Needs port forwarding | ✅ Yes |
| **Peers supported** | ~20 | ~100 | ~500+ |
| **Technical skill** | None | Low | Medium |

---

## Path 1 — Browser tab (easiest, no setup)

Your open browser tab acts as a Gun relay peer. Zero installation.

**In the app:** Settings → Network → Run a Relay Node → Browser tab → Start

You get a public relay URL automatically. Share it with others and they add it
under Settings → Network → Relay Peers → Add Peer.

**Limitations:**
- Stops working when you close the tab
- Requires the tunnel bridge service to be reachable (hosted on the main VPS)
- On the same local network, other users can use your local IP directly without the bridge

---

## Path 2 — Home server (Raspberry Pi / spare PC)

Runs permanently on hardware you own. No monthly cost.

**Requirements:** Any Linux machine (Ubuntu, Debian, Raspberry Pi OS), internet connection.

**Install (one command):**
```bash
curl -fsSL https://interpoll.endless.sbs/install-relay.sh | bash
```

The script:
1. Installs Node.js 20 if not present
2. Creates the relay at `/opt/interpoll-relay`
3. Installs it as a systemd service (auto-starts on reboot)
4. Prints your local relay URL

**Your relay URL** will look like `http://192.168.1.x:8765/gun` — this works
for anyone on your local network.

**Useful commands after install:**
```bash
sudo systemctl status interpoll-relay   # check if running
journalctl -u interpoll-relay -f        # live logs
sudo systemctl restart interpoll-relay  # restart
```

### Optional: internet access

By default your relay only works on your local network. To let anyone reach it:

1. **Port forward** port `8765` in your router to your Pi's local IP
2. Get a free domain via [DuckDNS](https://www.duckdns.org) pointing to your home IP
3. Your public relay URL: `http://myhome.duckdns.org:8765/gun`

> ⚠️ Port forwarding exposes your home network. Only do this if you're
> comfortable with the security implications.

---

## Path 3 — Cloud server / VPS (most reliable)

Permanent, internet-facing relay on a rented server. Supports your full
community even when you're offline.

**Cost:** ~$5/month. Recommended providers:
- [Hetzner](https://www.hetzner.com/cloud) — €4/month (Europe, very fast)
- [DigitalOcean](https://www.digitalocean.com) — $6/month (global)
- [Vultr](https://www.vultr.com) — $6/month (global)

**Requirements:**
- Ubuntu 20+ or Debian 11+ server
- A domain name with an A record pointing to the server's IP
- Ports 80 and 443 open

**Install (one command, replace with your domain):**
```bash
curl -fsSL https://interpoll.endless.sbs/install-relay-vps.sh | bash -s relay.yourdomain.com
```

The script installs Docker, Caddy (auto-TLS), and starts the relay.
Your relay URL will be `https://relay.yourdomain.com/gun`.

**Useful commands after install:**
```bash
# From /opt/interpoll-relay/
docker compose ps              # check status
docker compose logs -f         # live logs
docker compose restart         # restart
docker compose pull && docker compose up -d  # update to latest
```

---

## What a relay does and does not do

### Does
- Caches and relays Gun graph data to connected peers
- Keeps the network alive if the main VPS is down
- Joins the AXE peer mesh — discovered automatically by other relays
- Can optionally run moderation middleware (see below)

### Does NOT do (by default)
- Cannot read encrypted community content — stores and relays ciphertext only
- Cannot forge or modify posts, polls, or votes — all Ed25519-signed by authors
- Cannot override the client-side filter running in users' browsers

### Moderation on community relays

By default a community relay is a Gun data repeater with no moderation logic.
If you want to filter content through your relay, copy `moderation-middleware.js`
from the main relay server into your relay's directory and require it in `relay.js`.

This lets you:
- Block authors by their signing public key
- Reject messages matching server-side slur/CSAM patterns
- Rate-limit posts from the same device fingerprint

Without middleware, moderation runs only in each user's browser via the
`ModerationService` client-side filter.

---

## Auto-discovery

Gun's AXE protocol discovers your relay automatically once any common peer
connects to both you and another relay. No registration needed.

For faster initial discovery, announce from the app:
**Settings → Network → Discovery → Announce This Node**

Your relay URL is written to the Gun mesh and other users pick it up within
a few minutes.

---

## Optional: Tor hidden service

For users who need censorship resistance at the network layer.

Install Tor on your relay host, then add to `/etc/tor/torrc`:
```
HiddenServiceDir /var/lib/tor/interpoll-relay/
HiddenServicePort 80 127.0.0.1:8765
```

Restart Tor and find your address:
```bash
sudo systemctl restart tor
cat /var/lib/tor/interpoll-relay/hostname
# → youronionaddress.onion
```

Share as `http://youronionaddress.onion/gun`. Tor Browser users can add
this in Settings → Network → Relay Peers.

---

## Resource usage (VPS path)

Serving ~100 concurrent users:
- CPU: < 5% on a single core
- RAM: 100–300 MB
- Disk: grows over time (Gun persists to `./radata`); prune with a weekly cron if needed
- Network: ~1–5 GB/month for a small community

A $5/month VPS handles a typical community comfortably.

---

## Tunnel bridge (for browser relay path)

The browser relay path requires a tunnel bridge running on the main VPS.
This is `relay-bridge-server.js` in this directory.

To deploy it alongside the main relay:
```bash
# On the main VPS
node relay-bridge-server.js &

# Add to Nginx (wildcard subdomain):
# server {
#   server_name *.tunnel.interpoll.endless.sbs;
#   location / { proxy_pass http://127.0.0.1:9000; proxy_http_version 1.1;
#                proxy_set_header Upgrade $http_upgrade;
#                proxy_set_header Connection "upgrade"; }
# }

# DNS: add wildcard A record
# *.tunnel.interpoll.endless.sbs → your VPS IP
```

Update `BRIDGE_URLS` in `browserRelayService.ts` to point at your bridge.
