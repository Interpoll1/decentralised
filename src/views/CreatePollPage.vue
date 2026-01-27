<template>
  <ion-page>
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-back-button default-href="/home"></ion-back-button>
        </ion-buttons>
        <ion-title>Create Poll</ion-title>
      </ion-toolbar>
    </ion-header>

    <ion-content class="ion-padding">
      <ion-card>
        <ion-card-content>
          <ion-item>
            <ion-input
              v-model="title"
              label="Poll Title"
              label-placement="floating"
              placeholder="Enter poll title"
            ></ion-input>
          </ion-item>

          <ion-item>
            <ion-textarea
              v-model="description"
              label="Description"
              label-placement="floating"
              placeholder="Enter description"
              :rows="3"
            ></ion-textarea>
          </ion-item>

          <div class="mt-4">
            <p class="text-sm font-semibold mb-2">Options</p>
            <div v-for="(option, index) in options" :key="index" class="mb-2">
              <ion-item>
                <ion-input
                  v-model="options[index]"
                  :placeholder="`Option ${index + 1}`"
                ></ion-input>
                <ion-button
                  slot="end"
                  fill="clear"
                  color="danger"
                  @click="removeOption(index)"
                  v-if="options.length > 2"
                >
                  <ion-icon :icon="closeCircle"></ion-icon>
                </ion-button>
              </ion-item>
            </div>

            <ion-button size="small" fill="outline" @click="addOption">
              <ion-icon slot="start" :icon="add"></ion-icon>
              Add Option
            </ion-button>
          </div>

          <ion-button
            expand="block"
            @click="createPoll"
            :disabled="!isValid"
            class="mt-6"
          >
            Create Poll
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
  IonCardContent,
  IonItem,
  IonInput,
  IonTextarea,
  IonButton,
  IonIcon,
  toastController
} from '@ionic/vue';
import { add, closeCircle } from 'ionicons/icons';
import { usePollStore } from '../stores/pollStore';
import { Poll } from '../types/chain';

const router = useRouter();
const pollStore = usePollStore();

const title = ref('');
const description = ref('');
const options = ref(['', '']);

const isValid = computed(() => {
  return (
    title.value.trim() !== '' &&
    description.value.trim() !== '' &&
    options.value.filter(o => o.trim() !== '').length >= 2
  );
});

const addOption = () => {
  options.value.push('');
};

const removeOption = (index: number) => {
  options.value.splice(index, 1);
};

const createPoll = async () => {
  const validOptions = options.value.filter(o => o.trim() !== '');

  const poll: Poll = {
    id: `poll-${Date.now()}`,
    title: title.value.trim(),
    description: description.value.trim(),
    options: validOptions,
    createdAt: Date.now()
  };

  await pollStore.createPoll(poll);

  const toast = await toastController.create({
    message: 'Poll created successfully!',
    duration: 2000,
    color: 'success',
    position: 'bottom'
  });

  await toast.present();
  
  // Reset form
  title.value = '';
  description.value = '';
  options.value = ['', ''];
  
  // Navigate back to home
  router.push('/home');
};
</script>