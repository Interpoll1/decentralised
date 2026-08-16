<template>
  <ion-page>
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start">
          <button class="back-btn" @click="router.back()">
            <svg viewBox="0 0 24 24" fill="none"><path d="M15 18l-6-6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
        </ion-buttons>
        <ion-title>Create Community</ion-title>
      </ion-toolbar>
    </ion-header>

    <ion-content>
      <DesktopPageShell>
      <div class="create-page">

        <p class="page-subtitle">Create a space for people to discuss topics they love</p>

        <!-- Community Name -->
        <div class="field-group">
          <label class="field-label">Community Name</label>
          <div class="field-input-wrap">
            <span class="field-prefix">c/</span>
            <input
              v-model="name"
              @input="validateName"
              class="field-native has-prefix"
              type="text"
              placeholder="programming"
              :maxlength="21"
              autocomplete="off"
              autocapitalize="none"
              spellcheck="false"
            />
          </div>
          <p class="helper-text" :class="{ error: nameError }">
            {{ nameError || 'Lowercase letters, numbers, underscores only. No spaces.' }}
          </p>
        </div>

        <!-- Display Name -->
        <div class="field-group">
          <label class="field-label">Display Name</label>
          <div class="field-input-wrap">
            <input
              v-model="displayName"
              class="field-native"
              type="text"
              placeholder="Programming"
              :maxlength="50"
            />
          </div>
        </div>

        <!-- Description -->
        <div class="field-group">
          <label class="field-label">Description</label>
          <div class="field-input-wrap">
            <textarea
              v-model="description"
              class="field-native"
              placeholder="What is this community about?"
              :maxlength="500"
              rows="4"
            ></textarea>
          </div>
        </div>

        <!-- Category -->
        <div class="field-group">
          <label class="field-label">Category</label>
          <div class="field-input-wrap">
            <select v-model="category" class="field-native">
              <option value="" disabled>Choose a category</option>
              <option v-for="opt in categoryOptions" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
            </select>
          </div>
        </div>

        <!-- NSFW -->
        <div class="nsfw-row">
          <div>
            <div class="nsfw-label">Mark as NSFW</div>
            <div class="nsfw-sub">Contains adult or sensitive content</div>
          </div>
          <label class="toggle-switch">
            <input type="checkbox" v-model="nsfw" />
            <span class="toggle-track"></span>
          </label>
        </div>

        <!-- Rules -->
        <div>
          <div class="section-heading">Community Rules</div>
          <div class="rules-list-edit">
            <div v-for="(_, index) in rules" :key="index" class="rule-row">
              <span class="rule-number">{{ index + 1 }}</span>
              <input
                v-model="rules[index]"
                class="rule-input"
                type="text"
                :placeholder="`Rule ${index + 1}`"
                :maxlength="200"
              />
              <button v-if="rules.length > 1" class="rule-delete" @click="removeRule(index)" title="Remove rule">
                <svg viewBox="0 0 24 24" fill="none" width="14" height="14"><path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg>
              </button>
            </div>
          </div>
          <button v-if="rules.length < 10" class="add-rule-btn" @click="addRule">
            <svg viewBox="0 0 24 24" fill="none"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg>
            Add Rule
          </button>
        </div>

        <!-- Info box -->
        <div class="info-box">
          <div class="info-box-icon">
            <ion-icon :icon="informationCircle"></ion-icon>
          </div>
          <div>
            <p><strong>Peer-to-Peer Community</strong></p>
            <p>This community will be stored on GunDB and synced across all peers. Once created, it cannot be deleted — that's the nature of P2P!</p>
          </div>
        </div>

        <!-- Private toggle -->
        <PrivateCommunityToggle @update:config="privacyConfig = $event" />

        <!-- Create button -->
        <button
          class="create-btn"
          @click="createCommunity"
          :disabled="!canCreate || isCreating"
        >
          <ion-spinner v-if="isCreating" name="crescent" style="width:18px;height:18px;color:#fff"></ion-spinner>
          {{ isCreating ? 'Creating...' : 'Create Community' }}
        </button>

      </div>
      </DesktopPageShell>
    </ion-content>
  </ion-page>
</template>

<style scoped>
ion-header::after { display: none !important; }
ion-toolbar { --border-width: 0 !important; }

ion-back-button {
  --background: transparent;
  --background-hover: transparent;
  --background-activated: transparent;
  --background-hover-opacity: 0;
  --ripple-color: rgba(255,255,255,0.08);
  --color: var(--app-text-muted);
}

ion-content { --background: transparent; }

.create-page {
  max-width: 640px;
  margin: 0 auto;
  padding: 20px 16px 60px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

/* ── Subtitle ── */
.page-subtitle {
  font-size: 13.5px;
  color: var(--app-text-muted);
  margin: 0 0 4px;
  line-height: 1.5;
}

/* ── Field groups ── */
.field-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.field-label {
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--app-text-subtle);
  padding: 0 2px;
}

