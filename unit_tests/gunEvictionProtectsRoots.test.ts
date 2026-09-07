import { describe, it, expect, beforeEach, vi } from 'vitest';

// gun-shim loads Gun via a <script> tag; this suite only exercises evictCache,
// which never touches the Gun constructor.
vi.mock('../src/lib/gun-shim', () => ({ default: () => ({}) }));

const { GunService, GUN_NAMESPACE } = await import('../src/services/gunService');

// `initialize()` caches one chain for GUN_NAMESPACE and every namespaced write
// goes through it. If eviction deletes that soul's entry in `root.next`, the
// cached chain can no longer resolve a soul: puts produce no wire message and no
// ack, so writes stop reaching the relay for the rest of the session while reads
// keep working. These roots must survive every eviction level.
function fakeGun(soulCount: number) {
  const graph: Record<string, any> = {};
  const next: Record<string, any> = {};
  // Oldest keys first — insertion order is what `keys.slice(0, n)` walks.
  const roots = [
    GUN_NAMESPACE,
    `${GUN_NAMESPACE}/communities`,
    `${GUN_NAMESPACE}/posts`,
    `${GUN_NAMESPACE}/polls`,
    `${GUN_NAMESPACE}/users`,
  ];
  for (const soul of roots) { graph[soul] = { _: { '#': soul } }; next[soul] = { tag: {} }; }
  for (let i = 0; i < soulCount; i++) {
    const soul = `${GUN_NAMESPACE}/posts/post-${i}`;
    graph[soul] = { _: { '#': soul } };
    next[soul] = { tag: {} };
  }
  return { _: { graph, next } };
}

function setGun(gun: any) {
  (GunService as any).gun = gun;
  (GunService as any).evicting = false;
}

describe('GunService.evictCache', () => {
  beforeEach(() => setGun(fakeGun(2600)));

  it.each(['light', 'aggressive', 'emergency'] as const)('keeps the namespace roots at %s level', (level) => {
    const gun: any = (GunService as any).gun;
    GunService.evictCache(level);

    for (const soul of [GUN_NAMESPACE, `${GUN_NAMESPACE}/communities`, `${GUN_NAMESPACE}/posts`]) {
      expect(gun._.graph[soul], `${soul} graph node at ${level}`).toBeDefined();
      expect(gun._.next[soul], `${soul} chain at ${level}`).toBeDefined();
    }
  });

  it('still evicts ordinary souls', () => {
    const gun: any = (GunService as any).gun;
    const before = Object.keys(gun._.graph).length;
    GunService.evictCache('light');
    expect(Object.keys(gun._.graph).length).toBeLessThan(before);
  });
});
