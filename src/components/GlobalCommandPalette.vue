<template>
  <ion-modal :is-open="isOpen" class="global-command-modal" @didDismiss="emit('close')">
    <div class="global-command-modal__shell">
      <div class="global-command-palette">
        <div class="global-command-palette__header">
          <div>
            <strong>Command palette</strong>
            <p>Navigate and run quick app actions.</p>
          </div>
          <ion-button fill="clear" size="small" @click="emit('close')">Close</ion-button>
        </div>

        <input
          ref="searchInput"
          v-model="query"
          class="global-command-palette__search"
          type="text"
          placeholder="Search navigation and actions..."
          @keydown="handleKeydown"
        />

        <div v-if="flatCommands.length === 0" class="global-command-palette__empty">
          No commands match “{{ query }}”.
        </div>

        <div v-else class="global-command-palette__groups">
          <section v-for="group in groupedCommands" :key="group.category" class="global-command-group">
            <h3>{{ group.title }}</h3>
            <button
              v-for="command in group.commands"
              :key="command.id"
              class="global-command-item"
              :class="{ 'is-active': activeCommand?.id === command.id }"
              @click="runCommand(command.id)"
            >
              <div>
                <strong>{{ command.title }}</strong>
                <p>{{ command.description }}</p>
              </div>
              <span v-if="command.shortcut" class="global-command-item__shortcut">{{ command.shortcut }}</span>
            </button>
          </section>
        </div>
      </div>
    </div>
  </ion-modal>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { IonButton, IonModal } from '@ionic/vue';
import { useRouter } from 'vue-router';

type CommandCategory = 'Navigation' | 'Create' | 'Tools';

type CommandItem = {
  id: string;
  title: string;
  description: string;
  category: CommandCategory;
  keywords: string[];
  shortcut?: string;
};

const props = defineProps<{
  isOpen: boolean;
}>();

const emit = defineEmits<{
  close: [];
}>();

const router = useRouter();
const query = ref('');
const searchInput = ref<HTMLInputElement | null>(null);
const activeIndex = ref(0);

const COMMANDS: CommandItem[] = [
  { id: 'nav:home', title: 'Go to Home', description: 'Open the main feed.', category: 'Navigation', keywords: ['home', 'feed', 'dashboard'] },
  { id: 'nav:search', title: 'Open Search', description: 'Find posts, polls, and users.', category: 'Navigation', keywords: ['search', 'find'] },
  { id: 'nav:profile', title: 'Open Profile', description: 'Manage your profile settings.', category: 'Navigation', keywords: ['profile', 'account'] },
  { id: 'nav:settings', title: 'Open Settings', description: 'Configure relays and app behavior.', category: 'Navigation', keywords: ['settings', 'config'] },
  { id: 'nav:resilience', title: 'Open Resilience Center', description: 'Relay health and continuity tools.', category: 'Navigation', keywords: ['resilience', 'relay', 'network'] },
  { id: 'nav:chain', title: 'Open Chain Explorer', description: 'Inspect local blockchain records.', category: 'Navigation', keywords: ['chain', 'explorer', 'blocks'] },
  { id: 'create:community', title: 'Create Community', description: 'Start a new community.', category: 'Create', keywords: ['create', 'community', 'new'] },
  { id: 'create:poll', title: 'Create Poll', description: 'Publish a new poll.', category: 'Create', keywords: ['create', 'poll', 'vote'] },
  { id: 'tools:reload', title: 'Reload App', description: 'Hard refresh the current page.', category: 'Tools', keywords: ['reload', 'refresh'], shortcut: 'R' },
];

const filteredCommands = computed(() => {
  const normalized = query.value.trim().toLowerCase();
  if (!normalized) return COMMANDS;
  return COMMANDS.filter((command) => {
    const haystack = [
      command.title,
      command.description,
      command.category,
      command.shortcut || '',
      ...command.keywords,
    ].join(' ').toLowerCase();
    return normalized.split(/\s+/).every(term => haystack.includes(term));
  });
});

const groupedCommands = computed(() => {
  const categories: CommandCategory[] = ['Navigation', 'Create', 'Tools'];
  return categories
    .map(category => ({
      category,
      title: category,
      commands: filteredCommands.value.filter(command => command.category === category),
    }))
    .filter(group => group.commands.length > 0);
});

const flatCommands = computed(() => groupedCommands.value.flatMap(group => group.commands));
const activeCommand = computed(() => flatCommands.value[activeIndex.value] || null);

watch(
  () => query.value,
  () => {
    activeIndex.value = 0;
  },
);

watch(
  () => props.isOpen,
  async (open) => {
    if (open) {
      activeIndex.value = 0;
      query.value = '';
      await nextTick();
      searchInput.value?.focus();
      searchInput.value?.select();
    }
  },
);

