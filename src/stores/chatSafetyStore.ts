// src/stores/chatSafetyStore.ts
import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { ChatSafetyService, type ChatSafetyState, type ReportInput, type DmPolicy } from '../services/chatSafetyService';

export const useChatSafetyStore = defineStore('chatSafety', () => {
  const blocked = ref<string[]>([]);
  const muted = ref<string[]>([]);
  const dmPolicy = ref<DmPolicy>('everyone');

  const isBlocked = computed(() => (userId: string) => blocked.value.includes(userId));
  const isMuted = computed(() => (userId: string) => muted.value.includes(userId));
  const blockedCount = computed(() => blocked.value.length);

  function syncState(state: ChatSafetyState): void {
    blocked.value = [...state.blocked];
    muted.value = [...state.muted];
  }

  async function init(): Promise<void> {
    try {
      const state = await ChatSafetyService.load();
      syncState(state);
      dmPolicy.value = ChatSafetyService.getDmPolicy();
    } catch {
      blocked.value = [];
      muted.value = [];
      dmPolicy.value = 'everyone';
    }
  }

  async function block(userId: string): Promise<void> {
    try {
      const state = await ChatSafetyService.block(userId);
      syncState(state);
    } catch {
      // Degrade to local add
      if (!blocked.value.includes(userId)) {
        blocked.value.push(userId);
      }
    }
  }

  async function unblock(userId: string): Promise<void> {
    try {
      const state = await ChatSafetyService.unblock(userId);
      syncState(state);
    } catch {
      // Degrade to local remove
      const idx = blocked.value.indexOf(userId);
      if (idx !== -1) {
        blocked.value.splice(idx, 1);
      }
    }
  }

  async function mute(userId: string): Promise<void> {
    try {
      const state = await ChatSafetyService.mute(userId);
      syncState(state);
    } catch {
      // Degrade to local add
      if (!muted.value.includes(userId)) {
        muted.value.push(userId);
      }
    }
  }

  async function unmute(userId: string): Promise<void> {
    try {
      const state = await ChatSafetyService.unmute(userId);
      syncState(state);
    } catch {
      // Degrade to local remove
      const idx = muted.value.indexOf(userId);
      if (idx !== -1) {
        muted.value.splice(idx, 1);
      }
    }
  }

  async function report(input: ReportInput): Promise<{ ok: boolean; message: string }> {
    return ChatSafetyService.report(input);
  }

  async function blockAndReport(input: ReportInput): Promise<{ ok: boolean; message: string }> {
    return ChatSafetyService.blockAndReport(input);
  }

  function setDmPolicy(policy: DmPolicy): void {
    dmPolicy.value = policy;
    ChatSafetyService.setDmPolicy(policy);
  }

  return {
    blocked,
    muted,
    dmPolicy,
    isBlocked,
    isMuted,
    blockedCount,
    init,
    block,
    unblock,
    mute,
    unmute,
    report,
    blockAndReport,
    setDmPolicy,
  };
});
