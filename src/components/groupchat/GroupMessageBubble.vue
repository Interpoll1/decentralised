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
    <span v-if="!mine && !grouped" class="gmb-sender" :style="{ color: senderColor(item.senderId) }">{{ item.senderName }}</span>

    <div class="gmb-row">
      <div class="gmb-bubble" :class="{ deleted: item.deleted }">
        <div v-if="item.forwarded && !item.deleted" class="gmb-forwarded">↪ Forwarded</div>
        <button v-if="item.reply && !item.deleted" class="gmb-quote" :class="{ missing: item.reply.missing }" @click.stop="emit('jump', item.reply.messageId)">
          <span v-if="!item.reply.missing" class="gmb-quote-name">{{ item.reply.senderName }}</span>
          <span class="gmb-quote-text">{{ item.reply.text }}</span>
        </button>

        <p v-if="item.deleted" class="gmb-text gmb-deleted">🚫 This message was deleted</p>
        <template v-else>
          <GroupMediaView v-if="item.media" :media="item.media" @open="url => emit('openMedia', url)" />
          <div v-if="item.poll" class="gmb-poll">
            <div class="gmb-poll-q">📊 {{ item.poll.question }}</div>
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
              <span class="gmb-poll-check">{{ item.poll.myChoices.includes(i) ? '●' : '○' }}</span>
              <span class="gmb-poll-label">{{ opt }}</span>
              <span class="gmb-poll-count" :title="item.poll.votes[i].map(v => v.name).join(', ')">{{ item.poll.votes[i].length }}</span>
            </button>
            <div class="gmb-poll-total">{{ item.poll.voters }} {{ item.poll.voters === 1 ? 'vote' : 'votes' }}</div>
          </div>
          <p v-if="item.text" class="gmb-text" v-html="html"></p>
        </template>

        <div class="gmb-meta">
          <span v-if="item.pinned" class="gmb-pin" title="Pinned">📌</span>
          <span v-if="item.edited && !item.deleted" class="gmb-edited">edited</span>
          <span class="gmb-time" :title="new Date(item.timestamp).toLocaleString()">{{ time }}</span>
          <span v-if="mine" class="gmb-status" :class="statusClass" :title="statusTitle">{{ statusIcon }}</span>
        </div>
      </div>

      <div class="gmb-actions">
        <button class="gmb-act" title="React" @click.stop="emit('reactPicker', $event)">😊</button>
        <button class="gmb-act" title="Reply" @click.stop="emit('reply')">↩</button>
        <button class="gmb-act" title="More" @click.stop="emit('menu', $event)">⋯</button>
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
import { formatChatText, senderColor } from '@/utils/chatFormat';
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
.gmb { display: flex; flex-direction: column; max-width: 78%; margin-bottom: 6px; position: relative; }
.gmb.grouped { margin-top: -3px; }
.gmb.sent { align-self: flex-end; align-items: flex-end; }
.gmb.received { align-self: flex-start; align-items: flex-start; }
.gmb-sender { font-size: 11.5px; font-weight: 700; padding: 0 8px; margin-bottom: 2px; letter-spacing: .02em; }
.gmb-row { display: flex; align-items: center; gap: 4px; max-width: 100%; }
.gmb.sent .gmb-row { flex-direction: row-reverse; }

