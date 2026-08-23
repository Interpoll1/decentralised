import type { SignalBackend, SignalSocket } from '../types';

/**
 * Web relay socket: a plain `WebSocket`.
 *
 * `WebSocket` already satisfies `SignalSocket` structurally, so there is nothing
 * to adapt. The indirection only matters on desktop, where the socket lives in
 * Rust so it can outlive a webview reload and keep seeding with the window
 * hidden to tray.
 */
export const platformSignal: SignalBackend = {
  open(url: string): SignalSocket {
    return new WebSocket(url) as unknown as SignalSocket;
  },
};

export default platformSignal;
