<template>
  <section class="feed-hub" aria-label="Feed controls">
    <header class="fh-heading">
      <h1>Home</h1>
      <button v-if="!spaces.length" @click="emit('spaces')">Discover spaces <span aria-hidden="true">↗</span></button>
    </header>
    <div v-if="spaces.length" class="fh-spaces" aria-label="Explore spaces">
      <button class="fh-space fh-space--discover" @click="emit('spaces')"><span class="fh-space-circle">+</span><span>Discover</span></button>
      <button v-for="(space, index) in spaces.slice(0, 8)" :key="space.id" class="fh-space" @click="emit('space', space.id)">
        <span class="fh-space-circle" :class="`fh-tone-${index % 4}`">{{ (space.displayName || space.name || 'S').charAt(0).toUpperCase() }}</span>
        <span>{{ space.displayName || space.name }}</span>
      </button>
    </div>
    <div class="fh-composer">
      <div class="fh-compose-row">
        <span class="fh-avatar" aria-hidden="true">{{ initial === '·' ? 'You' : initial }}</span>
        <button class="fh-prompt" @click="emit('post')">What's on your mind?</button>
        <button class="fh-create" aria-label="Create poll" @click="emit('poll')"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 19v-6m7 6V5m7 14V9" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" /></svg><span>Poll</span></button>
      </div>
      <div class="fh-compose-actions">
        <button @click="emit('post')"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="3" stroke="currentColor" stroke-width="1.8"/><circle cx="8" cy="9" r="1.5" fill="currentColor"/><path d="m4 17 5-5 4 4 3-3 4 4" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>Photo / video</button>
        <button @click="emit('poll')"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 19v-6m7 6V5m7 14V9" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg>Ask a question</button>
        <button @click="emit('post')"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 5h16M4 10h16M4 15h10M4 20h7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>Start a discussion</button>
      </div>
    </div>
    <div class="fh-feed-controls">
    <div class="fh-toolbar">
      <div class="fh-scopes" data-tour="feed-scopes" role="group" aria-label="Feed source">
        <button v-for="scope in scopes" :key="scope.id" :aria-pressed="scope.id === feedScope" :class="{ selected: scope.id === feedScope }" @click="emit('scope', scope.id)">{{ scope.label }}</button>
      </div>
    </div>
    <div class="fh-filter-row">
      <div class="fh-topics" role="group" aria-label="Topics">
        <button :class="{ selected: category === 'all' }" :aria-pressed="category === 'all'" @click="emit('category', 'all')">All topics</button>
        <button v-for="topic in categories.slice(0, 3)" :key="topic.id" :class="{ selected: category === topic.id }" :aria-pressed="category === topic.id" @click="emit('category', topic.id)">{{ topic.label }}</button>
      </div>
      <label class="fh-more"><span class="fh-sr">Choose any topic</span><select :value="category" aria-label="Choose any topic" @change="emit('category', ($event.target as HTMLSelectElement).value)"><option value="all">All topics</option><option v-for="topic in categories" :key="topic.id" :value="topic.id">{{ topic.label }}</option></select></label>
      <label class="fh-sort"><span class="fh-sr">Feed order</span><select :value="feedMode" aria-label="Feed order" @change="changeOrder"><option value="for-you">Relevant</option><option value="latest">Recent</option></select></label>
    </div>
    </div>
    <div v-if="tags.length" class="fh-tags" role="group" aria-label="Trending tags"><button v-for="tag in tags.slice(0, 5)" :key="tag.tag" :aria-pressed="activeTag === tag.tag" :class="{ selected: activeTag === tag.tag }" @click="emit('tag', tag.tag)">#{{ tag.tag }}</button></div>
  </section>
</template>

<script setup lang="ts">
type Scope = 'mine' | 'relay' | 'explore' | 'nearby';
defineProps<{
  initial: string;
  feedScope: Scope;
  feedMode: 'for-you' | 'latest';
  category: string;
  categories: readonly { id: string; label: string }[];
  tags: readonly { tag: string }[];
  activeTag?: string | null;
  spaces: readonly { id: string; name?: string; displayName?: string }[];
}>();
const emit = defineEmits<{ scope: [scope: Scope]; order: [order: 'for-you' | 'latest']; category: [category: string]; tag: [tag: string]; post: []; poll: []; spaces: []; space: [id: string] }>();
const scopes: { id: Scope; label: string }[] = [
  { id: 'relay', label: 'This relay' }, { id: 'mine', label: 'My spaces' },
  { id: 'explore', label: 'Explore' }, { id: 'nearby', label: 'Nearby' },
];
function changeOrder(event: Event) {
  const value = (event.target as HTMLSelectElement).value;
  if (value === 'for-you' || value === 'latest') emit('order', value);
}
</script>

