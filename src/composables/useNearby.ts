// Shared Nearby state (one instance for the whole app). Nothing runs until the user has opted in.
import { computed, reactive, ref, shallowRef } from 'vue';
import {
  NearbyService, HEARTBEAT_MS,
  type NearbyPrefs, type NearbyPerson, type NearbyMeetup, type NearbySpace, type LocationSource, type Visibility, type FoundPosition,
} from '../services/nearbyService';
import { KeyService } from '../services/keyService';
import { UserService } from '../services/userService';
import { cellsAround, haversineKm, levelForRadius, RADII, type Precision, type RadiusKm } from '../utils/geoCells';

export type NearbyStatus = 'idle' | 'locating' | 'live' | 'denied' | 'error';

const MAX_PEOPLE = 300;

const prefs = reactive<NearbyPrefs>(NearbyService.loadPrefs());
const position = shallowRef<FoundPosition | null>(null);
const positionLabel = ref('');
const status = ref<NearbyStatus>('idle');
const errorText = ref('');
const publishError = ref('');
/** The area size actually published (can be wider than chosen if the position isn't accurate enough). */
const publishedPrecision = ref<Precision>(prefs.precision);
const myId = ref('');
const now = ref(Date.now());
const entries = shallowRef(new Map<string, any>());
let contacts: string[] = [];
const watches = new Map<string, () => void>();
const contactWatches = new Map<string, () => void>();
let started = false;
let beat: ReturnType<typeof setInterval> | null = null;
let clock: ReturnType<typeof setInterval> | null = null;
let lastPublish = 0;

function save() { NearbyService.savePrefs({ ...prefs, blocked: [...prefs.blocked] }); }

function setEntry(id: string, rec: any | null) {
  const m = entries.value;
  if (rec) { if (m.size >= 4000 && !m.has(id)) return; m.set(id, rec); } else if (!m.delete(id)) return;
  entries.value = new Map(m);
}

function handle(level: number, cell: string) {
  return (r: string | null, key: string) => {
    const id = `${level}|${cell}|${key}`;
    const rec = r ? NearbyService.verifyPublic(r, level, cell, key) : null;
    setEntry(id, rec && rec.type !== 'gone' ? rec : null);
  };
}

/** Subscribe to exactly the cells that can hold someone within the chosen radius. */
function syncWatches(force = false) {
  const pos = position.value;
  if (force || !pos || !prefs.enabled) {
    watches.forEach(u => u()); watches.clear();
    entries.value = new Map([...entries.value].filter(([k]) => k.startsWith('c|')));
    if (!pos || !prefs.enabled) return;
  }
  const level = levelForRadius(prefs.radius);
  const want = new Map(cellsAround(pos, Math.min(prefs.radius, level), level).map(c => [`${level}|${c.key}`, c]));
  for (const [k, unsub] of watches) {
    if (!want.has(k)) {
      unsub(); watches.delete(k);
      const next = new Map(entries.value);
      for (const id of next.keys()) if (id.startsWith(`${k}|`)) next.delete(id);
      entries.value = next;
    }
  }
  for (const [k, c] of want) if (!watches.has(k)) watches.set(k, NearbyService.watchCell(level, c.key, handle(level, c.key)));
}

/** One subscription per contact for the sealed record they leave for me. */
async function syncContactWatches() {
  contactWatches.forEach(u => u()); contactWatches.clear();
  const next = new Map(entries.value);
  for (const id of next.keys()) if (id.startsWith('c|')) next.delete(id);
  entries.value = next;
  if (!prefs.enabled || !started) return;
  for (const pub of contacts.slice(0, 40)) {
    const t = await NearbyService.incomingTag(pub);
    if (!t) continue;
    contactWatches.set(pub, NearbyService.watchSealed(t.tag, async r => {
      if (!r) return setEntry(`c|${pub}`, null);
      const inner = await NearbyService.openSealed(r, t.key);
      const rec = inner ? NearbyService.verifySealedInner(inner, pub) : null;
      setEntry(`c|${pub}`, rec && rec.type !== 'gone' ? { ...rec, viaContacts: true } : null);
    }));
  }
}

async function myName(): Promise<string> {
  try { const u = await UserService.getCurrentUser(); return u.displayName || u.username || 'Someone'; } catch { return 'Someone'; }
}

