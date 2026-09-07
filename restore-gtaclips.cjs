// One-off: restore c-gtaclips metadata into GunDB. Values come from the create
// form as filled in (description/category/rules); displayName is the natural
// rendering of the slug — pass DISPLAY_NAME=... to override.
const Gun = require('gun');

const RELAY = 'https://interpoll2.endless.sbs';
const ID = 'c-gtaclips';
const rec = {
  id: ID,
  name: 'gtaclips',
  displayName: process.env.DISPLAY_NAME || 'GTA Clips',
  description: process.env.DESCRIPTION || 'Your go-to for GTA clips!',
  creatorId: 'current-user-id',
  createdAt: Number(process.env.CREATED_AT) || Date.now(),
  memberCount: 1,
  postCount: 0,
  category: 'gaming',
  nsfw: false,
  isPrivate: false,
};
const rules = { 0: 'Be respectful', 1: 'No spam' };

const put = (node, value) => new Promise((resolve) => {
  const timer = setTimeout(() => resolve({ ok: false, reason: 'ack timeout' }), 10_000);
  node.put(value, (ack) => { clearTimeout(timer); resolve(ack?.err ? { ok: false, reason: ack.err } : { ok: true }); });
});

(async () => {
  const gun = Gun({ peers: [`${RELAY}/gun`], radisk: false, localStorage: false, file: false, axe: false, multicast: false });
  console.log('meta ack: ', JSON.stringify(await put(gun.get(`v3/communities/${ID}`), rec)));
  console.log('rules ack:', JSON.stringify(await put(gun.get(`v3/communities/${ID}/rules`), rules)));

  // The /db mirror lags the ack — poll rather than read once.
  const url = `${RELAY}/db/soul?soul=${encodeURIComponent(`v3/communities/${ID}`)}`;
  for (let i = 0; i < 8; i++) {
    await new Promise((r) => setTimeout(r, 1_000));
    const res = await fetch(url);
    const data = res.ok ? (await res.json()).data || {} : {};
    if (data.createdAt && data.displayName) {
      console.log('persisted:', JSON.stringify(data).slice(0, 300));
      process.exit(0);
    }
  }
  console.log('NOT confirmed on relay');
  process.exit(1);
})();
