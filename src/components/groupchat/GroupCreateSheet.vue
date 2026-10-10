<template>
  <ion-modal :is-open="open" :initial-breakpoint="1" :breakpoints="[0, 1]" class="gcs-modal" @didDismiss="close">
    <div class="gcs">
      <!-- Step 1: name the group -->
      <form v-if="!created" class="gcs__body" @submit.prevent="create">
        <div class="gcs__top">
          <ChatAvatar :name="name || 'New group'" :seed="name || 'new'" group size="xl" />
          <h2 class="gcs__title">New group</h2>
        </div>

        <label class="gcs__label" for="gcs-name">Group name</label>
        <input id="gcs-name" ref="nameEl" v-model="name" data-test="group-name" class="gcs__input" maxlength="60" placeholder="e.g. Weekend hike" autocomplete="off" />

        <label class="gcs__label" for="gcs-desc">Description <span class="gcs__opt">(optional)</span></label>
        <textarea id="gcs-desc" v-model="description" class="gcs__input gcs__input--area" maxlength="200" rows="2" placeholder="What's this group for?"></textarea>

        <div class="gcs__choice" role="radiogroup" aria-label="Who can join">
          <button type="button" class="gcs__opt-card" :class="{ on: !usePassword }" role="radio" :aria-checked="!usePassword" @click="usePassword = false">
            <span class="gcs__opt-title">You approve each person</span>
            <span class="gcs__opt-sub">People with the link ask to join; you accept them.</span>
          </button>
          <button type="button" data-test="group-password-toggle" class="gcs__opt-card" :class="{ on: usePassword }" role="radio" :aria-checked="usePassword" @click="usePassword = true; focusPassword()">
            <span class="gcs__opt-title">Password</span>
            <span class="gcs__opt-sub">Anyone with the link and password joins right away.</span>
          </button>
        </div>
        <input v-if="usePassword" ref="passEl" v-model="password" data-test="group-password" class="gcs__input" type="password" placeholder="Choose a password" autocomplete="new-password" />

        <p v-if="error" class="gcs__error">{{ error }}</p>

        <div class="gcs__actions">
          <button type="button" class="gcs__btn gcs__btn--ghost" @click="close">Cancel</button>
          <button type="submit" data-test="group-create" class="gcs__btn gcs__btn--primary" :disabled="!canCreate || busy">
            {{ busy ? 'Creating…' : 'Create group' }}
          </button>
        </div>
      </form>

      <!-- Step 2: invite people -->
      <div v-else class="gcs__body">
        <div class="gcs__top">
          <ChatAvatar :name="created.name" :seed="created.id" group size="xl" />
          <h2 class="gcs__title">{{ created.name }} is ready</h2>
          <p class="gcs__lead">
            Send this link to the people you want in the group.
            <template v-if="usePassword">Share the password separately.</template>
            <template v-else>You'll approve each request from the group's info screen.</template>
          </p>
        </div>
        <div class="gcs__link">
          <input data-test="invite-link" class="gcs__link-input" :value="created.link" readonly @focus="($event.target as HTMLInputElement).select()" />
          <button class="gcs__btn gcs__btn--small" @click="copy">{{ copied ? 'Copied' : 'Copy' }}</button>
        </div>
        <div class="gcs__actions">
          <button v-if="canShare" class="gcs__btn gcs__btn--ghost" @click="share">Share…</button>
          <button data-test="invite-done" class="gcs__btn gcs__btn--primary" @click="openGroup">Open group</button>
        </div>
      </div>
    </div>
  </ion-modal>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue';
import { useRouter } from 'vue-router';
import { IonModal } from '@ionic/vue';
import ChatAvatar from './ChatAvatar.vue';
import { useChatRoomStore } from '@/stores/chatRoomStore';
import { UserService } from '@/services/userService';

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ (e: 'close'): void }>();
const router = useRouter();
const store = useChatRoomStore();

const name = ref('');
const description = ref('');
const usePassword = ref(false);
const password = ref('');
const busy = ref(false);
const error = ref('');
const copied = ref(false);
const created = ref<{ id: string; name: string; link: string } | null>(null);
const nameEl = ref<HTMLInputElement | null>(null);
const passEl = ref<HTMLInputElement | null>(null);
const canShare = typeof navigator !== 'undefined' && 'share' in navigator;
const canCreate = computed(() => !!name.value.trim() && (!usePassword.value || password.value.length >= 4));

watch(() => props.open, (o) => {
  if (!o) return;
  name.value = ''; description.value = ''; usePassword.value = false; password.value = '';
  error.value = ''; created.value = null; copied.value = false;
  setTimeout(() => nameEl.value?.focus(), 350);
});
function focusPassword() { void nextTick(() => passEl.value?.focus()); }