async function publish() {
  const pos = position.value;
  if (!prefs.enabled || !pos) return;
  try {
    NearbyService.lastError = '';
    const res = await NearbyService.publishPresence(pos, prefs, await myName(), contacts);
    publishedPrecision.value = res.precision;
    publishError.value = res.ok ? '' : (NearbyService.lastError || 'The relay did not accept your location.');
    lastPublish = Date.now();
  } catch (e: any) {
    publishError.value = String(e?.message || e);
  }
}

async function refreshPosition(): Promise<boolean> {
  status.value = 'locating'; errorText.value = '';
  try {
    let p: FoundPosition; let label = '';
    if (prefs.source === 'manual' && prefs.manual) { p = { lat: prefs.manual.lat, lon: prefs.manual.lon }; label = prefs.manual.label; }
    else if (prefs.source === 'ip') { const r = await NearbyService.locateIp(); p = r; label = r.label; }
    else p = await NearbyService.locateGps();
    position.value = p;
    positionLabel.value = label;
    status.value = 'live';
    return true;
  } catch (e: any) {
    // Keep a previously found position if a refresh fails.
    if (position.value) { status.value = 'live'; return true; }
    status.value = e?.message === 'denied' ? 'denied' : 'error';
    errorText.value = e?.message === 'denied'
      ? 'Location permission was blocked. Allow it in your browser, or pick "Approximate" or a city instead.'
      : 'Could not work out where you are. Try a city instead.';
    return false;
  }
}

async function start() {
  if (started || !prefs.enabled) return;
  started = true;
  try { myId.value = await KeyService.getPublicKeyHex(); } catch { /* ignore */ }
  if (!(await refreshPosition())) { started = false; return; }
  syncWatches(true);
  void syncContactWatches();
  void publish();
  beat = setInterval(async () => {
    if (!prefs.enabled) return;
    if (prefs.source !== 'manual') await refreshPosition();
    syncWatches();
    void publish();
  }, HEARTBEAT_MS);
  clock = setInterval(() => { now.value = Date.now(); }, 60_000);
  document.addEventListener('visibilitychange', onVisible);
}

function onVisible() {
  if (document.visibilityState === 'visible' && prefs.enabled && Date.now() - lastPublish > HEARTBEAT_MS / 2) void publish();
}

function stop() {
  started = false;
  if (beat) clearInterval(beat);
  if (clock) clearInterval(clock);
  beat = clock = null;
  document.removeEventListener('visibilitychange', onVisible);
  watches.forEach(u => u()); watches.clear();
  contactWatches.forEach(u => u()); contactWatches.clear();
  entries.value = new Map();
}

const inRange = (pos: FoundPosition, r: { lat: number; lon: number; prec: number }) =>
  prefs.radius >= 20000 || haversineKm(pos, r) <= prefs.radius + r.prec * 0.75;

const people = computed<NearbyPerson[]>(() => {
  const best = new Map<string, NearbyPerson>();
  const pos = position.value;
  if (!pos) return [];
  for (const r of entries.value.values()) {
    if (r.type !== 'person' || r.id === myId.value || prefs.blocked.includes(r.id)) continue;
    if (r.at + r.ttl < now.value) continue;
    if (prefs.detectedOnly && r.src === 'manual') continue;
    if (!inRange(pos, r)) continue;
    const cur = best.get(r.id);
    if (!cur || r.prec < cur.prec || (r.prec === cur.prec && r.at > cur.at)) {
      best.set(r.id, { id: r.id, name: r.name, prec: r.prec, lat: r.lat, lon: r.lon, at: r.at, viaContacts: !!r.viaContacts, src: r.src });
    }
  }
  return [...best.values()].sort((a, b) => haversineKm(pos, a) - haversineKm(pos, b)).slice(0, MAX_PEOPLE);
});

const meetups = computed<NearbyMeetup[]>(() => {
  const pos = position.value; if (!pos) return [];
  const seen = new Map<string, NearbyMeetup>();
  for (const r of entries.value.values()) {
    if (r.type !== 'meetup' || prefs.blocked.includes(r.hostId)) continue;
    if (prefs.detectedOnly && r.src === 'manual') continue;
    if (!inRange(pos, r)) continue;
    seen.set(`${r.hostId}${r.id}`, r);
  }
  return [...seen.values()].filter(m => m.when + 3 * 3600_000 > now.value).sort((a, b) => a.when - b.when).slice(0, 100);
});

