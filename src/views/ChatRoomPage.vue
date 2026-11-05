<template>
  <ion-page class="room" :class="{ 'room--embedded': embedded }">
    <ion-header class="room-header">
      <ion-toolbar>
        <div class="bar">
          <button v-if="!embedded" class="icon-btn" aria-label="Back" @click="$router.back()">
            <svg viewBox="0 0 24 24" fill="none"><path d="M15 18l-6-6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
          <button class="bar-identity" :disabled="!ready" aria-label="Group info" @click="openInfo">
            <ChatAvatar :name="roomTitle" :seed="roomId" group size="lg" />
            <span class="bar-text">
              <span class="bar-name">{{ roomTitle }}</span>
              <span v-if="ready" class="bar-sub" :class="{ 'bar-sub--typing': chatRoomStore.typingNames.length }">{{ subtitle }}</span>
            </span>
          </button>
          <div v-if="embedded && ready" class="sync" :title="`${syncPeers} online · ${syncHealthy ? 'connected to the relay' : 'relay unreachable'}`">
            <span class="sync-label">Synced across {{ syncPeers }} {{ syncPeers === 1 ? 'peer' : 'peers' }}</span>
            <span class="sync-path">
              <template v-for="(n, i) in syncNodes" :key="n.id">
                <i v-if="i > 0" class="sync-line"></i>
                <span class="sync-node"><ChatAvatar :name="n.name" :seed="n.id" size="sm" online /><small>{{ n.name.split(' ')[0] }}</small></span>
              </template>
            </span>
            <span class="sync-health" :class="{ 'sync-health--bad': !syncHealthy }">{{ syncHealthy ? 'Healthy' : 'Offline' }}</span>
          </div>
          <template v-if="ready">
            <button class="icon-btn" :class="{ 'icon-btn--on': searchOpen }" aria-label="Search messages" title="Search messages" @click="toggleSearch">
              <svg viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="6.5" stroke="currentColor" stroke-width="1.9"/><path d="M20 20l-4-4" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg>
            </button>
            <div class="overflow">
              <button class="icon-btn" aria-label="More options" aria-haspopup="menu" :aria-expanded="overflowOpen" @click="toggleOverflow($event)">
                <svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5.5" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="12" cy="18.5" r="1.8"/></svg>
                <span v-if="chatRoomStore.pendingJoins.length" class="dot-badge"></span>
              </button>
              <Teleport to="body">
              <div v-if="overflowOpen" class="pop-backdrop" @click="overflowOpen = false"></div>
              <div v-if="overflowOpen" class="pop" :style="popStyle" role="menu">
                <button class="pop-item" role="menuitem" @click="openInfo">Group info<span v-if="chatRoomStore.pendingJoins.length" class="pop-count">{{ chatRoomStore.pendingJoins.length }}</span></button>
                <button class="pop-item" role="menuitem" @click="overflowOpen = false; copyInvite()">Copy invite link</button>
                <button v-if="chatRoomStore.pinnedMessages.length" class="pop-item" role="menuitem" @click="openInfo">Pinned messages</button>
                <button class="pop-item pop-item--danger" role="menuitem" @click="overflowOpen = false; confirmLeave()">{{ chatRoomStore.isOwner ? 'Close group' : 'Leave group' }}</button>
              </div>
              </Teleport>
            </div>
          </template>
        </div>
      </ion-toolbar>

      <div v-if="ready && searchOpen" class="strip">
        <input ref="searchInput" v-model="searchQuery" class="strip-input" placeholder="Search messages" aria-label="Search messages" @keydown.esc="toggleSearch" />
        <span class="strip-meta">{{ searchQuery.trim() ? `${searchResults.length} found` : '' }}</span>
        <button class="strip-close" @click="toggleSearch">Done</button>
      </div>
      <button v-else-if="ready && chatRoomStore.isOwner && chatRoomStore.pendingJoins.length" class="strip strip--action" @click="openInfo">
        <span class="strip-text">
          <strong>{{ chatRoomStore.pendingJoins[0].name || 'Someone' }}</strong>
          {{ chatRoomStore.pendingJoins.length > 1 ? `and ${chatRoomStore.pendingJoins.length - 1} more want` : 'wants' }} to join
        </span>
        <span class="strip-cta">Review</span>
      </button>
      <button v-else-if="ready && currentPinned" class="strip strip--pin" @click="cyclePinned">
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M9 4h6l-1 5 3 3v2H7v-2l3-3-1-5zM12 14v6" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" stroke-linecap="round"/></svg>
        <span class="strip-text"><span class="strip-label">Pinned{{ chatRoomStore.pinnedMessages.length > 1 ? ` ${pinnedIndex + 1} of ${chatRoomStore.pinnedMessages.length}` : '' }}</span>{{ previewText(currentPinned) }}</span>
      </button>
    </ion-header>

    <ion-content :scroll-y="false" class="room-content">
      <div v-if="initialLoading" class="state">
        <div class="spinner"></div>
        <p class="state-sub">Opening the group…</p>
      </div>

      <div v-else-if="chatRoomStore.error" class="state">
        <p class="state-title">This group couldn't be opened</p>
        <p class="state-sub">{{ chatRoomStore.error }}</p>
        <button class="btn btn--ghost" @click="initRoom">Try again</button>
      </div>

      <!-- Not a member yet -->
      <div v-else-if="!hasAccess" class="state">
        <ChatAvatar :name="''" :seed="roomId" group size="xl" />
        <template v-if="joinState === 'requested'">
          <p class="state-title">{{ joinPassword ? 'Checking the password' : 'Request sent' }}</p>
          <p class="state-sub">
            {{ joinPassword
              ? 'You\'ll be let in as soon as the group creator\'s device confirms it. If the password is wrong, they can still accept you.'
              : 'The group creator will see your request. This screen opens the chat once you\'re accepted.' }}
          </p>
          <div class="spinner small"></div>
          <button v-if="accessMode === 'password'" class="btn btn--ghost" @click="joinState = 'idle'">Try another password</button>
        </template>
        <template v-else>
          <p class="state-title">You've been invited to a group</p>
          <p class="state-sub">
            {{ accessMode === 'password' ? 'Enter the group password to join.' : 'Ask to join and the group creator will accept you.' }}
          </p>
          <input v-if="accessMode === 'password'" v-model="joinPassword" type="password" class="field join-field"
            placeholder="Group password" autocomplete="off" @keydown.enter="requestJoin" />
          <button class="btn btn--primary" :disabled="joinState === 'sending' || (accessMode === 'password' && !joinPassword)" @click="requestJoin">
            {{ joinState === 'sending' ? 'Sending…' : accessMode === 'password' ? 'Join group' : 'Ask to join' }}
          </button>
          <button v-if="accessMode !== 'password'" class="btn btn--link" @click="accessMode = 'password'">I have a password</button>
          <p v-if="joinError" class="state-sub state-error">{{ joinError }}</p>
        </template>
      </div>

      <!-- Search results -->
      <div v-else-if="searchOpen && searchQuery.trim()" class="results">
        <p v-if="!searchResults.length" class="state-sub results-empty">No messages match “{{ searchQuery.trim() }}”.</p>
        <button v-for="m in searchResults" :key="m.id" class="result" @click="jumpTo(m.messageId, true)">
          <ChatAvatar :name="m.senderName" :seed="m.senderId" size="sm" />
          <span class="result-body">
            <span class="result-head"><strong>{{ m.senderId === currentUserId ? 'You' : m.senderName }}</strong><span>{{ formatDay(m.timestamp) }}, {{ formatClock(m.timestamp) }}</span></span>
            <span class="result-text">{{ previewText(m) }}</span>
          </span>
        </button>
      </div>

      <!-- Conversation -->
      <div v-else class="convo" @dragover.prevent="dragOver = true" @dragleave.self="dragOver = false" @drop.prevent="onDrop">
        <div v-if="dragOver" class="drop">Drop to attach</div>
        <div ref="messagesContainer" class="scroller" @scroll="onScroll">
          <div class="column">
            <div v-if="accountCount <= 1" class="intro">
              <ChatAvatar :name="roomTitle" :seed="roomId" group size="xl" />
              <p class="intro-title">{{ roomTitle }}</p>
              <p class="intro-sub">You're the only one here. Send the invite link to bring people in.</p>
              <div class="intro-actions">
                <button class="btn btn--primary" @click="copyInvite">Copy invite link</button>
                <button v-if="canShare" class="btn btn--ghost" @click="shareInviteNative">Share…</button>
              </div>
            </div>
            <p v-else-if="chatRoomStore.timeline.length === 0" class="intro-sub intro-sub--quiet">No messages yet. Say hello 👋</p>

            <template v-for="(item, i) in chatRoomStore.timeline" :key="item.id">
              <div v-if="dayChanged(i)" class="day"><span>{{ formatDay(item.timestamp) }}</span></div>
              <div v-if="item.id === unreadDividerId" class="unread"><span>Unread messages</span></div>
              <div class="line" :class="{ 'line--mine': item.senderId === currentUserId, 'line--cont': isGrouped(i) }">
                <span v-if="item.senderId !== currentUserId" class="line-avatar">
                  <ChatAvatar v-if="showAvatar(i)" :name="item.senderName" :seed="item.senderId" size="sm" />
                </span>
                <GroupMessageBubble
                  :item="item"
                  :mine="item.senderId === currentUserId"
                  :grouped="isGrouped(i)"
                  :flash="flashId === item.messageId"
                  :mention-names="mentionNamesFor(item)"
                  :read-count="item.senderId === currentUserId ? chatRoomStore.readBy(item).length : 0"
                  :other-count="chatRoomStore.otherAccounts.length"
                  @reply="startReply(item)"
                  @react="emoji => react(item, emoji)"
                  @react-picker="ev => openMenu(item, ev, true)"
                  @menu="ev => openMenu(item, ev)"
                  @jump="id => jumpTo(id)"
                  @vote="choices => vote(item, choices)"
                  @open-media="url => (lightbox = url)"
                />
              </div>
            </template>
          </div>
        </div>
        <button v-if="!atBottom" class="to-bottom" aria-label="Scroll to latest" @click="scrollToBottom(true)">
          <svg viewBox="0 0 24 24" fill="none"><path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          <span v-if="newWhileAway" class="to-bottom-count">{{ newWhileAway }}</span>
        </button>
      </div>
    </ion-content>

    <ion-footer v-if="ready" class="room-footer">
      <div class="dock">
        <div v-if="chatRoomStore.typingNames.length" class="typing">
          <span class="typing-dots"><span></span><span></span><span></span></span>{{ typingText }}
        </div>

        <div v-if="replyTo || editing" class="context">
          <span class="context-bar"></span>
          <span class="context-body">
            <span class="context-title">{{ editing ? 'Edit message' : `Reply to ${replyTo!.senderId === currentUserId ? 'yourself' : replyTo!.senderName}` }}</span>
            <span class="context-text">{{ previewText((editing || replyTo)!) }}</span>
          </span>
          <button class="icon-btn icon-btn--sm" aria-label="Cancel" @click="cancelCompose"><svg viewBox="0 0 24 24" fill="none"><path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></button>
        </div>

        <div v-if="pendingFile" class="context">
          <img v-if="pendingPreview" :src="pendingPreview" class="context-thumb" alt="" />
          <span v-else class="context-file">📄</span>
          <span class="context-body">
            <span class="context-title">{{ pendingFile.name || 'Attachment' }}</span>
            <span class="context-text">{{ formatSize(pendingFile.size) }} · add a caption or just send</span>
          </span>
          <button class="icon-btn icon-btn--sm" aria-label="Remove attachment" @click="clearPendingFile"><svg viewBox="0 0 24 24" fill="none"><path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></button>
        </div>

        <div v-if="mentionMatches.length" class="suggest" role="listbox">
          <button v-for="(m, idx) in mentionMatches" :key="m.accountId" class="suggest-item" :class="{ on: idx === mentionIndex }" role="option" :aria-selected="idx === mentionIndex" @mousedown.prevent="applyMention(m)">
            <ChatAvatar :name="m.name" :seed="m.accountId" size="sm" />{{ m.name }}
          </button>
        </div>

        <Teleport to="body">
          <div v-if="emojiOpen" class="pop-backdrop" @click="emojiOpen = false"></div>
          <div v-if="emojiOpen" class="pop emoji-grid" :style="emojiStyle" role="menu">
            <button v-for="e in EMOJI_PICKER" :key="e" class="emoji-cell" @click="insertEmoji(e)">{{ e }}</button>
          </div>
        </Teleport>

        <div class="composer" :class="{ 'composer--rec': recording }">
          <template v-if="recording">
            <button class="icon-btn" aria-label="Discard recording" @click="stopRecording(false)">
              <svg viewBox="0 0 24 24" fill="none"><path d="M5 7h14M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </button>
            <span class="rec"><span class="rec-dot"></span>{{ recordClock }}<span class="rec-hint">Recording</span></span>
            <button class="send" aria-label="Send voice message" @click="stopRecording(true)">
              <svg viewBox="0 0 24 24" fill="currentColor"><path d="M3.4 20.4l17.4-7.5c.8-.4.8-1.5 0-1.8L3.4 3.6c-.7-.3-1.4.3-1.2 1l1.6 6.2c.1.4.4.6.8.7L12 12l-7.4.5c-.4.1-.7.3-.8.7l-1.6 6.2c-.2.7.5 1.3 1.2 1z"/></svg>
            </button>
          </template>
          <template v-else>
            <div class="attach">
              <button class="icon-btn" :class="{ 'icon-btn--on': attachOpen }" aria-label="Attach" aria-haspopup="menu" :aria-expanded="attachOpen" :disabled="!!editing" @click="toggleAttach($event)">
                <svg viewBox="0 0 24 24" fill="none"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
              </button>
              <Teleport to="body">
              <div v-if="attachOpen" class="pop-backdrop" @click="attachOpen = false"></div>
              <div v-if="attachOpen" class="pop" :style="popStyle" role="menu">
                <button class="pop-item pop-item--icon" role="menuitem" @click="pickFile('media')">
                  <span class="pop-ico pop-ico--media"><svg viewBox="0 0 24 24" fill="none"><rect x="3" y="5" width="18" height="14" rx="2.5" stroke="currentColor" stroke-width="1.8"/><circle cx="9" cy="10" r="1.6" fill="currentColor"/><path d="M4 17l5-4.5 4 3.5 3-2.5 4 3.5" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg></span>
                  Photo or video
                </button>
                <button class="pop-item pop-item--icon" role="menuitem" @click="pickFile('file')">
                  <span class="pop-ico pop-ico--file"><svg viewBox="0 0 24 24" fill="none"><path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8l-5-5z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M14 3v5h5" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg></span>
                  Document
                </button>
                <button class="pop-item pop-item--icon" role="menuitem" @click="attachOpen = false; openPollComposer()">
                  <span class="pop-ico pop-ico--poll"><svg viewBox="0 0 24 24" fill="none"><path d="M5 20V11M12 20V4M19 20v-6" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg></span>
                  Poll
                </button>
              </div>
              </Teleport>
            </div>
            <input ref="fileInput" type="file" hidden @change="onFilePicked" />
            <div class="field-wrap">
              <textarea
                ref="inputEl"
                v-model="messageInput"
                data-test="composer"
                @keydown="onKeydown"
                @input="onInput"
                @paste="onPaste"
                @blur="chatRoomStore.stopTyping()"
                :placeholder="editing ? 'Edit your message' : 'Message'"
                :disabled="!chatRoomStore.currentRoom"
                class="message-input"
                rows="1"
                aria-label="Message"
              />
              <button class="icon-btn icon-btn--sm" :class="{ 'icon-btn--on': emojiOpen }" aria-label="Emoji" @click="toggleEmoji($event)">
                <svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="8.5" stroke="currentColor" stroke-width="1.8"/><path d="M8.5 14c.9 1.3 2.1 2 3.5 2s2.6-.7 3.5-2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="9.3" cy="9.8" r="1.1" fill="currentColor"/><circle cx="14.7" cy="9.8" r="1.1" fill="currentColor"/></svg>
              </button>
            </div>
            <button v-if="canSend" class="send" :disabled="isSending" :aria-label="editing ? 'Save edit' : 'Send'" @click="handleSend">
              <svg v-if="editing" viewBox="0 0 24 24" fill="none"><path d="M5 12.5l4.5 4.5L19 7.5" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
              <svg v-else viewBox="0 0 24 24" fill="currentColor"><path d="M3.4 20.4l17.4-7.5c.8-.4.8-1.5 0-1.8L3.4 3.6c-.7-.3-1.4.3-1.2 1l1.6 6.2c.1.4.4.6.8.7L12 12l-7.4.5c-.4.1-.7.3-.8.7l-1.6 6.2c-.2.7.5 1.3 1.2 1z"/></svg>
            </button>
            <button v-else class="send send--quiet" aria-label="Record voice message" :disabled="!canRecord" @click="startRecording">
              <svg viewBox="0 0 24 24" fill="none"><rect x="9" y="3" width="6" height="11" rx="3" stroke="currentColor" stroke-width="2"/><path d="M5.5 11a6.5 6.5 0 0013 0M12 17.5V21" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
            </button>
          </template>
        </div>
      </div>
    </ion-footer>

    <!-- Message actions -->
    <Teleport to="body">
    <div v-if="menu" class="menu-backdrop" @click="closeMenu" @contextmenu.prevent="closeMenu">
      <div class="menu" :style="menu.style" role="menu" @click.stop>
        <div class="menu-reacts">
          <button v-for="e in QUICK_REACTIONS" :key="e" class="menu-react" :class="{ mine: myReaction(menu.item) === e }" :aria-label="`React ${e}`" @click="react(menu.item, myReaction(menu.item) === e ? '' : e); menu = null">{{ e }}</button>
          <button class="menu-react menu-react--more" aria-label="More reactions" @click="menu.moreEmoji = !menu.moreEmoji">
            <svg viewBox="0 0 24 24" fill="none"><path d="M12 6v12M6 12h12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
          </button>
        </div>
        <div v-if="menu.moreEmoji" class="menu-emoji">
          <button v-for="e in EMOJI_PICKER" :key="e" class="emoji-cell" @click="react(menu.item, e); menu = null">{{ e }}</button>
        </div>
        <template v-if="!menu.reactOnly && !menu.item.deleted">
          <button class="menu-item" role="menuitem" @click="startReply(menu.item); menu = null">Reply</button>
          <button v-if="menu.item.text" class="menu-item" role="menuitem" @click="copyText(menu.item); menu = null">Copy text</button>
          <button class="menu-item" role="menuitem" @click="openForward(menu.item); menu = null">Forward</button>
          <button class="menu-item" role="menuitem" @click="togglePin(menu.item); menu = null">{{ menu.item.pinned ? 'Unpin' : 'Pin to top' }}</button>
          <button v-if="menu.item.senderId === currentUserId && !menu.item.poll && menu.item.status !== 'failed'" class="menu-item" role="menuitem" @click="startEdit(menu.item); menu = null">Edit</button>
          <button v-if="menu.item.senderId === currentUserId" class="menu-item" role="menuitem" @click="infoFor = menu.item; menu = null">Seen by…</button>
          <button v-if="menu.item.senderId === currentUserId" class="menu-item menu-item--danger" role="menuitem" @click="confirmDelete(menu.item); menu = null">Delete for everyone</button>
        </template>
      </div>
    </div>
    </Teleport>

    <!-- Poll composer -->
    <ion-modal :is-open="pollOpen" class="sheet" @didDismiss="pollOpen = false">
      <div class="sheet-body">
        <h2 class="sheet-title">Create a poll</h2>
        <label class="label" for="poll-q">Question</label>
        <input id="poll-q" v-model="pollQuestion" class="field" maxlength="300" placeholder="Ask the group something" />
        <label class="label">Options</label>
        <div v-for="(_, i) in pollOptions" :key="i" class="poll-row">
          <input v-model="pollOptions[i]" class="field" maxlength="200" :placeholder="i < 2 ? `Option ${i + 1}` : 'Add another option'" :aria-label="`Option ${i + 1}`" @input="growPollOptions" />
          <button v-if="pollOptions.length > 2 && i < pollOptions.length - 1" class="icon-btn icon-btn--sm" :aria-label="`Remove option ${i + 1}`" @click="pollOptions.splice(i, 1)"><svg viewBox="0 0 24 24" fill="none"><path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></button>
        </div>
        <label class="check"><input type="checkbox" v-model="pollMulti" /> Let people pick more than one</label>
        <div class="sheet-actions">
          <button class="btn btn--ghost" @click="pollOpen = false">Cancel</button>
          <button class="btn btn--primary" :disabled="!pollValid || isSending" @click="sendPoll">Send poll</button>
        </div>
      </div>
    </ion-modal>

    <!-- Group info -->
    <ion-modal :is-open="showMembers" class="sheet sheet--tall" @didDismiss="showMembers = false">
      <div class="sheet-body info">
        <button class="icon-btn info-close" aria-label="Close" @click="showMembers = false"><svg viewBox="0 0 24 24" fill="none"><path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></button>
        <div class="info-top">
          <ChatAvatar :name="roomTitle" :seed="roomId" group size="xl" />
          <h2 class="info-name">{{ roomTitle }}</h2>
          <p class="info-meta">Group, {{ accountCount }} {{ accountCount === 1 ? 'member' : 'members' }}</p>
          <p v-if="chatRoomStore.currentRoom?.description" class="info-desc">{{ chatRoomStore.currentRoom.description }}</p>
        </div>
        <div class="info-actions">
          <button class="info-action" @click="copyInvite">
            <svg viewBox="0 0 24 24" fill="none"><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
            Invite link
          </button>
          <button v-if="canShare" class="info-action" @click="shareInviteNative">
            <svg viewBox="0 0 24 24" fill="none"><path d="M12 15V3M8 7l4-4 4 4M5 12v7a2 2 0 002 2h10a2 2 0 002-2v-7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
            Share
          </button>
          <button class="info-action" @click="showMembers = false; toggleSearch()">
            <svg viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="6.5" stroke="currentColor" stroke-width="1.8"/><path d="M20 20l-4-4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
            Search
          </button>
        </div>

        <section v-if="chatRoomStore.pinnedMessages.length" class="info-section">
          <h3 class="info-h">Pinned</h3>
          <button v-for="p in chatRoomStore.pinnedMessages" :key="p.id" class="result" @click="showMembers = false; jumpTo(p.messageId)">
            <ChatAvatar :name="p.senderName" :seed="p.senderId" size="sm" />
            <span class="result-body">
              <span class="result-head"><strong>{{ p.senderId === currentUserId ? 'You' : p.senderName }}</strong><span>{{ formatDay(p.timestamp) }}</span></span>
              <span class="result-text">{{ previewText(p) }}</span>
            </span>
          </button>
        </section>

        <GroupMembersPanel />

        <button class="leave" @click="confirmLeave">{{ chatRoomStore.isOwner ? 'Close group' : 'Leave group' }}</button>
      </div>
    </ion-modal>

    <!-- Seen by -->
    <ion-modal :is-open="!!infoFor" class="sheet" @didDismiss="infoFor = null">
      <div v-if="infoFor" class="sheet-body">
        <h2 class="sheet-title">Seen by</h2>
        <p class="quote">{{ previewText(infoFor) }}</p>
        <p v-if="!infoReaders.length" class="state-sub">Nobody has seen it yet.</p>
        <div v-for="a in infoReaders" :key="a" class="person"><ChatAvatar :name="chatRoomStore.displayName(a)" :seed="a" size="sm" />{{ chatRoomStore.displayName(a) }}</div>
        <template v-if="infoUnread.length">
          <h3 class="info-h">Not yet</h3>
          <div v-for="a in infoUnread" :key="a" class="person person--muted"><ChatAvatar :name="chatRoomStore.displayName(a)" :seed="a" size="sm" />{{ chatRoomStore.displayName(a) }}</div>
        </template>
        <p class="sheet-foot">Sent {{ new Date(infoFor.timestamp).toLocaleString() }}</p>
      </div>
    </ion-modal>

    <!-- Forward -->
    <ion-modal :is-open="!!forwarding" class="sheet" @didDismiss="forwarding = null">
      <div class="sheet-body">
        <h2 class="sheet-title">Forward to</h2>
        <p v-if="!forwardRooms.length" class="state-sub">You're not in any other groups yet.</p>
        <button v-for="r in forwardRooms" :key="r.id" class="result" @click="doForward(r.id)">
          <ChatAvatar :name="r.name" :seed="r.id" group size="sm" />
          <span class="result-body"><span class="result-head"><strong>{{ r.name }}</strong><span>{{ r.memberCount }} members</span></span></span>
        </button>
      </div>
    </ion-modal>

    <div v-if="lightbox" class="lightbox" role="dialog" aria-label="Image" @click="lightbox = ''"><img :src="lightbox" alt="" /></div>
  </ion-page>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick, watch } from 'vue';
