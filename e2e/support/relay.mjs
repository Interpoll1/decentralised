export function makePoll(overrides = {}) {
  return {
    id: 'poll-first-use-local',
    communityId: 'community-first-use-local',
    authorId: 'local-author',
    authorName: 'Local tester',
    question: 'Which day should we meet?',
    description: 'Local browser fixture',
    options: [
      { id: 'friday', text: 'Friday evening', votes: 0, voters: [] },
      { id: 'saturday', text: 'Saturday morning', votes: 0, voters: [] },
    ],
    createdAt: Date.now(),
    expiresAt: Date.now() + 86400000,
    allowMultipleChoices: false,
    showResultsBeforeVoting: false,
    requireLogin: false,
    isPrivate: false,
    totalVotes: 0,
    isExpired: false,
    ...overrides,
  };
}

// Exercise the actual app with fresh device storage and local relay responses.
// Every external HTTP request and WebSocket is intercepted before opening a page.
export async function mockRelay(context, poll = makePoll(), realGunOrigin) {
  await context.routeWebSocket('**', ws => {
    if (realGunOrigin && ws.url().startsWith(realGunOrigin.replace('http:', 'ws:'))) ws.connectToServer();
  });
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin === 'http://127.0.0.1:5197') return route.continue();
    if (url.origin === realGunOrigin && url.pathname.startsWith('/gun')) return route.continue();
    if (url.pathname === `/api/poll/${poll.id}`) return route.fulfill({ json: poll });
    if (url.pathname === '/api/vote-authorize') {
      return route.fulfill({ json: { allowed: true, reservationToken: 'local-test-reservation' } });
    }
    return route.fulfill({ json: { ok: true, communities: [], posts: [], polls: [] } });
  });
}

export async function navigate(page, path) {
  await page.evaluate(async destination => {
    const { default: router } = await import('/src/router/index.ts');
    await router.push(destination);
  }, path);
}