async function runCommand(commandId: string) {
  switch (commandId) {
    case 'nav:home':
      await router.push('/home');
      break;
    case 'nav:search':
      await router.push('/search');
      break;
    case 'nav:profile':
      await router.push('/profile');
      break;
    case 'nav:settings':
      await router.push('/settings');
      break;
    case 'nav:resilience':
      await router.push('/resilience');
      break;
    case 'nav:chain':
      await router.push('/chain-explorer');
      break;
    case 'create:community':
      await router.push('/create-community');
      break;
    case 'create:poll':
      await router.push('/create-poll');
      break;
    case 'tools:reload':
      window.location.reload();
      return;
  }
  emit('close');
}

function handleKeydown(event: KeyboardEvent) {
  if (flatCommands.value.length === 0) {
    if (event.key === 'Escape') emit('close');
    return;
  }

  if (event.key === 'ArrowDown') {
    event.preventDefault();
    activeIndex.value = (activeIndex.value + 1) % flatCommands.value.length;
    return;
  }

  if (event.key === 'ArrowUp') {
    event.preventDefault();
    activeIndex.value = (activeIndex.value - 1 + flatCommands.value.length) % flatCommands.value.length;
    return;
  }

  if (event.key === 'Enter' && activeCommand.value) {
    event.preventDefault();
    void runCommand(activeCommand.value.id);
    return;
  }

  if (event.key === 'Escape') {
    event.preventDefault();
    emit('close');
  }
}
</script>

<style scoped>
.global-command-modal__shell {
  width: 100%;
  min-height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 12px;
  box-sizing: border-box;
}

.global-command-modal {
  --width: 100vw;
  --height: 100vh;
  --max-width: 100vw;
  --max-height: 100vh;
  --border-radius: 0;
  --background: transparent;
}

.global-command-palette {
  width: min(1040px, calc(100vw - 24px));
  max-height: calc(100vh - 24px);
  display: flex;
  flex-direction: column;
  padding: 18px;
  border-radius: 24px;
  background: rgba(var(--ion-background-color-rgb), 0.96);
  border: 1px solid rgba(var(--ion-text-color-rgb), 0.14);
  box-shadow: 0 18px 60px rgba(15, 23, 42, 0.18);
  color: var(--ion-text-color);
}

:global(html.dark) .global-command-palette {
  background: rgba(15, 23, 42, 0.92);
  border-color: rgba(148, 163, 184, 0.2);
  box-shadow: 0 20px 80px rgba(2, 6, 23, 0.5);
}

.global-command-palette__header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
  margin-bottom: 12px;
}

.global-command-palette__header p {
  margin: 4px 0 0;
  color: rgba(var(--ion-text-color-rgb), 0.72);
}

.global-command-palette__search {
  width: 100%;
  border: 1px solid rgba(var(--ion-text-color-rgb), 0.2);
  border-radius: 16px;
  background: rgba(var(--ion-background-color-rgb), 0.84);
  padding: 14px 16px;
  font-size: 1rem;
  margin-bottom: 16px;
  outline: none;
  color: inherit;
}

.global-command-palette__groups {
  flex: 1;
  min-height: 0;
  overflow: auto;
  display: grid;
  gap: 16px;
  padding-right: 4px;
}

.global-command-group h3 {
  margin: 0 0 8px;
  font-size: 0.82rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--ion-color-primary);
}

.global-command-item {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  width: 100%;
  padding: 12px 14px;
  border: 1px solid rgba(var(--ion-text-color-rgb), 0.16);
  border-radius: 16px;
  background: rgba(var(--ion-background-color-rgb), 0.72);
  text-align: left;
  color: inherit;
}

.global-command-item + .global-command-item {
  margin-top: 8px;
}

.global-command-item.is-active {
  border-color: rgba(var(--ion-color-primary-rgb), 0.46);
  background: rgba(var(--ion-color-primary-rgb), 0.12);
}

.global-command-item strong,
.global-command-item p {
  display: block;
  margin: 0;
}

.global-command-item p {
  margin-top: 4px;
  color: rgba(var(--ion-text-color-rgb), 0.72);
}

.global-command-item__shortcut {
  flex-shrink: 0;
  align-self: center;
  padding: 4px 8px;
  border-radius: 999px;
  background: rgba(var(--ion-color-primary-rgb), 0.12);
  color: var(--ion-color-primary);
  font-size: 0.75rem;
  font-weight: 700;
}

.global-command-palette__empty {
  padding: 36px 16px;
  text-align: center;
  color: rgba(var(--ion-text-color-rgb), 0.72);
}

@media (max-width: 720px) {
  .global-command-modal__shell {
    padding: 8px;
  }

  .global-command-palette {
    width: calc(100vw - 16px);
    max-height: calc(100vh - 16px);
    padding: 14px;
  }
}
</style>
