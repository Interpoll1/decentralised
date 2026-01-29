// src/stores/userStore.ts
import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { UserProfile } from '../services/userService';
import { UserService } from '../services/userService';

export const useUserStore = defineStore('user', () => {
  const profiles = ref<Record<string, UserProfile>>({});

  async function getProfile(userId: string): Promise<UserProfile | null> {
    if (profiles.value[userId]) return profiles.value[userId];

    const profile = await UserService.getUser(userId);
    if (profile) {
      profiles.value[userId] = profile;
    }
    return profile;
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
