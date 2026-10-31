<template>
  <section class="feed-hub" aria-label="Feed controls">
    <header class="fh-heading">
      <div>
        <span class="fh-eyebrow">Your corner of Interpoll</span>
        <h1>The conversation starts here.</h1>
        <p>Find your people. Ask a question. Share a thought.</p>
      </div>
      <BitMascot :size="58" :animated="false" mood="happy" />
    </header>

    <div class="fh-composer">
      <span class="fh-avatar" aria-hidden="true">{{ initial }}</span>
      <button class="fh-prompt" @click="emit('post')">What's on your mind?</button>
      <button class="fh-create" @click="emit('poll')">
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 19v-6m7 6V5m7 14V9" stroke="currentColor" stroke-width="2" stroke-linecap="round" /></svg>
        <span>Create poll</span>
      </button>
    </div>

    <div class="fh-toolbar">
      <div class="fh-scopes" data-tour="feed-scopes" role="group" aria-label="Feed source">
        <button v-for="scope in scopes" :key="scope.id" :aria-pressed="scope.id === feedScope" :class="{ selected: scope.id === feedScope }" @click="emit('scope', scope.id)">{{ scope.label }}</button>
      </div>
      <label class="fh-sort">
        <span>Sort by</span>
        <select :value="feedMode" aria-label="Feed order" @change="changeOrder">
          <option value="for-you">Relevant</option>
          <option value="latest">Recent</option>
        </select>
      </label>
    </div>

    <div class="fh-topics" role="group" aria-label="Topics">
      <button :class="{ selected: category === 'all' }" :aria-pressed="category === 'all'" @click="emit('category', 'all')">All topics</button>
      <button v-for="topic in categories.slice(0, 5)" :key="topic.id" :class="{ selected: category === topic.id }" :aria-pressed="category === topic.id" @click="emit('category', topic.id)">{{ topic.label }}</button>
      <label class="fh-more">
        <span class="fh-sr">Choose any topic</span>
        <select :value="category" aria-label="Choose any topic" @change="emit('category', ($event.target as HTMLSelectElement).value)">
          <option value="all">More topics</option>
          <option v-for="topic in categories" :key="topic.id" :value="topic.id">{{ topic.label }}</option>
        </select>
      </label>
    </div>
    <div v-if="tags.length" class="fh-tags" role="group" aria-label="Trending tags">
      <span>In the conversation</span>
      <button v-for="tag in tags.slice(0, 5)" :key="tag.tag" :aria-pressed="activeTag === tag.tag" :class="{ selected: activeTag === tag.tag }" @click="emit('tag', tag.tag)">#{{ tag.tag }}</button>
    </div>
  </section>
</template>

<script setup lang="ts">
import BitMascot from './BitMascot.vue';

type Scope = 'mine' | 'relay' | 'explore' | 'nearby';
defineProps<{
  initial: string;
  feedScope: Scope;
  feedMode: 'for-you' | 'latest';
  category: string;
  categories: readonly { id: string; label: string }[];
  tags: readonly { tag: string }[];
  activeTag?: string | null;
}>();
const emit = defineEmits<{
  scope: [scope: Scope];
  order: [order: 'for-you' | 'latest'];
  category: [category: string];
  tag: [tag: string];
  post: [];
  poll: [];
}>();
const scopes: { id: Scope; label: string }[] = [
  { id: 'relay', label: 'This relay' },
  { id: 'mine', label: 'My spaces' },
  { id: 'explore', label: 'Explore' },
  { id: 'nearby', label: 'Nearby' },
];
function changeOrder(event: Event) {
  const value = (event.target as HTMLSelectElement).value;
  if (value === 'for-you' || value === 'latest') emit('order', value);
}
</script>