import { useRoute } from 'vue-router';
import {
  IonPage, IonHeader, IonToolbar, IonContent, IonModal,
  IonFooter, toastController, alertController,
} from '@ionic/vue';
import { useRouter } from 'vue-router';
import { useChatRoomStore } from '@/stores/chatRoomStore';
import { ChatRoomService } from '@/services/chatRoomService';
import { KeyVaultService } from '@/services/keyVaultService';
import { UserService } from '@/services/userService';
import { GunService } from '@/services/gunService';
import { InviteLinkService } from '@/services/inviteLinkService';
import type { ChatRoom } from '@/services/chatRoomService';
import GroupMessageBubble from '@/components/groupchat/GroupMessageBubble.vue';
import GroupMembersPanel from '@/components/groupchat/GroupMembersPanel.vue';
import ChatAvatar from '@/components/groupchat/ChatAvatar.vue';
import { previewText, type TimelineItem } from '@/utils/groupTimeline';
import { EMOJI_PICKER, QUICK_REACTIONS } from '@/utils/chatFormat';

const props = defineProps<{ roomId: string; /** Rendered inside the desktop Messages workspace rather than as a routed page. */ embedded?: boolean }>();

const route = useRoute();
const router = useRouter();
const chatRoomStore = useChatRoomStore();

