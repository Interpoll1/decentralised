// src/stores/userStore.ts
import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { UserProfile } from '../services/userService';
import { UserService } from '../services/userService';
import { ModerationService } from '../services/moderationService';

export const useUserStore = defineStore('user', () => {
  const profiles = ref<Record<string, UserProfile>>({});
  const profileRequests = new Map<string, Promise<UserProfile | null>>();

  async function getProfile(userId: string): Promise<UserProfile | null> {
    if (profiles.value[userId]) return profiles.value[userId];
    const inFlight = profileRequests.get(userId);
    if (inFlight) return inFlight;

    const request = UserService.getUser(userId).then(async (profile) => {
      if (!profile) return profile;
      // Karma is derived from signed votes; only pay the extra vote queries when
      // karma-based hiding is actually enabled (off by default → the feed stays fast).
      const withKarma = ModerationService.getSettings().minUserKarma > -1000
        ? { ...profile, karma: await UserService.getKarma(userId) }
        : profile;
      profiles.value[userId] = withKarma;
      return withKarma;
    }).finally(() => {
      profileRequests.delete(userId);
    });
    profileRequests.set(userId, request);
    return request;
  }

  function getCachedKarma(userId: string): number | null {
    return profiles.value[userId]?.karma ?? null;
  }

  return {
    profiles,
    getProfile,
    getCachedKarma,
  };
});
