<template>
  <section class="nb" aria-label="Nearby">
    <!-- ── Setup / consent ─────────────────────────────────────────────── -->
    <div v-if="!nb.prefs.enabled || editing" class="nb-card">
      <p class="nb-title">{{ nb.prefs.enabled ? 'Nearby settings' : 'Find people near you' }}</p>
      <p v-if="!nb.prefs.enabled" class="nb-lead">
        See who's around, join local spaces and meetups. It's <b>off until you turn it on</b>, shares only a rough <b>area</b> (never your exact spot),
        expires on its own, and you can switch it off and wipe it any time.
      </p>

      <p class="nb-label">How precise should your area be?</p>
      <div class="nb-chips" role="radiogroup" aria-label="Area size">
        <button v-for="o in PREC_OPTS" :key="o.km" class="nb-chip" :class="{ on: form.precision === o.km }" role="radio" :aria-checked="form.precision === o.km" @click="form.precision = o.km">
          <b>{{ o.km }} km</b><small>{{ o.name }}</small>
        </button>
      </div>
      <p class="nb-hint">Others only ever see "within {{ form.precision }} km" of a point — never a pin on a street.</p>

      <p class="nb-label">Where do we get your location?</p>
      <div class="nb-opts" role="radiogroup" aria-label="Location source">
        <label class="nb-opt" :class="{ on: form.source === 'gps' }"><input v-model="form.source" type="radio" value="gps" /><span><b>GPS</b><small>Most accurate. Your browser will ask permission.</small></span></label>
        <label class="nb-opt" :class="{ on: form.source === 'ip' }"><input v-model="form.source" type="radio" value="ip" /><span><b>Approximate</b><small>City-level from your network address. No prompt; uses a lookup service.</small></span></label>
        <label class="nb-opt" :class="{ on: form.source === 'manual' }"><input v-model="form.source" type="radio" value="manual" /><span><b>A city I choose</b><small>Most private — nothing is detected.</small></span></label>
      </div>
      <div v-if="form.source === 'manual'" class="nb-city">
        <div class="nb-row">
          <input v-model="cityQuery" class="nb-input" placeholder="Search a city or town" aria-label="City" @keydown.enter.prevent="searchCity" />
          <button class="nb-btn" :disabled="searching" @click="searchCity">{{ searching ? '…' : 'Search' }}</button>
        </div>
        <ul v-if="cityResults.length" class="nb-results">
          <li v-for="r in cityResults" :key="r.label"><button :class="{ on: form.manual?.label === r.label }" @click="form.manual = { lat: r.lat, lon: r.lon, label: r.label }">{{ r.label }}</button></li>
        </ul>
        <p v-if="form.manual" class="nb-hint">Using <b>{{ form.manual.label }}</b></p>
        <p v-if="cityError" class="nb-err">{{ cityError }}</p>
      </div>

      <p class="nb-label">Who can see you?</p>
      <div class="nb-opts" role="radiogroup" aria-label="Visibility">
        <label class="nb-opt" :class="{ on: form.visibility === 'everyone' }"><input v-model="form.visibility" type="radio" value="everyone" /><span><b>Everyone nearby</b><small>Your name and rough area show up for people within range.</small></span></label>
        <label class="nb-opt" :class="{ on: form.visibility === 'contacts' }"><input v-model="form.visibility" type="radio" value="contacts" /><span><b>Only people I've messaged</b><small>Sealed per contact — nobody else can read it, not even that it's you.</small></span></label>
        <label class="nb-opt" :class="{ on: form.visibility === 'off' }"><input v-model="form.visibility" type="radio" value="off" /><span><b>No one — I just want to look</b><small>You can see others; nothing about you is shared.</small></span></label>
      </div>

      <label v-if="nb.prefs.enabled" class="nb-opt nb-opt--plain"><input type="checkbox" :checked="nb.prefs.detectedOnly" @change="nb.applySettings({ detectedOnly: ($event.target as HTMLInputElement).checked })" /><span><b>Only people whose location was detected</b><small>Hides anyone who typed in a city by hand (their location can't be checked).</small></span></label>

      <p v-if="nb.errorText.value" class="nb-err">{{ nb.errorText.value }}</p>
      <div class="nb-row nb-row--end">
        <button v-if="editing" class="nb-btn nb-btn--ghost" @click="editing = false">Cancel</button>
        <button class="nb-btn nb-btn--primary" :disabled="busy || (form.source === 'manual' && !form.manual)" @click="save">
          {{ busy ? 'Working…' : nb.prefs.enabled ? 'Save' : 'Turn on Nearby' }}
        </button>
      </div>
    </div>

    <!-- ── Live ────────────────────────────────────────────────────────── -->
    <template v-if="nb.prefs.enabled && !editing">
      <div class="nb-card nb-status">
        <div class="nb-status__main">
          <span class="nb-dot" :class="`nb-dot--${nb.status.value}`"></span>
          <div>
            <p class="nb-title">{{ statusLine }}</p>
            <p class="nb-hint">{{ visLine }}</p>
          </div>
        </div>
        <div class="nb-row">
          <button class="nb-btn nb-btn--ghost" @click="refresh">Refresh</button>
          <button class="nb-btn nb-btn--ghost" @click="openSettings">Settings</button>
        </div>
      </div>
      <p v-if="nb.status.value === 'denied' || nb.status.value === 'error'" class="nb-err nb-err--card">{{ nb.errorText.value }}</p>
      <p v-if="widened" class="nb-note">Your location is only accurate to about {{ nb.publishedPrecision.value }} km right now, so your shared area was widened from {{ nb.prefs.precision }} km to {{ nb.publishedPrecision.value }} km.</p>
      <p v-if="nb.publishError.value" class="nb-err nb-err--card">Couldn't publish your location: {{ nb.publishError.value }}</p>

      <div class="nb-bar">
        <div class="nb-chips nb-chips--tight" role="radiogroup" aria-label="Radius">
          <button v-for="r in RADII" :key="r" class="nb-chip nb-chip--sm" :class="{ on: nb.prefs.radius === r }" role="radio" :aria-checked="nb.prefs.radius === r" @click="nb.applySettings({ radius: r })">{{ RADIUS_LABEL(r) }}</button>
        </div>
        <button class="nb-btn nb-btn--ghost" @click="router.push({ path: '/home', query: { scope: 'nearby' } })">Nearby posts →</button>
      </div>

      <div class="nb-seg" role="tablist">
        <button v-for="t in TABS" :key="t.id" role="tab" :aria-selected="tab === t.id" :class="{ on: tab === t.id }" @click="tab = t.id">
          {{ t.label }}<span v-if="counts[t.id]" class="nb-count">{{ counts[t.id] }}</span>
        </button>
      </div>

      <!-- Map -->
      <NearbyMap
        v-if="tab === 'map'" :stats="mapStats"
        :me="nb.position.value" :myPrec="nb.publishedPrecision.value" :radiusKm="nb.prefs.radius"
        :people="nb.people.value" :meetups="nb.meetups.value" :spaces="nb.spaces.value" :tiles="tilesOn"
        @tiles="setTiles" @message="msg" @openSpace="openSpace" @hide="hide"
      />

      <!-- People -->
      <div v-else-if="tab === 'people'" class="nb-card nb-list">
        <p v-if="!nb.people.value.length" class="nb-empty">
          {{ nb.status.value === 'locating' ? 'Finding your area…' : `No one ${nb.prefs.radius >= 20000 ? 'anywhere' : 'within ' + RADIUS_LABEL(nb.prefs.radius)} yet. Try a wider radius — people appear as they turn Nearby on.` }}
        </p>
        <div v-for="p in nb.people.value" :key="p.id" class="nb-person">
          <span class="nb-avatar">{{ (p.name || '?').charAt(0).toUpperCase() }}</span>
          <span class="nb-person__info">
            <b>{{ p.name }} <em v-if="p.viaContacts" class="nb-tag">contact</em></b>
            <small>{{ distance(p) }} · {{ timeAgo(p.at) }} · {{ srcLabel(p.src) }}</small>
          </span>
          <button class="nb-btn" @click="router.push(`/chat/${p.id}`)">Message</button>
          <button class="nb-icon" aria-label="Hide this person" title="Hide" @click="hide(p.id, p.name)">✕</button>
        </div>
        <details v-if="nb.prefs.blocked.length" class="nb-hidden">
          <summary>Hidden people ({{ nb.prefs.blocked.length }})</summary>
          <div v-for="id in nb.prefs.blocked" :key="id" class="nb-row nb-hidden__row"><code>{{ id.slice(0, 10) }}…</code><button class="nb-btn nb-btn--ghost" @click="nb.unblock(id)">Unhide</button></div>
        </details>
      </div>

      <!-- Meetups -->
      <div v-else-if="tab === 'meetups'" class="nb-card nb-list">
        <p v-if="!nb.meetups.value.length && !hosting" class="nb-empty">No meetups within {{ nb.prefs.radius }} km yet. Be the first to host one.</p>
        <div v-for="m in nb.meetups.value" :key="m.hostId + m.id" class="nb-meetup">
          <div class="nb-date"><b>{{ dayNum(m.when) }}</b><small>{{ monthName(m.when) }}</small></div>
          <div class="nb-meetup__info">
            <b>{{ m.title }}</b>
            <small>{{ timeOfDay(m.when) }} · {{ m.place || 'Place TBA' }}</small>
            <small>Hosted by {{ m.hostName }} · {{ distance(m) }}</small>
            <p v-if="m.desc">{{ m.desc }}</p>
          </div>
          <button v-if="m.hostId === nb.myId.value" class="nb-btn nb-btn--ghost" @click="cancelMeetup(m.id)">Cancel</button>
          <button v-else class="nb-btn" @click="router.push(`/chat/${m.hostId}`)">Message host</button>
        </div>
        <button v-if="!hosting" class="nb-btn nb-btn--primary nb-wide" @click="hosting = true">Host a meetup</button>
        <form v-else class="nb-form" @submit.prevent="host">
          <input v-model="mForm.title" class="nb-input" maxlength="80" placeholder="Title (e.g. Saturday chess in the park)" required />
          <div class="nb-row">
            <input v-model="mForm.when" class="nb-input" type="datetime-local" required :min="minWhen" />
            <input v-model="mForm.place" class="nb-input" maxlength="80" placeholder="Place (public spot)" />
          </div>
          <textarea v-model="mForm.desc" class="nb-input" rows="2" maxlength="300" placeholder="Details (optional)"></textarea>
          <p class="nb-hint">Shown to everyone within range. Pick a public place and don't share a home address.</p>
          <div class="nb-row nb-row--end"><button type="button" class="nb-btn nb-btn--ghost" @click="hosting = false">Cancel</button><button class="nb-btn nb-btn--primary" :disabled="busy">Publish meetup</button></div>
        </form>
      </div>

      <!-- Local spaces -->
      <div v-else class="nb-card nb-list">
        <p v-if="!nb.spaces.value.length && !makingSpace" class="nb-empty">No local spaces within {{ nb.prefs.radius }} km yet.</p>
        <div v-for="s in nb.spaces.value" :key="s.id" class="nb-person">
          <span class="nb-avatar nb-avatar--sq">{{ s.name.charAt(0).toUpperCase() }}</span>
          <span class="nb-person__info"><b>{{ s.name }}</b><small>{{ s.desc || 'Local space' }} · {{ distance(s) }}</small></span>
          <button class="nb-btn" @click="router.push(`/community/${s.id}`)">Open</button>
        </div>
        <button v-if="!makingSpace" class="nb-btn nb-btn--primary nb-wide" @click="startSpace">Create a local space</button>
        <form v-else class="nb-form" @submit.prevent="makeSpace">
          <input v-model="sForm.name" class="nb-input" maxlength="40" placeholder="Name (e.g. Brooklyn Runners)" required />
          <input v-model="sForm.desc" class="nb-input" maxlength="200" placeholder="What's it about?" />
          <p class="nb-hint">Anyone within range can find it. Spaces are public.</p>
          <p v-if="spaceError" class="nb-err">{{ spaceError }}</p>
          <div class="nb-row nb-row--end"><button type="button" class="nb-btn nb-btn--ghost" @click="makingSpace = false">Cancel</button><button class="nb-btn nb-btn--primary" :disabled="busy">Create space</button></div>
        </form>
      </div>

      <button class="nb-off" @click="turnOff">Turn off Nearby &amp; delete my location data</button>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { useNearby } from '../composables/useNearby';
import { timeAgo } from '../composables/useRelayPulse';
import { distanceLabel, haversineKm, RADII, type Precision } from '../utils/geoCells';
import NearbyMap from './NearbyMap.vue';
import type { NearbyPrefs } from '../services/nearbyService';

const props = defineProps<{ chatList?: Array<{ publicKey?: string; userId?: string }>; mapStats?: Array<{ label: string; n: number; color: string; of?: number }> }>();
const router = useRouter();
const nb = useNearby();

const RADIUS_LABEL = (r: number) => (r >= 20000 ? 'Worldwide' : `${r.toLocaleString()} km`);
const PREC_OPTS: Array<{ km: Precision; name: string }> = [
  { km: 1, name: 'Neighbourhood' }, { km: 5, name: 'District' }, { km: 25, name: 'City' }, { km: 100, name: 'Region' }, { km: 500, name: 'Country' },
];
const TABS = [{ id: 'map', label: 'Map' }, { id: 'people', label: 'People' }, { id: 'meetups', label: 'Meetups' }, { id: 'spaces', label: 'Spaces' }] as const;
const tab = ref<'map' | 'people' | 'meetups' | 'spaces'>('map');
const counts = computed(() => ({ map: 0, people: nb.people.value.length, meetups: nb.meetups.value.length, spaces: nb.spaces.value.length }));

const editing = ref(false);
const busy = ref(false);
const form = reactive<{ precision: Precision; source: NearbyPrefs['source']; visibility: NearbyPrefs['visibility']; manual: NearbyPrefs['manual'] }>({
  precision: nb.prefs.precision, source: nb.prefs.source, visibility: nb.prefs.visibility, manual: nb.prefs.manual,
});
function openSettings() {
  Object.assign(form, { precision: nb.prefs.precision, source: nb.prefs.source, visibility: nb.prefs.visibility, manual: nb.prefs.manual });
  editing.value = true;
}

// Map tiles are opt-out (they come from OpenStreetMap, which can see the area being viewed).
const TILES_KEY = 'interpoll_nearby_tiles';
const tilesOn = ref((() => { try { return localStorage.getItem(TILES_KEY) === '1'; } catch { return false; } })());
function setTiles(v: boolean) { tilesOn.value = v; try { localStorage.setItem(TILES_KEY, v ? '1' : '0'); } catch { /* ignore */ } }
const widened = computed(() => nb.prefs.enabled && nb.publishedPrecision.value > nb.prefs.precision && nb.prefs.visibility !== 'off');
const srcLabel = (s: string) => (s === 'gps' ? 'GPS' : s === 'ip' ? 'network' : 'chosen city');
function msg(id: string) { void router.push(`/chat/${id}`); }
function openSpace(id: string) { void router.push(`/community/${id}`); }

// City search
const cityQuery = ref('');
const cityResults = ref<Array<{ lat: number; lon: number; label: string }>>([]);
const cityError = ref('');
const searching = ref(false);
async function searchCity() {
  cityError.value = ''; searching.value = true;
  try {
    cityResults.value = await nb.geocode(cityQuery.value);
    if (!cityResults.value.length) cityError.value = 'No matches. Try a bigger nearby town.';
  } catch { cityError.value = 'City search is unavailable right now.'; }
  finally { searching.value = false; }
}

async function save() {
  busy.value = true;
  try {
    if (!nb.prefs.enabled) {
      await nb.enable({ precision: form.precision, source: form.source, visibility: form.visibility, manual: form.manual });
    } else {
      const sourceChanged = form.source !== nb.prefs.source || (form.source === 'manual' && form.manual?.label !== nb.prefs.manual?.label);
      if (sourceChanged) {
        await nb.enable({ precision: form.precision, source: form.source, visibility: form.visibility, manual: form.manual });
      } else {
        await nb.applySettings({ precision: form.precision, visibility: form.visibility });
      }
      editing.value = false;
    }
  } finally { busy.value = false; }
}

async function refresh() { await nb.refreshLocation(); }
async function turnOff() {
  if (!window.confirm('Turn off Nearby? Your area, meetups and local-space listings will be removed from the network.')) return;
  await nb.disable();
  editing.value = false;
}
function hide(id: string, name: string) {
  if (window.confirm(`Hide ${name} from your Nearby list?`)) nb.block(id);
}

const statusLine = computed(() => {
  if (nb.status.value === 'locating') return 'Finding your area…';
  if (nb.status.value === 'denied' || nb.status.value === 'error') return 'Location unavailable';
  const where = nb.positionLabel.value ? ` near ${nb.positionLabel.value}` : '';
  return `Your area: about ${nb.prefs.precision} km${where}`;
});
const visLine = computed(() => ({
  everyone: 'Visible to everyone nearby · refreshes every 10 minutes',
  contacts: 'Visible only to people you\'ve messaged',
  off: 'Hidden — you can see others, they can\'t see you',
}[nb.prefs.visibility]));

function distance(o: { lat: number; lon: number; prec: number }) {
  return nb.position.value ? distanceLabel(haversineKm(nb.position.value, o), o.prec) : '';
}

// Meetups
const hosting = ref(false);
const mForm = reactive({ title: '', when: '', place: '', desc: '' });
const minWhen = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);
async function host() {
  const when = new Date(mForm.when).getTime();
  if (!mForm.title.trim() || !Number.isFinite(when)) return;
  busy.value = true;
  try {
    await nb.hostMeetup({ title: mForm.title, desc: mForm.desc, place: mForm.place, when });
    Object.assign(mForm, { title: '', when: '', place: '', desc: '' });
    hosting.value = false;
  } finally { busy.value = false; }
}
async function cancelMeetup(id: string) { await nb.removeMeetup(id); }
const dayNum = (t: number) => new Date(t).getDate();
const monthName = (t: number) => new Date(t).toLocaleString(undefined, { month: 'short' });
const timeOfDay = (t: number) => new Date(t).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' });

