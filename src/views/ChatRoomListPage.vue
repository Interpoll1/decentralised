<template>
  <ion-page>
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start">
          <button class="back-btn" @click="router.back()">
            <svg viewBox="0 0 24 24" fill="none"><path d="M15 18l-6-6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
        </ion-buttons>
        <ion-title>Chat Rooms</ion-title>
        <ion-buttons slot="end">
          <button class="header-action-btn" @click="showCreateModal = true" title="New Room">
            <svg viewBox="0 0 24 24" fill="none"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>
          </button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>

    <ion-content>
      <ion-refresher slot="fixed" @ionRefresh="handleRefresh">
        <ion-refresher-content />
      </ion-refresher>

      <DesktopPageShell>

      <!-- Loading -->
      <div v-if="chatRoomStore.loading && chatRoomStore.rooms.length === 0" class="state-container">
        <div class="spinner"></div>
        <p>Loading rooms…</p>
      </div>

      <!-- Error -->
      <div v-else-if="chatRoomStore.error && chatRoomStore.rooms.length === 0" class="state-container">
        <div class="state-icon error-icon">
          <ion-icon :icon="alertCircleOutline"></ion-icon>
        </div>
        <p class="state-title">Something went wrong</p>
        <p class="state-sub">{{ chatRoomStore.error }}</p>
        <button class="pill-btn outline" @click="chatRoomStore.loadRooms()">Retry</button>
      </div>

      <!-- Empty -->
      <div v-else-if="chatRoomStore.rooms.length === 0" class="state-container">
        <div class="state-icon">
          <ion-icon :icon="chatbubblesOutline"></ion-icon>
        </div>
        <p class="state-title">No chat rooms yet</p>
        <p class="state-sub">Create or join a room to get started</p>
        <button class="pill-btn accent" @click="showCreateModal = true">
          <svg viewBox="0 0 24 24" fill="none" width="14" height="14"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg>
          Create Room
        </button>
      </div>

      <!-- Room list -->
      <div v-else class="room-list">
        <div
          v-for="room in chatRoomStore.rooms"
          :key="room.id"
          class="room-card"
          @click="openRoom(room.id)"
        >
          <div class="room-avatar" :class="roomTone(room.id)">
            <ion-icon :icon="room.isEncrypted ? lockClosedOutline : chatbubblesOutline"></ion-icon>
          </div>
          <div class="room-info">
            <div class="room-name-row">
              <span class="room-name">{{ room.name }}</span>
              <span v-if="room.isEncrypted" class="enc-badge">
                <ion-icon :icon="lockClosedOutline"></ion-icon>
                E2E
              </span>
            </div>
            <p v-if="room.description" class="room-desc">{{ room.description }}</p>
            <div class="room-meta">
              <span class="meta-item">
                <ion-icon :icon="peopleOutline"></ion-icon>
                {{ room.memberCount }} {{ room.memberCount === 1 ? 'member' : 'members' }}
              </span>
              <span class="meta-item">
                <ion-icon :icon="timeOutline"></ion-icon>
                {{ formatDate(room.createdAt) }}
              </span>
            </div>
          </div>
          <button class="leave-btn" @click.stop="confirmLeave(room)" title="Leave room">
            <ion-icon :icon="exitOutline"></ion-icon>
          </button>
        </div>
      </div>

      <!-- FAB -->
      <button class="fab-btn" @click="showCreateModal = true" title="New Room">
        <svg viewBox="0 0 24 24" fill="none"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg>
      </button>

      </DesktopPageShell>
    </ion-content>

    <!-- Create Modal -->
    <ion-modal :is-open="showCreateModal" @didDismiss="resetForm">
      <ion-header>
        <ion-toolbar>
          <ion-buttons slot="start">
            <button class="modal-cancel-btn" @click="showCreateModal = false">Cancel</button>
          </ion-buttons>
          <ion-title>New Room</ion-title>
          <ion-buttons slot="end">
            <button
              class="modal-create-btn"
              :disabled="!newRoomName.trim() || creating || (usePassword && !newRoomPassword.trim())"
              @click="handleCreate"
            >
              <div v-if="creating" class="btn-spinner"></div>
              <span v-else>Create</span>
            </button>
          </ion-buttons>
        </ion-toolbar>
      </ion-header>

      <ion-content>
        <div class="modal-body">
          <div class="field-group">
            <label class="field-label">Room Name</label>
            <div class="field-wrap">
              <input class="field-native" v-model="newRoomName" placeholder="e.g. General Discussion" :maxlength="60" />
            </div>
          </div>

          <div class="field-group">
            <label class="field-label">Description <span class="optional">optional</span></label>
            <div class="field-wrap">
              <textarea class="field-native" v-model="newRoomDescription" placeholder="What is this room about?" :maxlength="200" rows="3"></textarea>
            </div>
          </div>

          <div class="toggle-row">
            <div>
              <div class="toggle-label">Password protected</div>
              <div class="toggle-sub">Members will need the password to join</div>
            </div>
            <label class="toggle-switch">
              <input type="checkbox" v-model="usePassword" />
              <span class="toggle-track"></span>
            </label>
          </div>

          <div v-if="usePassword" class="field-group">
            <label class="field-label">Password</label>
            <div class="field-wrap">
              <input class="field-native" v-model="newRoomPassword" type="password" placeholder="Room password" />
            </div>
          </div>

          <div class="hint-box">
            <ion-icon :icon="informationCircleOutline"></ion-icon>
            <span>{{ usePassword ? 'Members will need this password to join the room.' : 'An invite link will be generated — share it with members.' }}</span>
          </div>
        </div>
      </ion-content>
    </ion-modal>
  </ion-page>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import DesktopPageShell from '../components/DesktopPageShell.vue';