const messagesContainer = ref<HTMLDivElement | null>(null);
const inputEl = ref<HTMLTextAreaElement | null>(null);
const fileInput = ref<HTMLInputElement | null>(null);
const searchInput = ref<HTMLInputElement | null>(null);
const messageInput = ref('');
const initialLoading = ref(true);
const hasAccess = ref(false);
const currentUserId = ref('');
const currentUserName = ref('');
const isSending = ref(false);
const roomTitle = ref('Loading...');

const roomId = computed(() => props.roomId || (route.params.roomId as string));
const ready = computed(() => hasAccess.value && !initialLoading.value && !chatRoomStore.error);

// ── Header ────────────────────────────────────────────────────────────────
const overflowOpen = ref(false);
const attachOpen = ref(false);
const accountCount = computed(() => new Set(chatRoomStore.members.map(m => m.accountId)).size || chatRoomStore.currentRoom?.memberCount || 0);
const inviteLink = computed(() => InviteLinkService.generateInviteLink(roomId.value, 'chatroom', 'epoch-v1'));
const canShare = typeof navigator !== 'undefined' && 'share' in navigator;
async function shareInviteNative() {
  await navigator.share({ title: roomTitle.value, text: `Join "${roomTitle.value}" on InterPoll`, url: inviteLink.value }).catch(() => {});
}
function pickFile(kind: 'media' | 'file') {
  attachOpen.value = false;
  if (!fileInput.value) return;
  fileInput.value.accept = kind === 'media' ? 'image/*,video/*' : '';
  fileInput.value.click();
}
/**
 * Menus render at <body> level: ion-header/ion-footer clip their contents,
 * which hid these menus behind the toolbar.
 */