.field-input-wrap {
  display: flex;
  align-items: center;
  border-radius: 14px;
  background: rgba(255,255,255,0.05);
  border: 1px solid rgba(255,255,255,0.09);
  transition: border-color 180ms ease, box-shadow 180ms ease;
  overflow: hidden;
}
.field-input-wrap:focus-within {
  border-color: rgba(var(--app-accent-rgb,99,102,241), 0.5);
  box-shadow: 0 0 0 3px rgba(var(--app-accent-rgb,99,102,241), 0.1);
}

.field-prefix {
  padding: 0 4px 0 14px;
  font-size: 15px;
  font-weight: 600;
  color: var(--app-text-subtle);
  flex-shrink: 0;
}

.field-native {
  flex: 1;
  background: transparent;
  border: none;
  outline: none;
  padding: 13px 14px;
  font-size: 15px;
  font-family: inherit;
  color: var(--ion-text-color);
  width: 100%;
  -webkit-appearance: none;
  appearance: none;
}
.field-native.has-prefix { padding-left: 2px; }
.field-native::placeholder { color: var(--app-text-subtle); }
.field-native::-webkit-search-decoration { -webkit-appearance: none; }

textarea.field-native {
  resize: none;
  padding: 13px 14px;
  line-height: 1.6;
  min-height: 100px;
}