import { useRouter } from 'vue-router';
import {
  IonPage, IonHeader, IonToolbar, IonTitle, IonContent, IonModal,
  IonButtons, IonIcon, IonRefresher, IonRefresherContent,
  toastController, alertController, onIonViewWillEnter,
} from '@ionic/vue';
import {
  chatbubblesOutline, lockClosedOutline, peopleOutline,
  timeOutline, exitOutline, alertCircleOutline, informationCircleOutline,
} from 'ionicons/icons';
import { useChatRoomStore } from '@/stores/chatRoomStore';
import { UserService } from '@/services/userService';
import type { ChatRoom } from '@/services/chatRoomService';

const router = useRouter();
const chatRoomStore = useChatRoomStore();

const showCreateModal = ref(false);
const creating = ref(false);
const newRoomName = ref('');
const newRoomDescription = ref('');
const usePassword = ref(false);
const newRoomPassword = ref('');

const TONES = ['tone-violet','tone-blue','tone-teal','tone-amber','tone-rose'];
function roomTone(id: string) {
  const code = id.split('').reduce((a,c) => a + c.charCodeAt(0), 0);
  return TONES[code % TONES.length];
}

onIonViewWillEnter(() => { chatRoomStore.loadRooms(); });

async function handleRefresh(event: CustomEvent) {
  await chatRoomStore.loadRooms();
  (event.target as HTMLIonRefresherElement).complete();
}

function openRoom(roomId: string) { router.push(`/chatroom/${roomId}`); }

async function handleCreate() {
  if (!newRoomName.value.trim()) return;
  const password = usePassword.value ? newRoomPassword.value.trim() : undefined;
  if (usePassword.value && !password) return;
  creating.value = true;
  try {
    const user = await UserService.getCurrentUser();
    const result = await chatRoomStore.createRoom(newRoomName.value.trim(), newRoomDescription.value.trim(), user.id, password);
    showCreateModal.value = false;
    if (result?.inviteLink) {
      await showInviteLinkAlert(result.inviteLink);
    } else {
      const t = await toastController.create({ message: 'Room created!', duration: 2000, color: 'success' });
      await t.present();
    }
  } catch {
    const t = await toastController.create({ message: chatRoomStore.error || 'Failed to create room', duration: 3000, color: 'danger' });
    await t.present();
  } finally { creating.value = false; }
}

async function showInviteLinkAlert(link: string) {
  const alert = await alertController.create({
    header: 'Room Created!', message: 'Share this invite link:',
    inputs: [{ name: 'link', type: 'text', value: link, attributes: { readonly: true } }],
    buttons: [
      { text: 'Copy', handler: () => { navigator.clipboard.writeText(link).then(() => toastController.create({ message: 'Copied!', duration: 1500 }).then(t => t.present())); return false; } },
      { text: 'Done', role: 'cancel' },
    ],
  });
  await alert.present();
}

async function confirmLeave(room: ChatRoom) {
  const alert = await alertController.create({
    header: 'Leave Room',
    message: `Leave "${room.name}"? You'll need a new invite to rejoin.`,
    buttons: [{ text: 'Cancel', role: 'cancel' }, { text: 'Leave', role: 'destructive' }],
  });
  await alert.present();
  const { role } = await alert.onDidDismiss();
  if (role === 'destructive') {
    try {
      await chatRoomStore.leaveRoom(room.id);
      const t = await toastController.create({ message: `Left ${room.name}`, duration: 2000, color: 'medium' });
      await t.present();
    } catch {
      const t = await toastController.create({ message: 'Failed to leave room', duration: 3000, color: 'danger' });
      await t.present();
    }
  }
}

