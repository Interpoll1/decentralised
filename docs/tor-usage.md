# Using InterPoll with Tor Browser

## Why Tor?

Tor Browser routes your traffic through the Tor network, hiding your IP address from relay servers and making it harder for ISPs or governments to block your access to InterPoll.

## Quick Start

1. **Download Tor Browser** from [torproject.org](https://www.torproject.org/download/)
2. **Open InterPoll** in Tor Browser — use the same URL as your regular browser
3. InterPoll auto-detects Tor Browser and shows a 🧅 indicator on the Resilience page

## Adding .onion Relays

If a relay operator publishes a `.onion` address, you can add it for maximum privacy:

1. Go to **Resilience** → **Relay Management**
2. Click **Add Relay**
3. Enter the `.onion` URLs for WebSocket, Gun, and API
4. Toggle **Is Tor Relay** on
5. Save — the relay will only be used when you're in Tor Browser

> **Note:** `.onion` addresses only work inside Tor Browser. Regular browsers cannot resolve them.

## Performance

Tor adds latency (typically 2-5 seconds per request). InterPoll works fine over Tor but expect:
- Slower initial load and data sync
- Higher latency on real-time features (chat, live poll updates)
- GunDB sync may take longer to converge

## Privacy Considerations

- **Relay operators** cannot see your real IP when using Tor
- **Other peers** cannot identify you by IP
- Your **device fingerprint** (used for vote fraud prevention) is still generated locally — Tor Browser's fingerprint resistance helps here
- **Pseudonyms** are deterministic per-post, so your browsing pattern across posts is not linkable

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Cannot connect to relay | Check if relay is online via Resilience → Scan All Relays |
| `.onion` relay unreachable | Ensure you're using Tor Browser, not a regular browser |
| Very slow sync | Normal for Tor; try connecting to fewer relays |
| WebRTC fails | Expected — Tor Browser blocks WebRTC by default for privacy |
