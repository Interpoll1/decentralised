<template>
  <ion-page>
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-back-button default-href="/home"></ion-back-button>
        </ion-buttons>
        <ion-title>Create Community</ion-title>
      </ion-toolbar>
    </ion-header>

    <ion-content>
      <div class="page-shell page-shell--form form-grid">

      <!-- Basics: one name (the c/ handle is derived automatically) -->
      <div class="page-panel">
      <p class="page-subtitle">Create a space for people to discuss topics they love</p>

      <ion-item>
        <ion-input
          v-model="displayName"
          label="Community name"
          label-placement="floating"
          placeholder="Programming"
          :maxlength="50"
        ></ion-input>
      </ion-item>
      <p class="helper-text" :class="{ error: !!nameError }">
        {{ nameError || (slug ? `Will live at c/${slug}` : 'Pick a clear name — the c/ handle is created for you.') }}
      </p>

      <ion-item>
        <ion-textarea
          v-model="description"
          label="Description (optional)"
          label-placement="floating"
          placeholder="What is this community about?"
          :rows="2"
          :auto-grow="true"
          :maxlength="500"
        ></ion-textarea>
      </ion-item>
      </div>

      <div class="form-grid__side">
      <!-- Rules: sensible defaults ship collapsed; editing is opt-in -->
      <div class="page-panel rules-section">
        <button type="button" class="rules-toggle" @click="showRules = !showRules">
          <ion-label>Community rules</ion-label>
          <span class="rules-summary">{{ rulesSummary }} · {{ showRules ? 'Done' : 'Customize' }}</span>
        </button>
        <template v-if="showRules">
          <div v-for="(rule, index) in rules" :key="index" class="rule-item">
            <ion-item>
              <ion-input
                v-model="rules[index]"
                :placeholder="`Rule ${index + 1}`"
                :maxlength="200"
              ></ion-input>
              <ion-button
                slot="end"
                fill="clear"
                color="danger"
                @click="removeRule(index)"
                v-if="rules.length > 1"
              >
                <ion-icon :icon="closeCircle"></ion-icon>
              </ion-button>
            </ion-item>
          </div>
          <ion-button
            size="small"
            fill="outline"
            @click="addRule"
            v-if="rules.length < 10"
          >
            <ion-icon slot="start" :icon="add"></ion-icon>
            Add Rule
          </ion-button>
        </template>
      </div>

      <!-- Privacy -->
      <div class="page-panel privacy-panel">
        <PrivateCommunityToggle @update:config="privacyConfig = $event" />
      </div>
      </div>

      <div class="form-grid__full">
        <ion-button
          expand="block"
          @click="createCommunity"
          :disabled="!canCreate || isCreating"
          class="create-btn"
        >
          <ion-spinner v-if="isCreating" name="crescent" class="mr-2"></ion-spinner>
          {{ isCreating ? 'Creating...' : 'Create Community' }}
        </ion-button>

        <p class="p2p-note">
          Stored on GenosDB and synced across all peers — once created, it can't be deleted.
        </p>
      </div>

      </div>
    </ion-content>
  </ion-page>
</template>

<style scoped>
.page-subtitle {
  color: var(--ion-color-medium);
  margin: 0 0 20px;
  font-size: 14px;
}

.helper-text {
  font-size: 12px;
  color: var(--ion-color-medium);
  margin: 4px 16px 16px;
}

.helper-text.error {
  color: var(--ion-color-danger);
}

.rule-item {
  margin-bottom: 8px;
}

.rules-toggle {
  display: flex;
  width: 100%;
  align-items: center;
  justify-content: space-between;
  padding: 0;
  background: none;
  border: none;
  cursor: pointer;
  font: inherit;
  color: var(--app-text);
}

.rules-toggle ion-label {
  font-weight: 600;
}

.rules-summary {
  font-size: 13px;
  color: var(--app-accent);
}

.rules-toggle + .rule-item {
  margin-top: 12px;
}

.privacy-panel {
  padding: 8px 12px;
}

.create-btn {
  margin-top: 4px;
}

.p2p-note {
  margin: 10px 0 0;
  text-align: center;
  font-size: 12px;
  line-height: 1.5;
  color: var(--app-text-subtle);
}

.mr-2 {
  margin-right: 8px;
}
</style>
<script setup lang="ts">
import { ref, computed } from 'vue';
import { useRouter } from 'vue-router';
import {
  IonPage,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonButtons,
  IonBackButton,
  IonCard,
  IonCardHeader,
  IonCardTitle,
  IonCardSubtitle,
  IonCardContent,
  IonItem,
  IonInput,
  IonTextarea,
  IonLabel,
  IonButton,
  IonIcon,
  IonSpinner,
  toastController
} from '@ionic/vue';
import { add, closeCircle } from 'ionicons/icons';
import { useCommunityStore } from '../stores/communityStore';
import PrivateCommunityToggle from '../components/PrivateCommunityToggle.vue';
import type { PrivateCommunityConfig } from '../components/PrivateCommunityToggle.vue';

const router = useRouter();
const communityStore = useCommunityStore();

const displayName = ref('');
const description = ref('');
const rules = ref(['Be respectful', 'No spam']);
const showRules = ref(false);
const isCreating = ref(false);
const privacyConfig = ref<PrivateCommunityConfig>({ isPrivate: false, method: 'invite' });

/**
 * The c/ handle is derived from the community name automatically (lowercased,
 * spaces -> underscores, symbols stripped), so users fill in ONE name field
 * and never have to learn the slug format rules.
 */
const slug = computed(() =>
  displayName.value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9_\s]/g, '')
    .replace(/\s+/g, '_')
    .slice(0, 21)
);

const nameError = computed(() =>
  displayName.value.trim() !== '' && slug.value.length < 3
    ? 'Name needs at least 3 letters or numbers'
    : ''
);

const rulesSummary = computed(() => {
  const count = rules.value.filter((r) => r.trim() !== '').length;
  return `${count} rule${count === 1 ? '' : 's'}`;
});

const canCreate = computed(() => {
  const baseValid = displayName.value.trim() !== '' && slug.value.length >= 3;

  if (privacyConfig.value.isPrivate && privacyConfig.value.method === 'password') {
    return baseValid && (privacyConfig.value.password?.trim().length ?? 0) >= 12;
  }
  return baseValid;
});

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
      name: slug.value,
      displayName: displayName.value.trim(),
      description: description.value.trim(),
      rules: validRules
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