function resetForm() {
  showCreateModal.value = false; newRoomName.value = ''; newRoomDescription.value = '';
  usePassword.value = false; newRoomPassword.value = '';
}

function formatDate(ts: number): string {
  if (!ts || isNaN(ts)) return '—';
  const d = new Date(ts), now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const yesterday = new Date(now); yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}
</script>

<style scoped>
ion-header::after { display: none !important; }
ion-toolbar { --border-width: 0 !important; }
ion-content { --background: transparent; }

.back-btn, .header-action-btn {
  display: flex; align-items: center; justify-content: center;
  width: 36px; height: 36px; background: none; border: none;
  border-radius: 50%; color: var(--app-text-muted); cursor: pointer;
  transition: color 160ms ease, background 160ms ease;
}
.back-btn:hover, .header-action-btn:hover { color: var(--app-text); background: rgba(255,255,255,0.06); }
.back-btn svg, .header-action-btn svg { width: 22px; height: 22px; }

/* ── Room list ── */
.room-list { display: flex; flex-direction: column; gap: 10px; padding: 16px 16px 100px; }

.room-card {
  display: flex; align-items: center; gap: 14px;
  padding: 14px 16px; border-radius: 18px;
  background: rgba(255,255,255,0.04);
  border: 1px solid rgba(255,255,255,0.08);
  cursor: pointer;
  transition: background 160ms ease, border-color 160ms ease, transform 160ms ease;
  -webkit-tap-highlight-color: transparent;
}
.room-card:hover { background: rgba(255,255,255,0.07); border-color: rgba(255,255,255,0.13); transform: translateY(-1px); }
.room-card:active { transform: translateY(0); }

