<template>
  <div
    class="gmb"
    :class="{ sent: mine, received: !mine, grouped, flash, mention: item.mentionsMe && !mine }"
    :data-mid="item.messageId"
    @contextmenu.prevent="emit('menu', $event)"
    @touchstart.passive="pressStart"
    @touchend="pressEnd"
    @touchmove="pressEnd"
  >
    <span v-if="!mine && !grouped" class="gmb-sender" :style="{ '--gmb-hue': senderHue(item.senderId) }">{{ item.senderName }}</span>

    <div class="gmb-row">
      <div class="gmb-bubble" :class="{ deleted: item.deleted }">
        <div v-if="item.forwarded && !item.deleted" class="gmb-forwarded">Forwarded</div>
        <button v-if="item.reply && !item.deleted" class="gmb-quote" :class="{ missing: item.reply.missing }" @click.stop="emit('jump', item.reply.messageId)">
          <span v-if="!item.reply.missing" class="gmb-quote-name">{{ item.reply.senderName }}</span>
          <span class="gmb-quote-text">{{ item.reply.text }}</span>
        </button>

        <p v-if="item.deleted" class="gmb-text gmb-deleted">This message was deleted</p>
        <template v-else>
          <GroupMediaView v-if="item.media" :media="item.media" @open="url => emit('openMedia', url)" />
          <div v-if="item.poll" class="gmb-poll">
            <div class="gmb-poll-q">{{ item.poll.question }}</div>
            <div class="gmb-poll-hint">{{ item.poll.multi ? 'Select one or more' : 'Select one' }}</div>
            <button
              v-for="(opt, i) in item.poll.options"
              :key="i"
              class="gmb-poll-opt"
              :class="{ chosen: item.poll.myChoices.includes(i) }"
              :disabled="!canVote"
              @click.stop="toggleVote(i)"
            >
              <span class="gmb-poll-bar" :style="{ width: pct(i) + '%' }"></span>
              <span class="gmb-poll-check" :class="{ multi: item.poll.multi }"></span>
              <span class="gmb-poll-label">{{ opt }}</span>
              <span class="gmb-poll-count" :title="item.poll.votes[i].map(v => v.name).join(', ')">{{ item.poll.votes[i].length }}</span>
            </button>
            <div class="gmb-poll-total">{{ item.poll.voters }} {{ item.poll.voters === 1 ? 'vote' : 'votes' }}</div>
          </div>
          <p v-if="item.text" class="gmb-text" v-html="html"></p>
        </template>

        <div class="gmb-meta">
          <span v-if="item.pinned" class="gmb-pin">Pinned</span>
          <span v-if="item.edited && !item.deleted" class="gmb-edited">edited</span>
          <span class="gmb-time" :title="new Date(item.timestamp).toLocaleString()">{{ time }}</span>
          <span v-if="mine" class="gmb-status" :class="statusClass" :title="statusTitle" :aria-label="statusTitle">
            <svg v-if="statusIcon === '!'" viewBox="0 0 16 16" fill="currentColor"><circle cx="8" cy="8" r="7"/><path d="M8 4v5M8 11.2v.6" stroke="var(--app-bg-base)" stroke-width="1.8" stroke-linecap="round"/></svg>
            <svg v-else-if="statusIcon === '🕓'" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.5"/><path d="M8 5v3.2l2 1.3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
            <svg v-else-if="statusIcon === '✓'" viewBox="0 0 16 16" fill="none"><path d="M3 8.5l3 3 7-7" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>
            <svg v-else viewBox="0 0 20 16" fill="none"><path d="M1.5 8.5l3 3 7-7M8 11.5l1 0.5 7-7.5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </span>
        </div>
      </div>

      <div class="gmb-actions">
        <button class="gmb-act" title="React" aria-label="React" @click.stop="emit('reactPicker', $event)">
          <svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="8.5" stroke="currentColor" stroke-width="1.8"/><path d="M8.5 14c.9 1.3 2.1 2 3.5 2s2.6-.7 3.5-2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="9.3" cy="9.8" r="1.1" fill="currentColor"/><circle cx="14.7" cy="9.8" r="1.1" fill="currentColor"/></svg>
        </button>
        <button class="gmb-act" title="Reply" aria-label="Reply" @click.stop="emit('reply')">
          <svg viewBox="0 0 24 24" fill="none"><path d="M10 8L5 12.5l5 4.5M5.5 12.5H14a5 5 0 015 5V19" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
        <button class="gmb-act" title="More" aria-label="More actions" @click.stop="emit('menu', $event)">
          <svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5.5" cy="12" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="18.5" cy="12" r="1.7"/></svg>
        </button>
      </div>
    </div>

    <div v-if="item.reactions.length && !item.deleted" class="gmb-reactions">
      <button
        v-for="r in item.reactions"
        :key="r.emoji"
        class="gmb-chip"
        :class="{ mine: r.mine }"
        :title="r.users.map(u => u.name).join(', ')"
        @click.stop="emit('react', r.mine ? '' : r.emoji)"
      >{{ r.emoji }} <span>{{ r.users.length }}</span></button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import GroupMediaView from './GroupMediaView.vue';
