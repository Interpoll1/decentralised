<template>
  <div class="language-picker">
    <label :for="languageId">{{ $ui('Language') }}</label>
    <select :id="languageId" :value="languagePreference" @change="onChange">
      <option value="system">{{ $ui('Device language') }}</option>
      <option v-for="language in supportedLanguages" :key="language.code" :value="language.code">{{ language.name }}</option>
    </select>
    <p v-if="!compact">{{ $ui('Changes the interface language. Posts and messages stay in their original language.') }}</p>
  </div>
</template>

<script setup lang="ts">
import { languagePreference, supportedLanguages, setLanguage, type LanguagePreference } from '../i18n';
import { useId } from 'vue';
const languageId = useId();
defineProps<{ compact?: boolean }>();
function onChange(event: Event) {
  setLanguage((event.target as HTMLSelectElement).value as LanguagePreference);
}
</script>

<style scoped>
.language-picker { display: grid; gap: 10px; min-width: 0; }
label { color: var(--app-text); font-size: 15px; font-weight: 700; }
select { width: 100%; min-height: 48px; padding: 10px 12px; border: 1px solid var(--app-border-strong); border-radius: 10px; background: var(--app-surface-strong); color: var(--app-text); font: inherit; font-size: 16px; }
p { margin: 0; color: var(--app-text-muted); font-size: 13px; line-height: 1.5; overflow-wrap: anywhere; }
</style>
