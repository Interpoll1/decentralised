<template>
  <span
    v-if="category"
    class="cat-badge"
    :class="`cat-${category}`"
    :title="CATEGORY_LABELS[category] || category"
  >
    {{ CATEGORY_LABELS[category] || category }}
  </span>
  <span v-else-if="pending" class="cat-badge cat-pending" aria-hidden="true">···</span>
</template>

<script setup lang="ts">
defineProps<{
  /** The category slug (e.g. 'technology', 'politics'). Absent = not yet loaded. */
  category?: string;
  /** Show a placeholder shimmer while the category is still loading from Gun. */
  pending?: boolean;
}>();

const CATEGORY_LABELS: Record<string, string> = {
  'politics':      '🏛 Politics',
  'technology':    '💻 Tech',
  'science':       '🔬 Science',
  'finance':       '💰 Finance',
  'health':        '🏥 Health',
  'sports':        '⚽ Sports',
  'entertainment': '🎬 Entertainment',
  'environment':   '🌱 Environment',
  'education':     '📚 Education',
  'world-news':    '🌍 World',
  'local':         '📍 Local',
  'opinion':       '💬 Opinion',
  'humour':        '😂 Humour',
  'crypto':        '₿ Crypto',
  'gaming':        '🎮 Gaming',
  'other':         '• Other',
};
</script>

<style scoped>
.cat-badge {
  display: inline-block;
  font-size: 0.72rem;
  font-weight: 500;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--ion-color-light, #f4f5f8);
  color: var(--ion-color-medium, #92949c);
  margin-left: 0.4rem;
  white-space: nowrap;
  vertical-align: middle;
  line-height: 1.6;
  transition: opacity 0.15s;
  cursor: default;
  user-select: none;
}

.cat-pending {
  opacity: 0.35;
  letter-spacing: 0.1em;
}

/* Per-category colour overrides */
.cat-technology    { background: #dbeafe; color: #1d4ed8; }
.cat-science       { background: #d1fae5; color: #065f46; }
.cat-politics      { background: #fee2e2; color: #991b1b; }
.cat-crypto        { background: #fef9c3; color: #713f12; }
.cat-finance       { background: #dcfce7; color: #166534; }
.cat-health        { background: #fce7f3; color: #9d174d; }
.cat-humour        { background: #fff7ed; color: #c2410c; }
.cat-gaming        { background: #ede9fe; color: #5b21b6; }
.cat-sports        { background: #e0f2fe; color: #0369a1; }
.cat-entertainment { background: #fef3c7; color: #92400e; }
.cat-environment   { background: #ecfdf5; color: #065f46; }
.cat-education     { background: #f0fdf4; color: #166534; }
.cat-world-news    { background: #e0e7ff; color: #3730a3; }
.cat-local         { background: #f1f5f9; color: #334155; }
.cat-opinion       { background: #fdf4ff; color: #7e22ce; }
.cat-other         { background: var(--ion-color-light, #f4f5f8); color: var(--ion-color-medium, #92949c); }

/* Dark-mode: desaturate the bright backgrounds slightly */
@media (prefers-color-scheme: dark) {
  .cat-technology    { background: #1e3a5f; color: #93c5fd; }
  .cat-science       { background: #064e3b; color: #6ee7b7; }
  .cat-politics      { background: #7f1d1d; color: #fca5a5; }
  .cat-crypto        { background: #451a03; color: #fde68a; }
  .cat-finance       { background: #14532d; color: #86efac; }
  .cat-health        { background: #831843; color: #f9a8d4; }
  .cat-humour        { background: #7c2d12; color: #fdba74; }
  .cat-gaming        { background: #3b0764; color: #d8b4fe; }
  .cat-sports        { background: #0c4a6e; color: #7dd3fc; }
  .cat-entertainment { background: #78350f; color: #fcd34d; }
  .cat-environment   { background: #052e16; color: #4ade80; }
  .cat-education     { background: #052e16; color: #86efac; }
  .cat-world-news    { background: #1e1b4b; color: #a5b4fc; }
  .cat-opinion       { background: #3b0764; color: #e9d5ff; }
}
</style>
