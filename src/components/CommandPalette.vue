<template>
  <div v-if="isOpen" class="command-palette-overlay" @click="closePalette">
    <div
      ref="paletteRef"
      class="command-palette"
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
      @click.stop
      @keydown.tab.prevent="trapFocus"
    >
      <input
        ref="searchInputRef"
        v-model="query"
        class="command-search"
        type="text"
        placeholder="Search commands..."
        autocomplete="off"
        @keydown.down.prevent="moveSelection(1)"
        @keydown.up.prevent="moveSelection(-1)"
        @keydown.enter.prevent="executeSelectedCommand"
        @keydown.esc.prevent="closePalette"
      />

      <div v-if="filteredCommands.length > 0" class="command-list">
        <button
          v-for="(command, index) in filteredCommands"
          :key="command.id"
          class="command-item"
          :class="{ selected: index === selectedIndex }"
          @click="runCommand(command)"
        >
          <div class="command-label">{{ command.label }}</div>
          <div class="command-hint">{{ command.hint }}</div>
        </button>
      </div>
      <div v-else class="empty-state">No matching commands</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRouter, type RouteLocationRaw } from 'vue-router'
import { useUserStore } from '@/stores/userStore'

interface PaletteCommand {
  id: string
  label: string
  hint: string
  to: RouteLocationRaw
  requiresAuth?: boolean
  keywords: string[]
}

const router = useRouter()
const userStore = useUserStore()

const isOpen = ref(false)
const query = ref('')
const selectedIndex = ref(0)
const searchInputRef = ref<HTMLInputElement | null>(null)
const paletteRef = ref<HTMLElement | null>(null)
const previousFocusRef = ref<HTMLElement | null>(null)

const commands = computed<PaletteCommand[]>(() => [
  {
    id: 'home',
    label: 'Go to Home',
    hint: '/home',
    to: { name: 'Home' },
    keywords: ['home', 'landing', 'dashboard'],
  },
  {
    id: 'polls',
    label: 'Go to Polls',
    hint: '/polls',
    to: { name: 'Polls' },
    keywords: ['polls', 'vote', 'voting'],
  },
  {
    id: 'posts',
    label: 'Go to Posts',
    hint: '/posts',
    to: { name: 'Posts' },
    keywords: ['posts', 'feed', 'content'],
  },
  {
    id: 'communities',
    label: 'Go to Communities',
    hint: '/communities',
    to: { name: 'Communities' },
    keywords: ['communities', 'groups', 'community'],
  },
  {
    id: 'search',
    label: 'Go to Search',
    hint: '/search',
    to: { name: 'Search' },
    keywords: ['search', 'find', 'discover'],
  },
  {
    id: 'settings',
    label: 'Go to Settings',
    hint: '/settings',
    to: { name: 'Settings' },
    keywords: ['settings', 'preferences', 'config'],
  },
  {
    id: 'profile',
    label: 'Go to Profile',
    hint: '/profile',
    to: { name: 'Profile' },
    keywords: ['profile', 'account', 'user'],
  },
  {
    id: 'create-poll',
    label: 'Create Poll',
    hint: '/create-poll',
    to: { name: 'CreatePoll' },
    requiresAuth: true,
    keywords: ['create poll', 'new poll', 'poll'],
  },
  {
    id: 'create-post',
    label: 'Create Post',
    hint: '/create-post',
    to: { name: 'CreatePost' },
    requiresAuth: true,
    keywords: ['create post', 'new post', 'post'],
  },
  {
    id: 'create-community',
    label: 'Create Community',
    hint: '/create-community',
    to: { name: 'CreateCommunity' },
    requiresAuth: true,
    keywords: ['create community', 'new community', 'community'],
  },
  {
    id: 'chat-rooms',
    label: 'Go to Chat Rooms',
    hint: '/chatrooms',
    to: { name: 'ChatRoomList' },
    requiresAuth: true,
    keywords: ['chat', 'messages', 'rooms'],
  },
  {
    id: 'login',
    label: 'Go to Login',
    hint: '/login',
    to: { name: 'Login' },
    keywords: ['login', 'sign in'],
  },
  {
    id: 'register',
    label: 'Go to Register',
    hint: '/register',
    to: { name: 'Register' },
    keywords: ['register', 'sign up'],
  },
])

const visibleCommands = computed(() => {
  const authenticated = userStore.isAuthenticated

  return commands.value.filter((command) => {
    if (command.requiresAuth) {
      return authenticated
    }

    if (authenticated && (command.id === 'login' || command.id === 'register')) {
      return false
    }

    return true
  })
})

const filteredCommands = computed(() => {
  const trimmedQuery = query.value.trim().toLowerCase()
  if (!trimmedQuery) {
    return visibleCommands.value
  }

  return visibleCommands.value.filter((command) => {
    const haystack = `${command.label} ${command.hint} ${command.keywords.join(' ')}`.toLowerCase()
    return haystack.includes(trimmedQuery)
  })
})

watch(filteredCommands, () => {
  selectedIndex.value = 0
})

