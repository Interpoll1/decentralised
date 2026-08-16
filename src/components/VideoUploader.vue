<template>
  <div class="video-uploader">

    <!-- Drop zone / file picker (before upload starts) -->
    <div
      v-if="!meta && !uploading && !error"
      class="video-uploader__dropzone"
      :class="{ 'video-uploader__dropzone--dragover': isDragOver }"
      @click="triggerFilePicker"
      @dragover.prevent="isDragOver = true"
      @dragleave="isDragOver = false"
      @drop.prevent="onDrop"
    >
      <input
        ref="fileInput"
        type="file"
        accept="video/mp4,video/webm,video/ogg,video/quicktime,video/x-msvideo,video/mpeg"
        style="display:none"
        @change="onFileSelected"
      />
      <ion-icon :icon="cloudUploadOutline" class="video-uploader__icon" />
      <p class="video-uploader__label">
        <strong>Drop video here</strong> or click to browse
      </p>
      <p class="video-uploader__hint">
        MP4, WebM, OGG, MOV · Auto-compressed to H.264 · Max 30 MB after compression
      </p>
    </div>

    <!-- File selected, not yet uploading -->
    <div v-if="selectedFile && !uploading && !meta && !error" class="video-uploader__preview">
      <div class="video-uploader__preview-thumb">
        <img v-if="thumbnailPreview" :src="thumbnailPreview" alt="Thumbnail preview" />
        <ion-icon v-else :icon="videocamOutline" />
      </div>
      <div class="video-uploader__preview-info">
        <p class="video-uploader__filename">{{ selectedFile.name }}</p>
        <p class="video-uploader__fileinfo">
          {{ formatFileSize(selectedFile.size) }}
          <span v-if="detectedDuration"> · {{ formatDuration(detectedDuration) }}</span>
        </p>
      </div>
      <div class="video-uploader__preview-actions">
        <ion-button size="small" @click="startUpload">
          <ion-icon slot="start" :icon="cloudUploadOutline" />
          Upload
        </ion-button>
        <ion-button size="small" fill="clear" @click="clearSelection">
          Change
        </ion-button>
      </div>
    </div>

    <!-- Upload / compression in progress -->
    <div v-if="uploading" class="video-uploader__progress">
      <div class="video-uploader__progress-track">
        <div
          class="video-uploader__progress-fill"
          :style="{ width: progress.percent + '%' }"
          :class="{
            'video-uploader__progress-fill--compressing': progress.stage === 'compressing',
            'video-uploader__progress-fill--uploading':   progress.stage === 'uploading',
          }"
        />
      </div>
      <p class="video-uploader__progress-label">
        <ion-icon
          :icon="progress.stage === 'compressing' ? settingsOutline :
                 progress.stage === 'uploading'   ? cloudUploadOutline :
                 progress.stage === 'pinning'      ? linkOutline :
                 checkmarkCircleOutline"
        />
        {{ progress.message }}
      </p>
      <p class="video-uploader__progress-pct">{{ progress.percent }}%</p>
      <p v-if="progress.stage === 'compressing'" class="video-uploader__progress-hint">
        Compressing in your browser — this may take a moment for large files
      </p>
    </div>

    <!-- Error state -->
    <div v-if="error" class="video-uploader__error">
      <ion-icon :icon="alertCircleOutline" />
      <p>{{ error }}</p>
      <ion-button size="small" fill="outline" @click="reset">Try again</ion-button>
    </div>

    <!-- Success state -->
    <div v-if="meta && !uploading" class="video-uploader__success">
      <div class="video-uploader__success-thumb">
        <img v-if="thumbnailPreview" :src="thumbnailPreview" />
        <ion-icon v-else :icon="checkmarkCircleOutline" />
      </div>
      <div class="video-uploader__success-info">
        <p><strong>Video uploaded</strong></p>
        <p class="video-uploader__cid">{{ meta.cid.slice(0, 24) }}…</p>
        <p>{{ formatFileSize(meta.size) }} · {{ formatDuration(meta.duration) }}</p>
      </div>
      <ion-button size="small" fill="clear" color="danger" @click="reset">Remove</ion-button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { IonIcon, IonButton } from '@ionic/vue';
import {
  cloudUploadOutline, videocamOutline, alertCircleOutline, checkmarkCircleOutline,
  settingsOutline, linkOutline,
} from 'ionicons/icons';
import {
  uploadVideo, validateVideoFile, getVideoDuration, extractVideoThumbnail,
  formatFileSize, formatDuration,
  type VideoMeta, type VideoUploadProgress,
} from '../services/videoService';

// ── Props & emits ─────────────────────────────────────────────────────────────

const emit = defineEmits<{
  (e: 'uploaded', meta: VideoMeta): void;
  (e: 'cleared'): void;
}>();

// ── Constants ─────────────────────────────────────────────────────────────────


// ── State ─────────────────────────────────────────────────────────────────────

const fileInput       = ref<HTMLInputElement | null>(null);
const selectedFile    = ref<File | null>(null);
const thumbnailPreview = ref<string | null>(null);
const detectedDuration = ref<number | null>(null);
const uploading       = ref(false);
const error           = ref<string | null>(null);
const isDragOver      = ref(false);
const meta            = ref<VideoMeta | null>(null);
const progress        = ref<VideoUploadProgress>({
  stage: 'validating', percent: 0, message: '',
});

// ── File selection ────────────────────────────────────────────────────────────

function triggerFilePicker() {
  fileInput.value?.click();
}

function onFileSelected(event: Event) {
  const input = event.target as HTMLInputElement;
  if (input.files?.[0]) handleFile(input.files[0]);
}