const popStyle = ref<Record<string, string>>({});
function placePop(ev: Event, above: boolean) {
  const r = (ev.currentTarget as HTMLElement).getBoundingClientRect();
  popStyle.value = above
    ? { left: `${Math.max(8, r.left)}px`, bottom: `${window.innerHeight - r.top + 8}px` }
    : { right: `${Math.max(8, window.innerWidth - r.right)}px`, top: `${r.bottom + 4}px` };
}
const emojiStyle = ref<Record<string, string>>({});
function toggleEmoji(ev: Event) {
  attachOpen.value = false;
  if (!emojiOpen.value) {
    const r = (ev.currentTarget as HTMLElement).getBoundingClientRect();
    const w = Math.min(320, window.innerWidth - 16);
    emojiStyle.value = {
      left: `${Math.max(8, Math.min(r.right - w, window.innerWidth - w - 8))}px`,
      bottom: `${window.innerHeight - r.top + 8}px`,
      width: `${w}px`,
    };
  }
  emojiOpen.value = !emojiOpen.value;
}
function toggleOverflow(ev: Event) { attachOpen.value = false; if (!overflowOpen.value) placePop(ev, false); overflowOpen.value = !overflowOpen.value; }
function toggleAttach(ev: Event) { overflowOpen.value = false; emojiOpen.value = false; if (!attachOpen.value) placePop(ev, true); attachOpen.value = !attachOpen.value; }
function openInfo() { overflowOpen.value = false; showMembers.value = true; }
const typingText = computed(() => {
  const n = chatRoomStore.typingNames;
  if (n.length === 1) return `${n[0]} is typing…`;
  if (n.length === 2) return `${n[0]} and ${n[1]} are typing…`;
  return `${n.length} people are typing…`;
});
const subtitle = computed(() => {
  if (chatRoomStore.typingNames.length) return typingText.value;
  const accounts = accountCount.value;
  const online = chatRoomStore.onlineAccounts.size;
  if (accounts <= 1) return 'Only you — tap to invite people';
  const base = online > 1 ? `${accounts} members, ${online} online` : `${accounts} members`;
  const about = props.embedded ? chatRoomStore.currentRoom?.description : '';
  return about ? `${base} • ${about}` : base;
});

// ── Sync strip (desktop workspace header) ─────────────────────────────────
const syncPeers = computed(() => chatRoomStore.onlineAccounts.size);
const syncNodes = computed(() => {
  const me = currentUserId.value;
  const others = [...chatRoomStore.onlineAccounts].filter(a => a !== me);
  return [me, ...others].filter(Boolean).slice(0, 4).map(id => ({ id, name: chatRoomStore.displayName(id) }));
});
const syncHealthy = ref(true);
let syncTimer: ReturnType<typeof setInterval> | null = null;
function readSync() { try { syncHealthy.value = GunService.getPeerStats().isConnected; } catch { /* keep last */ } }

// ── Timeline helpers ──────────────────────────────────────────────────────
const sameDay = (a: number, b: number) => new Date(a).toDateString() === new Date(b).toDateString();
function dayChanged(i: number) {
  const t = chatRoomStore.timeline;
  return i === 0 || !sameDay(t[i].timestamp, t[i - 1].timestamp);
}
function isGrouped(i: number) {
  const t = chatRoomStore.timeline;
  if (i === 0 || dayChanged(i)) return false;
  return t[i].senderId === t[i - 1].senderId && t[i].timestamp - t[i - 1].timestamp < 5 * 60_000 && t[i].id !== unreadDividerId.value;
}
/** Discord/WhatsApp groups: the sender's avatar sits beside the first bubble of a run. */
function showAvatar(i: number) {
  const t = chatRoomStore.timeline;
  return t[i].senderId !== currentUserId.value && !isGrouped(i);
}
function formatDay(ts: number) {
  const d = new Date(ts), now = new Date();
  if (d.toDateString() === now.toDateString()) return 'Today';
  const y = new Date(now); y.setDate(y.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}) });
}
const formatClock = (ts: number) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const formatSize = (b: number) => b < 1024 ? `${b} B` : b < 1048576 ? `${(b / 1024).toFixed(0)} KB` : `${(b / 1048576).toFixed(1)} MB`;

function mentionNamesFor(item: TimelineItem): string[] {
  if (item.ext?.k !== 'msg' || !item.ext.mentions) return [];
  return item.ext.mentions.map(a => (a === currentUserId.value ? currentUserName.value : chatRoomStore.displayName(a)));
}

/** First message from someone else that arrived after the last visit. */
const unreadDividerId = ref<string | null>(null);
function computeUnreadDivider() {
  const mark = chatRoomStore.readMarkAtOpen;
  const first = chatRoomStore.timeline.find(m => m.timestamp > mark && m.senderId !== currentUserId.value);
  unreadDividerId.value = mark && first ? first.id : null;
}

// ── Scrolling / read state ────────────────────────────────────────────────
const atBottom = ref(true);
const newWhileAway = ref(0);
const flashId = ref('');

function scrollToBottom(smooth = false) {
  const el = messagesContainer.value;
  if (!el) return;
  el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
  newWhileAway.value = 0;
}
function onScroll() {
  const el = messagesContainer.value;
  if (!el) return;
  atBottom.value = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  if (atBottom.value) { newWhileAway.value = 0; maybeMarkRead(); }
}
function maybeMarkRead() {
  if (atBottom.value && document.visibilityState === 'visible') void chatRoomStore.markRead();
}
function onVisibility() { maybeMarkRead(); }

watch(() => chatRoomStore.timeline.length, (len, old) => {
  if (initialLoading.value || !old) return;
  const last = chatRoomStore.timeline[len - 1];
  if (atBottom.value || last?.senderId === currentUserId.value) nextTick(() => { scrollToBottom(true); maybeMarkRead(); });
  else newWhileAway.value += len - old;
});

async function jumpTo(messageId: string, closeSearch = false) {
  if (closeSearch) { searchOpen.value = false; searchQuery.value = ''; }
  await nextTick();
  const el = messagesContainer.value?.querySelector(`[data-mid="${CSS.escape(messageId)}"]`);
  if (!el) {
    const t = await toastController.create({ message: 'That message is not on this device', duration: 1800, position: 'top' });
    return t.present();
  }
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  flashId.value = messageId;
  setTimeout(() => { if (flashId.value === messageId) flashId.value = ''; }, 1600);
}

// ── Pinned ────────────────────────────────────────────────────────────────
const pinnedIndex = ref(0);
const currentPinned = computed(() => {
  const list = chatRoomStore.pinnedMessages;
  return list.length ? list[Math.min(pinnedIndex.value, list.length - 1)] : null;
});
function cyclePinned() {
  if (!currentPinned.value) return;
  void jumpTo(currentPinned.value.messageId);
  pinnedIndex.value = (pinnedIndex.value + 1) % chatRoomStore.pinnedMessages.length;
}

// ── Search ────────────────────────────────────────────────────────────────
const searchOpen = ref(false);
const searchQuery = ref('');
const searchResults = computed(() => {
  const q = searchQuery.value.trim().toLowerCase();
  if (!q) return [];
  return chatRoomStore.timeline
    .filter(m => !m.deleted && (m.text.toLowerCase().includes(q) || m.senderName.toLowerCase().includes(q)
      || m.poll?.question.toLowerCase().includes(q) || m.media?.mediaName.toLowerCase().includes(q)))
    .slice().reverse();
});
function toggleSearch() {
  searchOpen.value = !searchOpen.value;
  searchQuery.value = '';
  if (searchOpen.value) nextTick(() => searchInput.value?.focus());
  else nextTick(() => scrollToBottom());
}

// ── Composer: reply / edit / mentions / emoji / files ─────────────────────
const replyTo = ref<TimelineItem | null>(null);
const editing = ref<TimelineItem | null>(null);
const emojiOpen = ref(false);
const pendingFile = ref<File | null>(null);
const pendingPreview = ref('');
const dragOver = ref(false);
const canSend = computed(() => !!messageInput.value.trim() || !!pendingFile.value);

function focusInput() { nextTick(() => inputEl.value?.focus()); }
function startReply(item: TimelineItem) { editing.value = null; replyTo.value = item; focusInput(); }
function startEdit(item: TimelineItem) {
  replyTo.value = null; clearPendingFile();
  editing.value = item; messageInput.value = item.text; focusInput();
}
function cancelCompose() {
  if (editing.value) messageInput.value = '';
  editing.value = null; replyTo.value = null;
}

/** Mentions: `@` opens a picker; picked names map to signed account ids on send. */
const mentionQuery = ref<string | null>(null);
const mentionIndex = ref(0);
const mentionPicked = new Map<string, string>(); // display name -> accountId
const mentionCandidates = computed(() => {
  const seen = new Set<string>();
  return chatRoomStore.members
    .filter(m => m.accountId !== currentUserId.value && !seen.has(m.accountId) && !!seen.add(m.accountId))
    .map(m => ({ accountId: m.accountId, name: chatRoomStore.displayName(m.accountId) }));
});
const mentionMatches = computed(() => {
  if (mentionQuery.value === null) return [];
  const q = mentionQuery.value.toLowerCase();
  return mentionCandidates.value.filter(m => m.name.toLowerCase().includes(q)).slice(0, 6);
});
function onInput() {
  autosize();
  chatRoomStore.notifyTyping();
  const el = inputEl.value;
  const before = el ? messageInput.value.slice(0, el.selectionStart ?? messageInput.value.length) : messageInput.value;
  const m = before.match(/(?:^|\s)@([^\s@]{0,24})$/);
  mentionQuery.value = m ? m[1] : null;
  mentionIndex.value = 0;
}
function applyMention(m: { accountId: string; name: string }) {
  const el = inputEl.value;
  const pos = el?.selectionStart ?? messageInput.value.length;
  const before = messageInput.value.slice(0, pos).replace(/@([^\s@]{0,24})$/, `@${m.name} `);
  messageInput.value = before + messageInput.value.slice(pos);
  mentionPicked.set(m.name, m.accountId);
  mentionQuery.value = null;
  nextTick(() => { el?.focus(); el?.setSelectionRange(before.length, before.length); });
}
function mentionsIn(text: string) {
  return [...mentionPicked].filter(([name]) => text.includes(`@${name}`)).map(([, id]) => id);
}

