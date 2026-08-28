<template>
  <ion-page>
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start">
          <button class="back-btn" @click="router.back()">
            <svg viewBox="0 0 24 24" fill="none"><path d="M15 18l-6-6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
        </ion-buttons>
        <ion-title>Create Post</ion-title>
        <ion-buttons slot="end">
          <button class="submit-btn" @click="submitPost" :disabled="!canSubmit || isSubmitting">
            <div v-if="isSubmitting" class="btn-spinner"></div>
            {{ isSubmitting ? 'Posting…' : 'Post' }}
          </button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>

    <ion-content>
      <div class="create-page">

        <div v-if="isSubmittingSlow" class="slow-banner">
          <ion-icon :icon="timeOutline"></ion-icon>
          Still publishing to the network — this can take a few extra seconds on a slow relay.
        </div>

        <div class="create-hero">
          <p class="hero-label">New post</p>
          <h1 class="hero-title">Publish to your community</h1>
          <p class="hero-sub">Draft a post with a clear title, optional context, and an image preview before broadcasting it to peers.</p>
        </div>

        <div class="form-card">

          <!-- Community -->
          <div class="field-group">
            <label class="field-label">Community</label>
            <button class="community-picker" @click="pickerOpen = true">
              <span v-if="selectedCommunityObj" class="picker-avatar-wrap">
                <span class="picker-mini-avatar" :class="avatarTone(selectedCommunityObj.id)">
                  {{ (selectedCommunityObj.displayName || selectedCommunityObj.name || 'C').charAt(0).toUpperCase() }}
                </span>
              </span>
              <span :class="selectedCommunityObj ? 'picker-selected' : 'picker-placeholder'">
                {{ selectedCommunityObj ? selectedCommunityObj.displayName : 'Select a community' }}
              </span>
              <ion-icon :icon="chevronDownOutline"></ion-icon>
            </button>
            <p v-if="selectedCommunityObj" class="field-sub">{{ selectedCommunityObj.id }}</p>
          </div>

          <CommunityPickerModal
            v-model="pickerOpen"
            :communities="joinedCommunities"
            :selected="selectedCommunityObj"
            title="Post to…"
            @pick="c => { selectedCommunity = c.id; selectedCommunityObj = c }"
          />

          <!-- Title -->
          <div class="field-group">
            <label class="field-label">Title <span class="required">*</span></label>
            <div class="field-wrap">
              <input class="field-native" v-model="title" type="text" placeholder="An interesting title…" :maxlength="300" />
            </div>
            <p class="field-count">{{ title.length }}/300</p>
          </div>

          <!-- Content -->
          <div class="field-group">
            <label class="field-label">Text <span class="optional">optional</span></label>
            <div class="field-wrap">
              <textarea class="field-native" v-model="content" placeholder="What's on your mind?" :maxlength="10000" rows="6"></textarea>
            </div>
            <p class="field-count">{{ content.length }}/10,000</p>
          </div>

          <!-- Image -->
          <div class="media-section">
            <div class="media-header">
              <div class="media-header-left">
                <div class="media-icon-wrap img-icon"><ion-icon :icon="imageOutline"></ion-icon></div>
                <div>
                  <p class="media-title">Image <span class="optional">optional</span></p>
                  <p class="media-sub">Compressed to ~200 KB and stored on GunDB</p>
                </div>
              </div>
              <button v-if="!imagePreview" class="pill-btn accent-sm" @click="selectImage">
                <ion-icon :icon="imageOutline"></ion-icon> Add Image
              </button>
            </div>
            <div v-if="imagePreview" class="preview-wrap">
              <img :src="imagePreview" class="image-preview" :alt="title" />
              <button class="remove-btn" @click="removeImage" title="Remove">
                <ion-icon :icon="closeCircle"></ion-icon>
              </button>
              <div class="image-badges">
                <span class="img-badge">{{ imageSize }}</span>
                <span v-if="isCompressing" class="img-badge compressing">Compressing…</span>
              </div>
            </div>
          </div>

          <!-- Video -->
          <div class="media-section">
            <div class="media-header clickable" @click="showVideoSection = !showVideoSection">
              <div class="media-header-left">
                <div class="media-icon-wrap vid-icon"><ion-icon :icon="videocamOutline"></ion-icon></div>
                <div>
                  <p class="media-title">Video <span class="optional">optional</span></p>
                  <p class="media-sub">Compressed in-browser, uploaded to IPFS via Filebase · max 30 MB</p>
                </div>
              </div>
              <button class="chevron-btn" type="button">
                <ion-icon :icon="showVideoSection ? chevronUpOutline : chevronDownOutline"></ion-icon>
              </button>
            </div>
            <div v-if="showVideoSection" class="video-body">
              <VideoUploader @uploaded="onVideoUploaded" @cleared="onVideoCleared" />
              <div v-if="videoCID" class="video-attached">
                <ion-icon :icon="videocamOutline"></ion-icon>
                <span>Video attached · {{ (videoSize / 1024 / 1024).toFixed(1) }} MB · {{ Math.round(videoDuration) }}s</span>
              </div>
            </div>
          </div>

          <!-- Image info -->
          <div v-if="imageFile" class="info-box">
            <ion-icon :icon="informationCircle"></ion-icon>
            <p>Image will be compressed to ~200 KB and stored on GunDB. Thumbnail (~15 KB) cached locally for fast loading.</p>
          </div>

        </div>
      </div>

      <input ref="fileInput" type="file" accept="image/*" class="hidden-input" @change="handleImageSelect" />
    </ion-content>
  </ion-page>
