<template>
  <div class="community-card" @click="$emit('click')">
    <div class="card-header">
      <div class="community-icon">
        <ion-icon :icon="peopleOutline"></ion-icon>
      </div>
      
      <div class="community-details">
        <h3>{{ community.displayName || community.name }}</h3>
        <p class="community-id">{{ community.id }}</p>
        <p v-if="truncatedDescription" class="description">{{ truncatedDescription }}</p>
        
        <div class="card-footer">
          <div class="stats">
            <span>
              <ion-icon :icon="peopleOutline"></ion-icon>
              {{ formatNumber(community.memberCount ?? 1) }}
            </span>
            <span>
              <ion-icon :icon="documentTextOutline"></ion-icon>
              {{ formatNumber(community.postCount ?? 0) }}
            </span>
          </div>
          
          <ion-badge :color="isJoined ? 'success' : 'medium'">
            {{ isJoined ? 'Joined' : 'Not joined' }}
          </ion-badge>
        </div>
      </div>
    </div>

    <div class="separator"></div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { IonIcon, IonBadge } from '@ionic/vue';
import { peopleOutline, documentTextOutline } from 'ionicons/icons';
import { Community } from '../services/communityService';
import { useCommunityStore } from '../stores/communityStore';

const props = defineProps<{ community: Community }>();
defineEmits(['click']);

const communityStore = useCommunityStore();

const isJoined = computed(() => communityStore.isJoined(props.community.id));

const truncatedDescription = computed(() => {
  const desc = props.community.description || '';
  if (!desc) return '';
  if (desc.length <= 80) return desc;
  return desc.substring(0, 80) + '...';
});

const formatNumber = (num: number | undefined | null): string => {
  const n = num ?? 0;
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return n.toString();
};
</script>

<style scoped>
.community-card {
  cursor: pointer;
  padding: 12px 16px;
  background: transparent;
}

.card-header {
  display: flex;
  gap: 12px;
}

.community-icon {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: rgba(var(--ion-color-primary-rgb), 0.08);
  border: 1px solid rgba(var(--ion-text-color-rgb), 0.08);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  overflow: hidden;
}

.community-icon img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.community-icon ion-icon {
  font-size: 24px;
  color: var(--ion-color-primary);
}

.community-details {
  flex: 1;
  min-width: 0;
}

.community-details h3 {
  margin: 0 0 2px 0;
  font-size: 16px;
  font-weight: 600;
  color: var(--ion-text-color);
}

.community-id {
  color: var(--ion-color-medium);
  font-size: 11px;
  margin: 0 0 4px 0;
}

.description {
  font-size: 13px;
  line-height: 1.3;
  color: var(--ion-color-step-600);
  margin: 0 0 8px 0;
}

.card-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.stats {
  display: flex;
  gap: 12px;
  font-size: 11px;
  color: var(--ion-color-medium);
}

.stats span {
  display: flex;
  align-items: center;
  gap: 3px;
}

.stats ion-icon {
  font-size: 14px;
}

.separator {
  height: 1px;
  background: rgba(var(--ion-text-color-rgb), 0.08);
  margin-top: 12px;
}
</style>