<template>
  <ion-card class="community-card" @click="$emit('click')">
    <ion-card-content>
      <div class="card-header">
        <div class="community-icon">
          <img 
            v-if="community.imageThumbnail" 
            :src="community.imageThumbnail" 
            alt="Community icon"
          />
          <ion-icon v-else :icon="peopleOutline" size="large"></ion-icon>
        </div>
        
        <div class="community-details">
          <h3>{{ community.displayName || community.name }}</h3>
          <p class="community-id">{{ community.id }}</p>
          <p class="description">{{ truncatedDescription }}</p>
        </div>
      </div>
      <div class="card-footer">
        <div class="stats">
          <span>
            <ion-icon :icon="peopleOutline"></ion-icon>
            {{ formatNumber(community.memberCount ?? 1) }} members
          </span>
          <span>
            <ion-icon :icon="documentTextOutline"></ion-icon>
            {{ formatNumber(community.postCount ?? 0) }} posts
          </span>
        </div>
        
        <ion-badge :color="isJoined ? 'success' : 'medium'">
          {{ isJoined ? 'Joined' : 'Not joined' }}
        </ion-badge>
      </div>
    </ion-card-content>
  </ion-card>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { IonCard, IonCardContent, IonIcon, IonBadge } from '@ionic/vue';
import { peopleOutline, documentTextOutline } from 'ionicons/icons';
import { Community } from '../services/communityService';
import { useCommunityStore } from '../stores/communityStore';

const props = defineProps<{ community: Community }>();
defineEmits(['click']);

const communityStore = useCommunityStore();

const isJoined = computed(() => communityStore.isJoined(props.community.id));

const truncatedDescription = computed(() => {
  const desc = props.community.description || '';
  if (desc.length <= 100) {
    return desc;
  }
  return desc.substring(0, 100) + '...';
});

const formatNumber = (num: number | undefined | null): string => {
  // Handle undefined/null cases
  const n = num ?? 0;
  
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return n.toString();
};
</script>

<style scoped>
.community-card {
  cursor: pointer;
  transition: transform 0.3s ease, box-shadow 0.3s ease;
  border-radius: 16px;
}

.community-card:hover {
  transform: translateY(-3px);
}

.card-header {
  display: flex;
  gap: 16px;
  margin-bottom: 16px;
}

.community-icon {
  width: 64px;
  height: 64px;
  border-radius: 50%;
  background: rgba(var(--ion-card-background-rgb), 0.4);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  border: 1px solid var(--glass-border);
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
  font-size: 32px;
  color: var(--ion-color-medium);
}

.community-details {
  flex: 1;
}

.community-details h3 {
  margin: 0 0 4px 0;
  font-size: 18px;
  font-weight: 600;
}

.community-id {
  color: var(--ion-color-medium);
  font-size: 12px;
  margin: 0 0 8px 0;
}

.description {
  font-size: 14px;
  line-height: 1.4;
  color: var(--ion-color-step-600);
  margin: 0;
}

.card-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding-top: 12px;
  border-top: 1px solid rgba(var(--ion-text-color-rgb), 0.06);
}

.stats {
  display: flex;
  gap: 16px;
  font-size: 12px;
  color: var(--ion-color-medium);
}

.stats span {
  display: flex;
  align-items: center;
  gap: 4px;
}

.stats ion-icon {
  font-size: 16px;
}
</style>