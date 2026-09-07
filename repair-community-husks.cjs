// One-off repair: re-put community metadata into GunDB for communities whose
// Gun node lost its metadata (husks holding only {polls, posts} links).
// Source of truth is the relay's own DB (/api/communities). Idempotent.
//
//   node repair-community-husks.cjs            # dry run — lists what it would write
//   node repair-community-husks.cjs --apply    # write
const Gun = require('gun');

const RELAY = 'https://interpoll2.endless.sbs';
const API = process.env.API_BASE || RELAY;
const APPLY = process.argv.includes('--apply');

const soulUrl = (soul) => `${RELAY}/db/soul?soul=${encodeURIComponent(soul)}`;

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) return null;
  return res.json();
}

function toGunRecord(c) {
  const rec = {
    id: c.id,
    name: c.name,
    displayName: c.displayName,
    description: c.description,
    creatorId: c.creatorId,
    createdAt: c.createdAt,
    memberCount: c.memberCount ?? 1,
    postCount: c.postCount ?? 0,
    category: c.category || null,
    nsfw: !!c.nsfw,
    isPrivate: !!c.isPrivate,
  };
  for (const [k, v] of Object.entries(rec)) if (v === undefined) delete rec[k];
  return rec;
}

const put = (node, value, label) => new Promise((resolve) => {
  let settled = false;
  const done = (r) => { if (!settled) { settled = true; resolve(r); } };
  const timer = setTimeout(() => done({ ok: false, reason: 'ack timeout' }), 10_000);
  node.put(value, (ack) => {
    clearTimeout(timer);
    done(ack?.err ? { ok: false, reason: ack.err } : { ok: true });
  });
});

(async () => {
  const list = (await getJson(`${API}/api/communities`))?.communities || [];
  const index = (await getJson(soulUrl('v3/communities')))?.data || {};
  const ids = Object.keys(index).filter((k) => k !== '_');

  const husks = [];
  for (const id of ids) {
    const node = (await getJson(soulUrl(`v3/communities/${id}`)))?.data || {};
    if (!node.createdAt) husks.push(id);
  }

  const byId = new Map(list.map((c) => [c.id, c]));

  // The API copy of an encrypted community carries only the public placeholder —
  // no `isEncrypted`, no `encryptedMeta`. Writing that back would assert the
  // community is NOT encrypted and destroy the ciphertext members decrypt from,
  // so an encrypted husk is not repairable from this source. Leave it alone.
  const isEncryptedPlaceholder = (c) =>
    c.isEncrypted || !!c.encryptedMeta || String(c.displayName || '').startsWith('🔒');
  const unsafe = husks.filter((id) => byId.has(id) && isEncryptedPlaceholder(byId.get(id)) && !byId.get(id).encryptedMeta);

  const repairable = husks.filter((id) => byId.has(id) && !unsafe.includes(id));
  const orphans = husks.filter((id) => !byId.has(id));
  if (unsafe.length) console.log(`skipping (encrypted, no ciphertext in API): ${unsafe.join(', ')}`);

  console.log(`communities in graph: ${ids.length}`);
  console.log(`husks (no metadata):  ${husks.length}`);
  console.log(`repairable from API:  ${repairable.length}`);
  console.log(`no source (skipped):  ${orphans.length}${orphans.length ? ' → ' + orphans.join(', ') : ''}`);
  console.log('');

  if (!APPLY) {
    for (const id of repairable) console.log(`would write ${id.padEnd(26)} "${byId.get(id).displayName}"`);
    console.log('\ndry run — pass --apply to write');
    process.exit(0);
  }

  const gun = Gun({ peers: [`${RELAY}/gun`], radisk: false, localStorage: false, file: false, axe: false, multicast: false });
  const results = [];
  for (const id of repairable) {
    const c = byId.get(id);
    const rec = toGunRecord(c);
    const ack = await put(gun.get(`v3/communities/${id}`), rec, id);
    // Independently confirm the relay stored it, rather than trusting the ack.
    // The /db mirror lags the ack by a second or two, so poll rather than read
    // once — a single immediate read reports a false negative on every row.
    let persisted = false;
    for (let i = 0; i < 5 && !persisted; i++) {
      await new Promise((r) => setTimeout(r, 1_000));
      const after = (await getJson(soulUrl(`v3/communities/${id}`)))?.data || {};
      persisted = !!after.createdAt && !!after.displayName;
    }
    results.push({ id, displayName: c.displayName, ack: ack.ok, persisted });
    console.log(`${persisted ? 'OK  ' : 'FAIL'} ${id.padEnd(26)} "${c.displayName}"${ack.ok ? '' : ' (ack: ' + ack.reason + ')'}`);
  }

  const failed = results.filter((r) => !r.persisted);
  console.log(`\nrepaired ${results.length - failed.length}/${results.length}`);
  if (failed.length) console.log('failed: ' + failed.map((r) => r.id).join(', '));
  process.exit(failed.length ? 1 : 0);
})();
