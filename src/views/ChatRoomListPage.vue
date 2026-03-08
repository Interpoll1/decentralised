<template>
  <ion-page>
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-back-button default-href="/home"></ion-back-button>
        </ion-buttons>
        <ion-title>Chat Rooms</ion-title>
      </ion-toolbar>
    </ion-header>

    <ion-content>
      <ion-refresher slot="fixed" @ionRefresh="handleRefresh">
        <ion-refresher-content />
      </ion-refresher>

      <!-- Loading -->
      <div v-if="chatRoomStore.loading && chatRoomStore.rooms.length === 0" class="loading-container">
        <ion-spinner />
        <p>Loading rooms…</p>
      </div>

      <!-- Error -->
      <div v-else-if="chatRoomStore.error && chatRoomStore.rooms.length === 0" class="empty-state">
        <ion-icon :icon="alertCircleOutline" size="large" />
        <p>{{ chatRoomStore.error }}</p>
        <ion-button fill="outline" size="small" @click="chatRoomStore.loadRooms()">Retry</ion-button>
      </div>

      <!-- Empty state -->
      <div v-else-if="chatRoomStore.rooms.length === 0" class="empty-state">
        <ion-icon :icon="chatbubblesOutline" size="large" />
        <p>No chat rooms yet</p>
        <p class="subtitle">Create or join a room to get started</p>
        <ion-button fill="outline" size="small" @click="showCreateModal = true">
          <ion-icon :icon="addOutline" slot="start" />
          Create Room
        </ion-button>
      </div>

      <!-- Room list -->
      <ion-list v-else class="room-list">
        <ion-item-sliding v-for="room in chatRoomStore.rooms" :key="room.id">
          <ion-item button @click="openRoom(room.id)" detail>
            <div class="room-icon" slot="start">
              <ion-icon :icon="room.isEncrypted ? lockClosedOutline : chatbubblesOutline" />
            </div>
            <ion-label>
              <h2 class="room-name">
                {{ room.name }}
                <ion-chip v-if="room.isEncrypted" color="warning" class="encrypted-chip">
                  <ion-icon :icon="lockClosedOutline" />
                  <ion-label>Encrypted</ion-label>
                </ion-chip>
              </h2>
              <p v-if="room.description" class="room-description">{{ room.description }}</p>
              <div class="room-meta">
                <span class="meta-item">
                  <ion-icon :icon="peopleOutline" />
                  {{ room.memberCount }} {{ room.memberCount === 1 ? 'member' : 'members' }}
                </span>
                <span class="meta-item">
                  <ion-icon :icon="timeOutline" />
                  {{ formatDate(room.createdAt) }}
                </span>
              </div>
            </ion-label>
          </ion-item>

          <ion-item-options side="end">
            <ion-item-option color="danger" @click="confirmLeave(room)">
              <ion-icon :icon="exitOutline" slot="icon-only" />
            </ion-item-option>
          </ion-item-options>
        </ion-item-sliding>
      </ion-list>

      <!-- FAB: create room -->
      <ion-fab vertical="bottom" horizontal="end" slot="fixed">
        <ion-fab-button @click="showCreateModal = true">
          <ion-icon :icon="addOutline" />
        </ion-fab-button>
      </ion-fab>

      <!-- Create room modal -->
      <ion-modal :is-open="showCreateModal" @didDismiss="resetForm">
        <ion-header>
          <ion-toolbar>
            <ion-buttons slot="start">
              <ion-button @click="showCreateModal = false">Cancel</ion-button>
            </ion-buttons>
            <ion-title>New Room</ion-title>
            <ion-buttons slot="end">
              <ion-button
                :strong="true"
                :disabled="!newRoomName.trim() || creating || (usePassword && !newRoomPassword.trim())"
                @click="handleCreate"
              >
                <ion-spinner v-if="creating" name="crescent" class="btn-spinner" />
                <span v-else>Create</span>
              </ion-button>
            </ion-buttons>
          </ion-toolbar>
        </ion-header>

        <ion-content class="ion-padding">
          <ion-list>
            <ion-item>
              <ion-input
                v-model="newRoomName"
                label="Room Name"
                label-placement="stacked"
                placeholder="e.g. General Discussion"
                :maxlength="60"
                required
              />
            </ion-item>

            <ion-item>
              <ion-textarea
                v-model="newRoomDescription"
                label="Description"
                label-placement="stacked"
                placeholder="What is this room about? (optional)"
                :maxlength="200"
                :auto-grow="true"
                :rows="2"
              />
            </ion-item>

            <ion-item>
              <ion-toggle v-model="usePassword" justify="space-between">
                Password protected
              </ion-toggle>
            </ion-item>

            <ion-item v-if="usePassword">
              <ion-input
                v-model="newRoomPassword"
                label="Password"
                label-placement="stacked"
                type="password"
                placeholder="Room password"
              />
            </ion-item>
          </ion-list>

          <p class="form-hint">
            {{ usePassword
              ? 'Members will need the password to join.'
              : 'An invite link will be generated — share it with members.' }}
          </p>
        </ion-content>
      </ion-modal>
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import {
  IonPage, IonHeader, IonToolbar, IonTitle, IonContent,
  IonButtons, IonBackButton, IonButton, IonIcon,
  IonList, IonItem, IonLabel, IonInput, IonTextarea,
  IonSpinner, IonRefresher, IonRefresherContent,
  IonFab, IonFabButton, IonModal, IonToggle, IonChip,
  IonItemSliding, IonItemOptions, IonItemOption,
  toastController, alertController, onIonViewWillEnter,
} from '@ionic/vue';
import {
  addOutline, chatbubblesOutline, lockClosedOutline,
  peopleOutline, timeOutline, exitOutline, alertCircleOutline,
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

onIonViewWillEnter(() => {
  chatRoomStore.loadRooms();
});

async function handleRefresh(event: CustomEvent) {
  await chatRoomStore.loadRooms();
  (event.target as HTMLIonRefresherElement).complete();
}

function openRoom(roomId: string) {
  router.push(`/chatroom/${roomId}`);
}

async function handleCreate() {
  if (!newRoomName.value.trim()) return;
  const password = usePassword.value ? newRoomPassword.value.trim() : undefined;
  if (usePassword.value && !password) return;

  creating.value = true;
  try {
    const user = await UserService.getCurrentUser();
    const result = await chatRoomStore.createRoom(
      newRoomName.value.trim(),
      newRoomDescription.value.trim(),
      user.id,
      password,
    );
    showCreateModal.value = false;

    if (result?.inviteLink) {
      await showInviteLinkAlert(result.inviteLink);
    } else {
      const toast = await toastController.create({
        message: 'Room created!',
        duration: 2000,
        color: 'success',
      });
      await toast.present();
    }
  } catch {
    const toast = await toastController.create({
      message: chatRoomStore.error || 'Failed to create room',
      duration: 3000,
      color: 'danger',
    });
    await toast.present();
  } finally {
    creating.value = false;
  }
}

async function showInviteLinkAlert(link: string) {
  const alert = await alertController.create({
    header: 'Room Created!',
    message: 'Share this invite link with others:',
    inputs: [{ name: 'link', type: 'text', value: link, attributes: { readonly: true } }],
    buttons: [
      {
        text: 'Copy',
        handler: () => {
          navigator.clipboard.writeText(link)
            .then(() => toastController.create({ message: 'Copied!', duration: 1500, color: 'success' }))
            .catch(() => toastController.create({ message: 'Could not copy — please copy manually', duration: 2500, color: 'warning' }))
            .then(t => t?.present());
          return false;
        },
      },
      { text: 'Done', role: 'cancel' },
    ],
  });
  await alert.present();
}

async function confirmLeave(room: ChatRoom) {
  const alert = await alertController.create({
    header: 'Leave Room',
    message: `Leave &ldquo;${escapeHtml(room.name)}&rdquo;? You'll need a new invite to rejoin.`,
    buttons: [
      { text: 'Cancel', role: 'cancel' },
      { text: 'Leave', role: 'destructive' },
    ],
  });
  await alert.present();
  const { role } = await alert.onDidDismiss();

  if (role === 'destructive') {
    try {
      await chatRoomStore.leaveRoom(room.id);
      const toast = await toastController.create({
        message: `Left ${escapeHtml(room.name)}`,
        duration: 2000,
        color: 'medium',
      });
      await toast.present();
    } catch {
      const toast = await toastController.create({
        message: 'Failed to leave room',
        duration: 3000,
        color: 'danger',
      });
      await toast.present();
    }
  }
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function resetForm() {
  showCreateModal.value = false;
  newRoomName.value = '';
  newRoomDescription.value = '';
  usePassword.value = false;
  newRoomPassword.value = '';
}

function formatDate(ts: number): string {
  if (!ts || isNaN(ts)) return '—';
  const d = new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}
</script>

<style scoped>
.loading-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 64px 24px;
  color: var(--ion-color-medium);
}

.loading-container ion-spinner {
  margin-bottom: 12px;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 64px 24px;
  text-align: center;
  color: var(--ion-color-medium);
}

.empty-state ion-icon {
  font-size: 56px;
  margin-bottom: 12px;
  opacity: 0.5;
}

.empty-state p {
  margin: 0 0 4px;
  font-size: 16px;
}

.empty-state .subtitle {
  font-size: 13px;
  opacity: 0.7;
  margin-bottom: 16px;
}

.room-list {
  padding: 0;
  background: transparent;
}

.room-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: 12px;
  background: rgba(var(--ion-color-primary-rgb), 0.1);
  color: var(--ion-color-primary);
  font-size: 20px;
  flex-shrink: 0;
}

.room-name {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
  font-size: 15px;
}

.encrypted-chip {
  height: 20px;
  font-size: 10px;
  --padding-start: 4px;
  --padding-end: 6px;
}

.encrypted-chip ion-icon {
  font-size: 12px;
}

.room-description {
  margin-top: 2px;
  font-size: 13px;
  color: var(--ion-color-medium);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: min(280px, 60vw);
}

.room-meta {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 4px;
}

.meta-item {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: var(--ion-color-medium);
}

.meta-item ion-icon {
  font-size: 14px;
}

.form-hint {
  margin: 16px;
  font-size: 13px;
  color: var(--ion-color-medium);
  text-align: center;
}

.btn-spinner {
  width: 20px;
  height: 20px;
}

html.dark .room-icon {
  background: rgba(var(--ion-color-primary-rgb), 0.15);
}
</style>
