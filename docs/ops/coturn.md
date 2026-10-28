# coturn (TURN relay for 1:1 calls)

Calls try direct (host/srflx) candidates first. TURN is only the fallback for
symmetric NATs. When TURN is used, the VPS relays **DTLS-SRTP encrypted** media:
it sees both IPs and traffic volume, never content.

> **Not deployed automatically.** Do this by hand, in ONE multiplexed SSH session.
> The VPS bans rapid reconnects, so never run SSH in a retry loop.

## 1. Install

```bash
apt install coturn
openssl rand -hex 32   # → TURN_SECRET (keep it; used by coturn AND the relay)
```

## 2. `/etc/turnserver.conf`

```
use-auth-secret
static-auth-secret=<TURN_SECRET>
realm=turn.endless.social
listening-port=3478
tls-listening-port=5349
cert=/etc/letsencrypt/live/turn.endless.social/fullchain.pem
pkey=/etc/letsencrypt/live/turn.endless.social/privkey.pem
min-port=49160
max-port=49200
fingerprint
no-cli
no-multicast-peers
no-tlsv1
no-tlsv1_1
# Never relay into private / loopback ranges (SSRF guard)
denied-peer-ip=0.0.0.0-0.255.255.255
denied-peer-ip=10.0.0.0-10.255.255.255
denied-peer-ip=100.64.0.0-100.127.255.255
denied-peer-ip=127.0.0.0-127.255.255.255
denied-peer-ip=169.254.0.0-169.254.255.255
denied-peer-ip=172.16.0.0-172.31.255.255
denied-peer-ip=192.168.0.0-192.168.255.255
denied-peer-ip=::1
denied-peer-ip=fc00::-fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff
```

Make sure the coturn user can read the cert (`usermod -aG ssl-cert turnserver` or
copy via a renewal hook). Then add `TURNSERVER_ENABLED=1` to `/etc/default/coturn` and run
`systemctl enable --now coturn`.

## 3. Firewall

```bash
ufw allow 3478/udp
ufw allow 3478/tcp
ufw allow 5349/tcp
ufw allow 49160:49200/udp
```

## 4. Relay env

Add to the relay's env (PM2 ecosystem / `.env`), then restart the relay:

```
TURN_SECRET=<same secret as coturn>
TURN_URLS=turn:turn.endless.social:3478,turns:turn.endless.social:5349
```

When either one is unset, `GET /api/turn-credentials` returns 503. Calls then run
STUN-only, which still works for most NATs.

## 5. Verify

```bash
curl -s https://interpoll.endless.social/api/turn-credentials   # → 401 without auth (expected; needs session or ?pk&ts&sig)
# Easiest real check: start a call in the app with DevTools open and inspect the 200 response.
turnutils_uclient -u <username> -w <credential> turn.endless.social
```

Credentials have a 1 h TTL. The username is `<expiry>:<sha256(session user | device pubkey)[:32]>`.
