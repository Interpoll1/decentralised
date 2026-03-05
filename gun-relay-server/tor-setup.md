# Running the Gun Relay as a Tor Hidden Service

## Overview

You can expose the GunDB relay server as a Tor hidden service (`.onion` address), making it accessible to Tor Browser users and peer nodes running through Tor. The relay itself doesn't need modification — Tor handles the routing.

## Prerequisites

```bash
# Ubuntu/Debian
sudo apt install tor

# macOS
brew install tor
```

## Setup

### 1. Configure Tor Hidden Service

Edit `/etc/tor/torrc`:

```
HiddenServiceDir /var/lib/tor/interpoll-gun/
HiddenServicePort 8765 127.0.0.1:8765
```

For the WebSocket relay too:

```
HiddenServiceDir /var/lib/tor/interpoll-ws/
HiddenServicePort 8080 127.0.0.1:8080
```

### 2. Restart Tor

```bash
sudo systemctl restart tor
```

### 3. Get Your .onion Addresses

```bash
sudo cat /var/lib/tor/interpoll-gun/hostname
# → e.g., abc123xyz456.onion

sudo cat /var/lib/tor/interpoll-ws/hostname
# → e.g., def789uvw012.onion
```

### 4. Start the Relay Servers

```bash
# Gun relay (normal start — Tor handles routing)
npm run dev:gun

# WebSocket relay
npm run dev:relay
```

### 5. Share Your .onion URLs

Users can add these in InterPoll → Resilience → Relay Management:

| Field | Value |
|-------|-------|
| Label | My Tor Relay |
| WebSocket URL | `wss://def789uvw012.onion/ws` |
| Gun URL | `https://abc123xyz456.onion/gun` |
| API URL | `https://def789uvw012.onion` |
| Is Tor | ✅ |

## Security Considerations

- The relay server binds to `127.0.0.1` — it's only accessible via Tor, not the open internet
- No need to open firewall ports
- Tor provides end-to-end encryption between client and hidden service
- The relay operator's IP is hidden from clients
- Clients' IPs are hidden from the relay

## Dual-Stack Setup

You can run both a clearnet relay AND a Tor hidden service on the same machine:

```
# torrc — point to the same local ports
HiddenServicePort 8765 127.0.0.1:8765
HiddenServicePort 8080 127.0.0.1:8080
```

The relay serves both clearnet and Tor clients simultaneously. Share both URLs so users can choose.

## Monitoring

```bash
# Check Tor service status
sudo systemctl status tor

# Check if hidden service is accessible
# (from another machine with Tor)
curl --socks5-hostname 127.0.0.1:9050 http://abc123xyz456.onion/gun
```