// Local spaces
const makingSpace = ref(false);
const spaceError = ref('');
const sForm = reactive({ name: '', desc: '' });
function startSpace() {
  sForm.name = nb.positionLabel.value ? `${nb.positionLabel.value.split(',')[0]} locals` : '';
  makingSpace.value = true;
}
async function makeSpace() {
  spaceError.value = ''; busy.value = true;
  try {
    const id = await nb.createLocalSpace(sForm.name, sForm.desc);
    makingSpace.value = false;
    router.push(`/community/${id}`);
  } catch (e: any) {
    spaceError.value = e?.message === 'name' ? 'Pick a name with at least 3 letters or numbers.' : 'Could not create the space. That name may be taken.';
  } finally { busy.value = false; }
}

// Contacts (for "only people I've messaged")
watch(() => props.chatList, list => {
  void nb.setContacts((list || []).map(c => c.publicKey || c.userId || '').filter(k => /^[0-9a-f]{64}$/i.test(k)));
}, { immediate: true, deep: false });

onMounted(() => { if (nb.prefs.enabled) void nb.ensureStarted(); });
</script>

<style scoped>
.nb { display: flex; flex-direction: column; gap: 12px; padding: 4px 2px 24px; max-width: 720px; margin: 0 auto; width: 100%; }
.nb-card { padding: 16px; border-radius: 14px; background: var(--app-bg-elevated); border: 1px solid var(--app-border); }
.nb-title { margin: 0 0 4px; font-size: 15px; font-weight: 700; color: var(--app-text); text-shadow: none; }
.nb-lead { margin: 0 0 14px; font-size: 13px; line-height: 1.55; color: var(--app-text-muted); }
.nb-lead b { color: var(--app-text); }
.nb-label { margin: 16px 0 8px; font-size: 12px; font-weight: 700; color: var(--app-text-muted); letter-spacing: 0; }
.nb-hint { margin: 6px 0 0; font-size: 12px; line-height: 1.45; color: var(--app-text-subtle); }
.nb-note { margin: 0; padding: 10px 14px; border-radius: 10px; font-size: 12.5px; line-height: 1.45; color: var(--app-text-muted); background: rgba(251,191,36,.08); border: 1px solid rgba(251,191,36,.25); }
.nb-opt--plain { margin-top: 14px; }
.nb-err { margin: 10px 0 0; font-size: 12.5px; color: var(--app-danger, #ff6b6b); }
.nb-err--card { margin: 0; padding: 10px 14px; border-radius: 10px; background: rgba(255, 77, 79, 0.08); border: 1px solid rgba(255, 77, 79, 0.25); }
.nb-empty { margin: 4px 0 8px; font-size: 13px; line-height: 1.5; color: var(--app-text-muted); text-align: center; padding: 14px 6px; }

.nb-row { display: flex; align-items: center; gap: 8px; }
.nb-row--end { justify-content: flex-end; margin-top: 16px; }
.nb-chips { display: flex; gap: 8px; flex-wrap: wrap; }
.nb-chips--tight { gap: 6px; }
.nb-chip {
  display: flex; flex-direction: column; align-items: flex-start; gap: 1px; padding: 9px 14px; min-width: 92px; cursor: pointer; text-align: left;
  border-radius: 10px; background: rgba(255,255,255,0.03); border: 1px solid var(--app-border); color: var(--app-text); font: inherit;
}
.nb-chip b { font-size: 13.5px; } .nb-chip small { font-size: 11px; color: var(--app-text-muted); }
.nb-chip--sm { min-width: 0; padding: 6px 12px; font-size: 12.5px; font-weight: 600; }
.nb-chip.on { border-color: var(--app-accent); background: rgba(var(--app-accent-rgb), 0.1); color: var(--app-accent); }
.nb-chip.on small { color: inherit; opacity: .8; }

.nb-opts { display: flex; flex-direction: column; gap: 8px; }
.nb-opt { display: flex; gap: 10px; align-items: flex-start; padding: 10px 12px; cursor: pointer; border-radius: 10px; border: 1px solid var(--app-border); background: rgba(255,255,255,0.02); }
.nb-opt.on { border-color: var(--app-accent); background: rgba(var(--app-accent-rgb), 0.07); }
.nb-opt input { margin-top: 3px; accent-color: var(--app-accent); }
.nb-opt span { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.nb-opt b { font-size: 13.5px; color: var(--app-text); } .nb-opt small { font-size: 12px; color: var(--app-text-muted); line-height: 1.4; }

.nb-input {
  flex: 1; min-width: 0; width: 100%; box-sizing: border-box; padding: 9px 12px; border-radius: 10px; font: inherit; font-size: 13.5px;
  background: rgba(255,255,255,0.04); border: 1px solid var(--app-border); color: var(--app-text); outline: none;
}
.nb-input:focus { border-color: var(--app-accent); }
textarea.nb-input { resize: vertical; }
.nb-btn {
  padding: 8px 14px; border-radius: 9px; cursor: pointer; font: inherit; font-size: 12.5px; font-weight: 650; white-space: nowrap;
  background: rgba(255,255,255,0.06); border: 1px solid var(--app-border); color: var(--app-text);
}
.nb-btn:hover:not(:disabled) { border-color: var(--app-border-strong); }
.nb-btn:disabled { opacity: .5; cursor: default; }
.nb-btn--primary { background: var(--app-accent); border-color: var(--app-accent); color: #04120a; }
.nb-btn--ghost { background: none; }
.nb-wide { width: 100%; margin-top: 10px; padding: 10px; }
.nb-icon { width: 28px; height: 28px; flex-shrink: 0; cursor: pointer; border-radius: 8px; border: none; background: none; color: var(--app-text-subtle); font-size: 12px; }
.nb-icon:hover { background: rgba(255,255,255,0.06); color: var(--app-text); }

.nb-results { list-style: none; margin: 8px 0 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
.nb-results button { width: 100%; text-align: left; padding: 8px 10px; border-radius: 8px; cursor: pointer; background: none; border: 1px solid transparent; color: var(--app-text-muted); font: inherit; font-size: 12.5px; }
.nb-results button:hover, .nb-results button.on { border-color: var(--app-accent); color: var(--app-text); }

.nb-status { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.nb-status__main { display: flex; align-items: center; gap: 12px; min-width: 0; }
.nb-dot { width: 10px; height: 10px; border-radius: 50%; background: var(--app-text-subtle); flex-shrink: 0; }
.nb-dot--live { background: var(--app-accent); box-shadow: 0 0 8px rgba(var(--app-accent-rgb), .6); }
.nb-dot--locating { background: #fbbf24; }
.nb-dot--denied, .nb-dot--error { background: #ff4d4f; }

.nb-bar { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
.nb-seg { display: inline-flex; align-self: flex-start; padding: 3px; gap: 2px; border-radius: 10px; background: rgba(255,255,255,0.04); border: 1px solid var(--app-border); }
.nb-seg button { display: inline-flex; align-items: center; gap: 6px; padding: 6px 14px; border: none; border-radius: 8px; background: none; cursor: pointer; font: inherit; font-size: 12.5px; font-weight: 650; color: var(--app-text-muted); }
.nb-seg button.on { background: var(--app-accent); color: #04120a; }
.nb-count { font-size: 10.5px; padding: 1px 6px; border-radius: 999px; background: rgba(0,0,0,.25); }

.nb-list { display: flex; flex-direction: column; gap: 4px; padding: 10px; }
.nb-person { display: flex; align-items: center; gap: 12px; padding: 8px 6px; border-radius: 10px; }
.nb-person:hover { background: rgba(255,255,255,0.03); }
.nb-avatar { width: 38px; height: 38px; flex-shrink: 0; display: grid; place-items: center; border-radius: 50%; font-weight: 800; background: rgba(var(--app-accent-rgb), .14); color: var(--app-accent); }
.nb-avatar--sq { border-radius: 10px; }
.nb-person__info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.nb-person__info b { font-size: 13.5px; color: var(--app-text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.nb-person__info small, .nb-meetup__info small { font-size: 11.5px; color: var(--app-text-muted); }
.nb-tag { font-style: normal; font-size: 10px; font-weight: 600; padding: 1px 6px; margin-left: 4px; border-radius: 6px; background: rgba(var(--app-accent-rgb), .12); color: var(--app-accent); }

.nb-meetup { display: flex; gap: 12px; align-items: flex-start; padding: 10px 6px; border-bottom: 1px solid var(--app-border); }
.nb-date { width: 44px; flex-shrink: 0; text-align: center; padding: 6px 0; border-radius: 10px; background: rgba(var(--app-accent-rgb), .1); color: var(--app-accent); display: flex; flex-direction: column; }
.nb-date b { font-size: 17px; line-height: 1.1; } .nb-date small { font-size: 10.5px; text-transform: uppercase; }
.nb-meetup__info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.nb-meetup__info b { font-size: 14px; color: var(--app-text); }
.nb-meetup__info p { margin: 4px 0 0; font-size: 12.5px; line-height: 1.45; color: var(--app-text-muted); }
.nb-form { display: flex; flex-direction: column; gap: 8px; margin-top: 10px; }

.nb-hidden { margin-top: 8px; font-size: 12.5px; color: var(--app-text-muted); }
.nb-hidden summary { cursor: pointer; padding: 6px; }
.nb-hidden__row { justify-content: space-between; padding: 2px 6px; }
.nb-off { align-self: center; margin-top: 6px; padding: 8px 12px; cursor: pointer; background: none; border: none; color: var(--app-text-subtle); font: inherit; font-size: 12px; text-decoration: underline; }
.nb-off:hover { color: #ff6b6b; }
</style>
