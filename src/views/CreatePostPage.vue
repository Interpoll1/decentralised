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
            <ion-spinner v-if="isSubmitting" name="crescent" class="submit-spinner"></ion-spinner>
            {{ isSubmitting ? 'Posting...' : 'Post' }}
          </ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>

    <ion-content class="ambient-page">
      <div class="ambient-page__content create-post-page">
        <section class="create-hero">
          <span class="surface-label">New post</span>
          <h1 class="section-heading create-title">Publish to your community</h1>
          <p class="section-subtitle create-subtitle">
            Draft a post with a clear title, optional context, and an image preview before broadcasting it to peers.
          </p>
        </section>

        <section class="create-form surface-card">
          <div class="field-stack">
            <ion-item lines="none">
              <ion-select
                v-model="selectedCommunity"
                label="Community"
                placeholder="Select joined community"
              >
                <ion-select-option
                  v-for="community in joinedCommunities"
                  :key="community.id"
                  :value="community.id"
                >
                  {{ community.displayName }}
                </ion-select-option>
              </ion-select>
            </ion-item>

            <ion-item lines="none">
              <ion-input
                v-model="title"
                label="Title"
                label-placement="floating"
                placeholder="An interesting title"
                :maxlength="300"
              ></ion-input>
            </ion-item>

            <ion-item lines="none" class="content-field">
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
          </div>

          <div class="image-section surface-card">
            <div class="image-section-header">
              <div>
                <span class="surface-label">Media</span>
                <h2>Add an image</h2>
              </div>
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
            </div>

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
        </section>
      </div>

      <input
        ref="fileInput"
        type="file"
        accept="image/*"
        class="hidden-file-input"
        @change="handleImageSelect"
      />

      <div class="ambient-page__content create-post-info" v-if="imageFile">
        <div class="info-box">
          <ion-icon :icon="informationCircle"></ion-icon>
          <p>Image will be compressed to ~200 KB and stored on GunDB. Thumbnail (~15 KB) cached locally for fast loading.</p>
        </div>
      </div>
    </ion-content>
  </ion-page>
</template>

<style scoped>
.create-post-page {
  display: grid;
  gap: 24px;
}

.create-hero {
  max-width: 760px;
  padding-top: 8px;
}

.create-title {
  margin: 12px 0 10px;
}

.create-subtitle {
  max-width: 640px;
}

.create-form {
  display: grid;
  gap: 24px;
  padding: 24px;
}

.field-stack {
  display: grid;
  gap: 16px;
}

.content-field {
  align-items: flex-start;
}

.image-section {
  display: grid;
  gap: 16px;
  padding: 20px;
}

.add-image-btn {
  margin: 0;
}

.image-section-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.image-section-header h2 {
  margin: 6px 0 0;
  font-size: 20px;
  letter-spacing: -0.02em;
}

.image-preview-container {
  position: relative;
}

.image-preview {
  width: 100%;
  max-height: 360px;
  object-fit: cover;
  border-radius: 16px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.06);
}

.remove-image {
  position: absolute;
  top: 8px;
  right: 8px;
  --background: var(--app-surface-strong);
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
  margin-top: -8px;
  padding: 14px 16px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 16px;
  font-size: 12px;
  color: var(--app-text-muted);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.05);
}

.info-box ion-icon {
  flex-shrink: 0;
  font-size: 18px;
  margin-top: 1px;
  color: var(--app-accent-bright);
}

.info-box p {
  margin: 0;
  line-height: 1.5;
}

.submit-spinner {
  width: 18px;
  height: 18px;
  margin-right: 4px;
}

.hidden-file-input {
  display: none;
}

@media (max-width: 767px) {
  .create-form {
    padding: 18px;
  }

  .image-section {
    padding: 16px;
  }

  .image-section-header {
    flex-direction: column;
    align-items: flex-start;
  }
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
import { checkContent } from '../utils/contentGuard';

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

const joinedCommunities = computed(() =>
  communityStore.communities.filter(c => communityStore.isJoined(c.id))
);

const canSubmit = computed(() =>
  !!selectedCommunity.value
  && communityStore.isJoined(selectedCommunity.value)
  && title.value.trim().length > 0
);

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
  if (!communityStore.isJoined(selectedCommunity.value)) {
    const toast = await toastController.create({
      message: 'Join a community before creating a post',
      duration: 2500,
      color: 'warning'
    });
    await toast.present();
    return;
  }

  const titleCheck = checkContent(title.value.trim(), 'title');
  if (!titleCheck.ok) {
    const toast = await toastController.create({ message: `Title: ${titleCheck.reason}`, duration: 2500, color: 'warning' });
    await toast.present();
    return;
  }
  if (content.value.trim()) {
    const bodyCheck = checkContent(content.value.trim(), 'body');
    if (!bodyCheck.ok) {
      const toast = await toastController.create({ message: `Content: ${bodyCheck.reason}`, duration: 2500, color: 'warning' });
      await toast.present();
      return;
    }
  }

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
    const message = error instanceof Error && error.message === 'COMMUNITY_JOIN_REQUIRED'
      ? 'Join the selected community before posting'
      : 'Failed to create post';
    
    const toast = await toastController.create({
      message,
      duration: 3000,
      color: 'danger'
    });
    await toast.present();
  } finally {
    isSubmitting.value = false;
  }
};
</script>