</template>

<style scoped>
ion-header::after { display: none !important; }
ion-toolbar { --border-width: 0 !important; }
ion-content { --background: transparent; }

.back-btn {
  display: flex; align-items: center; justify-content: center;
  width: 36px; height: 36px; background: none; border: none;
  border-radius: 50%; color: var(--app-text-muted); cursor: pointer;
  margin-left: 4px; transition: color 160ms ease;
}
.back-btn:hover { color: var(--app-text); }
.back-btn svg { width: 22px; height: 22px; }

.submit-btn {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 7px 18px; border-radius: 999px; border: none;
  background: linear-gradient(135deg,#6366f1,#8b5cf6); color: #fff;
  font-size: 13.5px; font-weight: 700; cursor: pointer;
  box-shadow: 0 4px 14px rgba(99,102,241,.38);
  transition: opacity 160ms, transform 160ms; margin-right: 8px;
}
.submit-btn:hover:not(:disabled) { opacity: .9; transform: translateY(-1px); }
.submit-btn:disabled { opacity: .38; cursor: not-allowed; }

.btn-spinner {
  width: 15px; height: 15px;
  border: 2px solid rgba(255,255,255,.3); border-top-color: #fff;
  border-radius: 50%; animation: spin .7s linear infinite; flex-shrink: 0;
}
@keyframes spin { to { transform: rotate(360deg); } }

.create-page { max-width: 720px; margin: 0 auto; padding: 20px 16px 60px; display: flex; flex-direction: column; gap: 20px; }

.slow-banner {
  display: flex; align-items: center; gap: 10px;
  padding: 11px 14px; border-radius: 12px;
  background: rgba(251,191,36,.1); border: 1px solid rgba(251,191,36,.28);
  color: #fbbf24; font-size: 13px; line-height: 1.5;
}
.slow-banner ion-icon { font-size: 16px; flex-shrink: 0; }

.create-hero { padding-top: 4px; }
.hero-label { font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: .1em; color: #818cf8; margin: 0 0 8px; }
.hero-title {
  margin: 0 0 8px; font-size: 26px; font-weight: 800; letter-spacing: -.03em; line-height: 1.2;
  background: linear-gradient(135deg, var(--app-text) 60%, rgba(167,139,250,.85));
  -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent;
}
.hero-sub { margin: 0; font-size: 13.5px; color: var(--app-text-muted); line-height: 1.6; max-width: 580px; }

.form-card { border-radius: 20px; background: rgba(255,255,255,.05); border: 1px solid rgba(255,255,255,.09); padding: 22px; display: flex; flex-direction: column; gap: 18px; }

.field-group { display: flex; flex-direction: column; gap: 6px; }
.field-label { font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: .08em; color: var(--app-text-subtle); }
.required { color: #ef4444; }
.optional { font-weight: 400; text-transform: none; letter-spacing: 0; font-size: 11px; color: var(--app-text-subtle); }
.field-wrap { border-radius: 14px; background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.09); overflow: hidden; transition: border-color 180ms, box-shadow 180ms; position: relative; }
.field-wrap:focus-within { border-color: rgba(99,102,241,.5); box-shadow: 0 0 0 3px rgba(99,102,241,.1); }
.field-native { width: 100%; background: transparent; border: none; outline: none; padding: 13px 14px; font-size: 14.5px; font-family: inherit; color: var(--ion-text-color); -webkit-appearance: none; appearance: none; resize: none; }
.field-native::placeholder { color: var(--app-text-subtle); }
.community-picker { width: 100%; display: flex; align-items: center; gap: 10px; padding: 10px 14px; border-radius: 12px; background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.09); cursor: pointer; transition: border-color 180ms, box-shadow 180ms; }
.community-picker:hover { border-color: rgba(99,102,241,.4); }
.community-picker ion-icon { color: var(--app-text-subtle); font-size: 16px; flex-shrink: 0; margin-left: auto; }
.picker-avatar-wrap { flex-shrink: 0; }
.picker-mini-avatar { width: 28px; height: 28px; border-radius: 8px; display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 800; color: #fff; }
.picker-selected { font-size: 14px; font-weight: 600; color: var(--app-text); flex: 1; text-align: left; }
.picker-placeholder { font-size: 14px; color: var(--app-text-subtle); flex: 1; text-align: left; }
.field-sub { margin: 4px 0 0; font-size: 11px; color: var(--app-text-subtle); padding: 0 2px; }
.tone-violet { background: linear-gradient(135deg,#6366f1,#8b5cf6); }
.tone-blue   { background: linear-gradient(135deg,#3b82f6,#6366f1); }
.tone-teal   { background: linear-gradient(135deg,#14b8a6,#3b82f6); }
.tone-amber  { background: linear-gradient(135deg,#f59e0b,#ef4444); }
.tone-rose   { background: linear-gradient(135deg,#ec4899,#8b5cf6); }
.field-native option { background: #1a1a2e; color: #fff; }
.field-count { font-size: 11px; color: var(--app-text-subtle); text-align: right; margin: 0; }

.media-section { border-radius: 16px; background: rgba(255,255,255,.03); border: 1px solid rgba(255,255,255,.07); overflow: hidden; }
.media-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 14px 16px; }
.media-header.clickable { cursor: pointer; user-select: none; }
.media-header.clickable:hover { background: rgba(255,255,255,.03); }
.media-header-left { display: flex; align-items: center; gap: 12px; min-width: 0; }
.media-icon-wrap { width: 38px; height: 38px; border-radius: 10px; flex-shrink: 0; display: flex; align-items: center; justify-content: center; font-size: 18px; color: #fff; }
.img-icon { background: linear-gradient(135deg,#3b82f6,#6366f1); box-shadow: 0 3px 10px rgba(59,130,246,.3); }
.vid-icon { background: linear-gradient(135deg,#ec4899,#8b5cf6); box-shadow: 0 3px 10px rgba(236,72,153,.3); }
.media-title { font-size: 14px; font-weight: 700; color: var(--app-text); margin: 0 0 2px; letter-spacing: -.01em; }
.media-sub { font-size: 12px; color: var(--app-text-muted); margin: 0; line-height: 1.4; }

.preview-wrap { position: relative; margin: 0 14px 14px; border-radius: 12px; overflow: hidden; border: 1px solid rgba(255,255,255,.08); }
.image-preview { width: 100%; max-height: 320px; object-fit: cover; display: block; }
.remove-btn { position: absolute; top: 8px; right: 8px; width: 30px; height: 30px; border-radius: 50%; border: none; background: rgba(0,0,0,.55); backdrop-filter: blur(6px); color: #fff; cursor: pointer; display: flex; align-items: center; justify-content: center; font-size: 18px; transition: background 160ms; }
.remove-btn:hover { background: rgba(239,68,68,.7); }
.image-badges { display: flex; gap: 6px; margin: 8px 14px 14px; }
.img-badge { padding: 3px 9px; border-radius: 999px; font-size: 11px; font-weight: 700; background: rgba(99,102,241,.12); color: #818cf8; border: 1px solid rgba(99,102,241,.22); }
.img-badge.compressing { background: rgba(52,211,153,.12); color: #34d399; border-color: rgba(52,211,153,.25); }

.video-body { padding: 0 14px 14px; display: flex; flex-direction: column; gap: 12px; }
.video-attached { display: flex; align-items: center; gap: 8px; padding: 10px 14px; border-radius: 12px; background: rgba(139,92,246,.1); border: 1px solid rgba(139,92,246,.2); color: #a78bfa; font-size: 13px; font-weight: 600; }
.video-attached ion-icon { font-size: 16px; flex-shrink: 0; }

.pill-btn { display: inline-flex; align-items: center; gap: 5px; padding: 7px 14px; border-radius: 999px; border: none; font-size: 13px; font-weight: 700; cursor: pointer; transition: opacity 160ms, transform 160ms; white-space: nowrap; }
.accent-sm { background: rgba(99,102,241,.14); color: #818cf8; border: 1px solid rgba(99,102,241,.25); }
.accent-sm:hover { background: rgba(99,102,241,.22); transform: translateY(-1px); }
.accent-sm ion-icon { font-size: 15px; }
.chevron-btn { width: 32px; height: 32px; border-radius: 50%; border: none; background: rgba(255,255,255,.06); color: var(--app-text-subtle); cursor: pointer; display: flex; align-items: center; justify-content: center; font-size: 17px; flex-shrink: 0; transition: background 160ms; }
.chevron-btn:hover { background: rgba(255,255,255,.1); color: var(--app-text); }

.info-box { display: flex; align-items: flex-start; gap: 10px; padding: 12px 14px; border-radius: 12px; background: rgba(99,102,241,.07); border: 1px solid rgba(99,102,241,.18); color: #a5b4fc; font-size: 13px; line-height: 1.5; }
.info-box ion-icon { font-size: 17px; flex-shrink: 0; margin-top: 1px; }
.info-box p { margin: 0; }
.hidden-input { display: none; }

@media (max-width: 576px) {
  .form-card { padding: 16px; }
  .hero-title { font-size: 22px; }
  .create-page { padding: 16px 12px 60px; }
}
</style>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { onMounted } from 'vue';
import {
  IonPage,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonButtons,
  IonButton,
  IonIcon,
  IonSpinner,
  toastController
} from '@ionic/vue';
import { imageOutline, closeCircle, informationCircle, videocamOutline, chevronDownOutline, chevronUpOutline, timeOutline } from 'ionicons/icons';
import { defineAsyncComponent } from 'vue';
const VideoUploader = defineAsyncComponent(() => import('../components/VideoUploader.vue'));
import CommunityPickerModal from '../components/CommunityPickerModal.vue';
import type { VideoMeta } from '../services/videoService';
import { useCommunityStore } from '../stores/communityStore';
import { usePostStore } from '../stores/postStore';
import { checkContent } from '../utils/contentGuard';

const route = useRoute();
const router = useRouter();
const communityStore = useCommunityStore();
const postStore = usePostStore();

const communityId = route.params.communityId as string;
const selectedCommunity = ref(communityId || '');
const selectedCommunityObj = ref<import('../services/communityService').Community | null>(null);
const pickerOpen = ref(false);

const TONES = ['tone-violet', 'tone-blue', 'tone-teal', 'tone-amber', 'tone-rose'];
function avatarTone(id: string) {
  const code = id.split('').reduce((a, ch) => a + ch.charCodeAt(0), 0);
  return TONES[code % TONES.length];
}
const title = ref('');
const content = ref('');
const imageFile = ref<File | null>(null);
const imagePreview = ref<string | null>(null);
const isSubmitting = ref(false);
const isSubmittingSlow = ref(false);
let submitSlowTimer: ReturnType<typeof setTimeout> | null = null;

watch(isSubmitting, (submitting) => {
  if (submitSlowTimer) {
    clearTimeout(submitSlowTimer);
    submitSlowTimer = null;
  }
  isSubmittingSlow.value = false;
  if (submitting) {
    submitSlowTimer = setTimeout(() => {
      isSubmittingSlow.value = true;
    }, 3000);
  }
});
const isCompressing = ref(false);
const fileInput = ref<HTMLInputElement | null>(null);

// ── Video attachment state ──────────────────────────────────────────────────
const showVideoSection  = ref(false);
const videoCID          = ref<string | null>(null);
const videoThumbnailCID = ref<string | null>(null);
const videoDuration     = ref<number>(0);
const videoSize         = ref<number>(0);
const videoMimeType     = ref<string>('video/mp4');

function onVideoUploaded(meta: VideoMeta) {
  videoCID.value          = meta.cid;
  videoThumbnailCID.value = meta.thumbnailCID || null;
  videoDuration.value     = meta.duration;
  videoSize.value         = meta.size;
  videoMimeType.value     = meta.mimeType;
}
function onVideoCleared() {
  videoCID.value          = null;
  videoThumbnailCID.value = null;
  videoDuration.value     = 0;
  videoSize.value         = 0;
  videoMimeType.value     = 'video/mp4';
}

// Ensure communities are loaded when navigating directly to this page
// (bypassing HomePage which normally calls loadCommunities on mount).
onMounted(async () => {
  if (communityStore.communities.length === 0) {
    await communityStore.loadCommunities();
  }
  // If no joined communities are recorded (empty localStorage / new device),
  // sync joined state from the relay so the list isn't empty.
  if (joinedCommunities.value.length === 0 && communityStore.communities.length > 0) {
    await communityStore.syncJoinedFromRelay?.().catch(() => {});
  }
  // Pre-select the community from route param if still joined
  if (communityId && communityStore.isJoined(communityId)) {
    selectedCommunity.value = communityId;
    selectedCommunityObj.value = communityStore.communities.find(c => c.id === communityId) || null;
  }
});

const imageSize = computed(() => {
  if (!imageFile.value) return '';
  const kb = imageFile.value.size / 1024;
  if (kb < 1024) return `${kb.toFixed(0)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
});

const joinedCommunities = computed(() => {
  const joined = communityStore.communities.filter(c => communityStore.isJoined(c.id));
  // Fall back to all communities when none are marked joined (empty localStorage,
  // new device, or join state not yet synced). User can post to any community.
  return joined.length > 0 ? joined : communityStore.communities;
});

const canSubmit = computed(() =>
  !!selectedCommunity.value
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
  // Auto-join the community if user selected from fallback list (not yet joined)
  if (!communityStore.isJoined(selectedCommunity.value)) {
    await communityStore.joinCommunity(selectedCommunity.value);
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
      title:       title.value.trim(),
      content:     content.value.trim(),
      imageFile:   imageFile.value || undefined,
      ...(videoCID.value ? {
        videoCID:          videoCID.value,
        videoThumbnailCID: videoThumbnailCID.value || undefined,
        videoDuration:     videoDuration.value     || undefined,
        videoSize:         videoSize.value         || undefined,
        videoMimeType:     videoMimeType.value     || undefined,
      } : {}),
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
    onVideoCleared();
    showVideoSection.value = false;

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