function insertEmoji(e: string) {
  const el = inputEl.value;
  const pos = el?.selectionStart ?? messageInput.value.length;
  messageInput.value = messageInput.value.slice(0, pos) + e + messageInput.value.slice(pos);
  nextTick(() => { el?.focus(); el?.setSelectionRange(pos + e.length, pos + e.length); });
}

function autosize() {
  const el = inputEl.value;
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
}

function onKeydown(ev: KeyboardEvent) {
  if (mentionMatches.value.length) {
    if (ev.key === 'ArrowDown') { ev.preventDefault(); mentionIndex.value = (mentionIndex.value + 1) % mentionMatches.value.length; return; }
    if (ev.key === 'ArrowUp') { ev.preventDefault(); mentionIndex.value = (mentionIndex.value - 1 + mentionMatches.value.length) % mentionMatches.value.length; return; }
    if (ev.key === 'Enter' || ev.key === 'Tab') { ev.preventDefault(); applyMention(mentionMatches.value[mentionIndex.value]); return; }
    if (ev.key === 'Escape') { mentionQuery.value = null; return; }
  }
  if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); void handleSend(); return; }
  if (ev.key === 'Escape') { cancelCompose(); emojiOpen.value = false; return; }
  // Discord: ↑ in an empty composer edits your last message.
  if (ev.key === 'ArrowUp' && !messageInput.value) {
    const last = [...chatRoomStore.timeline].reverse().find(m => m.senderId === currentUserId.value && !m.deleted && !m.poll && m.text);
    if (last) { ev.preventDefault(); startEdit(last); }
  }
}

function setPendingFile(file: File) {
  clearPendingFile();
  editing.value = null;
  pendingFile.value = file;
  if (file.type.startsWith('image/')) pendingPreview.value = URL.createObjectURL(file);
  focusInput();
}
function clearPendingFile() {
  if (pendingPreview.value) URL.revokeObjectURL(pendingPreview.value);
  pendingPreview.value = '';
  pendingFile.value = null;
  if (fileInput.value) fileInput.value.value = '';
}
function onFilePicked(ev: Event) {
  const file = (ev.target as HTMLInputElement).files?.[0];
  if (file) setPendingFile(file);
}
function onPaste(ev: ClipboardEvent) {
  const file = [...(ev.clipboardData?.files ?? [])][0];
  if (file) { ev.preventDefault(); setPendingFile(file); }
}
function onDrop(ev: DragEvent) {
  dragOver.value = false;
  const file = ev.dataTransfer?.files?.[0];
  if (file) setPendingFile(file);
}

async function toastError(message: string) {
  const t = await toastController.create({ message, duration: 2600, position: 'top', color: 'danger' });
  await t.present();
}

async function handleSend() {
  const text = messageInput.value.trim();
  if ((!text && !pendingFile.value) || !chatRoomStore.currentRoom || isSending.value) return;
  isSending.value = true;
  emojiOpen.value = false;
  const reply = replyTo.value, edit = editing.value, file = pendingFile.value;
  messageInput.value = '';
  nextTick(autosize);
  try {
    if (edit) {
      if (text && text !== edit.text) await chatRoomStore.editMessage(edit.messageId, text);
    } else if (file) {
      await chatRoomStore.sendMedia(file, text, reply?.messageId);
    } else {
      await chatRoomStore.sendText(text, { replyTo: reply?.messageId, mentions: mentionsIn(text) });
    }
    editing.value = null; replyTo.value = null; clearPendingFile(); mentionPicked.clear();
    nextTick(() => scrollToBottom(true));
  } catch (err: any) {
    messageInput.value = text;
    console.error('Failed to send message:', err);
    await toastError(err?.message?.includes('Owner device') ? 'The group creator is offline — try again when they are back.' : 'Failed to send. Please try again.');
  } finally {
    isSending.value = false;
  }
}

// ── Message actions ───────────────────────────────────────────────────────
interface MenuState { item: TimelineItem; style: Record<string, string>; reactOnly: boolean; moreEmoji: boolean }
const menu = ref<MenuState | null>(null);
function openMenu(item: TimelineItem, ev: Event, reactOnly = false) {
  if (item.deleted && !reactOnly) return;
  const touch = (ev as TouchEvent).touches?.[0];
  const x = touch ? touch.clientX : (ev as MouseEvent).clientX;
  const y = touch ? touch.clientY : (ev as MouseEvent).clientY;
  const w = 280, h = reactOnly ? 70 : 330;
  const left = Math.max(8, Math.min(x - w / 2, window.innerWidth - w - 8));
  const top = Math.max(8, Math.min(y, window.innerHeight - h - 8));
  menuOpenedAt = Date.now();
  menu.value = { item, reactOnly, moreEmoji: false, style: { left: `${left}px`, top: `${top}px`, width: `${w}px` } };
}
// The touchend that finishes a long-press would otherwise land on the backdrop and close it at once.
let menuOpenedAt = 0;
function closeMenu() { if (Date.now() - menuOpenedAt > 350) menu.value = null; }
const myReaction = (item: TimelineItem) => item.reactions.find(r => r.mine)?.emoji ?? '';

async function run(action: () => Promise<unknown>) {
  try { await action(); }
  catch (err: any) {
    await toastError(err?.message?.includes('Owner device') ? 'The group creator is offline — try again when they are back.' : (err?.message || 'Action failed'));
  }
}
const react = (item: TimelineItem, emoji: string) => run(() => chatRoomStore.react(item.messageId, emoji));
const vote = (item: TimelineItem, choices: number[]) => run(() => chatRoomStore.vote(item.messageId, choices));
const togglePin = (item: TimelineItem) => run(() => (item.pinned ? chatRoomStore.unpin(item.messageId) : chatRoomStore.pin(item.messageId)));

async function copyText(item: TimelineItem) {
  await navigator.clipboard.writeText(item.text).catch(() => {});
  const t = await toastController.create({ message: 'Copied', duration: 1200, position: 'top' });
  await t.present();
}
async function confirmDelete(item: TimelineItem) {
  const alert = await alertController.create({
    header: 'Delete message?',
    message: 'It will be removed for everyone in this group.',
    buttons: [{ text: 'Cancel', role: 'cancel' }, { text: 'Delete', role: 'destructive' }],
  });
  await alert.present();
  const { role } = await alert.onDidDismiss();
  if (role === 'destructive') await run(() => chatRoomStore.deleteMessage(item.messageId));
}

// Read receipts sheet.
const infoFor = ref<TimelineItem | null>(null);
const infoReaders = computed(() => (infoFor.value ? chatRoomStore.readBy(infoFor.value) : []));
const infoUnread = computed(() => chatRoomStore.otherAccounts.filter(a => !infoReaders.value.includes(a)));

// Forwarding.
const forwarding = ref<TimelineItem | null>(null);
const forwardRooms = ref<ChatRoom[]>([]);
async function openForward(item: TimelineItem) {
  forwarding.value = item;
  forwardRooms.value = (await ChatRoomService.listJoinedRooms().catch(() => [])).filter(r => r.securityMode === 'EPOCH_GROUP_V1');
}
async function doForward(targetRoom: string) {
  const item = forwarding.value;
  forwarding.value = null;
  if (!item) return;
  await run(async () => {
    await chatRoomStore.forward(targetRoom, { text: item.text, media: item.media });
    const t = await toastController.create({ message: 'Forwarded', duration: 1400, position: 'top', color: 'success' });
    await t.present();
  });
}

// ── Polls ─────────────────────────────────────────────────────────────────
const pollOpen = ref(false);
const pollQuestion = ref('');
const pollOptions = ref<string[]>(['', '']);
const pollMulti = ref(false);
const pollValid = computed(() => pollQuestion.value.trim() && pollOptions.value.filter(o => o.trim()).length >= 2);
function openPollComposer() {
  pollQuestion.value = ''; pollOptions.value = ['', '']; pollMulti.value = false; pollOpen.value = true;
}
function growPollOptions() {
  const o = pollOptions.value;
  if (o.length < 12 && o[o.length - 1].trim()) o.push('');
}
async function sendPoll() {
  const options = pollOptions.value.map(o => o.trim()).filter(Boolean);
  isSending.value = true;
  try {
    await chatRoomStore.createPoll(pollQuestion.value.trim(), options, pollMulti.value);
    pollOpen.value = false;
    nextTick(() => scrollToBottom(true));
  } catch (err: any) {
    await toastError(err?.message || 'Failed to create poll');
  } finally { isSending.value = false; }
}