select.field-native {
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='rgba(255,255,255,0.4)' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 14px center;
  padding-right: 36px;
  cursor: pointer;
}
select.field-native option { background: #1a1a2e; color: #fff; }

.helper-text {
  font-size: 12px;
  color: var(--app-text-subtle);
  padding: 0 2px;
  line-height: 1.4;
}
.helper-text.error { color: var(--ion-color-danger, #ef4444); }

/* ── NSFW toggle ── */
.nsfw-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  border-radius: 14px;
  background: rgba(255,255,255,0.05);
  border: 1px solid rgba(255,255,255,0.09);
}

.nsfw-label {
  font-size: 14px;
  font-weight: 600;
  color: var(--app-text);
}
.nsfw-sub {
  font-size: 12px;
  color: var(--app-text-subtle);
  margin-top: 2px;
}

/* native checkbox styled as toggle */
.toggle-switch {
  position: relative;
  width: 44px;
  height: 26px;
  flex-shrink: 0;
}
.toggle-switch input { opacity: 0; width: 0; height: 0; }
.toggle-track {
  position: absolute;
  inset: 0;
  border-radius: 999px;
  background: rgba(255,255,255,0.12);
  border: 1px solid rgba(255,255,255,0.1);
  cursor: pointer;
  transition: background 200ms ease;
}
.toggle-switch input:checked + .toggle-track { background: #6366f1; border-color: #6366f1; }
.toggle-track::after {
  content: '';
  position: absolute;
  top: 3px;
  left: 3px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 4px rgba(0,0,0,0.3);
  transition: transform 200ms ease;
}
.toggle-switch input:checked + .toggle-track::after { transform: translateX(18px); }

/* ── Rules section ── */
.section-heading {
  font-size: 13px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--app-text-subtle);
  margin: 8px 0 10px;
}

.rules-list-edit {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 10px;
}

.rule-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  border-radius: 12px;
  background: rgba(255,255,255,0.05);
  border: 1px solid rgba(255,255,255,0.09);
  transition: border-color 180ms ease;
}
.rule-row:focus-within {
  border-color: rgba(var(--app-accent-rgb,99,102,241),0.4);
}

.rule-number {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: rgba(var(--app-accent-rgb,99,102,241),0.15);
  color: #818cf8;
  font-size: 11px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.rule-input {
  flex: 1;
  background: transparent;
  border: none;
  outline: none;
  font-size: 14px;
  font-family: inherit;
  color: var(--ion-text-color);
}
.rule-input::placeholder { color: var(--app-text-subtle); }

.rule-delete {
  width: 28px;
  height: 28px;
  border: none;
  background: rgba(239,68,68,0.1);
  border-radius: 50%;
  color: #ef4444;
  font-size: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  flex-shrink: 0;
  transition: background 160ms ease;
}
.rule-delete:hover { background: rgba(239,68,68,0.2); }

.add-rule-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  border-radius: 999px;
  border: 1px dashed rgba(var(--app-accent-rgb,99,102,241),0.35);
  background: rgba(var(--app-accent-rgb,99,102,241),0.06);
  color: #818cf8;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: background 160ms ease, border-color 160ms ease;
}
.add-rule-btn:hover {
  background: rgba(var(--app-accent-rgb,99,102,241),0.12);
  border-color: rgba(var(--app-accent-rgb,99,102,241),0.5);
}
.add-rule-btn svg { width: 14px; height: 14px; }

/* ── Info box ── */
.info-box {
  display: flex;
  gap: 12px;
  padding: 16px;
  background: rgba(var(--app-accent-rgb,99,102,241),0.07);
  border: 1px solid rgba(var(--app-accent-rgb,99,102,241),0.18);
  border-radius: 14px;
}
.info-box-icon {
  width: 36px;
  height: 36px;
  border-radius: 10px;
  background: rgba(var(--app-accent-rgb,99,102,241),0.15);
  color: #818cf8;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  font-size: 18px;
}
.info-box-icon ion-icon { font-size: 18px; }
.info-box p { margin: 0 0 6px; font-size: 13px; line-height: 1.5; color: var(--app-text-muted); }
.info-box p:last-child { margin: 0; }
.info-box strong { color: var(--app-text); font-weight: 700; }

/* ── Create button ── */
.create-btn {
  margin-top: 8px;
  width: 100%;
  padding: 15px;
  border-radius: 14px;
  border: none;
  background: linear-gradient(135deg, #6366f1, #8b5cf6);
  color: #fff;
  font-size: 15px;
  font-weight: 700;
  letter-spacing: -0.01em;
  cursor: pointer;
  box-shadow: 0 8px 24px rgba(99,102,241,0.35);
  transition: opacity 160ms ease, transform 160ms ease;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}
.create-btn:hover:not(:disabled) { opacity: 0.92; transform: translateY(-1px); }
.create-btn:disabled { opacity: 0.45; cursor: not-allowed; }

.back-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  background: none;
  border: none;
  border-radius: 50%;
  color: var(--app-text-muted, rgba(255,255,255,0.65));
  cursor: pointer;
  margin-left: 4px;
  transition: color 160ms ease;
}
.back-btn:hover { color: var(--app-text, #fff); }
.back-btn svg { width: 22px; height: 22px; }

</style>

<script setup lang="ts">
import { ref, computed } from 'vue';
import DesktopPageShell from '../components/DesktopPageShell.vue';
import { useRouter } from 'vue-router';
import {
  IonPage,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonButtons,
  IonIcon,
  IonSpinner,
  toastController
} from '@ionic/vue';
import { informationCircle } from 'ionicons/icons';
import { useCommunityStore } from '../stores/communityStore';
import PrivateCommunityToggle from '../components/PrivateCommunityToggle.vue';
import type { PrivateCommunityConfig } from '../components/PrivateCommunityToggle.vue';

const router = useRouter();
const communityStore = useCommunityStore();

const name = ref('');
const displayName = ref('');
const description = ref('');
const category = ref('');
const nsfw = ref(false);
const rules = ref(['Be respectful', 'No spam']);
const isCreating = ref(false);
const nameError = ref('');
const privacyConfig = ref<PrivateCommunityConfig>({ isPrivate: false, method: 'invite', valid: true });

const categoryOptions = [
  { value: 'technology', label: 'Technology' },
  { value: 'gaming', label: 'Gaming' },
  { value: 'science', label: 'Science' },
  { value: 'politics', label: 'Politics' },
  { value: 'crypto', label: 'Crypto' },
  { value: 'sports', label: 'Sports' },
  { value: 'general', label: 'General' },
];

const canCreate = computed(() => {
  const baseValid = name.value.trim() !== '' &&
    !nameError.value &&
    displayName.value.trim() !== '' &&
    description.value.trim() !== '';
  
  if (privacyConfig.value.isPrivate && privacyConfig.value.method === 'password') {
    return baseValid && (privacyConfig.value.password?.trim().length ?? 0) >= 12;
  }
  return baseValid;
});

const validateName = () => {
  const value = name.value.toLowerCase().trim();
  
  if (value === '') {
    nameError.value = '';
    return;
  }

  // Check format (only lowercase letters, numbers, underscores)
  if (!/^[a-z0-9_]+$/.test(value)) {
    nameError.value = 'Only lowercase letters, numbers, and underscores allowed';
    return;
  }

  // Check length
  if (value.length < 3) {
    nameError.value = 'Must be at least 3 characters';
    return;
  }

  nameError.value = '';
  name.value = value;
};

const addRule = () => {
  rules.value.push('');
};

const removeRule = (index: number) => {
  rules.value.splice(index, 1);
};

const createCommunity = async () => {
  if (!canCreate.value) return;

  isCreating.value = true;

  try {
    const validRules = rules.value.filter(r => r.trim() !== '');
    const communityData = {
      name: name.value.trim(),
      displayName: displayName.value.trim(),
      description: description.value.trim(),
      rules: validRules,
      category: category.value || undefined,
      nsfw: nsfw.value,
    };

    let communityId: string;

    if (privacyConfig.value.isPrivate) {
      const password = privacyConfig.value.method === 'password' ? privacyConfig.value.password : undefined;
      const result = await communityStore.createPrivateCommunity(communityData, password);
      communityId = result.community.id;

      if (result.inviteLink) {
        const toast = await toastController.create({
          message: 'Private community created! Invite link copied to clipboard.',
          duration: 4000,
          color: 'success'
        });
        await toast.present();
        try { await navigator.clipboard.writeText(result.inviteLink); } catch { /* ignore */ }
      }
    } else {
      const community = await communityStore.createCommunity(communityData);
      communityId = community.id;

      const toast = await toastController.create({
        message: 'Community created successfully',
        duration: 2000,
        color: 'success'
      });
      await toast.present();
    }

    router.push(`/community/${communityId}`);
  } catch (error) {
    console.error('Error creating community:', error);
    
    const toast = await toastController.create({
      message: 'Failed to create community',
      duration: 3000,
      color: 'danger'
    });
    await toast.present();
  } finally {
    isCreating.value = false;
  }
};
</script>