.gmb-bubble { padding: 7px 12px 5px; border-radius: 18px; min-width: 64px; max-width: 100%; overflow-wrap: anywhere; transition: box-shadow .3s ease; }
.gmb.sent .gmb-bubble { background: linear-gradient(135deg,#6366f1,#8b5cf6); color: #fff; border-bottom-right-radius: 5px; }
.gmb.received .gmb-bubble { background: rgba(255,255,255,.07); border: 1px solid rgba(255,255,255,.09); color: var(--app-text); border-bottom-left-radius: 5px; }
.gmb.grouped.sent .gmb-bubble { border-top-right-radius: 8px; }
.gmb.grouped.received .gmb-bubble { border-top-left-radius: 8px; }
.gmb.mention .gmb-bubble { border-color: rgba(245,158,11,.55); box-shadow: inset 3px 0 0 #f59e0b; }
.gmb.flash .gmb-bubble { box-shadow: 0 0 0 3px rgba(250,204,21,.7); }
.gmb-bubble.deleted { opacity: .7; }

.gmb-forwarded { font-size: 11.5px; font-style: italic; opacity: .75; margin-bottom: 2px; }
.gmb-quote { display: flex; flex-direction: column; align-items: flex-start; width: 100%; text-align: left; margin: 2px 0 5px; padding: 5px 9px; border: none; border-left: 3px solid #a5b4fc; border-radius: 8px; background: rgba(0,0,0,.18); color: inherit; cursor: pointer; font: inherit; }
.gmb-quote.missing { font-style: italic; opacity: .7; cursor: default; }
.gmb-quote-name { font-size: 11.5px; font-weight: 700; color: #c7d2fe; }
.gmb-quote-text { font-size: 12.5px; opacity: .85; overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }

.gmb-text { margin: 0; font-size: 14.5px; line-height: 1.45; white-space: normal; color: inherit; }
.gmb-deleted { font-style: italic; opacity: .8; font-size: 13.5px; }
.gmb-text :deep(a) { color: inherit; text-decoration: underline; }
.gmb-text :deep(.fmt-code) { font-family: ui-monospace, monospace; font-size: 13px; padding: 1px 5px; border-radius: 5px; background: rgba(0,0,0,.25); }
.gmb-text :deep(.fmt-pre) { font-family: ui-monospace, monospace; font-size: 12.5px; padding: 8px 10px; margin: 4px 0; border-radius: 8px; background: rgba(0,0,0,.3); white-space: pre-wrap; }
.gmb-text :deep(.fmt-mention) { font-weight: 700; color: #fcd34d; background: rgba(245,158,11,.14); border-radius: 4px; padding: 0 2px; }

.gmb-meta { display: flex; align-items: center; justify-content: flex-end; gap: 4px; margin-top: 2px; font-size: 10.5px; opacity: .75; }
.gmb-edited { font-style: italic; }
.gmb-status { font-size: 10.5px; letter-spacing: -2px; padding-right: 2px; }
.gmb-status.read { color: #67e8f9; opacity: 1; }
.gmb-status.failed { color: #fbbf24; font-weight: 800; letter-spacing: 0; }

.gmb-actions { display: flex; gap: 2px; opacity: 0; transition: opacity .15s ease; }
.gmb:hover .gmb-actions { opacity: 1; }
@media (hover: none) { .gmb-actions { display: none; } }
.gmb-act { width: 28px; height: 28px; border-radius: 50%; border: none; background: rgba(255,255,255,.07); color: var(--app-text-muted); cursor: pointer; font-size: 14px; display: flex; align-items: center; justify-content: center; }
.gmb-act:hover { background: rgba(255,255,255,.14); color: var(--app-text); }

.gmb-reactions { display: flex; flex-wrap: wrap; gap: 4px; margin-top: -4px; padding: 0 6px; position: relative; z-index: 1; }
.gmb-chip { display: inline-flex; align-items: center; gap: 3px; padding: 2px 8px; border-radius: 999px; font-size: 13px; cursor: pointer; background: var(--app-bg-elevated, #1f2937); border: 1px solid rgba(255,255,255,.12); color: var(--app-text); }
.gmb-chip span { font-size: 11.5px; font-weight: 700; color: var(--app-text-muted); }
.gmb-chip.mine { border-color: #818cf8; background: rgba(99,102,241,.25); }

.gmb-poll { min-width: 230px; margin-bottom: 4px; }
.gmb-poll-q { font-weight: 700; font-size: 14.5px; margin-bottom: 2px; }
.gmb-poll-hint { font-size: 11.5px; opacity: .7; margin-bottom: 6px; }
.gmb-poll-opt { position: relative; display: flex; align-items: center; gap: 8px; width: 100%; padding: 7px 10px; margin-bottom: 5px; border-radius: 10px; border: 1px solid rgba(255,255,255,.18); background: rgba(0,0,0,.12); color: inherit; font: inherit; font-size: 13.5px; cursor: pointer; overflow: hidden; text-align: left; }
.gmb-poll-opt.chosen { border-color: #c7d2fe; }
.gmb-poll-opt:disabled { cursor: not-allowed; }
.gmb-poll-bar { position: absolute; inset: 0 auto 0 0; background: rgba(255,255,255,.14); transition: width .3s ease; z-index: 0; }
.gmb-poll-check, .gmb-poll-label, .gmb-poll-count { position: relative; z-index: 1; }
.gmb-poll-label { flex: 1; }
.gmb-poll-count { font-weight: 700; font-size: 12.5px; }
.gmb-poll-total { font-size: 11.5px; opacity: .75; }
</style>