<style scoped>
.feed-hub { min-width: 0; margin-bottom: 12px; }
.fh-heading { display: flex; align-items: center; justify-content: space-between; margin-bottom: 18px; gap: 12px; }
.fh-heading h1 { font-size: 24px; font-weight: 700; margin: 0; color: var(--app-text); }
.fh-heading > button { font-size: 12px; color: var(--app-text-muted); border: 0; background: none; padding: 8px 0; }
.fh-heading > button span { margin-left: 5px; }
button, select { font: inherit; cursor: pointer; }
.fh-spaces { display: flex; gap: 17px; overflow-x: auto; scrollbar-width: none; padding: 2px 0 20px; }
.fh-space { display: flex; flex-direction: column; align-items: center; gap: 9px; padding: 0; border: 0; background: none; color: var(--app-text-muted); width: 65px; flex-shrink: 0; font-size: 10px; }
.fh-space > span:last-child { width: 100%; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; text-align: center; }
.fh-space-circle { width: 52px; height: 52px; display: grid; place-items: center; border: 3px solid var(--app-bg-base); outline: 1px solid #789c8a; border-radius: 50%; color: #b2e6ce; background: #23463b; font-weight: 700; font-size: 20px; }
.fh-space-circle.fh-tone-1 { outline-color: #9e8cc0; color: #d9cffa; background: #49375f; }
.fh-space-circle.fh-tone-2 { outline-color: #b28d60; color: #ffe0af; background: #634b2d; }
.fh-space-circle.fh-tone-3 { outline-color: #739fc1; color: #d1eaff; background: #2a5068; }
.fh-space--discover .fh-space-circle { color: var(--app-text-muted); background: var(--app-bg-elevated); outline-color: var(--app-border-strong); font-size: 25px; font-weight: 400; }
.fh-composer { padding: 14px 16px 0; border-radius: 14px; border: 1px solid var(--app-border); background: var(--app-bg-elevated); }
.fh-compose-row { display: flex; align-items: center; gap: 11px; padding-bottom: 13px; }
.fh-avatar { width: 38px; height: 38px; border-radius: 50%; display: grid; place-items: center; background: #294d42; color: #b8e4d0; font-weight: 650; font-size: 12px; flex-shrink: 0; }
.fh-prompt { text-align: left; flex: 1; min-width: 0; height: 40px; background: var(--app-item-surface); border: 0; border-radius: 30px; color: var(--app-text-muted); padding: 0 15px; font-size: 14px; }
.fh-create { display: inline-flex; align-items: center; justify-content: center; gap: 7px; border: 0; border-radius: 30px; background: none; color: var(--app-text); font-size: 12px; height: 40px; padding: 0 10px; }
.fh-create svg { width: 21px; height: 21px; color: var(--app-accent); }
.fh-compose-actions { display: flex; border-top: 1px solid var(--app-border); padding: 6px 0; justify-content: space-between; gap: 8px; }
.fh-compose-actions button { border: 0; background: none; display: inline-flex; gap: 7px; align-items: center; justify-content: center; font-size: 11px; color: var(--app-text-muted); padding: 9px 6px; }
.fh-compose-actions svg { width: 18px; height: 18px; color: #80bda0; }
.fh-compose-actions button:nth-child(2) svg { color: #d8b67f; }
.fh-compose-actions button:nth-child(3) svg { color: #a6a2ce; }
.fh-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 8px; border-bottom: 1px solid var(--app-border); margin-top: 12px; }
.fh-scopes { display: flex; gap: 20px; overflow-x: auto; min-width: 0; scrollbar-width: none; }
.fh-scopes button { position: relative; min-height: 48px; padding: 12px 0; border: 0; background: none; color: var(--app-text-muted); font-size: 12px; white-space: nowrap; }
.fh-scopes button.selected { color: var(--app-text); font-weight: 650; }
.fh-scopes button.selected::after { content: ''; position: absolute; bottom: 0; left: 0; right: 0; height: 3px; border-radius: 3px; background: var(--app-accent); }
.fh-sort select, .fh-more select { min-height: 38px; background: transparent; border: 0; border-radius: 7px; color: var(--app-text-muted); font-size: 11px; padding: 6px; max-width: 105px; }
.fh-filter-row { display: flex; align-items: center; gap: 6px; justify-content: space-between; padding-top: 10px; }
.fh-topics { display: flex; align-items: center; gap: 7px; min-width: 0; overflow-x: auto; scrollbar-width: none; }
.fh-topics button { border: 0; border-radius: 25px; background: var(--app-item-surface); color: var(--app-text-muted); font-size: 11px; min-height: 32px; padding: 7px 12px; flex-shrink: 0; }
.fh-topics button.selected { background: var(--app-text); color: var(--app-bg-base); font-weight: 650; }
.fh-more { flex-shrink: 0; }
.fh-tags { display: flex; overflow-x: auto; gap: 12px; scrollbar-width: none; margin-top: 7px; }
.fh-tags button { padding: 6px 0; border: 0; background: none; color: var(--app-text-subtle); font-size: 11px; }
.fh-tags button.selected { color: var(--app-accent); }
.fh-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
button:focus-visible, select:focus-visible { outline: 2px solid var(--app-accent); outline-offset: 3px; }
@media (max-width: 767px) {
  .fh-heading { margin-bottom: 15px; }
  .fh-heading h1 { font-size: 22px; }
  .fh-heading > button { font-size: 11px; }
  .fh-spaces { gap: 15px; padding-bottom: 18px; }
  .fh-space { width: 57px; }
  .fh-space-circle { width: 47px; height: 47px; }
  .fh-composer { padding: 12px; }
  .fh-compose-row { padding: 0; gap: 9px; }
  .fh-avatar { width: 34px; height: 34px; font-size: 10px; }
  .fh-prompt { height: 39px; font-size: 12px; padding: 0 12px; }
  .fh-create { padding-inline: 2px; font-size: 11px; }
  .fh-create svg { width: 19px; }
  .fh-compose-actions { display: none; }
  .fh-scopes { gap: 17px; }
  .fh-scopes button { font-size: 11px; }
  .fh-sort select { max-width: 80px; font-size: 10px; }
  .fh-topics button { font-size: 10px; padding-inline: 11px; }
  .fh-more select { font-size: 10px; max-width: 88px; }
}
</style>
