<template>
  <div class="key-management">
    <div class="section-header">
      <h3>
        <ion-icon :icon="keyOutline"></ion-icon>
        Encryption Keys
      </h3>
      <span class="key-count">{{ keys.length }} key{{ keys.length !== 1 ? 's' : '' }}</span>
    </div>

    <p class="section-description">
      These keys give you access to encrypted communities and chat rooms.
      <strong>Back them up</strong> — if you lose them, you lose access.
    </p>

    <!-- Key list -->
    <div v-if="keys.length > 0" class="key-list">
      <div v-for="key in keys" :key="key.id" class="key-item">
        <div class="key-info">
          <span class="key-label">{{ key.label || key.id }}</span>
          <div class="key-meta">
            <span class="key-type-badge" :class="key.type">{{ key.type }}</span>
            <span class="key-method">{{ key.method }}</span>
            <span class="key-date">{{ formatDate(key.joinedAt) }}</span>
          </div>
        </div>
        <ion-button fill="clear" color="danger" size="small" @click="confirmDelete(key)">
          <ion-icon :icon="trashOutline" slot="icon-only"></ion-icon>
        </ion-button>
      </div>
    </div>

    <div v-else class="empty-state">
      <ion-icon :icon="lockOpenOutline"></ion-icon>
      <p>No encryption keys stored yet.</p>
      <p class="hint">Join an encrypted community or chat room to store a key here.</p>
    </div>

    <!-- Actions -->
    <div class="key-actions">
      <ion-button expand="block" fill="outline" size="small" @click="exportKeys" :disabled="keys.length === 0">
        <ion-icon :icon="downloadOutline" slot="start"></ion-icon>
        Export Keys
      </ion-button>
      <ion-button expand="block" fill="outline" size="small" @click="triggerImport">
        <ion-icon :icon="cloudUploadOutline" slot="start"></ion-icon>
        Import Keys
      </ion-button>
      <input ref="fileInput" type="file" accept=".json" style="display: none" @change="handleImport" />
    </div>

    <!-- Delete confirmation alert -->
    <ion-alert
      :is-open="showDeleteAlert"
      header="Delete Key?"
      :message="deleteAlertMessage"
      :buttons="deleteAlertButtons"
      @didDismiss="showDeleteAlert = false"
    ></ion-alert>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { IonIcon, IonButton, IonAlert, toastController } from '@ionic/vue';
import {
  keyOutline,
  trashOutline,
  lockOpenOutline,
  downloadOutline,
  cloudUploadOutline,
} from 'ionicons/icons';
import type { StoredEncryptionKey } from '@/types/encryption';
import { KeyVaultService } from '@/services/keyVaultService';

const keys = ref<StoredEncryptionKey[]>([]);
const fileInput = ref<HTMLInputElement | null>(null);
const showDeleteAlert = ref(false);
const deleteAlertMessage = ref('');
const pendingDeleteId = ref<string | null>(null);

const deleteAlertButtons = computed(() => [
  { text: 'Cancel', role: 'cancel' },
  {
    text: 'Delete',
    role: 'destructive',
    handler: () => {
      if (pendingDeleteId.value) {
        deleteKey(pendingDeleteId.value);
      }
    },
  },
]);

async function showToast(message: string) {
  const toast = await toastController.create({ message, duration: 3000 });
  await toast.present();
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

async function loadKeys() {
  try {
    keys.value = await KeyVaultService.listKeys();
  } catch (err) {
    console.error('Failed to load keys:', err);
    keys.value = [];
    await showToast('Failed to load encryption keys.');
  }
}

function confirmDelete(key: StoredEncryptionKey) {
  pendingDeleteId.value = key.id;
  const name = escapeHtml(key.label || key.id);
  deleteAlertMessage.value =
    `Deleting the key for "${name}" will permanently remove your access. This cannot be undone.`;
  showDeleteAlert.value = true;
}

async function deleteKey(id: string) {
  try {
    await KeyVaultService.removeKey(id);
    pendingDeleteId.value = null;
    await loadKeys();
  } catch (err) {
    console.error('Failed to delete key:', err);
    await showToast('Failed to delete key.');
  }
}

async function exportKeys() {
  try {
    const json = await KeyVaultService.exportKeys();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `interpoll-keys-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (err) {
    console.error('Failed to export keys:', err);
    await showToast('Failed to export keys.');
  }
}

function triggerImport() {
  fileInput.value?.click();
}

async function handleImport(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;

  try {
    const text = await file.text();
    const count = await KeyVaultService.importKeys(text);
    await loadKeys();
    await showToast(
      count > 0
        ? `Imported ${count} key${count !== 1 ? 's' : ''} successfully.`
        : 'No valid keys found in the file.',
      count > 0 ? 'success' : 'warning',
    );
  } catch (err) {
    console.error('Failed to import keys:', err);
    await showToast('Import failed — the file may be invalid or corrupt.');
  } finally {
    input.value = '';
  }
}

function formatDate(ts: number): string {
  if (!ts) return '';
  return new Date(ts).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

onMounted(loadKeys);
</script>

<style scoped>
.key-management {
  padding: 16px;
}

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.section-header h3 {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  color: var(--ion-text-color);
}

.section-header h3 ion-icon {
  font-size: 20px;
  color: var(--ion-color-primary);
}

.key-count {
  font-size: 12px;
  font-weight: 600;
  color: var(--ion-color-medium);
  background: rgba(var(--ion-text-color-rgb), 0.06);
  padding: 2px 10px;
  border-radius: 12px;
}

.section-description {
  font-size: 13px;
  line-height: 1.4;
  color: var(--ion-color-step-600);
  margin: 0 0 16px 0;
}

/* Key list */
.key-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-bottom: 16px;
}

.key-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  border-radius: 8px;
  background: rgba(var(--ion-text-color-rgb), 0.03);
  border: 1px solid rgba(var(--ion-text-color-rgb), 0.06);
}

.key-info {
  flex: 1;
  min-width: 0;
}

.key-label {
  display: block;
  font-size: 14px;
  font-weight: 500;
  color: var(--ion-text-color);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.key-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 4px;
  font-size: 11px;
  color: var(--ion-color-medium);
}

.key-type-badge {
  display: inline-block;
  padding: 1px 6px;
  border-radius: 4px;
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.3px;
}

.key-type-badge.community {
  background: rgba(var(--ion-color-primary-rgb), 0.10);
  color: var(--ion-color-primary);
}

.key-type-badge.chatroom {
  background: rgba(var(--ion-color-tertiary-rgb), 0.10);
  color: var(--ion-color-tertiary);
}

.key-type-badge.server {
  background: rgba(var(--ion-color-warning-rgb), 0.10);
  color: var(--ion-color-warning-shade);
}

.key-method {
  text-transform: capitalize;
}

/* Empty state */
.empty-state {
  text-align: center;
  padding: 24px 16px;
  color: var(--ion-color-medium);
}

.empty-state ion-icon {
  font-size: 36px;
  margin-bottom: 8px;
  opacity: 0.5;
}

.empty-state p {
  margin: 4px 0;
  font-size: 14px;
}

.empty-state .hint {
  font-size: 12px;
  opacity: 0.7;
}

/* Actions */
.key-actions {
  display: flex;
  gap: 8px;
}

.key-actions ion-button {
  flex: 1;
  --border-radius: 8px;
}

/* Dark mode refinements */
html.dark .key-item {
  background: rgba(255, 255, 255, 0.04);
  border-color: rgba(255, 255, 255, 0.08);
}

html.dark .key-count {
  background: rgba(255, 255, 255, 0.08);
}
</style>
