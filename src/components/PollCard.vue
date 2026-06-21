<template>
  <article class="poll-card">
    <div v-if="flagged && filterAction === 'blur' && !revealed" class="flagged-overlay" @click.stop="revealed = true">
      <ion-icon :icon="warningOutline"></ion-icon>
      <span>Poll hidden by word filter — tap to reveal</span>
    </div>

    <div class="poll-body" @click="$emit('click')" :class="{ 'content-blurred': flagged && filterAction === 'blur' && !revealed }">
      <div class="poll-header">
        <div class="poll-badge">
          <ion-icon :icon="statsChartOutline"></ion-icon>
          <span>Poll</span>
        </div>
        <div class="poll-meta">
          <span class="author">u/{{ authorDisplayName }}</span>
          <span class="separator">•</span>
          <span class="timestamp">{{ formatTime(poll.createdAt) }}</span>
          <span v-if="poll.isExpired" class="expired-badge">Ended</span>
          <span v-if="flagged && filterAction === 'flag'" class="flag-badge" title="Flagged by word filter">
            <ion-icon :icon="warningOutline"></ion-icon>
          </span>
        </div>
      </div>

      <h3 class="poll-question">{{ poll.question || 'Untitled Poll' }}</h3>
      <p v-if="poll.description" class="poll-description">{{ poll.description }}</p>

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

      <div v-else class="no-options">
        <p>No poll options available</p>
      </div>

      <div class="poll-footer" @click.stop>
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
    </div>
  </article>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { IonIcon, IonButton } from '@ionic/vue';

import {
  statsChartOutline,
  peopleOutline,
  timeOutline,
  checkmarkDoneOutline,
  chevronForwardOutline,
  warningOutline
} from 'ionicons/icons';
import { Poll } from '../services/pollService';
import type { FilterAction } from '../services/moderationService';
import { generatePseudonym } from '../utils/pseudonym';

const props = defineProps<{
  poll: Poll;
  flagged?: boolean;
  filterAction?: FilterAction;
}>();
defineEmits(['click', 'vote']);

const revealed = ref(false);

const authorDisplayName = computed(() => {
  if (props.poll.authorShowRealName) {
    return props.poll.authorName || 'anon';
  }
  if (props.poll.authorId && props.poll.id) {
    return generatePseudonym(props.poll.id, props.poll.authorId);
  }
  return props.poll.authorName || 'anon';
});

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
  margin: 0 0 24px;
  padding: 20px 0 18px;
  border-bottom: 1px solid rgba(15, 23, 42, 0.08);
}

.poll-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}

.poll-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  background: rgba(var(--ion-color-tertiary-rgb), 0.08);
  border: 1px solid rgba(var(--ion-color-tertiary-rgb), 0.18);
  border-radius: 999px;
  color: var(--ion-color-tertiary);
  font-size: 12px;
  font-weight: 600;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.06);
}

.poll-badge ion-icon {
  font-size: 14px;
}

.poll-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  font-size: 12px;
  color: var(--app-text-muted);
}

.separator {
  color: rgba(255, 255, 255, 0.25);
}

.author {
  color: var(--app-text);
  font-weight: 500;
}

.expired-badge {
  padding: 4px 9px;
  border-radius: 999px;
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(var(--ion-color-medium-rgb), 0.1);
  color: var(--app-text-muted);
}

.timestamp,
.option-votes,
.more-options,
.no-options p {
  color: var(--app-text-subtle);
}

.poll-question {
  margin: 0 0 10px;
  font-size: 20px;
  font-weight: 600;
  line-height: 1.25;
  letter-spacing: -0.02em;
  color: var(--app-text);
}

.poll-description {
  margin: 0 0 16px;
  font-size: 14px;
  line-height: 1.7;
  color: var(--app-text-muted);
}

.poll-options-preview {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-bottom: 18px;
}

.option-preview {
  padding: 0;
}

.option-bar {
  height: 8px;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 999px;
  overflow: hidden;
  margin-bottom: 8px;
}

.option-fill {
  height: 100%;
  background: linear-gradient(90deg, var(--app-accent), var(--ion-color-tertiary));
  border-radius: 999px;
  box-shadow: 0 0 24px rgba(var(--app-accent-rgb), 0.18);
  transition: width 0.5s cubic-bezier(0.16, 1, 0.3, 1);
}

.option-info {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
}

.option-text {
  color: var(--app-text);
  font-size: 14px;
  font-weight: 500;
}

.poll-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  padding-top: 16px;
  border-top: 1px solid rgba(15, 23, 42, 0.08);
  flex-wrap: wrap;
}

.poll-stats {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}

.stat-item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 11px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 999px;
  font-size: 12px;
  color: var(--app-text-muted);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.05);
}

.stat-item ion-icon {
  color: var(--app-text-subtle);
}

.flagged-overlay {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  margin-bottom: 10px;
  background: rgba(var(--ion-color-warning-rgb), 0.1);
  border: 1px solid rgba(var(--ion-color-warning-rgb), 0.25);
  border-radius: 12px;
  color: var(--ion-color-warning);
  font-size: 13px;
  cursor: pointer;
}

.flagged-overlay ion-icon {
  font-size: 16px;
  flex-shrink: 0;
}

.content-blurred {
  filter: blur(6px);
  user-select: none;
  pointer-events: none;
}

.flag-badge {
  display: inline-flex;
  align-items: center;
  color: var(--ion-color-warning);
  margin-left: 4px;
}

.flag-badge ion-icon {
  font-size: 13px;
}

@media (max-width: 576px) {
  .poll-card {
    margin: 0 0 14px;
    padding: 16px 0 14px;
  }

  .poll-question {
    font-size: 17px;
  }

  .poll-description {
    font-size: 13px;
  }
}
</style>