.room-avatar {
  width: 48px; height: 48px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  font-size: 22px; color: #fff; flex-shrink: 0;
}
.tone-violet { background: linear-gradient(135deg,#6366f1,#8b5cf6); box-shadow: 0 4px 12px rgba(99,102,241,.3); }
.tone-blue   { background: linear-gradient(135deg,#3b82f6,#6366f1); box-shadow: 0 4px 12px rgba(59,130,246,.3); }
.tone-teal   { background: linear-gradient(135deg,#14b8a6,#3b82f6); box-shadow: 0 4px 12px rgba(20,184,166,.3); }
.tone-amber  { background: linear-gradient(135deg,#f59e0b,#ef4444); box-shadow: 0 4px 12px rgba(245,158,11,.3); }
.tone-rose   { background: linear-gradient(135deg,#ec4899,#8b5cf6); box-shadow: 0 4px 12px rgba(236,72,153,.3); }

.room-info { flex: 1; min-width: 0; }
.room-name-row { display: flex; align-items: center; gap: 8px; }
.room-name { font-size: 15px; font-weight: 700; letter-spacing: -0.02em; color: var(--app-text); }

.enc-badge {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 2px 8px; border-radius: 999px; font-size: 9.5px; font-weight: 700;
  background: rgba(251,191,36,.12); color: #fbbf24; border: 1px solid rgba(251,191,36,.25);
}
.enc-badge ion-icon { font-size: 10px; }

.room-desc { font-size: 13px; color: var(--app-text-muted); margin: 3px 0 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.room-meta { display: flex; gap: 12px; margin-top: 6px; }
.meta-item { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; color: var(--app-text-subtle); }
.meta-item ion-icon { font-size: 13px; }

.leave-btn {
  width: 32px; height: 32px; border-radius: 50%; border: none;
  background: rgba(239,68,68,.08); color: #ef4444; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  font-size: 16px; flex-shrink: 0;
  transition: background 160ms ease;
}
.leave-btn:hover { background: rgba(239,68,68,.18); }

/* FAB */
.fab-btn {
  position: fixed; bottom: 80px; right: 20px;
  width: 56px; height: 56px; border-radius: 50%; border: none;
  background: linear-gradient(135deg,#6366f1,#8b5cf6);
  color: #fff; cursor: pointer; display: flex; align-items: center; justify-content: center;
  box-shadow: 0 8px 24px rgba(99,102,241,.45);
  transition: transform 160ms ease, box-shadow 160ms ease;
  z-index: 100;
}
.fab-btn:hover { transform: translateY(-2px); box-shadow: 0 12px 32px rgba(99,102,241,.55); }
.fab-btn svg { width: 24px; height: 24px; }

/* States */
.state-container {
  display: flex; flex-direction: column; align-items: center;
  justify-content: center; padding: 64px 24px; text-align: center; gap: 12px;
}
.state-icon {
  width: 64px; height: 64px; border-radius: 50%;
  background: rgba(99,102,241,.1); border: 1px solid rgba(99,102,241,.2);
  display: flex; align-items: center; justify-content: center;
  color: #818cf8; font-size: 30px;
}
.state-icon.error-icon { background: rgba(239,68,68,.1); border-color: rgba(239,68,68,.2); color: #ef4444; }
.state-title { font-size: 16px; font-weight: 700; color: var(--app-text); margin: 0; }
.state-sub { font-size: 13.5px; color: var(--app-text-muted); margin: 0; }

.spinner {
  width: 30px; height: 30px;
  border: 2.5px solid rgba(99,102,241,.2);
  border-top-color: #6366f1; border-radius: 50%;
  animation: spin .7s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }

/* Pills */
.pill-btn {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 9px 18px; border-radius: 999px; border: none;
  font-size: 13.5px; font-weight: 700; cursor: pointer;
  transition: opacity 160ms ease, transform 160ms ease;
}
.pill-btn.accent { background: linear-gradient(135deg,#6366f1,#8b5cf6); color: #fff; box-shadow: 0 4px 14px rgba(99,102,241,.38); }
.pill-btn.outline { background: rgba(255,255,255,.05); border: 1px solid rgba(255,255,255,.1); color: var(--app-text-muted); }
.pill-btn:hover:not(:disabled) { opacity: .88; transform: translateY(-1px); }

/* Modal */
.modal-body { padding: 20px 16px; display: flex; flex-direction: column; gap: 14px; }
.field-group { display: flex; flex-direction: column; gap: 6px; }
.field-label { font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: .08em; color: var(--app-text-subtle); }
.optional { font-weight: 500; text-transform: none; letter-spacing: 0; opacity: .6; }
.field-wrap { border-radius: 12px; background: rgba(255,255,255,.05); border: 1px solid rgba(255,255,255,.09); overflow: hidden; transition: border-color 180ms ease, box-shadow 180ms ease; }
.field-wrap:focus-within { border-color: rgba(99,102,241,.5); box-shadow: 0 0 0 3px rgba(99,102,241,.1); }
.field-native { width: 100%; background: transparent; border: none; outline: none; padding: 12px 14px; font-size: 14.5px; font-family: inherit; color: var(--ion-text-color); -webkit-appearance: none; }
.field-native::placeholder { color: var(--app-text-subtle); }
textarea.field-native { resize: none; }

.toggle-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 0; border-bottom: 1px solid rgba(255,255,255,.06); }
.toggle-label { font-size: 14px; font-weight: 600; color: var(--app-text); }
.toggle-sub { font-size: 12px; color: var(--app-text-muted); margin-top: 2px; }
.toggle-switch { position: relative; width: 44px; height: 26px; flex-shrink: 0; }
.toggle-switch input { opacity: 0; width: 0; height: 0; }
.toggle-track { position: absolute; inset: 0; border-radius: 999px; background: rgba(255,255,255,.12); border: 1px solid rgba(255,255,255,.1); cursor: pointer; transition: background 200ms ease; }
.toggle-switch input:checked + .toggle-track { background: #6366f1; border-color: #6366f1; }
.toggle-track::after { content: ''; position: absolute; top: 3px; left: 3px; width: 18px; height: 18px; border-radius: 50%; background: #fff; box-shadow: 0 1px 4px rgba(0,0,0,.3); transition: transform 200ms ease; }
.toggle-switch input:checked + .toggle-track::after { transform: translateX(18px); }

.hint-box { display: flex; align-items: flex-start; gap: 10px; padding: 12px 14px; border-radius: 12px; background: rgba(99,102,241,.07); border: 1px solid rgba(99,102,241,.18); color: #a5b4fc; font-size: 13px; line-height: 1.5; }
.hint-box ion-icon { font-size: 16px; flex-shrink: 0; margin-top: 1px; }

.modal-cancel-btn { background: none; border: none; color: var(--app-text-muted); font-size: 14px; font-weight: 600; cursor: pointer; padding: 8px 12px; border-radius: 8px; transition: color 160ms ease; }
.modal-cancel-btn:hover { color: var(--app-text); }
.modal-create-btn { background: linear-gradient(135deg,#6366f1,#8b5cf6); border: none; color: #fff; font-size: 14px; font-weight: 700; cursor: pointer; padding: 8px 16px; border-radius: 999px; transition: opacity 160ms ease; display: flex; align-items: center; gap: 6px; }
.modal-create-btn:disabled { opacity: .4; cursor: not-allowed; }
.btn-spinner { width: 16px; height: 16px; border: 2px solid rgba(255,255,255,.3); border-top-color: #fff; border-radius: 50%; animation: spin .7s linear infinite; }
</style>