<style scoped>
.feed-hub { min-width: 0; margin-bottom: 20px; }
.fh-heading { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 4px 0 25px; }
.fh-heading .bit { flex-shrink: 0; }
.fh-eyebrow { color: var(--app-accent); font-size: 12px; font-weight: 600; }
.fh-heading h1 { font-size: clamp(24px, 2.5vw, 30px); line-height: 1.18; margin: 9px 0; font-weight: 650; max-width: 430px; }
.fh-heading p { margin: 0; color: var(--app-text-muted); font-size: 13px; line-height: 1.6; }
.fh-composer { display: flex; align-items: center; gap: 12px; border: 1px solid var(--app-border); border-radius: 14px; padding: 16px; background: var(--app-bg-elevated); }
.fh-avatar { width: 38px; height: 38px; border-radius: 50%; display: grid; place-items: center; flex-shrink: 0; background: rgba(var(--app-accent-rgb), .1); color: var(--app-accent); font-size: 14px; font-weight: 650; border: 1px solid rgba(var(--app-accent-rgb), .2); }
button, select { font: inherit; cursor: pointer; }
.fh-prompt { background: none; color: var(--app-text-muted); border: 0; padding: 10px 0; text-align: left; flex: 1; min-width: 0; font-size: 14px; }
.fh-create { display: inline-flex; align-items: center; justify-content: center; gap: 8px; min-height: 42px; padding: 0 14px; color: #051108; background: var(--app-accent); border: 0; border-radius: 9px; font-size: 12px; font-weight: 650; flex-shrink: 0; }
.fh-create svg { width: 17px; height: 17px; }
.fh-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; border-bottom: 1px solid var(--app-border); margin-top: 16px; }
.fh-scopes { display: flex; overflow-x: auto; scrollbar-width: none; min-width: 0; }
.fh-scopes button { position: relative; border: 0; background: none; color: var(--app-text-muted); padding: 15px 12px; white-space: nowrap; min-height: 48px; font-size: 12px; }
.fh-scopes button:first-child { padding-left: 0; }
.fh-scopes button.selected { color: var(--app-text); font-weight: 650; }
.fh-scopes button.selected::after { content: ''; position: absolute; height: 2px; background: var(--app-accent); bottom: 0; left: 10px; right: 10px; border-radius: 2px; }
.fh-scopes button:first-child::after { left: 0; }
.fh-sort { display: flex; align-items: center; gap: 6px; flex-shrink: 0; color: var(--app-text-subtle); font-size: 11px; }
.fh-sort select { border: 0; color: var(--app-text); background: var(--app-bg-base); padding: 8px 2px; max-width: 98px; min-height: 44px; font-size: 12px; }
.fh-topics { display: flex; align-items: center; gap: 7px; padding-top: 15px; overflow-x: auto; scrollbar-width: thin; scrollbar-color: var(--app-border) transparent; }
.fh-topics button, .fh-more select { flex-shrink: 0; border: 1px solid var(--app-border); border-radius: 7px; background: var(--app-bg-elevated); color: var(--app-text-muted); padding: 8px 11px; min-height: 36px; font-size: 11px; white-space: nowrap; }
.fh-topics button.selected { color: var(--app-accent); border-color: rgba(var(--app-accent-rgb), .4); background: rgba(var(--app-accent-rgb), .07); }
.fh-more { flex-shrink: 0; }
.fh-more select { max-width: 135px; }
.fh-tags { display: flex; align-items: center; gap: 10px; margin-top: 15px; overflow-x: auto; scrollbar-width: none; white-space: nowrap; }
.fh-tags > span { color: var(--app-text-subtle); font-size: 10px; }
.fh-tags button { border: 0; padding: 5px 0; background: none; color: var(--app-text-muted); font-size: 11px; }
.fh-tags button.selected { color: var(--app-accent); }
.fh-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
button:focus-visible, select:focus-visible { outline: 2px solid var(--app-accent); outline-offset: 3px; }
@media (max-width: 767px) {
  .fh-heading { padding: 10px 0 20px; gap: 10px; }
  .fh-heading h1 { font-size: 26px; max-width: 260px; }
  .fh-heading p { font-size: 12px; max-width: 230px; }
  .fh-heading .bit { width: 47px; }
  .fh-composer { padding: 12px; gap: 10px; }
  .fh-avatar { width: 32px; height: 32px; }
  .fh-prompt { font-size: 12px; }
  .fh-create { padding: 0 11px; }
  .fh-create span { display: none; }
  .fh-create::after { content: 'Poll'; }
  .fh-toolbar { gap: 4px; margin-top: 8px; }
  .fh-scopes button { padding: 14px 9px; font-size: 11px; }
  .fh-sort > span { display: none; }
  .fh-sort select { font-size: 11px; max-width: 77px; }
  .fh-topics button, .fh-more select { min-height: 40px; }
}
</style>
