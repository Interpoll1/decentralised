<template>
  <ion-page>
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start">
          <button class="back-btn" @click="router.back()">
            <svg viewBox="0 0 24 24" fill="none"><path d="M15 18l-6-6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
        </ion-buttons>
        <ion-title>Profile</ion-title>
        <ion-buttons slot="end">
          <button class="settings-btn" @click="$router.push('/settings')" title="Settings">
            <ion-icon :icon="settingsOutline"></ion-icon>
          </button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>

    <ion-content>
      <DesktopPageShell>
      <div class="profile-page">

        <!-- ── Hero ──────────────────────────────── -->
        <div class="profile-hero">
          <!-- Avatar -->
          <div class="avatar-wrap" @click="selectAvatar">
            <img v-if="avatarPreview || userProfile?.avatarThumbnail"
              :src="avatarPreview || userProfile?.avatarThumbnail"
              class="avatar-img"
              @error="avatarPreview = null; if (userProfile) userProfile.avatarThumbnail = undefined"
            />
            <div v-else class="avatar-placeholder">
              <ion-icon :icon="personCircleOutline"></ion-icon>
            </div>
            <div class="avatar-edit-ring">
              <ion-icon :icon="cameraOutline"></ion-icon>
            </div>
          </div>

          <!-- Name + badges -->
          <h1 class="profile-name">{{ userProfile?.customUsername || userProfile?.displayName || userProfile?.username }}</h1>
          <p class="profile-username">u/{{ userProfile?.customUsername || userProfile?.username }}</p>

          <div class="badge-row">
            <span class="identity-pill" :class="identityBadgeClass">{{ identityBadgeLabel }}</span>
            <span class="anon-pill" :class="userProfile?.showRealName ? 'named' : 'anon'">
              <ion-icon :icon="userProfile?.showRealName ? eyeOutline : eyeOffOutline"></ion-icon>
              {{ userProfile?.showRealName ? 'Visible' : 'Anonymous' }}
            </span>
          </div>

          <!-- Stats -->
          <div class="stats-strip">
            <div class="stat-item">
              <strong>{{ userProfile?.karma || 0 }}</strong>
              <span>Karma</span>
            </div>
            <div class="stat-divider"></div>
            <div class="stat-item">
              <strong>{{ userProfile?.postCount || 0 }}</strong>
              <span>Posts</span>
            </div>
            <div class="stat-divider"></div>
            <div class="stat-item">
              <strong>{{ userProfile?.commentCount || 0 }}</strong>
              <span>Comments</span>
            </div>
            <div class="stat-divider"></div>
            <div class="stat-item">
              <strong>{{ joinedCommunitiesCount }}</strong>
              <span>Communities</span>
            </div>
          </div>
        </div>

        <!-- ── Edit Profile ───────────────────────── -->
        <div class="profile-card">
          <div class="card-label">
            <ion-icon :icon="personCircleOutline"></ion-icon>
            Edit Profile
          </div>

          <div class="field-group">
            <label class="field-label">Custom Username</label>
            <div class="field-wrap">
              <input class="field-native" v-model="customUsername" placeholder="Choose a username" :maxlength="30" />
            </div>
          </div>

          <div class="field-group">
            <label class="field-label">Display Name</label>
            <div class="field-wrap">
              <input class="field-native" v-model="displayName" placeholder="Your display name" />
            </div>
          </div>

          <div class="field-group">
            <label class="field-label">Bio</label>
            <div class="field-wrap">
              <textarea class="field-native" v-model="bio" placeholder="Tell us about yourself…" rows="3"></textarea>
            </div>
          </div>

          <div class="toggle-row">
            <div>
              <div class="toggle-label">Show username on posts</div>
              <div class="toggle-sub">
                {{ showRealName
                  ? 'Your custom username will appear on new posts and comments.'
                  : 'You will appear as a random pseudonym on each post (default).' }}
              </div>
            </div>
            <label class="toggle-switch">
              <input type="checkbox" v-model="showRealName" />
              <span class="toggle-track"></span>
            </label>
          </div>

          <button class="save-btn" @click="saveProfile" :disabled="isSaving">
            <div v-if="isSaving" class="btn-spinner"></div>
            <ion-icon v-else :icon="saveOutline"></ion-icon>
            {{ isSaving ? 'Saving…' : 'Save Profile' }}
          </button>
        </div>

        <!-- ── Chat Link ──────────────────────────── -->
        <div class="profile-card chat-link-card">
          <div class="card-label">
            <ion-icon :icon="chatbubbleOutline"></ion-icon>
            Chat Link
          </div>
          <p class="card-sub">Share this link so others can start a direct message with you — no username search needed.</p>

          <div class="chat-link-box">
            <svg viewBox="0 0 24 24" fill="none" class="link-icon">
              <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
              <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
            </svg>
            <span class="link-text">{{ chatLinkDisplay }}</span>
          </div>

          <div class="link-actions">
            <button class="pill-btn accent" @click="copyChatLink">
              <svg viewBox="0 0 24 24" fill="none" width="14" height="14"><rect x="9" y="9" width="13" height="13" rx="2" stroke="currentColor" stroke-width="1.8"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
              Copy Link
            </button>
            <button v-if="canShare" class="pill-btn outline" @click="shareChatLink">
              <svg viewBox="0 0 24 24" fill="none" width="14" height="14"><path d="M21 12l-7-7v4C7 10 4 15 3 21c2.5-3.5 6-5.1 11-5.1V20l7-8z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/></svg>
              Share
            </button>
          </div>
          <p class="card-hint">Anyone with this link can open a chat with you directly.</p>
        </div>

        <!-- ── Account Info ───────────────────────── -->
        <div class="profile-card">
          <div class="card-label">
            <ion-icon :icon="settingsOutline"></ion-icon>
            Account Information
          </div>
          <div class="info-table">
            <div class="info-row">
              <span class="info-key">Device ID</span>
              <div class="info-val-row">
                <code class="info-val">{{ deviceId }}</code>
                <button class="icon-btn" @click="copyDeviceId" title="Copy">
                  <ion-icon :icon="copyOutline"></ion-icon>
                </button>
              </div>
            </div>
            <div class="info-row">
              <span class="info-key">Member Since</span>
              <span class="info-val">{{ formatDate(userProfile?.createdAt) }}</span>
            </div>
            <div class="info-row">
              <span class="info-key">Total Karma</span>
              <span class="karma-badge">{{ userProfile?.karma || 0 }} pts</span>
            </div>
          </div>
        </div>

        <!-- ── Activity ───────────────────────────── -->
        <div class="profile-card">
          <div class="card-label">
            <ion-icon :icon="trophyOutline"></ion-icon>
            Activity
          </div>
          <div class="activity-grid">
            <div class="activity-cell">
              <div class="activity-icon violet"><ion-icon :icon="documentTextOutline"></ion-icon></div>
              <strong>{{ userProfile?.postCount || 0 }}</strong>
              <span>Posts</span>
            </div>
            <div class="activity-cell">
              <div class="activity-icon amber"><ion-icon :icon="chatbubbleOutline"></ion-icon></div>
              <strong>{{ userProfile?.commentCount || 0 }}</strong>
              <span>Comments</span>
            </div>
            <div class="activity-cell">
              <div class="activity-icon gold"><ion-icon :icon="trophyOutline"></ion-icon></div>
              <strong>{{ userProfile?.karma || 0 }}</strong>
              <span>Karma</span>
            </div>
            <div class="activity-cell">
              <div class="activity-icon teal"><ion-icon :icon="peopleOutline"></ion-icon></div>
              <strong>{{ joinedCommunitiesCount }}</strong>
              <span>Communities</span>
            </div>
          </div>
        </div>

      </div>
      </DesktopPageShell>

      <input ref="avatarInput" type="file" accept="image/*" style="display:none" @change="handleAvatarSelect" />
    </ion-content>
  </ion-page>
