<template>
  <ion-page>
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-back-button default-href="/home"></ion-back-button>
        </ion-buttons>
        <ion-title>Vote Receipt</ion-title>
      </ion-toolbar>
    </ion-header>

    <ion-content class="ion-padding">
      <ReceiptViewer :receipt="currentReceipt" />

      <ion-card class="mt-4" v-if="!route.params.mnemonic">
        <ion-card-header>
          <ion-card-title>Lookup Receipt</ion-card-title>
        </ion-card-header>
        <ion-card-content>
          <ion-item>
            <ion-textarea
              v-model="mnemonicInput"
              placeholder="Enter your 12-word recovery phrase"
              :rows="3"
            ></ion-textarea>
          </ion-item>
          <ion-button expand="block" @click="lookupReceipt" class="mt-3">
            Find Receipt
          </ion-button>
        </ion-card-content>
      </ion-card>
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRoute } from 'vue-router';
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
  IonCardContent,
  IonItem,
  IonTextarea,
  IonButton,
  toastController
} from '@ionic/vue';
import { StorageService } from '../services/storageService';
import { Receipt } from '../types/chain';
import ReceiptViewer from '../components/ReceiptViewer.vue';

const route = useRoute();
const currentReceipt = ref<Receipt | null>(null);
const mnemonicInput = ref('');

onMounted(async () => {
  const mnemonic = route.params.mnemonic as string;
  if (mnemonic) {
    await loadReceipt(mnemonic);
  }
});

const loadReceipt = async (mnemonic: string) => {
  const receipt = await StorageService.getReceipt(mnemonic);
  currentReceipt.value = receipt || null;

  if (!receipt) {
    const toast = await toastController.create({
      message: 'Receipt not found',
      duration: 2000,
      color: 'warning'
    });
    await toast.present();
  }
};

const lookupReceipt = async () => {
  if (!mnemonicInput.value.trim()) return;
  await loadReceipt(mnemonicInput.value.trim());
};
</script>