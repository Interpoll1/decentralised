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

      <ion-card class="mt-4" v-if="!route.params.verificationCode">
        <ion-card-header>
          <ion-card-title>Lookup Receipt</ion-card-title>
        </ion-card-header>
        <ion-card-content>
          <ion-item>
            <ion-textarea
              v-model="verificationCodeInput"
              placeholder="Enter your 12-word receipt verification code"
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
const verificationCodeInput = ref('');

onMounted(async () => {
  const verificationCode = route.params.verificationCode as string;
  if (verificationCode) {
    await loadReceipt(verificationCode);
  }
});

const loadReceipt = async (verificationCode: string) => {
  const receipt = await StorageService.getReceipt(verificationCode);
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
  if (!verificationCodeInput.value.trim()) return;
  await loadReceipt(verificationCodeInput.value.trim());
};
</script>