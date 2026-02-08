<template>
  <ion-card class="poll-card" @click="$emit('click')">
    <ion-card-content>
      <!-- Poll Header -->
      <div class="poll-header">
        <div class="poll-badge">
          <ion-icon :icon="statsChartOutline"></ion-icon>
          <span>Poll</span>
        </div>
        <div class="poll-meta">
          <span class="author">u/{{ poll.authorName || 'Unknown' }}</span>
          <span class="separator">•</span>
          <span class="timestamp">{{ formatTime(poll.createdAt) }}</span>
          <span v-if="poll.isExpired" class="expired-badge">Ended</span>
        </div>
      </div>

      <!-- Poll Question -->
      <h3 class="poll-question">{{ poll.question || 'Untitled Poll' }}</h3>

      <!-- Poll Description -->
      <p v-if="poll.description" class="poll-description">{{ poll.description }}</p>

      <!-- Poll Options Preview -->
      <div v-if="poll.options && poll.options.length > 0" class="poll-options-preview">
        <div 
          v-for="(option, index) in poll.options.slice(0, 3)" 
          :key="option.id || index"
          class="option-preview"
        >
          <div class="option-bar">
            <div 
              class="option-fill" 
              :style="{ width: `${getOptionPercent(option)}%` }"
            ></div>
          </div>
          <div class="option-info">
            <span class="option-text">{{ option.text || `Option ${index + 1}` }}</span>
            <span class="option-votes">{{ option.votes || 0 }} votes</span>
          </div>
        </div>
        <div v-if="poll.options.length > 3" class="more-options">
          +{{ poll.options.length - 3 }} more option{{ poll.options.length - 3 !== 1 ? 's' : '' }}
        </div>
      </div>

      <!-- No options message -->
      <div v-else class="no-options">
        <p>No poll options available</p>
      </div>

      <!-- Poll Footer -->
      <div class="poll-footer">
        <div class="poll-stats">
          <div class="stat-item">
            <ion-icon :icon="peopleOutline"></ion-icon>
            <span>{{ poll.totalVotes || 0 }} vote{{ (poll.totalVotes || 0) !== 1 ? 's' : '' }}</span>
          </div>
          
          <div class="stat-item">
            <ion-icon :icon="timeOutline"></ion-icon>
            <span>{{ getTimeRemaining() }}</span>
          </div>

          <div v-if="poll.allowMultipleChoices" class="stat-item">
            <ion-icon :icon="checkmarkDoneOutline"></ion-icon>
            <span>Multiple choice</span>
          </div>
        </div>

        <ion-button fill="clear" size="small" @click.stop="$emit('vote')">
          Vote Now
          <ion-icon slot="end" :icon="chevronForwardOutline"></ion-icon>
        </ion-button>
      </div>
    </ion-card-content>
  </ion-card>
</template>

<script setup lang="ts">
import { IonCard, IonCardContent, IonIcon, IonButton } from '@ionic/vue';
import { 
  statsChartOutline,
  peopleOutline,
  timeOutline,
  checkmarkDoneOutline,
  chevronForwardOutline
} from 'ionicons/icons';
import { Poll } from '../services/pollService';

const props = defineProps<{ poll: Poll }>();
defineEmits(['click', 'vote']);

function formatTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  
  return new Date(timestamp).toLocaleDateString();
}

function getOptionPercent(option: { votes: number }): number {
  if (props.poll.totalVotes === 0) return 0;
  return (option.votes / props.poll.totalVotes) * 100;
}

function getTimeRemaining(): string {
  if (props.poll.isExpired) {
    return 'Ended';
  }
  
  const now = Date.now();
  const remaining = props.poll.expiresAt - now;
  
  const days = Math.floor(remaining / 86400000);
  const hours = Math.floor((remaining % 86400000) / 3600000);
  
  if (days > 0) {
    return `${days}d left`;
  } else if (hours > 0) {
    return `${hours}h left`;
  } else {
    return 'Ending soon';
  }
}
</script>

<style scoped>
.poll-card {
  margin: 12px 12px;
  cursor: pointer;
  transition: transform 0.2s, box-shadow 0.2s;
  border-left: 4px solid var(--ion-color-tertiary);
}

.poll-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
}

.poll-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.poll-badge {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;

  color: var(--ion-color-tertiary);
  border-radius: 4px;
  font-size: 12px;
  font-weight: 600;
}

.poll-badge ion-icon {
  font-size: 14px;
}

.poll-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--ion-color-medium);
}

.separator {
  color: var(--ion-color-medium-shade);
}

.author {
  color: var(--ion-color-step-600);
  font-weight: 500;
}

.expired-badge {
  padding: 2px 6px;
  background: var(--ion-color-medium);
  color: white;
  border-radius: 4px;
  font-size: 10px;
  font-weight: 600;
}

.poll-question {
  margin: 0 0 8px 0;
  font-size: 18px;
  font-weight: 600;
  line-height: 1.4;
  color: var(--ion-text-color);
}

.poll-description {
  margin: 0 0 16px 0;
  font-size: 14px;
  line-height: 1.5;
  color: var(--ion-color-step-600);
}

.poll-options-preview {
  margin: 16px 0;
}

.option-preview {
  margin-bottom: 12px;
}

.option-bar {
  height: 8px;
  background: var(--ion-color-light);
  border-radius: 4px;
  overflow: hidden;
  margin-bottom: 4px;
}

.option-fill {
  height: 100%;
  background: var(--ion-color-tertiary);
  transition: width 0.3s;
}

.option-info {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 13px;
}

.option-text {
  color: var(--ion-text-color);
  font-weight: 500;
}

.option-votes {
  color: var(--ion-color-medium);
  font-size: 12px;
}

.more-options {
  text-align: center;
  font-size: 13px;
  color: var(--ion-color-medium);
  margin-top: 8px;
}

.no-options {
  padding: 16px;
  text-align: center;
  color: var(--ion-color-medium);
  background: var(--ion-color-light);
  border-radius: 8px;
  margin: 12px 0;
}

.poll-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-top: 1px solid var(--ion-color-light);
  padding-top: 12px;
  margin-top: 12px;
}

.poll-stats {
  display: flex;
  align-items: center;
  gap: 12px;
}

.stat-item {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: var(--ion-color-medium);
}

.stat-item ion-icon {
  font-size: 14px;
}

@media (max-width: 576px) {
  .poll-question {
    font-size: 16px;
  }
  
  .poll-description {
    font-size: 13px;
  }
  
  .poll-stats {
    gap: 8px;
    flex-wrap: wrap;
  }
}
</style>