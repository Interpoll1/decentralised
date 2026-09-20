<template>
  <svg class="nav-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor"
       stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
    <!-- Feed -->
    <template v-if="id === 'home'">
      <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"
            :fill="active ? 'currentColor' : 'none'" :fill-opacity="active ? '0.18' : '1'" />
      <path d="M9 22V12h6v10" />
    </template>

    <!-- Spaces -->
    <template v-else-if="id === 'communities'">
      <circle :fill="active ? 'currentColor' : 'none'" cx="9" cy="8" r="3.5" />
      <path d="M3 21v-.5A5.5 5.5 0 018.5 15h1A5.5 5.5 0 0115 20.5v.5" />
      <path d="M16 4a3.5 3.5 0 010 7" />
      <path d="M21 21v-.5a5.5 5.5 0 00-4-5.32" />
    </template>

    <!-- Messages -->
    <template v-else-if="id === 'chat'">
      <path :fill="active ? 'currentColor' : 'none'"
            d="M20 2H4a2 2 0 00-2 2v14l4-4h14a2 2 0 002-2V4a2 2 0 00-2-2z" />
    </template>

    <!-- Publish -->
    <template v-else-if="id === 'create'">
      <circle cx="12" cy="12" r="10" :fill="active ? 'currentColor' : 'none'" />
      <line x1="12" y1="8" x2="12" y2="16" :stroke="active ? 'var(--app-bg, #000)' : 'currentColor'" stroke-width="2" />
      <line x1="8" y1="12" x2="16" y2="12" :stroke="active ? 'var(--app-bg, #000)' : 'currentColor'" stroke-width="2" />
    </template>

    <!-- Search -->
    <template v-else-if="id === 'search'">
      <circle cx="11" cy="11" r="7" :fill="active ? 'currentColor' : 'none'" :fill-opacity="active ? '0.18' : '1'" />
      <line x1="16.5" y1="16.5" x2="21" y2="21" />
    </template>

    <!-- Profile -->
    <template v-else-if="id === 'profile'">
      <circle cx="12" cy="8" r="4" :fill="active ? 'currentColor' : 'none'" :fill-opacity="active ? '0.18' : '1'" />
      <path d="M4 21v-1a6 6 0 016-6h4a6 6 0 016 6v1" />
    </template>

    <!-- Rooms -->
    <template v-else-if="id === 'chatrooms'">
      <path d="M8 12h8M8 8h8" />
      <path :fill="active ? 'currentColor' : 'none'" :fill-opacity="active ? '0.18' : '1'"
            d="M4 4h16v12H8l-4 4z" />
    </template>

    <!-- Chain explorer -->
    <template v-else-if="id === 'chainExplorer'">
      <rect x="3" y="9" width="7" height="6" rx="1.5"
            :fill="active ? 'currentColor' : 'none'" :fill-opacity="active ? '0.18' : '1'" />
      <rect x="14" y="9" width="7" height="6" rx="1.5"
            :fill="active ? 'currentColor' : 'none'" :fill-opacity="active ? '0.18' : '1'" />
      <line x1="10" y1="12" x2="14" y2="12" />
    </template>

    <!-- Settings -->
    <template v-else-if="id === 'settings'">
      <circle cx="12" cy="12" r="3" :fill="active ? 'currentColor' : 'none'" />
      <path d="M19.4 15a1.6 1.6 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.6 1.6 0 00-2.7 1.1V21a2 2 0 11-4 0v-.1A1.6 1.6 0 007.5 19.4l-.1.1a2 2 0 11-2.8-2.8l.1-.1A1.6 1.6 0 003 15H3a2 2 0 110-4h.1A1.6 1.6 0 004.6 7.5l-.1-.1a2 2 0 112.8-2.8l.1.1A1.6 1.6 0 0010 4.6V3a2 2 0 114 0v.1a1.6 1.6 0 002.7 1.1l.1-.1a2 2 0 112.8 2.8l-.1.1a1.6 1.6 0 001.1 2.7H21a2 2 0 110 4h-.1a1.6 1.6 0 00-1.5 1z" />
    </template>

    <!-- Network fallback -->
    <template v-else>
      <circle cx="12" cy="12" r="9" :fill="active ? 'currentColor' : 'none'" :fill-opacity="active ? '0.18' : '1'" />
      <path d="M3 12h18M12 3a15 15 0 010 18a15 15 0 010-18z" />
    </template>
  </svg>
</template>

<script setup lang="ts">
defineProps<{ id: string; active?: boolean }>();
</script>