async function create() {
  if (!canCreate.value || busy.value) return;
  busy.value = true; error.value = '';
  try {
    const user = await UserService.getCurrentUser();
    const result = await store.createRoom(name.value.trim(), description.value.trim(), user.id, usePassword.value ? password.value : undefined);
    created.value = { id: result.room.id, name: result.room.name, link: result.inviteLink };
  } catch (err: any) {
    error.value = err?.message?.includes('pending') || err?.message?.includes('transport')
      ? 'Couldn\'t reach the relay. Check your connection and try again.'
      : (err?.message || 'Couldn\'t create the group.');
  } finally { busy.value = false; }
}
async function copy() {
  if (!created.value) return;
  await navigator.clipboard.writeText(created.value.link).catch(() => {});
  copied.value = true;
  setTimeout(() => { copied.value = false; }, 1600);
}
async function share() {
  if (!created.value) return;
  await navigator.share({ title: created.value.name, text: `Join "${created.value.name}" on InterPoll`, url: created.value.link }).catch(() => {});
}
function openGroup() {
  const id = created.value?.id;
  close();
  if (id) void router.push(`/chatroom/${encodeURIComponent(id)}`);
}
function close() { emit('close'); }
</script>

<style scoped>
.gcs-modal { --height: auto; --max-width: 460px; --border-radius: 20px; }
.gcs { background: var(--app-bg-elevated); color: var(--app-text); }
.gcs__body { display: flex; flex-direction: column; padding: 22px 20px calc(20px + env(safe-area-inset-bottom)); max-height: 90vh; overflow-y: auto; }
.gcs__top { display: flex; flex-direction: column; align-items: center; gap: 10px; margin-bottom: 14px; text-align: center; }
.gcs__title { margin: 0; font-size: 20px; font-weight: 700; letter-spacing: -0.015em; }
.gcs__lead { margin: 0; font-size: 14px; line-height: 1.5; color: var(--app-text-muted); max-width: 36ch; }
.gcs__label { font-size: 13px; font-weight: 600; color: var(--app-text-muted); margin: 12px 2px 6px; }
.gcs__opt { font-weight: 400; color: var(--app-text-subtle); }
.gcs__input {
  width: 100%; padding: 12px 14px; border-radius: 12px; border: 1px solid var(--app-border-strong, var(--app-border));
  background: var(--app-bg-base); color: var(--app-text); font: inherit; font-size: 15px; outline: none;
}
.gcs__input:focus { border-color: var(--app-accent); box-shadow: var(--app-focus-ring); }
.gcs__input--area { resize: none; }
.gcs__choice { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin: 16px 0 8px; }
.gcs__opt-card {
  display: flex; flex-direction: column; gap: 4px; text-align: left; padding: 12px; border-radius: 12px; cursor: pointer;
  border: 1.5px solid var(--app-border-strong, var(--app-border)); background: transparent; color: var(--app-text); font: inherit;
}
.gcs__opt-card.on { border-color: var(--app-accent); background: rgba(var(--app-accent-rgb), 0.1); }
.gcs__opt-card:focus-visible { outline: none; box-shadow: var(--app-focus-ring); }
.gcs__opt-title { font-size: 14px; font-weight: 650; }
.gcs__opt-sub { font-size: 12.5px; line-height: 1.4; color: var(--app-text-muted); }
.gcs__error { margin: 10px 2px 0; font-size: 13px; color: var(--app-danger); }
.gcs__actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 20px; }
.gcs__btn { border: none; border-radius: 999px; padding: 11px 20px; font: inherit; font-size: 14.5px; font-weight: 650; cursor: pointer; }
.gcs__btn:focus-visible { outline: none; box-shadow: var(--app-focus-ring); }
.gcs__btn--primary { background: var(--app-accent); color: #fff; }
.gcs__btn--primary:disabled { opacity: 0.45; cursor: not-allowed; }
.gcs__btn--ghost { background: transparent; color: var(--app-text-muted); }
.gcs__btn--ghost:hover { color: var(--app-text); }
.gcs__btn--small { padding: 8px 14px; font-size: 13.5px; background: rgba(var(--app-accent-rgb), 0.14); color: var(--app-accent-bright); }
.gcs__link { display: flex; gap: 8px; align-items: center; padding: 6px 6px 6px 12px; border-radius: 12px; border: 1px solid var(--app-border-strong, var(--app-border)); background: var(--app-bg-base); }
.gcs__link-input { flex: 1; min-width: 0; border: none; background: transparent; color: var(--app-text); font: inherit; font-size: 13.5px; outline: none; text-overflow: ellipsis; }
@media (max-width: 380px) { .gcs__choice { grid-template-columns: 1fr; } }
</style>