// ── Voice messages ────────────────────────────────────────────────────────
const canRecord = typeof window !== 'undefined' && 'MediaRecorder' in window && !!navigator.mediaDevices?.getUserMedia;
const recording = ref(false);
const recordStart = ref(0);
const recordNow = ref(0);
let recorder: MediaRecorder | null = null;
let recordChunks: Blob[] = [];
let recordTimer: ReturnType<typeof setInterval> | null = null;
let sendRecording = false;
const recordClock = computed(() => {
  const s = Math.max(0, Math.floor((recordNow.value - recordStart.value) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
});
async function startRecording() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    recorder = new MediaRecorder(stream);
    recordChunks = [];
    recorder.ondataavailable = e => { if (e.data.size) recordChunks.push(e.data); };
    recorder.onstop = () => {
      stream.getTracks().forEach(t => t.stop());
      if (recordTimer) { clearInterval(recordTimer); recordTimer = null; }
      recording.value = false;
      if (!sendRecording || !recordChunks.length) return;
      const type = recorder?.mimeType || 'audio/webm';
      const ext = type.includes('ogg') ? 'ogg' : type.includes('mp4') ? 'm4a' : 'webm';
      const file = new File(recordChunks, `voice-${Date.now()}.${ext}`, { type: type.split(';')[0] });
      void run(() => chatRoomStore.sendMedia(file, '', replyTo.value?.messageId).then(() => { replyTo.value = null; }));
    };
    recorder.start();
    recording.value = true;
    recordStart.value = recordNow.value = Date.now();
    recordTimer = setInterval(() => { recordNow.value = Date.now(); }, 250);
  } catch {
    await toastError('Microphone unavailable');
  }
}
function stopRecording(send: boolean) {
  sendRecording = send;
  recorder?.stop();
}

// ── Lightbox ──────────────────────────────────────────────────────────────
const lightbox = ref('');

// ── Room lifecycle ────────────────────────────────────────────────────────
let initGeneration = 0;

async function initRoom() {
  const gen = ++initGeneration;
  initialLoading.value = true;
  chatRoomStore.error = null;

  try {
    const user = await UserService.getCurrentUser();
    if (gen !== initGeneration) return;

    currentUserId.value = user.id;
    currentUserName.value = user.displayName || user.username || 'Anonymous';
    chatRoomStore.setIdentity(user.id, currentUserName.value);

    const keyExists = await KeyVaultService.hasKey(roomId.value);
    if (gen !== initGeneration) return;

    if (!keyExists) {
      hasAccess.value = false;
      initialLoading.value = false;
      // Already approved on another visit? Then this completes the join.
      void tryCompleteJoin(gen);
      void chatRoomStore.accessMode(roomId.value).then(mode => { if (gen === initGeneration) accessMode.value = mode; });
      return;
    }
    hasAccess.value = true;

    const rooms = await ChatRoomService.listJoinedRooms();
    if (gen !== initGeneration) return;

    const room: ChatRoom | undefined = rooms.find(r => r.id === roomId.value);

    if (!room) {
      chatRoomStore.error = 'Room not found or could not be decrypted.';
      initialLoading.value = false;
      return;
    }

    roomTitle.value = room.name;
    // Awaited: `enterRoom` now loads history (local first, then the graph)
    // instead of only opening a live subscription onto an empty room.
    await chatRoomStore.enterRoom(room);
    if (gen !== initGeneration) return;
    computeUnreadDivider();
    initialLoading.value = false;
    await nextTick();
    const divider = unreadDividerId.value && messagesContainer.value?.querySelector('.unread-sep');
    if (divider) divider.scrollIntoView({ block: 'start' });
    else scrollToBottom();
    onScroll();
  } catch (err: any) {
    if (gen !== initGeneration) return;
    chatRoomStore.error = err.message || 'Failed to load room';
  } finally {
    if (gen === initGeneration) {
      initialLoading.value = false;
    }
  }
}

// ── Joining ───────────────────────────────────────────────────────────────
const joinState = ref<'idle' | 'sending' | 'requested'>('idle');
const accessMode = ref<'password' | 'approval'>('approval');
const joinPassword = ref('');
const joinError = ref('');
let joinPoll: ReturnType<typeof setInterval> | null = null;

async function tryCompleteJoin(gen: number): Promise<boolean> {
  try {
    await chatRoomStore.joinRoom(roomId.value, 'epoch-v1', 'invite');
    chatRoomStore.error = null;
    if (gen !== initGeneration) return true;
    stopJoinPoll();
    await initRoom();
    return true;
  } catch {
    chatRoomStore.error = null;
    return false;
  }
}
function stopJoinPoll() { if (joinPoll) { clearInterval(joinPoll); joinPoll = null; } }

async function requestJoin() {
  joinState.value = 'sending';
  joinError.value = '';
  try {
    const result = await chatRoomStore.requestJoin(roomId.value, currentUserName.value, accessMode.value === 'password' ? joinPassword.value : undefined);
    if (result === 'member') { await tryCompleteJoin(initGeneration); return; }
    joinState.value = 'requested';
    const gen = initGeneration;
    stopJoinPoll();
    joinPoll = setInterval(() => { void tryCompleteJoin(gen); }, 5000);
  } catch (err: any) {
    joinState.value = 'idle';
    joinError.value = err?.message?.includes('unavailable') ? 'Group not found. Check the invite link, or the creator may be offline.' : (err?.message || 'Could not send request');
  }
}


async function confirmLeave() {
  const owner = chatRoomStore.isOwner;
  const alert = await alertController.create({
    header: owner ? 'Close group?' : 'Leave group?',
    message: owner ? 'Everyone loses access and the group cannot be reopened.' : 'You will need to be approved again to rejoin.',
    buttons: [{ text: 'Cancel', role: 'cancel' }, { text: owner ? 'Close' : 'Leave', role: 'destructive' }],
  });
  await alert.present();
  const { role } = await alert.onDidDismiss();
  if (role !== 'destructive') return;
  try {
    await chatRoomStore.leaveRoom(roomId.value);
    showMembers.value = false;
    router.replace('/chatrooms');
  } catch (err: any) {
    await toastError(err?.message || 'Failed to leave');
  }
}

const showMembers = ref(false);
async function copyInvite() {
  await navigator.clipboard.writeText(inviteLink.value).catch(() => {});
  const t = await toastController.create({ message: 'Invite link copied', duration: 1600, position: 'top' });
  await t.present();
}

watch(roomId, () => {
  chatRoomStore.leaveCurrentRoom();
  stopJoinPoll();
  joinState.value = 'idle';
  cancelCompose(); clearPendingFile();
  searchOpen.value = false;
  roomTitle.value = 'Loading...';
  initRoom();
});

function onGlobalKey(ev: KeyboardEvent) {
  if (ev.key === 'Escape') { menu.value = null; lightbox.value = ''; overflowOpen.value = false; attachOpen.value = false; }
  const typing = ev.target instanceof HTMLElement && ev.target.matches('input, textarea, select, [contenteditable]');
  if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'f' && ready.value && !typing) { ev.preventDefault(); if (!searchOpen.value) toggleSearch(); }
}

onMounted(() => {
  initRoom();
  if (props.embedded) { readSync(); syncTimer = setInterval(readSync, 4000); }
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('keydown', onGlobalKey);
});

onUnmounted(() => {
  if (syncTimer) clearInterval(syncTimer);
  stopJoinPoll();
  if (recording.value) stopRecording(false);
  clearPendingFile();
  document.removeEventListener('visibilitychange', onVisibility);
  window.removeEventListener('keydown', onGlobalKey);
  chatRoomStore.leaveCurrentRoom();
});
</script>

<style scoped>
/* Everything derives from the app theme tokens so light and dark both work. */
.room { --room-col: 760px; --room-pad: 14px; }
ion-header::after { display: none !important; }
ion-toolbar { --border-width: 0 !important; --background: var(--app-bg-elevated); --padding-start: 4px; --padding-end: 4px; }
.room-content { --background: var(--app-bg-base); }

