/**
 * Desktop relay socket.
 *
 * Phase 0 uses the webview's own `WebSocket`, identical to web. Phase 3 moves
 * the socket into Rust (`invoke('relay_connect')` + a Tauri `Channel<string>`)
 * so it survives a webview reload and keeps relaying while the window is hidden
 * to tray — the mechanism behind always-on seeding. The wire envelope is
 * byte-identical either way, so `websocketService.ts` is unaffected.
 */
export { platformSignal, default } from '../web/signal';