</template>

<style scoped>
ion-header::after { display: none !important; }
ion-toolbar { --border-width: 0 !important; }

ion-content {
  --background:
    radial-gradient(ellipse at 15% 0%,   rgba(139, 92, 246, 0.35) 0%, transparent 50%),
    radial-gradient(ellipse at 88% 8%,   rgba(236, 72, 153, 0.22) 0%, transparent 45%),
    radial-gradient(ellipse at 50% 100%, rgba(99, 102, 241, 0.24) 0%, transparent 55%),
    radial-gradient(ellipse at 0%  55%,  rgba(79,  70, 229, 0.15) 0%, transparent 40%),
    #0d0e1c;
}

/* Only strip glass from the shell content area — leave sidebars intact */
:deep(.dps-main) {
  background: transparent !important;
  backdrop-filter: none !important;
  -webkit-backdrop-filter: none !important;
  box-shadow: none !important;
  border: none !important;
}

.back-btn, .settings-btn {
  display: flex; align-items: center; justify-content: center;
  width: 36px; height: 36px; background: none; border: none;
  border-radius: 50%; color: var(--app-text-muted); cursor: pointer;
  transition: color 160ms ease, background 160ms ease;
}
.back-btn svg { width: 22px; height: 22px; }
.settings-btn ion-icon { font-size: 21px; }
.back-btn { margin-left: 4px; }
.settings-btn { margin-right: 4px; }
.back-btn:hover, .settings-btn:hover { color: var(--app-text); background: rgba(255,255,255,0.06); }

