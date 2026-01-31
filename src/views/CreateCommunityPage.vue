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

    <ion-content class="ion-padding">
      <ion-card>
        <ion-card-header>
          <ion-card-title>Community Details</ion-card-title>
          <ion-card-subtitle>
            Create a space for people to discuss topics they love
          </ion-card-subtitle>
        </ion-card-header>

        <ion-card-content>
          <!-- Community Name -->
          <ion-item>
            <ion-input
              v-model="name"
              label="Community Name"
              label-placement="floating"
              placeholder="programming"
              @ionInput="validateName"
              :maxlength="21"
            >
              <div slot="start">c/</div>
            </ion-input>
          </ion-item>
          <p class="helper-text" :class="{ error: nameError }">
            {{ nameError || 'Lowercase letters, numbers, underscores only. No spaces.' }}
          </p>

          <!-- Display Name -->
          <ion-item>
            <ion-input
              v-model="displayName"
              label="Display Name"
              label-placement="floating"
              placeholder="Programming"
              :maxlength="50"
            ></ion-input>
          </ion-item>

          <!-- Description -->
          <ion-item>
            <ion-textarea
              v-model="description"
              label="Description"
              label-placement="floating"
              placeholder="What is this community about?"
              :rows="4"
              :maxlength="500"
            ></ion-textarea>
          </ion-item>

          <!-- Rules -->
          <div class="rules-section">
            <ion-label>Community Rules</ion-label>
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
          </div>

          <!-- Info Box -->
          <div class="info-box">
            <ion-icon :icon="informationCircle"></ion-icon>
            <div>
              <p><strong>Decentralized Community</strong></p>
              <p>
                This community will be stored on GunDB and synced across all peers. 
                Once created, it cannot be deleted (that's the nature of P2P!).
              </p>
            </div>
          </div>

          <!-- Create Button -->
          <ion-button
            expand="block"
            @click="createCommunity"
            :disabled="!canCreate || isCreating"
            class="mt-4"
          >
            <ion-spinner v-if="isCreating" name="crescent" class="mr-2"></ion-spinner>
            {{ isCreating ? 'Creating...' : 'Create Community' }}
          </ion-button>
        </ion-card-content>
      </ion-card>
    </ion-content>
  </ion-page>
</template>

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
import { add, closeCircle, informationCircle } from 'ionicons/icons';
import { useCommunityStore } from '../stores/communityStore';

const router = useRouter();
const communityStore = useCommunityStore();

const name = ref('');
const displayName = ref('');
const description = ref('');
const rules = ref(['Be respectful', 'No spam']);
const isCreating = ref(false);
const nameError = ref('');

const canCreate = computed(() => {
  return (
    name.value.trim() !== '' &&
    !nameError.value &&
    displayName.value.trim() !== '' &&
    description.value.trim() !== ''
  );
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

    const community = await communityStore.createCommunity({
      name: name.value.trim(),
      displayName: displayName.value.trim(),
      description: description.value.trim(),
      rules: validRules
    });

    const toast = await toastController.create({
      message: 'Community created successfully',
      duration: 2000,
      color: 'success'
    });
    await toast.present();

    // Navigate to the new community
    router.push(`/community/${community.id}`);
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

<style scoped>
.helper-text {
  font-size: 12px;
  color: var(--ion-color-medium);
  margin: 4px 16px 16px;
}

.helper-text.error {
  color: var(--ion-color-danger);
}

.rules-section {
  margin: 24px 0;
}

.rules-section > ion-label {
  display: block;
  font-weight: 600;
  margin-bottom: 12px;
  padding: 0 16px;
}

.rule-item {
  margin-bottom: 8px;
}

.info-box {
  display: flex;
  gap: 12px;
  margin-top: 24px;
  padding: 16px;
  background: var(--ion-color-light);
  border-radius: 8px;
}

.info-box ion-icon {
  flex-shrink: 0;
  font-size: 24px;
  color: var(--ion-color-primary);
}

.info-box p {
  margin: 0 0 8px 0;
  font-size: 13px;
  line-height: 1.4;
}

.info-box p:last-child {
  margin-bottom: 0;
}

.mt-4 {
  margin-top: 24px;
}

.mr-2 {
  margin-right: 8px;
}
</style>