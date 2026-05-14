// src/stores/userStore.ts
import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { UserProfile } from '../services/userService';
import { UserService } from '../services/userService';

export const useUserStore = defineStore('user', () => {
  const profiles = ref<Record<string, UserProfile>>({});
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
    profiles,
    getProfile,
    getCachedKarma,
  };
});
