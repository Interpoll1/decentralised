<template>
  <ion-page>
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-back-button :default-href="`/community/${communityId}`"></ion-back-button>
        </ion-buttons>
        <ion-title>Create Post</ion-title>
        <ion-buttons slot="end">
          <ion-button
            @click="submitPost"
            :disabled="!canSubmit || isSubmitting"
            color="primary"
          >
            <ion-spinner v-if="isSubmitting" name="crescent" style="width:18px;height:18px;margin-right:4px;"></ion-spinner>
            {{ isSubmitting ? 'Posting...' : 'Post' }}
          </ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>

    <ion-content>
      <!-- Community Selection -->
      <ion-item lines="full">
        <ion-select
          v-model="selectedCommunity"
          label="Community"
          placeholder="Select community"
        >
          <ion-select-option
            v-for="community in communityStore.communities"
            :key="community.id"
            :value="community.id"
          >
            {{ community.displayName }}
          </ion-select-option>
        </ion-select>
      </ion-item>

      <!-- Title -->
      <ion-item lines="full">
        <ion-input
          v-model="title"
          label="Title"
          label-placement="floating"
          placeholder="An interesting title"
          :maxlength="300"
        ></ion-input>
      </ion-item>

      <!-- Content -->
      <ion-item lines="full">
        <ion-textarea
          v-model="content"
          label="Text (optional)"
          label-placement="floating"
          placeholder="What's on your mind?"
          :rows="6"
          :maxlength="10000"
          :auto-grow="true"
        ></ion-textarea>
      </ion-item>

      <!-- Image Upload -->
      <div class="image-section">
        <ion-button
          fill="clear"
          size="small"
          @click="selectImage"
          v-if="!imagePreview"
          class="add-image-btn"
        >
          <ion-icon slot="start" :icon="imageOutline"></ion-icon>
          Add Image
        </ion-button>

        <div v-if="imagePreview" class="image-preview-container">
          <img :src="imagePreview" class="image-preview" />
          <ion-button
            fill="clear"
            color="danger"
            class="remove-image"
            @click="removeImage"
          >
            <ion-icon :icon="closeCircle"></ion-icon>
          </ion-button>
          <div class="image-info">
            <ion-badge color="primary">{{ imageSize }}</ion-badge>
            <ion-badge color="success" v-if="isCompressing">Compressing...</ion-badge>
          </div>
        </div>
      </div>

      <input
        ref="fileInput"
        type="file"
        accept="image/*"
        style="display: none"
        @change="handleImageSelect"
      />

      <!-- Info Box -->
      <div class="info-box" v-if="imageFile">
        <ion-icon :icon="informationCircle"></ion-icon>
        <p>Image will be compressed to ~200 KB and stored on GunDB. Thumbnail (~15 KB) cached locally for fast loading.</p>
      </div>
    </ion-content>
  </ion-page>
</template>

<style scoped>
.image-section {
  padding: 12px 16px;
  border-bottom: 1px solid rgba(var(--ion-text-color-rgb), 0.08);
}

.add-image-btn {
  margin: 0;
  --padding-start: 0;
}

.image-preview-container {
  position: relative;
  margin-top: 8px;
}

.image-preview {
  width: 100%;
  max-height: 360px;
  object-fit: cover;
  border-radius: 12px;
  border: 1px solid rgba(var(--ion-text-color-rgb), 0.1);
}

.remove-image {
  position: absolute;
  top: 8px;
  right: 8px;
  --background: rgba(0, 0, 0, 0.55);
  --border-radius: 50%;
}

.image-info {
  display: flex;
  gap: 8px;
  margin-top: 8px;
}

.info-box {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin: 16px;
  padding: 12px;
  background: rgba(var(--ion-card-background-rgb), 0.20);
  backdrop-filter: blur(14px) saturate(1.4);
  -webkit-backdrop-filter: blur(14px) saturate(1.4);
  border: 1px solid var(--glass-border);
  border-top-color: var(--glass-border-top);
  border-radius: 12px;
  font-size: 12px;
  color: var(--ion-color-medium);
  box-shadow: var(--glass-highlight);
}

.info-box ion-icon {
  flex-shrink: 0;
  font-size: 18px;
  margin-top: 1px;
}

.info-box p {
  margin: 0;
  line-height: 1.5;
}
</style>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
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
  IonSelect,
  IonSelectOption,
  IonButton,
  IonIcon,
  IonSpinner,
  IonBadge,
  toastController
} from '@ionic/vue';
import { imageOutline, closeCircle, informationCircle } from 'ionicons/icons';
import { useCommunityStore } from '../stores/communityStore';
import { usePostStore } from '../stores/postStore';

const route = useRoute();
const router = useRouter();
const communityStore = useCommunityStore();
const postStore = usePostStore();

const communityId = route.params.communityId as string;
const selectedCommunity = ref(communityId || '');
const title = ref('');
const content = ref('');
const imageFile = ref<File | null>(null);
const imagePreview = ref<string | null>(null);
const isSubmitting = ref(false);
const isCompressing = ref(false);
const fileInput = ref<HTMLInputElement | null>(null);

const imageSize = computed(() => {
  if (!imageFile.value) return '';
  const kb = imageFile.value.size / 1024;
  if (kb < 1024) return `${kb.toFixed(0)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
});

const canSubmit = computed(() => {
  return selectedCommunity.value && title.value.trim().length > 0;
});

const selectImage = () => {
  fileInput.value?.click();
};

const handleImageSelect = async (event: Event) => {
  const target = event.target as HTMLInputElement;
  const file = target.files?.[0];
  
  if (!file) return;

  // Check file size (max 10 MB before compression)
  if (file.size > 10 * 1024 * 1024) {
    const toast = await toastController.create({
      message: 'Image too large! Maximum 10 MB',
      duration: 3000,
      color: 'danger'
    });
    await toast.present();
    return;
  }

  isCompressing.value = true;
  imageFile.value = file;

  // Create preview
  const reader = new FileReader();
  reader.onload = (e) => {
    imagePreview.value = e.target?.result as string;
    isCompressing.value = false;
  };
  reader.readAsDataURL(file);
};

const removeImage = () => {
  imageFile.value = null;
  imagePreview.value = null;
  if (fileInput.value) {
    fileInput.value.value = '';
  }
};

const submitPost = async () => {
  if (!canSubmit.value) return;

  isSubmitting.value = true;

  try {
    await postStore.createPost({
      communityId: selectedCommunity.value,
      title: title.value.trim(),
      content: content.value.trim(),
      imageFile: imageFile.value || undefined
    });

    const toast = await toastController.create({
      message: 'Post created successfully',
      duration: 2000,
      color: 'success'
    });
    await toast.present();

    // Reset form
    title.value = '';
    content.value = '';
    removeImage();

    // Navigate back
    router.push(`/community/${selectedCommunity.value}`);
  } catch (error) {
    console.error('Error creating post:', error);
    
    const toast = await toastController.create({
      message: 'Failed to create post',
      duration: 3000,
      color: 'danger'
    });
    await toast.present();
  } finally {
    isSubmitting.value = false;
  }
};
</script>