/* ── Page layout ──────────────────────────── */
.profile-page {
  max-width: 640px; margin: 0 auto;
  padding: 0 16px 60px;
  display: flex; flex-direction: column; gap: 14px;
}

/* ── Hero ─────────────────────────────────── */
.profile-hero {
  display: flex; flex-direction: column; align-items: center;
  padding: 32px 20px 24px; text-align: center;
  border-radius: 20px;
  background: rgba(15, 12, 32, 0.55);
  border: 1px solid rgba(139, 92, 246, 0.18);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  margin-top: 16px;
}

/* Avatar */
.avatar-wrap {
  position: relative; width: 88px; height: 88px;
  border-radius: 50%; cursor: pointer; margin-bottom: 14px;
  flex-shrink: 0;
}
.avatar-img {
  width: 100%; height: 100%; border-radius: 50%;
  object-fit: cover;
  border: 3px solid rgba(99,102,241,0.35);
  box-shadow: 0 0 0 4px rgba(99,102,241,0.1);
}
.avatar-placeholder {
  width: 100%; height: 100%; border-radius: 50%;
  background: linear-gradient(135deg, #6366f1, #8b5cf6);
  display: flex; align-items: center; justify-content: center;
  color: rgba(255,255,255,0.6); font-size: 48px;
  border: 3px solid rgba(99,102,241,0.35);
}
.avatar-edit-ring {
  position: absolute; bottom: 2px; right: 2px;
  width: 26px; height: 26px; border-radius: 50%;
  background: linear-gradient(135deg,#6366f1,#8b5cf6);
  border: 2px solid var(--ion-background-color, #0e0f1a);
  display: flex; align-items: center; justify-content: center;
  color: #fff; font-size: 13px;
}

.profile-name {
  font-size: 22px; font-weight: 800; letter-spacing: -0.03em;
  color: var(--app-text); margin: 0 0 4px;
  background: linear-gradient(135deg, var(--app-text) 60%, rgba(167,139,250,0.85));
  -webkit-background-clip: text; background-clip: text;
  -webkit-text-fill-color: transparent;
}
.profile-username { font-size: 13px; color: var(--app-text-subtle); margin: 0 0 14px; }

/* Badges */
.badge-row { display: flex; gap: 8px; flex-wrap: wrap; justify-content: center; margin-bottom: 20px; }
.identity-pill, .anon-pill {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 4px 10px; border-radius: 999px;
  font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em;
}
.identity-pill.unverified {
  background: rgba(251,191,36,0.1); color: #fbbf24; border: 1px solid rgba(251,191,36,0.25);
}
.identity-pill.trusted-issuer {
  background: rgba(52,211,153,0.1); color: #34d399; border: 1px solid rgba(52,211,153,0.25);
}
.anon-pill.named {
  background: rgba(99,102,241,0.1); color: #818cf8; border: 1px solid rgba(99,102,241,0.22);
}
.anon-pill.anon {
  background: rgba(255,255,255,0.05); color: var(--app-text-muted); border: 1px solid rgba(255,255,255,0.09);
}
.anon-pill ion-icon { font-size: 12px; }

/* Stats strip */
.stats-strip {
  display: flex; align-items: center; gap: 0;
  background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08);
  border-radius: 14px; overflow: hidden; width: 100%;
}
.stat-item {
  flex: 1; display: flex; flex-direction: column; align-items: center;
  padding: 12px 8px; gap: 2px;
}
.stat-item strong { font-size: 18px; font-weight: 800; letter-spacing: -0.02em; color: var(--app-text); }
.stat-item span { font-size: 11px; color: var(--app-text-subtle); text-transform: uppercase; letter-spacing: 0.05em; }
.stat-divider { width: 1px; height: 32px; background: rgba(255,255,255,0.08); flex-shrink: 0; }

/* ── Cards ────────────────────────────────── */
.profile-card {
  border-radius: 18px;
  background: rgba(15, 12, 32, 0.55);
  border: 1px solid rgba(139, 92, 246, 0.15);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  padding: 18px 20px;
  display: flex; flex-direction: column; gap: 14px;
}

/* Chat link card gets a slightly more vivid tint */
.chat-link-card {
  background: rgba(99, 102, 241, 0.1);
  border-color: rgba(99, 102, 241, 0.25);
}

.card-label {
  display: flex; align-items: center; gap: 8px;
  font-size: 10.5px; font-weight: 700; text-transform: uppercase;
  letter-spacing: 0.08em; color: var(--app-text-subtle);
}
.card-label ion-icon { font-size: 14px; }
.card-sub { font-size: 13px; color: var(--app-text-muted); line-height: 1.55; margin: 0; }
.card-hint { font-size: 12px; color: var(--app-text-subtle); margin: 0; }

/* ── Fields ───────────────────────────────── */
.field-group { display: flex; flex-direction: column; gap: 6px; }
.field-label { font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: var(--app-text-subtle); }
.field-wrap { border-radius: 12px; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.09); overflow: hidden; transition: border-color 180ms, box-shadow 180ms; }
.field-wrap:focus-within { border-color: rgba(99,102,241,0.5); box-shadow: 0 0 0 3px rgba(99,102,241,0.1); }
.field-native { width: 100%; background: transparent; border: none; outline: none; padding: 12px 14px; font-size: 14px; font-family: inherit; color: var(--ion-text-color); -webkit-appearance: none; appearance: none; resize: none; }
.field-native::placeholder { color: var(--app-text-subtle); }

/* ── Toggle ───────────────────────────────── */
.toggle-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 4px 0; }
.toggle-label { font-size: 14px; font-weight: 600; color: var(--app-text); }
.toggle-sub { font-size: 12px; color: var(--app-text-muted); margin-top: 3px; line-height: 1.4; }
.toggle-switch { position: relative; width: 44px; height: 26px; flex-shrink: 0; }
.toggle-switch input { opacity: 0; width: 0; height: 0; }
.toggle-track { position: absolute; inset: 0; border-radius: 999px; background: rgba(255,255,255,0.12); border: 1px solid rgba(255,255,255,0.1); cursor: pointer; transition: background 200ms; }
.toggle-switch input:checked + .toggle-track { background: #6366f1; border-color: #6366f1; }
.toggle-track::after { content: ''; position: absolute; top: 3px; left: 3px; width: 18px; height: 18px; border-radius: 50%; background: #fff; box-shadow: 0 1px 4px rgba(0,0,0,0.3); transition: transform 200ms; }
.toggle-switch input:checked + .toggle-track::after { transform: translateX(18px); }

/* ── Save button ──────────────────────────── */
.save-btn {
  display: flex; align-items: center; justify-content: center; gap: 8px;
  padding: 13px; border-radius: 14px; border: none;
  background: linear-gradient(135deg,#6366f1,#8b5cf6); color: #fff;
  font-size: 14px; font-weight: 700; cursor: pointer;
  box-shadow: 0 6px 20px rgba(99,102,241,0.35);
  transition: opacity 160ms, transform 160ms;
}
.save-btn:hover:not(:disabled) { opacity: 0.9; transform: translateY(-1px); }
.save-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.btn-spinner { width: 16px; height: 16px; border: 2px solid rgba(255,255,255,0.3); border-top-color: #fff; border-radius: 50%; animation: spin 0.7s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

/* ── Info table ───────────────────────────── */
.info-table { display: flex; flex-direction: column; gap: 8px; }
.info-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 14px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06); border-radius: 12px; }
.info-key { font-size: 12.5px; color: var(--app-text-muted); font-weight: 600; }
.info-val-row { display: flex; align-items: center; gap: 8px; min-width: 0; }
.info-val { font-size: 11.5px; font-family: monospace; color: var(--app-text); word-break: break-all; }
.karma-badge { padding: 3px 10px; border-radius: 999px; background: rgba(99,102,241,0.12); color: #818cf8; border: 1px solid rgba(99,102,241,0.22); font-size: 12px; font-weight: 700; }
.icon-btn { width: 28px; height: 28px; border-radius: 50%; border: none; background: rgba(255,255,255,0.06); color: var(--app-text-muted); display: flex; align-items: center; justify-content: center; font-size: 14px; cursor: pointer; flex-shrink: 0; transition: background 160ms; }
.icon-btn:hover { background: rgba(255,255,255,0.12); color: var(--app-text); }

/* ── Activity grid ────────────────────────── */
.activity-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.activity-cell {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 8px; padding: 18px 12px; border-radius: 16px;
  background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.07);
  text-align: center;
}
.activity-icon { width: 40px; height: 40px; border-radius: 12px; display: flex; align-items: center; justify-content: center; font-size: 20px; color: #fff; }
.activity-icon.violet { background: linear-gradient(135deg,#6366f1,#8b5cf6); box-shadow: 0 4px 12px rgba(99,102,241,0.3); }
.activity-icon.amber  { background: linear-gradient(135deg,#f59e0b,#ef4444); box-shadow: 0 4px 12px rgba(245,158,11,0.3); }
.activity-icon.gold   { background: linear-gradient(135deg,#eab308,#f59e0b); box-shadow: 0 4px 12px rgba(234,179,8,0.3); }
.activity-icon.teal   { background: linear-gradient(135deg,#14b8a6,#3b82f6); box-shadow: 0 4px 12px rgba(20,184,166,0.3); }
.activity-cell strong { font-size: 22px; font-weight: 800; letter-spacing: -0.03em; color: var(--app-text); }
.activity-cell span { font-size: 11.5px; color: var(--app-text-muted); text-transform: uppercase; letter-spacing: 0.05em; }

/* ── Chat link ────────────────────────────── */
.chat-link-box { display: flex; align-items: center; gap: 10px; padding: 12px 14px; border-radius: 12px; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.09); }
.link-icon { width: 18px; height: 18px; color: #818cf8; flex-shrink: 0; }
.link-text { font-size: 13px; font-family: monospace; color: var(--app-text-muted); word-break: break-all; }
.link-actions { display: flex; gap: 8px; }
.pill-btn { display: inline-flex; align-items: center; gap: 6px; padding: 9px 18px; border-radius: 999px; border: none; font-size: 13.5px; font-weight: 700; cursor: pointer; transition: opacity 160ms, transform 160ms; }
.pill-btn.accent { background: linear-gradient(135deg,#6366f1,#8b5cf6); color: #fff; box-shadow: 0 4px 14px rgba(99,102,241,0.38); }
.pill-btn.outline { background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); color: var(--app-text-muted); }
.pill-btn:hover { opacity: 0.88; transform: translateY(-1px); }

@media (max-width: 480px) {
  .profile-name { font-size: 19px; }
  .stats-strip { flex-wrap: wrap; }
  .activity-grid { grid-template-columns: 1fr 1fr; }
}
</style>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import DesktopPageShell from '../components/DesktopPageShell.vue';
import {
  IonPage, IonHeader, IonToolbar, IonTitle, IonContent,
  IonButtons, IonIcon, IonSpinner,
  toastController
} from '@ionic/vue';
import {
  personCircleOutline, settingsOutline, saveOutline, copyOutline,
  documentTextOutline, chatbubbleOutline, trophyOutline, peopleOutline,
  cameraOutline, eyeOutline, eyeOffOutline
} from 'ionicons/icons';
import { UserService } from '../services/userService';
import type { UserProfile } from '../services/userService';
import { VoteTrackerService } from '../services/voteTrackerService';
import { IPFSService } from '../services/ipfsService';
import { useCommunityStore } from '../stores/communityStore';
import { formatTrustedIdentityLabel } from '../utils/identityTrust';
import config from '../config';

const communityStore = useCommunityStore();
const router = useRouter();

// ── Chat link ────────────────────────────────────────────────────────────────
const chatLink = computed(() => {
  const id = userProfile.value?.id;
  if (!id) return '';
  const name = encodeURIComponent(
    userProfile.value?.customUsername ||
    userProfile.value?.displayName ||
    userProfile.value?.username ||
    'User'
  );
  const base = ((config as any)?.app?.url || window.location.origin).replace(/\/$/, '');
  return `${base}/chat/${encodeURIComponent(id)}?name=${name}`;
});
const chatLinkDisplay = computed(() => {
  if (!chatLink.value) return 'Loading…';
  try { const u = new URL(chatLink.value); return u.host + u.pathname; } catch { return chatLink.value; }
});
const canShare = computed(() => !!navigator.share);
async function copyChatLink() {
  if (!chatLink.value) return;
  try {
    await navigator.clipboard.writeText(chatLink.value);
    const t = await toastController.create({ message: 'Chat link copied!', duration: 2000, color: 'success' });
    await t.present();
  } catch {
    const t = await toastController.create({ message: 'Copy failed', duration: 3000, color: 'warning' });
    await t.present();
  }
}
async function shareChatLink() {
  if (!chatLink.value || !navigator.share) return;
  const name = userProfile.value?.customUsername || userProfile.value?.displayName || 'me';
  try { await navigator.share({ title: `Chat with ${name} on Interpoll`, url: chatLink.value }); } catch { /* cancelled */ }
}

const userProfile = ref<UserProfile | null>(null);
const displayName = ref('');
const customUsername = ref('');
const bio = ref('');
const showRealName = ref(false);
const deviceId = ref('');
const isSaving = ref(false);
const avatarPreview = ref<string | null>(null);
const avatarFile = ref<File | null>(null);
const avatarInput = ref<HTMLInputElement | null>(null);

const joinedCommunitiesCount = computed(() => communityStore.joinedCommunities?.size || 0);
const identityTrust = computed(() => ({
  trustLevel: userProfile.value?.identityTrustLevel === 'trusted-issuer' ? 'trusted-issuer' : 'unverified',
  issuer: userProfile.value?.identityIssuer || '',
}));
const identityBadgeLabel = computed(() =>
  identityTrust.value.trustLevel === 'trusted-issuer'
    ? formatTrustedIdentityLabel({
      username: userProfile.value?.customUsername || userProfile.value?.username,
      issuer: identityTrust.value.issuer,
    })
    : 'Unverified identity'
);
const identityBadgeClass = computed(() =>
  identityTrust.value.trustLevel === 'trusted-issuer' ? 'trusted-issuer' : 'unverified'
);

function formatDate(timestamp?: number): string {
  if (!timestamp) return 'Unknown';
  return new Date(timestamp).toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric'
  });
}

function selectAvatar() {
  avatarInput.value?.click();
}

async function handleAvatarSelect(event: Event) {
  const target = event.target as HTMLInputElement;
  const file = target.files?.[0];
  if (!file) return;

  if (file.size > 10 * 1024 * 1024) {
    const toast = await toastController.create({ message: 'Image too large (max 10 MB)', duration: 3000 });
    await toast.present();
    return;
  }

  avatarFile.value = file;
  const reader = new FileReader();
  reader.onload = (e) => { avatarPreview.value = e.target?.result as string; };
  reader.onerror = async () => {
    avatarFile.value = null;
    const toast = await toastController.create({ message: 'Failed to read image', duration: 3000 });
    await toast.present();
  };
  reader.readAsDataURL(file);
  // Reset input so same file can be re-selected
  target.value = '';
}

async function loadProfile() {
  try {
    userProfile.value = await UserService.getCurrentUser(true);
    displayName.value = userProfile.value.displayName || userProfile.value.username;
    customUsername.value = userProfile.value.customUsername || '';
    bio.value = userProfile.value.bio || '';
    showRealName.value = userProfile.value.showRealName || false;
    deviceId.value = await VoteTrackerService.getDeviceId();
  } catch (error) {
    console.error('Error loading profile:', error);
  }
}

async function saveProfile() {
  try {
    if (!userProfile.value) return;
    isSaving.value = true;

    const updates: Partial<UserProfile> = {
      displayName: displayName.value,
      customUsername: customUsername.value.trim() || undefined,
      bio: bio.value,
      showRealName: showRealName.value,
    };

    // Upload avatar if changed
    if (avatarFile.value) {
      const result = await IPFSService.uploadImage(avatarFile.value);
      updates.avatarIPFS = result.cid;
      updates.avatarThumbnail = result.thumbnail;
    }

    await UserService.updateProfile(updates);
    avatarFile.value = null;
    avatarPreview.value = null;
    const toast = await toastController.create({ message: 'Profile updated', duration: 2000 });
    await toast.present();
    await loadProfile();
  } catch {
    const toast = await toastController.create({ message: 'Failed to update profile', duration: 2000 });
    await toast.present();
  } finally {
    isSaving.value = false;
  }
}

async function copyDeviceId() {
  try {
    await navigator.clipboard.writeText(deviceId.value);
    const toast = await toastController.create({ message: 'Device ID copied', duration: 1500 });
    await toast.present();
  } catch {
    const toast = await toastController.create({ message: 'Could not copy — please copy manually', duration: 2000 });
    await toast.present();
  }
}

onMounted(async () => {
  await loadProfile();
});
</script>