function onDrop(event: DragEvent) {
  isDragOver.value = false;
  const file = event.dataTransfer?.files?.[0];
  if (file) handleFile(file);
}

async function handleFile(file: File) {
  error.value           = null;
  thumbnailPreview.value = null;
  detectedDuration.value = null;

  // Validate
  const validErr = validateVideoFile(file);
  if (validErr) { error.value = validErr; return; }

  selectedFile.value = file;

  // Get duration
  try {
    detectedDuration.value = await getVideoDuration(file);
  } catch (err: any) {
    error.value = err.message;
    selectedFile.value = null;
    return;
  }

  // Extract thumbnail for preview
  try {
    thumbnailPreview.value = await extractVideoThumbnail(file);
  } catch {
    // No thumbnail — show icon instead
  }
}

// ── Upload ────────────────────────────────────────────────────────────────────

async function startUpload() {
  if (!selectedFile.value) return;
  uploading.value = true;
  error.value     = null;

  try {
    const result = await uploadVideo(selectedFile.value, (p) => {
      progress.value = p;
    });
    meta.value = result;
    emit('uploaded', result);
  } catch (err: any) {
    error.value = err.message || 'Upload failed.';
  } finally {
    uploading.value = false;
  }
}

// ── Reset ─────────────────────────────────────────────────────────────────────

function clearSelection() {
  selectedFile.value     = null;
  thumbnailPreview.value = null;
  detectedDuration.value = null;
  error.value            = null;
  if (fileInput.value) fileInput.value.value = '';
}

function reset() {
  clearSelection();
  meta.value = null;
  emit('cleared');
}
</script>

<style scoped>
.video-uploader { width: 100%; }

.video-uploader__dropzone {
  border: 2px dashed var(--ion-color-medium, #666);
  border-radius: 12px;
  padding: 32px 16px;
  text-align: center;
  cursor: pointer;
  transition: border-color 0.2s, background 0.2s;
  background: var(--interpoll-surface-1, #141420);
}
.video-uploader__dropzone:hover,
.video-uploader__dropzone--dragover {
  border-color: var(--ion-color-primary, #6c5ce7);
  background: rgba(108, 92, 231, 0.06);
}

.video-uploader__icon {
  font-size: 2.5rem;
  color: var(--ion-color-medium, #666);
  margin-bottom: 12px;
}
.video-uploader__label { margin: 0 0 6px; font-size: 0.95rem; }
.video-uploader__hint  { margin: 0; font-size: 0.78rem; color: var(--ion-color-medium, #888); }

/* Preview */
.video-uploader__preview {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px;
  background: var(--interpoll-surface-2, #1a1a2e);
  border-radius: 12px;
}
.video-uploader__preview-thumb {
  width: 72px;
  height: 48px;
  border-radius: 6px;
  overflow: hidden;
  background: #000;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  img { width: 100%; height: 100%; object-fit: cover; }
  ion-icon { font-size: 1.5rem; color: #666; }
}
.video-uploader__preview-info { flex: 1; min-width: 0; }
.video-uploader__filename   { margin: 0 0 3px; font-size: 0.85rem; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.video-uploader__fileinfo   { margin: 0; font-size: 0.75rem; color: var(--ion-color-medium, #888); }
.video-uploader__preview-actions { display: flex; gap: 4px; flex-shrink: 0; }

/* Progress */
.video-uploader__progress {
  padding: 16px;
  background: var(--interpoll-surface-2, #1a1a2e);
  border-radius: 12px;
}
.video-uploader__progress-track {
  height: 6px;
  background: rgba(255,255,255,0.1);
  border-radius: 3px;
  overflow: hidden;
  margin-bottom: 10px;
}
.video-uploader__progress-fill {
  height: 100%;
  background: var(--ion-color-primary, #6c5ce7);
  border-radius: 3px;
  transition: width 0.3s ease;
}
.video-uploader__progress-fill--compressing {
  background: linear-gradient(90deg, #f39c12, #e67e22);
  animation: pulse 1.5s ease-in-out infinite;
}
.video-uploader__progress-fill--uploading {
  background: var(--ion-color-primary, #6c5ce7);
}
@keyframes pulse {
  0%, 100% { opacity: 1; }
  50%       { opacity: 0.7; }
}
.video-uploader__progress-label {
  margin: 0 0 2px;
  font-size: 0.85rem;
  display: flex;
  align-items: center;
  gap: 6px;
  ion-icon { font-size: 0.9rem; }
}
.video-uploader__progress-pct  { margin: 0; font-size: 0.75rem; color: var(--ion-color-medium, #888); }
.video-uploader__progress-hint { margin: 6px 0 0; font-size: 0.72rem; color: var(--ion-color-medium, #888); font-style: italic; }

/* Error */
.video-uploader__error {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 20px;
  color: var(--ion-color-danger, #e74c3c);
  text-align: center;
  ion-icon { font-size: 1.75rem; }
  p { margin: 0; font-size: 0.9rem; }
}

/* Success */
.video-uploader__success {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px;
  background: rgba(39, 174, 96, 0.08);
  border: 1px solid rgba(39, 174, 96, 0.3);
  border-radius: 12px;
}
.video-uploader__success-thumb {
  width: 72px;
  height: 48px;
  border-radius: 6px;
  overflow: hidden;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(39,174,96,0.1);
  img { width: 100%; height: 100%; object-fit: cover; }
  ion-icon { font-size: 1.5rem; color: var(--ion-color-success, #27ae60); }
}
.video-uploader__success-info { flex: 1; min-width: 0; p { margin: 0 0 2px; font-size: 0.82rem; } }
.video-uploader__cid { font-family: monospace; font-size: 0.7rem; color: var(--ion-color-medium, #888); }
</style>