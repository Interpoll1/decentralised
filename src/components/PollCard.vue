<template>
  <ion-card @click="$emit('click')" class="cursor-pointer hover:shadow-lg transition-shadow">
    <ion-card-header>
      <div class="flex justify-between items-start">
        <ion-card-title class="text-lg">{{ poll.title }}</ion-card-title>
        <ion-badge v-if="hasVoted" color="success">
          <ion-icon :icon="checkmarkCircle" class="mr-1"></ion-icon>
          Voted
        </ion-badge>
      </div>
      <ion-card-subtitle>{{ poll.description }}</ion-card-subtitle>
    </ion-card-header>

    <ion-card-content>
      <div class="flex flex-wrap gap-2 mb-3">
        <ion-chip 
          v-for="option in poll.options.slice(0, 3)" 
          :key="option"
          size="small"
        >
          {{ option }}
        </ion-chip>
        <ion-chip v-if="poll.options.length > 3" size="small">
          +{{ poll.options.length - 3 }} more
        </ion-chip>
      </div>

      <div class="flex justify-between items-center">
        <span class="text-xs text-gray-500">
          Created {{ formatDate(poll.createdAt) }}
        </span>
        
        <ion-button 
          v-if="!hasVoted"
          size="small" 
          @click.stop="$emit('vote')"
        >
          Vote Now
        </ion-button>
        <ion-button 
          v-else
          size="small"
          fill="outline"
          color="success"
          @click.stop="viewResults"
        >
          View Results
        </ion-button>
      </div>
    </ion-card-content>
  </ion-card>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import {
  IonCard,
  IonCardHeader,
  IonCardTitle,
  IonCardSubtitle,
  IonCardContent,
  IonButton,
  IonChip,
  IonBadge,
  IonIcon
} from '@ionic/vue';
import { checkmarkCircle } from 'ionicons/icons';
import { Poll } from '../types/chain';
import { VoteTrackerService } from '../services/voteTrackerService';

interface Props {
  poll: Poll;
}

const props = defineProps<Props>();
defineEmits(['vote', 'click']);

const router = useRouter();
const hasVoted = ref(false);

onMounted(async () => {
  hasVoted.value = await VoteTrackerService.hasVoted(props.poll.id);
});

const formatDate = (timestamp: number) => {
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  return date.toLocaleDateString();
};

const viewResults = () => {
  router.push(`/results/${props.poll.id}`);
};
</script>