import { formatChatText, senderHue } from '@/utils/chatFormat';
import type { TimelineItem } from '@/utils/groupTimeline';

const props = defineProps<{
  item: TimelineItem;
  mine: boolean;
  grouped: boolean;
  flash: boolean;
  /** Display names this message mentions, for highlighting. */
  mentionNames: string[];
  /** Other-member read count, and how many other members exist. */
  readCount: number;
  otherCount: number;
}>();
const emit = defineEmits<{
  (e: 'reply'): void;
  (e: 'react', emoji: string): void;
  (e: 'reactPicker', ev: Event): void;
  (e: 'menu', ev: Event): void;
  (e: 'jump', messageId: string): void;
  (e: 'vote', choices: number[]): void;
  (e: 'openMedia', url: string): void;
}>();

const html = computed(() => formatChatText(props.item.text, props.mentionNames));
const time = computed(() => new Date(props.item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
const canVote = computed(() => props.item.status !== 'failed');

const statusIcon = computed(() => {
  const s = props.item.status;
  if (s === 'failed') return '!';
  if (s && s !== 'confirmed') return '🕓';
  if (props.otherCount > 0 && props.readCount >= props.otherCount) return '✓✓';
  return props.readCount > 0 ? '✓✓' : '✓';
});
const statusClass = computed(() => ({
  failed: props.item.status === 'failed',
  read: props.otherCount > 0 && props.readCount >= props.otherCount,
}));
const statusTitle = computed(() => {
  if (props.item.status === 'failed') return props.item.error || 'Not delivered — will retry';
  if (props.item.status && props.item.status !== 'confirmed') return 'Saved on this device, still syncing';
  return props.otherCount ? `Seen by ${props.readCount} of ${props.otherCount}` : 'Delivered';
});

function pct(i: number) {
  const p = props.item.poll!;
  return p.voters ? Math.round((p.votes[i].length / p.voters) * 100) : 0;
}
function toggleVote(i: number) {
  const p = props.item.poll!;
  const has = p.myChoices.includes(i);
  const next = p.multi ? (has ? p.myChoices.filter(c => c !== i) : [...p.myChoices, i].sort((a, b) => a - b)) : (has ? [] : [i]);
  emit('vote', next);
}

// Long-press opens the menu on touch devices, like WhatsApp.
let pressTimer: ReturnType<typeof setTimeout> | null = null;
function pressStart(ev: TouchEvent) {
  pressTimer = setTimeout(() => { pressTimer = null; emit('menu', ev); }, 480);
}
function pressEnd() {
  if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; }
}
</script>

<style scoped>
.gmb { --gmb-radius: 18px; display: flex; flex-direction: column; max-width: min(78%, 560px); position: relative; }
.gmb.sent { align-items: flex-end; }
.gmb.received { align-items: flex-start; }
.gmb-sender { font-size: 12.5px; font-weight: 650; padding: 0 12px 3px; color: hsl(var(--gmb-hue) 60% 45%); }
:global(html.dark) .gmb-sender { color: hsl(var(--gmb-hue) 70% 68%); }
.gmb-row { display: flex; align-items: center; gap: 4px; max-width: 100%; }
.gmb.sent .gmb-row { flex-direction: row-reverse; }

.gmb-bubble { position: relative; padding: 7px 12px 6px; border-radius: var(--gmb-radius); min-width: 72px; max-width: 100%; overflow-wrap: anywhere; transition: box-shadow 0.3s ease; }
.gmb.sent .gmb-bubble { background: var(--app-accent); color: #111214; border-bottom-right-radius: 6px; }
.gmb.received .gmb-bubble { background: var(--app-bg-elevated); color: var(--app-text); border: 1px solid var(--app-border); border-bottom-left-radius: 6px; }
.gmb.grouped.sent .gmb-bubble { border-top-right-radius: 6px; }
.gmb.grouped.received .gmb-bubble { border-top-left-radius: 6px; }
.gmb.mention .gmb-bubble { box-shadow: inset 3px 0 0 var(--app-warning, #f59e0b); }
.gmb.flash .gmb-bubble { box-shadow: 0 0 0 3px rgba(var(--app-accent-rgb), 0.55); }
.gmb-bubble.deleted { background: transparent !important; border: 1px dashed var(--app-border-strong, var(--app-border)) !important; color: var(--app-text-muted) !important; }

.gmb-forwarded { font-size: 12px; font-style: italic; opacity: 0.8; margin-bottom: 2px; }
.gmb-quote { display: flex; flex-direction: column; align-items: flex-start; width: 100%; margin: 2px 0 6px; padding: 6px 10px; border: none; border-left: 3px solid currentColor; border-radius: 8px; background: rgba(0, 0, 0, 0.08); color: inherit; font: inherit; text-align: left; cursor: pointer; }
.gmb.sent .gmb-quote { background: rgba(255, 255, 255, 0.16); }
.gmb-quote.missing { font-style: italic; opacity: 0.7; cursor: default; }
.gmb-quote-name { font-size: 12.5px; font-weight: 650; }
.gmb-quote-text { font-size: 13px; opacity: 0.85; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }

.gmb-text { margin: 0; font-size: 15px; line-height: 1.42; color: inherit; }
.gmb-deleted { font-style: italic; font-size: 14px; }
.gmb-text :deep(a) { color: inherit; text-decoration: underline; text-underline-offset: 2px; }
.gmb-text :deep(.fmt-code) { font-family: ui-monospace, SFMono-Regular, monospace; font-size: 13.5px; padding: 1px 5px; border-radius: 5px; background: rgba(0, 0, 0, 0.12); }
.gmb-text :deep(.fmt-pre) { font-family: ui-monospace, SFMono-Regular, monospace; font-size: 13px; padding: 8px 10px; margin: 4px 0; border-radius: 8px; background: rgba(0, 0, 0, 0.14); white-space: pre-wrap; }
.gmb-text :deep(.fmt-mention) { font-weight: 650; border-radius: 4px; padding: 0 2px; background: rgba(var(--app-accent-rgb), 0.16); }
.gmb.sent .gmb-text :deep(.fmt-mention) { background: rgba(255, 255, 255, 0.22); }

.gmb-meta { display: flex; align-items: center; justify-content: flex-end; gap: 5px; margin-top: 2px; font-size: 11px; line-height: 1; opacity: 0.72; }
.gmb-edited, .gmb-pin { font-style: italic; }
.gmb-status { display: inline-flex; }
.gmb-status svg { width: 16px; height: 14px; }
.gmb-status.read { opacity: 1; color: #a5f3fc; }
.gmb-status.failed { color: #fde68a; opacity: 1; }

.gmb-actions { display: flex; gap: 2px; opacity: 0; transition: opacity 0.15s ease; }
.gmb:hover .gmb-actions, .gmb:focus-within .gmb-actions { opacity: 1; }
@media (hover: none) { .gmb-actions { display: none; } }
.gmb-act { width: 30px; height: 30px; border-radius: 50%; border: none; background: transparent; color: var(--app-text-muted); cursor: pointer; display: flex; align-items: center; justify-content: center; }
.gmb-act svg { width: 18px; height: 18px; }
.gmb-act:hover, .gmb-act:focus-visible { background: rgba(var(--app-accent-rgb), 0.12); color: var(--app-text); outline: none; }

.gmb-reactions { display: flex; flex-wrap: wrap; gap: 4px; margin-top: -6px; padding: 0 8px; position: relative; z-index: 1; }
.gmb-chip { display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px; border-radius: 999px; font-size: 14px; cursor: pointer; background: var(--app-bg-elevated); border: 1px solid var(--app-border-strong, var(--app-border)); color: var(--app-text); box-shadow: 0 1px 2px rgba(0, 0, 0, 0.12); }
.gmb-chip span { font-size: 12px; font-weight: 650; color: var(--app-text-muted); }
.gmb-chip.mine { border-color: var(--app-accent); background: rgba(var(--app-accent-rgb), 0.16); }
.gmb-chip:focus-visible { outline: none; box-shadow: var(--app-focus-ring); }

.gmb-poll { min-width: min(260px, 70vw); margin-bottom: 4px; }
.gmb-poll-q { font-weight: 650; font-size: 15px; margin-bottom: 2px; }
.gmb-poll-hint { font-size: 12px; opacity: 0.75; margin-bottom: 8px; }
.gmb-poll-opt { position: relative; display: flex; align-items: center; gap: 10px; width: 100%; padding: 9px 10px; margin-bottom: 6px; border-radius: 10px; border: 1px solid currentColor; border-color: color-mix(in srgb, currentColor 25%, transparent); background: transparent; color: inherit; font: inherit; font-size: 14px; text-align: left; cursor: pointer; overflow: hidden; }
.gmb-poll-opt:focus-visible { outline: none; box-shadow: var(--app-focus-ring); }
.gmb-poll-opt:disabled { cursor: not-allowed; }
.gmb-poll-bar { position: absolute; inset: 0 auto 0 0; background: color-mix(in srgb, currentColor 14%, transparent); transition: width 0.3s ease; z-index: 0; }
.gmb-poll-check, .gmb-poll-label, .gmb-poll-count { position: relative; z-index: 1; }
.gmb-poll-check { width: 16px; height: 16px; flex-shrink: 0; border-radius: 50%; border: 2px solid currentColor; opacity: 0.7; }
.gmb-poll-check.multi { border-radius: 4px; }
.gmb-poll-opt.chosen .gmb-poll-check { opacity: 1; background: currentColor; box-shadow: inset 0 0 0 2.5px var(--app-bg-elevated); }
.gmb.sent .gmb-poll-opt.chosen .gmb-poll-check { box-shadow: inset 0 0 0 2.5px var(--app-accent); }
.gmb-poll-label { flex: 1; }
.gmb-poll-count { font-weight: 650; font-size: 13px; }
.gmb-poll-total { font-size: 12px; opacity: 0.75; }
@media (prefers-reduced-motion: reduce) { .gmb-actions, .gmb-bubble, .gmb-poll-bar { transition: none; } }
</style>