/* ── Header ── */
.bar { display: flex; align-items: center; gap: 2px; min-height: 56px; }
.bar-identity { flex: 1; min-width: 0; display: flex; align-items: center; gap: 10px; padding: 6px 8px; margin-left: -2px; border: none; border-radius: 12px; background: none; color: inherit; font: inherit; text-align: left; cursor: pointer; }
.bar-identity:hover:not(:disabled) { background: rgba(var(--app-accent-rgb), 0.07); }
.bar-identity:focus-visible { outline: none; box-shadow: var(--app-focus-ring); }
.bar-text { display: flex; flex-direction: column; min-width: 0; }
.bar-name { font-size: 16px; font-weight: 650; letter-spacing: -0.01em; color: var(--app-text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.bar-sub { font-size: 12.5px; color: var(--app-text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.bar-sub--typing { color: var(--app-success); }

.icon-btn { position: relative; flex-shrink: 0; width: 40px; height: 40px; display: inline-flex; align-items: center; justify-content: center; border: none; border-radius: 50%; background: none; color: var(--app-text-muted); cursor: pointer; }
.icon-btn svg { width: 22px; height: 22px; }
.icon-btn:hover:not(:disabled), .icon-btn--on { color: var(--app-text); background: rgba(var(--app-accent-rgb), 0.1); }
.icon-btn:focus-visible { outline: none; box-shadow: var(--app-focus-ring); }
.icon-btn:disabled { opacity: 0.35; cursor: not-allowed; }
.icon-btn--sm { width: 34px; height: 34px; }
.icon-btn--sm svg { width: 20px; height: 20px; }
.dot-badge { position: absolute; top: 8px; right: 8px; width: 9px; height: 9px; border-radius: 50%; background: var(--app-warning, #f59e0b); border: 2px solid var(--app-bg-elevated); }

.overflow, .attach { position: relative; }
.pop-backdrop { position: fixed; inset: 0; z-index: 9998; }
.pop { position: fixed; z-index: 9999; min-width: 210px; padding: 6px; border-radius: 14px; background: var(--app-bg-elevated); border: 1px solid var(--app-border-strong, var(--app-border)); box-shadow: var(--app-shadow-lg, 0 16px 40px rgba(0,0,0,.28)); }
.pop-item { display: flex; align-items: center; gap: 12px; width: 100%; padding: 11px 12px; border: none; border-radius: 10px; background: none; color: var(--app-text); font: inherit; font-size: 14.5px; text-align: left; cursor: pointer; }
.pop-item:hover, .pop-item:focus-visible { background: rgba(var(--app-accent-rgb), 0.09); outline: none; }
.pop-item--danger { color: var(--app-danger); }
.pop-count { margin-left: auto; min-width: 20px; height: 20px; padding: 0 6px; border-radius: 999px; background: var(--app-warning, #f59e0b); color: #111; font-size: 11.5px; font-weight: 700; display: inline-flex; align-items: center; justify-content: center; }
.pop-ico { width: 36px; height: 36px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; color: #fff; }
.pop-ico svg { width: 19px; height: 19px; }
.pop-ico--media { background: #3b82f6; }
.pop-ico--file { background: #e6e6e6; }
.pop-ico--poll { background: #10b981; }

/* Strip under the header: search, join requests, or the pinned message — one at a time. */
.strip { display: flex; align-items: center; gap: 10px; width: 100%; padding: 8px 14px; border: none; border-top: 1px solid var(--app-border); border-bottom: 1px solid var(--app-border); background: var(--app-bg-elevated); color: var(--app-text); font: inherit; text-align: left; }
.strip--action, .strip--pin { cursor: pointer; }
.strip--action { background: rgba(var(--app-warning-rgb, 245, 158, 11), 0.1); }
.strip--pin svg { width: 18px; height: 18px; flex-shrink: 0; color: var(--app-accent-bright); }
.strip-text { flex: 1; min-width: 0; font-size: 13.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.strip-label { display: block; font-size: 12px; font-weight: 650; color: var(--app-accent-bright); }
.strip-cta { font-size: 13.5px; font-weight: 650; color: var(--app-accent-bright); }
.strip-input { flex: 1; min-width: 0; padding: 9px 14px; border-radius: 999px; border: 1px solid var(--app-border-strong, var(--app-border)); background: var(--app-bg-base); color: var(--app-text); font: inherit; font-size: 14.5px; outline: none; }
.strip-input:focus { border-color: var(--app-accent); box-shadow: var(--app-focus-ring); }
.strip-meta { font-size: 12.5px; color: var(--app-text-subtle); white-space: nowrap; }
.strip-close { border: none; background: none; color: var(--app-accent-bright); font: inherit; font-size: 14px; font-weight: 650; cursor: pointer; }

/* ── States ── */
.state { height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; padding: 32px 24px; text-align: center; }
.state-title { margin: 6px 0 0; font-size: 18px; font-weight: 650; color: var(--app-text); }
.state-sub { margin: 0; max-width: 38ch; font-size: 14px; line-height: 1.5; color: var(--app-text-muted); }
.state-error { color: var(--app-danger); }
.join-field { max-width: 300px; text-align: center; }
.spinner { width: 28px; height: 28px; border: 2.5px solid rgba(var(--app-accent-rgb), 0.2); border-top-color: var(--app-accent); border-radius: 50%; animation: spin 0.7s linear infinite; }
.spinner.small { width: 20px; height: 20px; }
@keyframes spin { to { transform: rotate(360deg); } }

.btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; padding: 11px 20px; border: none; border-radius: 999px; font: inherit; font-size: 14.5px; font-weight: 650; cursor: pointer; }
.btn:focus-visible { outline: none; box-shadow: var(--app-focus-ring); }
.btn--primary { background: var(--app-accent); color: #111214; }
.btn--primary:disabled { opacity: 0.45; cursor: not-allowed; }
.btn--ghost { background: rgba(var(--app-accent-rgb), 0.1); color: var(--app-text); }
.btn--link { background: none; padding: 4px 8px; color: var(--app-accent-bright); font-weight: 600; font-size: 13.5px; }

/* ── Conversation ── */
.convo { position: relative; height: 100%; display: flex; flex-direction: column; }
.scroller { flex: 1; overflow-y: auto; overscroll-behavior: contain; scrollbar-width: thin; }
.column { max-width: var(--room-col); margin: 0 auto; padding: 12px var(--room-pad) 10px; display: flex; flex-direction: column; }
.drop { position: absolute; inset: 10px; z-index: 5; display: flex; align-items: center; justify-content: center; border: 2px dashed var(--app-accent); border-radius: 18px; background: rgba(var(--app-accent-rgb), 0.12); color: var(--app-text); font-weight: 650; pointer-events: none; }

.intro { display: flex; flex-direction: column; align-items: center; gap: 8px; margin: 28px auto 20px; padding: 24px 20px; max-width: 360px; text-align: center; border-radius: 20px; background: var(--app-bg-elevated); border: 1px solid var(--app-border); }
.intro-title { margin: 6px 0 0; font-size: 18px; font-weight: 650; color: var(--app-text); }
.intro-sub { margin: 0; font-size: 14px; line-height: 1.5; color: var(--app-text-muted); }
.intro-sub--quiet { text-align: center; margin: 40px 0; }
.intro-actions { display: flex; gap: 8px; margin-top: 10px; flex-wrap: wrap; justify-content: center; }

.day, .unread { display: flex; justify-content: center; margin: 14px 0 10px; }
.day span { font-size: 12px; font-weight: 600; color: var(--app-text-muted); background: var(--app-bg-elevated); border: 1px solid var(--app-border); padding: 4px 12px; border-radius: 999px; }
.unread span { width: 100%; text-align: center; font-size: 12px; font-weight: 650; color: var(--app-accent-bright); background: rgba(var(--app-accent-rgb), 0.1); padding: 5px; border-radius: 8px; }

.line { display: flex; align-items: flex-start; gap: 8px; margin-top: 8px; }
.line--cont { margin-top: 2px; }
.line--mine { justify-content: flex-end; }
.line-avatar { width: 30px; flex-shrink: 0; padding-top: 18px; }
.line--cont .line-avatar { padding-top: 0; }

.to-bottom { position: absolute; right: 16px; bottom: 14px; width: 42px; height: 42px; border-radius: 50%; border: 1px solid var(--app-border-strong, var(--app-border)); background: var(--app-bg-elevated); color: var(--app-text); display: flex; align-items: center; justify-content: center; cursor: pointer; box-shadow: var(--app-shadow-md, 0 6px 18px rgba(0,0,0,.25)); }
.to-bottom svg { width: 22px; height: 22px; }
.to-bottom-count { position: absolute; top: -6px; right: -4px; min-width: 20px; height: 20px; padding: 0 5px; border-radius: 999px; background: var(--app-accent); color: #111214; font-size: 11.5px; font-weight: 700; display: flex; align-items: center; justify-content: center; }

/* Search results / lists in sheets */
.results { height: 100%; overflow-y: auto; padding: 8px var(--room-pad); max-width: var(--room-col); margin: 0 auto; }
.results-empty { text-align: center; padding: 32px 0; margin: 0 auto; }
.result { display: flex; align-items: center; gap: 12px; width: 100%; padding: 10px; border: none; border-radius: 12px; background: none; color: var(--app-text); font: inherit; text-align: left; cursor: pointer; }
.result:hover, .result:focus-visible { background: rgba(var(--app-accent-rgb), 0.08); outline: none; }
.result-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.result-head { display: flex; justify-content: space-between; gap: 8px; font-size: 13px; }
.result-head span { color: var(--app-text-subtle); white-space: nowrap; }
.result-text { font-size: 14px; color: var(--app-text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

/* ── Composer dock ── */
.room-footer { background: var(--app-bg-base); }
.dock { max-width: var(--room-col); margin: 0 auto; padding: 4px var(--room-pad) calc(10px + env(safe-area-inset-bottom)); display: flex; flex-direction: column; gap: 6px; }
.typing { display: flex; align-items: center; gap: 6px; padding: 0 8px; font-size: 12.5px; color: var(--app-text-muted); }
.typing-dots { display: inline-flex; gap: 3px; }
.typing-dots span { width: 5px; height: 5px; border-radius: 50%; background: currentColor; animation: blink 1.2s infinite ease-in-out; }
.typing-dots span:nth-child(2) { animation-delay: 0.2s; }
.typing-dots span:nth-child(3) { animation-delay: 0.4s; }
@keyframes blink { 0%, 80%, 100% { opacity: 0.25; } 40% { opacity: 1; } }

.context { display: flex; align-items: center; gap: 10px; padding: 8px 6px 8px 10px; border-radius: 14px; background: var(--app-bg-elevated); border: 1px solid var(--app-border); }
.context-bar { align-self: stretch; width: 3px; border-radius: 2px; background: var(--app-accent); }
.context-body { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.context-title { font-size: 13px; font-weight: 650; color: var(--app-accent-bright); }
.context-text { font-size: 13.5px; color: var(--app-text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.context-thumb { width: 44px; height: 44px; border-radius: 8px; object-fit: cover; }
.context-file { font-size: 26px; }

.suggest { border-radius: 14px; overflow: hidden; background: var(--app-bg-elevated); border: 1px solid var(--app-border-strong, var(--app-border)); }
.suggest-item { display: flex; align-items: center; gap: 10px; width: 100%; padding: 8px 12px; border: none; background: none; color: var(--app-text); font: inherit; font-size: 14.5px; text-align: left; cursor: pointer; }
.suggest-item.on, .suggest-item:hover { background: rgba(var(--app-accent-rgb), 0.12); }

.emoji-grid, .menu-emoji { display: grid; grid-template-columns: repeat(auto-fill, minmax(38px, 1fr)); gap: 2px; }
.emoji-grid { padding: 8px; max-height: 200px; overflow-y: auto; border-radius: 14px; background: var(--app-bg-elevated); border: 1px solid var(--app-border); }
.emoji-cell { height: 38px; border: none; border-radius: 8px; background: none; font-size: 22px; cursor: pointer; }
.emoji-cell:hover, .emoji-cell:focus-visible { background: rgba(var(--app-accent-rgb), 0.1); outline: none; }

.composer { display: flex; align-items: flex-end; gap: 6px; }
.field-wrap { flex: 1; min-width: 0; display: flex; align-items: flex-end; gap: 2px; padding: 3px 3px 3px 14px; border-radius: 22px; background: var(--app-bg-elevated); border: 1px solid var(--app-border-strong, var(--app-border)); }
.field-wrap:focus-within { border-color: var(--app-accent); box-shadow: var(--app-focus-ring); }
.message-input { flex: 1; min-width: 0; align-self: center; padding: 8px 0; border: none; outline: none; resize: none; background: transparent; color: var(--app-text); font: inherit; font-size: 15px; line-height: 1.4; max-height: 140px; }
.message-input::placeholder { color: var(--app-text-subtle); }
.send { flex-shrink: 0; width: 44px; height: 44px; border: none; border-radius: 50%; display: flex; align-items: center; justify-content: center; background: var(--app-accent); color: #111214; cursor: pointer; transition: transform 120ms ease; }
.send svg { width: 21px; height: 21px; }
.send:active:not(:disabled) { transform: scale(0.92); }
.send:disabled { opacity: 0.45; cursor: not-allowed; }
.send:focus-visible { outline: none; box-shadow: var(--app-focus-ring); }
.send--quiet { background: rgba(var(--app-accent-rgb), 0.14); color: var(--app-accent-bright); }
.composer--rec { align-items: center; }
.rec { flex: 1; display: flex; align-items: center; gap: 8px; font-variant-numeric: tabular-nums; font-weight: 650; color: var(--app-text); }
.rec-dot { width: 10px; height: 10px; border-radius: 50%; background: var(--app-danger); animation: blink 1s infinite; }
.rec-hint { font-weight: 400; font-size: 13.5px; color: var(--app-text-muted); }

/* ── Message actions menu ── */
.menu-backdrop { position: fixed; inset: 0; z-index: 9998; background: rgba(0, 0, 0, 0.15); }
.menu { position: fixed; padding: 6px; border-radius: 16px; background: var(--app-bg-elevated); border: 1px solid var(--app-border-strong, var(--app-border)); box-shadow: var(--app-shadow-lg, 0 18px 44px rgba(0,0,0,.35)); }
.menu-reacts { display: flex; justify-content: space-between; padding: 2px 2px 6px; border-bottom: 1px solid var(--app-border); margin-bottom: 4px; }
.menu-react { width: 38px; height: 38px; border: none; border-radius: 50%; background: none; font-size: 23px; cursor: pointer; transition: transform 120ms ease; }
.menu-react:hover, .menu-react:focus-visible { transform: scale(1.18); background: rgba(var(--app-accent-rgb), 0.08); outline: none; }
.menu-react.mine { background: rgba(var(--app-accent-rgb), 0.22); }
.menu-react--more { display: inline-flex; align-items: center; justify-content: center; color: var(--app-text-muted); background: rgba(var(--app-accent-rgb), 0.08); }
.menu-react--more svg { width: 18px; height: 18px; }
.menu-emoji { max-height: 170px; overflow-y: auto; padding: 4px 0; border-bottom: 1px solid var(--app-border); margin-bottom: 4px; }
.menu-item { display: block; width: 100%; padding: 10px 12px; border: none; border-radius: 10px; background: none; color: var(--app-text); font: inherit; font-size: 14.5px; text-align: left; cursor: pointer; }
.menu-item:hover, .menu-item:focus-visible { background: rgba(var(--app-accent-rgb), 0.09); outline: none; }
.menu-item--danger { color: var(--app-danger); }

/* ── Sheets ── */
.sheet { --height: auto; --max-width: 480px; --border-radius: 20px; }
.sheet--tall { --height: min(88vh, 760px); }
.sheet-body { position: relative; display: flex; flex-direction: column; padding: 22px 20px calc(20px + env(safe-area-inset-bottom)); max-height: 88vh; overflow-y: auto; background: var(--app-bg-elevated); color: var(--app-text); }
.sheet--tall .sheet-body { height: 100%; }
.sheet-title { margin: 0 0 10px; font-size: 19px; font-weight: 700; letter-spacing: -0.015em; }
.sheet-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 20px; }
.sheet-foot { margin: 16px 0 0; font-size: 12.5px; color: var(--app-text-subtle); }
.label { margin: 12px 2px 6px; font-size: 13px; font-weight: 600; color: var(--app-text-muted); }
.field { width: 100%; padding: 11px 14px; border-radius: 12px; border: 1px solid var(--app-border-strong, var(--app-border)); background: var(--app-bg-base); color: var(--app-text); font: inherit; font-size: 15px; outline: none; }
.field:focus { border-color: var(--app-accent); box-shadow: var(--app-focus-ring); }
.poll-row { display: flex; align-items: center; gap: 6px; margin-bottom: 8px; }
.check { display: flex; align-items: center; gap: 10px; margin-top: 12px; font-size: 14.5px; color: var(--app-text); }
.check input { width: 18px; height: 18px; accent-color: var(--app-accent); }
.quote { margin: 0 0 12px; padding: 10px 12px; border-radius: 12px; background: var(--app-bg-base); font-size: 14px; color: var(--app-text); }
.person { display: flex; align-items: center; gap: 10px; padding: 6px 0; font-size: 14.5px; color: var(--app-text); }
.person--muted { color: var(--app-text-muted); }

.info-close { position: absolute; top: 10px; right: 10px; }
.info-top { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 8px 0 16px; text-align: center; }
.info-name { margin: 8px 0 0; font-size: 22px; font-weight: 700; letter-spacing: -0.02em; }
.info-meta { margin: 0; font-size: 14px; color: var(--app-text-muted); }
.info-desc { margin: 6px 0 0; max-width: 40ch; font-size: 14.5px; line-height: 1.5; color: var(--app-text); }
.info-actions { display: flex; justify-content: center; gap: 10px; padding-bottom: 16px; border-bottom: 1px solid var(--app-border); }
.info-action { display: flex; flex-direction: column; align-items: center; gap: 6px; min-width: 86px; padding: 12px 10px; border-radius: 14px; border: 1px solid var(--app-border); background: var(--app-bg-base); color: var(--app-accent-bright); font: inherit; font-size: 13px; font-weight: 600; cursor: pointer; }
.info-action:hover, .info-action:focus-visible { background: rgba(var(--app-accent-rgb), 0.08); outline: none; }
.info-action svg { width: 22px; height: 22px; }
.info-section { padding-top: 6px; }
.info-h { margin: 14px 2px 6px; font-size: 13px; font-weight: 650; color: var(--app-text-muted); }
.leave { margin: 16px auto 4px; padding: 11px 20px; border: none; border-radius: 999px; background: rgba(var(--app-danger-rgb, 248, 113, 113), 0.12); color: var(--app-danger); font: inherit; font-size: 14.5px; font-weight: 650; cursor: pointer; }

.lightbox { position: fixed; inset: 0; z-index: 2000; display: flex; align-items: center; justify-content: center; background: rgba(0, 0, 0, 0.9); cursor: zoom-out; }
.lightbox img { max-width: 95vw; max-height: 92vh; object-fit: contain; }

@media (max-width: 520px) { .room { --room-pad: 10px; } }
@media (prefers-reduced-motion: reduce) { .menu-react, .send { transition: none; } .typing-dots span, .rec-dot { animation: none; } }
/* ── Embedded in the desktop Messages workspace ─────────────────────── */
.room--embedded { --room-col: 820px; }
.room--embedded .room-content { --background: transparent; }
.room--embedded ion-toolbar { --background: transparent; --border-width: 0 0 1px 0; --border-color: var(--app-border); }
.sync { display: none; align-items: center; gap: 12px; margin: 0 6px; padding: 5px 12px; border-radius: 12px; background: rgba(255,255,255,0.03); border: 1px solid var(--app-border); flex-shrink: 0; }
.sync-label { font-size: 11px; font-weight: 600; color: var(--app-text-muted); white-space: nowrap; }
.sync-path { display: flex; align-items: flex-start; }
.sync-node { display: flex; flex-direction: column; align-items: center; gap: 2px; }
.sync-node small { font-size: 9.5px; color: var(--app-text-subtle); max-width: 40px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sync-node :deep(.cav) { width: 22px; height: 22px; font-size: 10px; }
.sync-line { width: 18px; height: 2px; margin-top: 10px; background: repeating-linear-gradient(90deg, var(--app-accent) 0 4px, transparent 4px 7px); opacity: 0.8; }
.sync-health { padding: 3px 10px; border-radius: 999px; font-size: 11px; font-weight: 700; color: var(--app-accent); background: rgba(var(--app-accent-rgb), 0.1); border: 1px solid rgba(var(--app-accent-rgb), 0.3); }
.sync-health--bad { color: var(--app-danger); background: rgba(var(--app-danger-rgb), 0.1); border-color: rgba(var(--app-danger-rgb), 0.3); }
@media (min-width: 1360px) { .room--embedded .sync { display: flex; } }
</style>