watch(isOpen, async (open) => {
  if (!open) {
    previousFocusRef.value?.focus()
    previousFocusRef.value = null
    return
  }

  previousFocusRef.value = document.activeElement instanceof HTMLElement ? document.activeElement : null
  await nextTick()
  searchInputRef.value?.focus()
})

const openPalette = () => {
  isOpen.value = true
}

const closePalette = () => {
  isOpen.value = false
  query.value = ''
  selectedIndex.value = 0
}

const moveSelection = (direction: number) => {
  const totalCommands = filteredCommands.value.length
  if (totalCommands === 0) {
    return
  }

  selectedIndex.value = (selectedIndex.value + direction + totalCommands) % totalCommands
}

const runCommand = async (command: PaletteCommand) => {
  closePalette()
  const target = router.resolve(command.to)
  if (router.currentRoute.value.fullPath !== target.fullPath) {
    await router.push(command.to)
  }
}

const executeSelectedCommand = async () => {
  const command = filteredCommands.value[selectedIndex.value]
  if (!command) {
    return
  }

  await runCommand(command)
}

const isTypingElement = (element: HTMLElement | null): boolean => {
  if (!element) {
    return false
  }

  if (element.isContentEditable) {
    return true
  }

  const tag = element.tagName.toLowerCase()
  if (
    tag === 'input' ||
    tag === 'textarea' ||
    tag === 'select' ||
    tag === 'ion-input' ||
    tag === 'ion-textarea' ||
    tag === 'ion-select'
  ) {
    return true
  }

  const role = element.getAttribute('role')
  return role === 'textbox' || role === 'combobox'
}

const isTypingFromEvent = (event: KeyboardEvent): boolean => {
  const composedPath = event.composedPath()
  for (const node of composedPath) {
    if (node instanceof HTMLElement && isTypingElement(node)) {
      return true
    }
  }

  return isTypingElement(document.activeElement instanceof HTMLElement ? document.activeElement : null)
}

const trapFocus = (event: KeyboardEvent) => {
  const container = paletteRef.value
  if (!container) {
    return
  }

  const focusableElements = Array.from(
    container.querySelectorAll<HTMLElement>(
      'input, button, [href], [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((element) => !element.hasAttribute('disabled'))

  if (focusableElements.length === 0) {
    return
  }

  const first = focusableElements[0]
  const last = focusableElements[focusableElements.length - 1]
  const activeElement = document.activeElement as HTMLElement | null

  if (event.shiftKey) {
    if (activeElement === first) {
      last.focus()
      return
    }
  } else if (activeElement === last) {
    first.focus()
    return
  }

  const currentIndex = focusableElements.findIndex((element) => element === activeElement)
  const nextIndex = event.shiftKey ? currentIndex - 1 : currentIndex + 1
  if (nextIndex < 0) {
    last.focus()
    return
  }

  if (nextIndex >= focusableElements.length) {
    first.focus()
    return
  }

  const nextElement = focusableElements[nextIndex]
  if (nextElement) {
    nextElement.focus()
  }
}

const handleGlobalKeydown = (event: KeyboardEvent) => {
  const pressedCommandPaletteShortcut = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k'
  if (!pressedCommandPaletteShortcut) {
    return
  }

  if (isTypingFromEvent(event)) {
    return
  }

  event.preventDefault()

  if (isOpen.value) {
    closePalette()
    return
  }

  openPalette()
}

onMounted(() => {
  window.addEventListener('keydown', handleGlobalKeydown)
})

onUnmounted(() => {
  window.removeEventListener('keydown', handleGlobalKeydown)
})
</script>

<style scoped>
.command-palette-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  z-index: 3000;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: max(12vh, 4rem);
}

.command-palette {
  width: min(640px, calc(100vw - 2rem));
  background: var(--ion-background-color, #1e1e1e);
  border: 1px solid var(--ion-color-step-200, #333);
  border-radius: 12px;
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.35);
  overflow: hidden;
}

.command-search {
  width: 100%;
  border: 0;
  border-bottom: 1px solid var(--ion-color-step-200, #333);
  background: transparent;
  color: var(--ion-text-color, #fff);
  font-size: 1rem;
  padding: 0.9rem 1rem;
  outline: none;
}

.command-list {
  max-height: 60vh;
  overflow-y: auto;
}

.command-item {
  width: 100%;
  border: 0;
  border-bottom: 1px solid var(--ion-color-step-100, #252525);
  background: transparent;
  color: var(--ion-text-color, #fff);
  text-align: left;
  padding: 0.8rem 1rem;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
}

.command-item:hover,
.command-item.selected {
  background: rgba(var(--ion-color-primary-rgb, 56, 128, 255), 0.14);
}

.command-item:last-child {
  border-bottom: 0;
}

.command-label {
  font-size: 0.95rem;
  font-weight: 500;
}

.command-hint {
  color: var(--ion-color-medium, #999);
  font-size: 0.85rem;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', monospace;
}

.empty-state {
  color: var(--ion-color-medium, #999);
  padding: 1rem;
  text-align: center;
}
</style>