const spaces = computed<NearbySpace[]>(() => {
  const pos = position.value; if (!pos) return [];
  const seen = new Map<string, NearbySpace>();
  for (const r of entries.value.values()) {
    if (r.type !== 'space' || prefs.blocked.includes(r.hostId)) continue;
    if (prefs.detectedOnly && r.src === 'manual') continue;
    if (!inRange(pos, r)) continue;
    seen.set(r.id, r);
  }
  return [...seen.values()].sort((a, b) => haversineKm(pos, a) - haversineKm(pos, b)).slice(0, 100);
});

/** Ids of people nearby (+ you) — used by the feed's "Nearby" filter. */
const nearbyAuthorIds = computed(() => {
  const s = new Set(people.value.map(p => p.id));
  if (myId.value) s.add(myId.value);
  return s;
});

export function useNearby() {
  async function enable(opts: { precision: Precision; source: LocationSource; visibility: Visibility; manual?: NearbyPrefs['manual'] }) {
    prefs.precision = opts.precision; prefs.source = opts.source; prefs.visibility = opts.visibility;
    prefs.manual = opts.source === 'manual' ? (opts.manual ?? null) : null;
    prefs.enabled = true; save();
    stop(); position.value = null;
    await start();
    return status.value === 'live';
  }

  /** Turn everything off and take down what this device published. */
  async function disable() {
    prefs.enabled = false; save();
    stop(); position.value = null; positionLabel.value = ''; status.value = 'idle'; publishError.value = '';
    await NearbyService.retract();
  }

  async function applySettings(patch: Partial<Pick<NearbyPrefs, 'precision' | 'visibility' | 'radius' | 'detectedOnly'>>) {
    const republish = 'precision' in patch || 'visibility' in patch;
    Object.assign(prefs, patch); save();
    if (!prefs.enabled || !position.value) return;
    syncWatches();
    if (republish) await publish();
  }

  async function setContacts(pubs: string[]) {
    const next = [...new Set(pubs.map(p => p.toLowerCase()).filter(Boolean))].sort();
    if (next.join() === [...contacts].sort().join()) return;
    contacts = next;
    if (!prefs.enabled || !started) return;
    await syncContactWatches();
    if (prefs.visibility === 'contacts') void publish();
  }

  function block(id: string) {
    if (!prefs.blocked.includes(id)) { prefs.blocked = [...prefs.blocked, id]; save(); }
    if (prefs.visibility === 'contacts') void publish();
  }
  function unblock(id: string) { prefs.blocked = prefs.blocked.filter(x => x !== id); save(); if (prefs.visibility === 'contacts') void publish(); }

  async function hostMeetup(m: { title: string; desc: string; place: string; when: number }) {
    if (!position.value) throw new Error('no-position');
    return NearbyService.publishMeetup(position.value, prefs, await myName(), m);
  }
  const removeMeetup = (id: string) => NearbyService.removeItem(`m_${myId.value}_${id}`);

  async function createLocalSpace(name: string, desc: string): Promise<string> {
    if (!position.value) throw new Error('no-position');
    const slug = name.toLowerCase().replace(/[^a-z0-9 -]/g, '').trim().replace(/\s+/g, '-').slice(0, 40);
    if (slug.length < 3) throw new Error('name');
    const { useCommunityStore } = await import('../stores/communityStore'); // loaded on demand
    const store = useCommunityStore();
    const community: any = await store.createCommunity({
      name: slug.replace(/-/g, ' '), displayName: name.trim().slice(0, 40), description: desc.trim().slice(0, 200), rules: [],
    } as any);
    await NearbyService.publishSpace(position.value, prefs, { id: community.id, name: community.displayName || name, desc });
    return community.id;
  }

  return {
    prefs, position, positionLabel, status, errorText, publishError, publishedPrecision, myId,
    people, meetups, spaces, nearbyAuthorIds,
    ensureStarted: start, enable, disable, applySettings, setContacts, block, unblock,
    refreshLocation: async () => { const ok = await refreshPosition(); if (ok) { syncWatches(); await publish(); } return ok; },
    hostMeetup, removeMeetup, createLocalSpace,
    geocode: NearbyService.geocode.bind(NearbyService),
    RADII,
  };
}

export type { RadiusKm };
