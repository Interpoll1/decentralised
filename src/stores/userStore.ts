// src/stores/userStore.ts
import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type { UserProfile } from '../services/userService';
import { UserService } from '../services/userService';

export const useUserStore = defineStore('user', () => {
  const profiles = ref<Record<string, UserProfile>>({});
  const currentUser = ref<UserProfile | null>(null);
  const isAuthenticated = computed(() => Boolean(currentUser.value?.publicKey));
  async function loadCurrentUser(): Promise<void> {
    currentUser.value = await UserService.getCurrentUser();
    profiles.value[currentUser.value.id] = currentUser.value;
  }
  const profileRequests = new Map<string, Promise<UserProfile | null>>();

  async function getProfile(userId: string): Promise<UserProfile | null> {
    if (profiles.value[userId]) return profiles.value[userId];
    const inFlight = profileRequests.get(userId);
    if (inFlight) return inFlight;

    const request = UserService.getUser(userId).then((profile) => {
      if (profile) {
        profiles.value[userId] = profile;
      }
      return profile;
    }).finally(() => {
      profileRequests.delete(userId);
    });
    profileRequests.set(userId, request);
    return request;
  }

  function getCachedKarma(userId: string): number | null {
    const p = profiles.value[userId];
    return p ? p.karma : null;
  }

  return {
    currentUser,
    isAuthenticated,
    loadCurrentUser,
    profiles,
    getProfile,
    getCachedKarma,
  };
});
