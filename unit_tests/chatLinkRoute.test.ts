import { describe, expect, it, vi } from 'vitest';
import { createRouter, createMemoryHistory } from 'vue-router';
vi.mock('vue-router', async (orig) => ({ ...(await orig<any>()), createWebHistory: () => createMemoryHistory() }));
import { routes } from '../src/router/index';

const ID = 'a'.repeat(64);
// Stub lazy view components; the unit config has no .vue plugin.
const stub = (list: any[]): any[] => list.map(r => ({ ...r, ...(r.component ? { component: { render: () => null } } : {}),
  ...(r.children ? { children: stub(r.children) } : {}) }));
function make() { return createRouter({ history: createMemoryHistory(), routes: stub(routes) }); }

describe('chat link routing (URL pasted into the address bar)', () => {
  it('/chat#id=… opens ChatView with the fragment intact', async () => {
    const r = make(); await r.push(`/chat#id=${ID}&name=Bob`);
    expect(r.currentRoute.value.name).toBe('ChatFromLink');
    expect(r.currentRoute.value.hash).toBe(`#id=${ID}&name=Bob`);
  });
  it('bare /chat still goes to the home chat tab', async () => {
    const r = make(); await r.push('/chat');
    expect(r.currentRoute.value.path).toBe('/home');
    expect(r.currentRoute.value.query.tab).toBe('chat');
  });
  it('/chat with a fragment but no id falls back to the home chat tab', async () => {
    const r = make(); await r.push('/chat#name=Bob');
    expect(r.currentRoute.value.path).toBe('/home');
  });
  it('/chat/:userId still routes to ChatView', async () => {
    const r = make(); await r.push(`/chat/${ID}?name=Bob`);
    expect(r.currentRoute.value.name).toBe('Chat');
    expect(r.currentRoute.value.params.userId).toBe(ID);
  });
});
