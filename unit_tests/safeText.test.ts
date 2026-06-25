import { describe, it, expect } from 'vitest';
import { autoLink, escapeHtml } from '../src/utils/safeText';

describe('safeText.autoLink (XSS hardening)', () => {
  it('escapes raw HTML so injected markup cannot execute', () => {
    const out = autoLink('<img src=x onerror=alert(1)>');
    expect(out).not.toContain('<img');
    expect(out).toContain('&lt;img');
    expect(out).toContain('onerror=alert(1)&gt;'.replace('>', '')); // attr text is inert, escaped
  });

  it('neutralizes a script tag', () => {
    const out = autoLink('hello <script>steal()</script>');
    expect(out).not.toMatch(/<script>/);
    expect(out).toContain('&lt;script&gt;');
  });

  it('still linkifies bare URLs', () => {
    const out = autoLink('see https://example.com/x now');
    expect(out).toContain('<a href="https://example.com/x"');
    expect(out).toContain('rel="noopener noreferrer"');
  });

  it('does not let a crafted URL break out of the href attribute', () => {
    const out = autoLink('https://e.com/"><script>x</script>');
    expect(out).not.toMatch(/<script>/);
  });

  it('escapeHtml covers all five metacharacters', () => {
    expect(escapeHtml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;');
  });

  it('returns empty string for empty input', () => {
    expect(autoLink('')).toBe('');
  });
});
