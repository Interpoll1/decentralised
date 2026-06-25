import { describe, it, expect } from 'vitest';
import { WebRTCService } from '../src/services/webrtcService';

describe('P2P manual signaling links', () => {
  it('builds a resilience invite link carrying the bundle', () => {
    const link = WebRTCService.buildSignalLink('AbC-_123');
    // History-mode path (no hash) so the query reaches the route.
    expect(link).toContain('/resilience?p2p=');
    expect(link).not.toContain('/#/');
    expect(link).toContain('AbC-_123');
  });

  it('extracts the bundle param from an invite link', () => {
    const link = WebRTCService.buildSignalLink('AbC-_123');
    expect(WebRTCService.extractBundleParam(link)).toBe('AbC-_123');
  });

  it('returns a raw bundle unchanged when no link wrapper is present', () => {
    expect(WebRTCService.extractBundleParam('  rawBundle123  ')).toBe('rawBundle123');
  });

  it('round-trips a url-encoded param', () => {
    const param = 'a+b/c=='; // pre-urlsafe form; encodeURIComponent in the link must survive
    const link = WebRTCService.buildSignalLink(param);
    expect(WebRTCService.extractBundleParam(link)).toBe(param);
  });

  it('ignores empty input', () => {
    expect(WebRTCService.buildSignalLink('   ')).toBe('');
    expect(WebRTCService.extractBundleParam('')).toBe('');
  });
});
