/**
 * gun-relay-sw.js — ServiceWorker Gun mesh relay
 *
 * Place at: /public/gun-relay-sw.js
 * Vite copies /public to /dist automatically.
 *
 * How it works:
 *   Each tab registers a MessageChannel port with this SW on startup.
 *   When a tab writes a Gun message, it posts it to the SW via its port.
 *   The SW fans it out to all other registered ports (other open tabs).
 *   Tabs on the same origin can sync Gun data without hitting the server.
 *
 * This is progressive enhancement — the app works fine without it.
 * It only activates on HTTPS origins (SW requirement).
 * Capacitor native builds: test before enabling; WebView SW support varies.
 */

const SW_VERSION = 'gun-relay-v2';
const BC_NAME    = 'gun-mesh-v4';

let bc = null;
const clientPorts = new Set();

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());

  // BroadcastChannel fans Gun messages to all tabs on this origin
  bc = new BroadcastChannel(BC_NAME);

  bc.onmessage = (event) => {
    const { senderId, data } = event.data || {};
    for (const port of clientPorts) {
      if (port._clientId === senderId) continue; // don't echo back
      try {
        port.postMessage({ type: 'gun-mesh', data });
      } catch {
        clientPorts.delete(port); // port is dead — clean up
      }
    }
  };
});

/**
 * Tabs register by sending a 'gun-mesh-register' message with a MessagePort.
 * The SW stores the port and uses it for bi-directional communication.
 */
self.addEventListener('message', (event) => {
  if (event.data?.type !== 'gun-mesh-register') return;

  const port = event.ports[0];
  if (!port) return;

  const clientId = event.data.clientId || Math.random().toString(36).slice(2);
  port._clientId = clientId;
  clientPorts.add(port);

  // Fan out incoming Gun data from this tab to all other tabs
  port.onmessage = (portEvent) => {
    const gunData = portEvent.data;
    if (!gunData) return;

    // BroadcastChannel path (reaches tabs that registered via BC directly)
    if (bc) {
      bc.postMessage({ senderId: clientId, data: gunData });
    }

    // Direct port path (lower latency than BC round-trip)
    for (const otherPort of clientPorts) {
      if (otherPort === port) continue;
      try {
        otherPort.postMessage({ type: 'gun-mesh', data: gunData });
      } catch {
        clientPorts.delete(otherPort);
      }
    }
  };

  // Confirm registration
  port.postMessage({ type: 'gun-mesh-ready', clientId, swVersion: SW_VERSION });
});
