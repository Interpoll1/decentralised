<template>
  <ion-page>
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-back-button default-href="/home"></ion-back-button>
        </ion-buttons>
        <ion-title>Settings</ion-title>
      </ion-toolbar>

      <ion-toolbar>
        <ion-segment v-model="activeTab">
          <ion-segment-button value="general">
            <ion-label>General</ion-label>
          </ion-segment-button>
          <ion-segment-button value="feed">
            <ion-label>Feed</ion-label>
          </ion-segment-button>
          <ion-segment-button value="moderation">
            <ion-label>Moderation</ion-label>
          </ion-segment-button>
          <ion-segment-button value="network">
            <ion-label>Network</ion-label>
          </ion-segment-button>
          <ion-segment-button value="data">
            <ion-label>Data</ion-label>
          </ion-segment-button>
        </ion-segment>
      </ion-toolbar>
    </ion-header>

    <ion-content>
      <!-- GENERAL TAB -->
      <div v-if="activeTab === 'general'">
        <!-- Appearance -->
        <div class="section">
          <h3 class="section-title">Appearance</h3>
          <ion-list>
            <ion-item>
              <ion-toggle v-model="isDarkMode" @ionChange="toggleDarkMode">
                {{ isDarkMode ? 'Dark mode' : 'Light mode' }}
              </ion-toggle>
            </ion-item>
          </ion-list>
          <div class="separator"></div>
        </div>

        <!-- Content Filters (moved to Moderation tab) -->
        <div class="section">
          <h3 class="section-title">Content Filters</h3>
          <p class="helper-text">
            Content filtering has moved to the <a href="#" @click.prevent="activeTab = 'moderation'" style="color: var(--ion-color-primary); cursor: pointer;">Moderation</a> tab.
          </p>
          <div class="separator"></div>
        </div>

        <!-- Account -->
        <div class="section">
          <h3 class="section-title">Account</h3>
          <div class="info-grid">
            <div class="info-row">
              <span>Device ID</span>
              <code>{{ fullDeviceId }}</code>
            </div>
            <div class="info-row">
              <span>Username</span>
              <strong>{{ userProfile?.username }}</strong>
            </div>
            <div class="info-row">
              <span>Karma</span>
              <ion-badge color="primary">{{ userProfile?.karma || 0 }}</ion-badge>
            </div>
          </div>

          <ion-button expand="block" fill="outline" @click="$router.push('/profile')">
            <ion-icon slot="start" :icon="personCircleOutline"></ion-icon>
            Edit Profile
          </ion-button>
          <div class="separator"></div>
        </div>

        <!-- Beta Features -->
        <div class="section">
          <h3 class="section-title">Beta Features</h3>
          <p class="section-subtitle">Try experimental features before they're fully released</p>
          <ion-list>
            <ion-item>
              <ion-toggle :checked="betaFeatures.resilience" @ionChange="onToggleResilienceBeta($event)">
                Resilience Tools
              </ion-toggle>
            </ion-item>
          </ion-list>
          <p class="helper-text">
            Anti-censorship toolkit: relay health scanning, relay management, snapshot export/import, Tor support.
            Enable to access the Resilience page from the side menu.
          </p>
          <div class="separator"></div>
        </div>

        <!-- Cryptographic Identity -->
        <div class="section">
          <h3 class="section-title">Cryptographic Identity</h3>
          <p class="section-subtitle">Schnorr / secp256k1 keypair for signing events</p>
          
          <div class="info-grid">
            <div class="info-row">
              <span>Public Key</span>
            </div>
            <div class="key-display">
              <code class="key-value">{{ publicKeyHex }}</code>
              <ion-button fill="clear" size="small" @click="copyPublicKey">
                <ion-icon :icon="copyOutline"></ion-icon>
              </ion-button>
            </div>

            <div class="info-row" style="margin-top: 12px">
              <span>Private Key</span>
            </div>
            <div v-if="!showPrivateKey" class="key-display">
              <code class="key-value key-hidden">**** hidden ****</code>
              <ion-button fill="clear" size="small" color="warning" @click="revealPrivateKey">
                <ion-icon :icon="eyeOutline"></ion-icon>
              </ion-button>
            </div>
            <div v-else class="key-display">
              <code class="key-value key-danger">{{ privateKeyHex }}</code>
              <ion-button fill="clear" size="small" @click="copyPrivateKey">
                <ion-icon :icon="copyOutline"></ion-icon>
              </ion-button>
            </div>
            <p v-if="showPrivateKey" class="key-warning">
              Never share your private key. Anyone with it can sign events as you.
            </p>
          </div>
        </div>
      </div>

      <!-- FEED TAB -->
      <div v-if="activeTab === 'feed'">
        <div class="section">
          <h3 class="section-title">Feed Mode</h3>
          <p class="section-subtitle">Switch between chronological and personalized ranking</p>
          <ion-segment :value="feedPreferences.mode" @ionChange="onFeedModeChange">
            <ion-segment-button value="for-you">
              <ion-label>For You</ion-label>
            </ion-segment-button>
            <ion-segment-button value="latest">
              <ion-label>Latest</ion-label>
            </ion-segment-button>
          </ion-segment>
          <p class="helper-text">
            For You uses keyword and community preferences plus engagement/freshness scoring. Latest keeps chronological order.
          </p>
          <div class="separator"></div>
        </div>

        <div class="section">
          <h3 class="section-title">Include Keywords</h3>
          <p class="section-subtitle">Boost content containing these words or phrases</p>
          <div class="chip-list" v-if="feedPreferences.includeKeywords.length">
            <ion-chip
              v-for="keyword in feedPreferences.includeKeywords"
              :key="`include-${keyword}`"
              color="success"
              outline
              @click="removeFeedIncludeKeyword(keyword)"
            >
              {{ keyword }}
              <ion-icon :icon="closeCircleOutline"></ion-icon>
            </ion-chip>
          </div>
          <div class="inline-add">
            <ion-input
              v-model="newFeedIncludeKeyword"
              placeholder="Add include keyword…"
              @keyup.enter="addFeedIncludeKeyword"
              class="inline-input"
            ></ion-input>
            <ion-button
              size="small"
              fill="clear"
              @click="addFeedIncludeKeyword"
              :disabled="!newFeedIncludeKeyword.trim()"
            >
              Add
            </ion-button>
          </div>
          <div class="separator"></div>
        </div>

        <div class="section">
          <h3 class="section-title">Exclude Keywords</h3>
          <p class="section-subtitle">Demote content containing these words (it still appears)</p>
          <div class="chip-list" v-if="feedPreferences.excludeKeywords.length">
            <ion-chip
              v-for="keyword in feedPreferences.excludeKeywords"
              :key="`exclude-${keyword}`"
              color="warning"
              outline
              @click="removeFeedExcludeKeyword(keyword)"
            >
              {{ keyword }}
              <ion-icon :icon="closeCircleOutline"></ion-icon>
            </ion-chip>
          </div>
          <div class="inline-add">
            <ion-input
              v-model="newFeedExcludeKeyword"
              placeholder="Add exclude keyword…"
              @keyup.enter="addFeedExcludeKeyword"
              class="inline-input"
            ></ion-input>
            <ion-button
              size="small"
              fill="clear"
              @click="addFeedExcludeKeyword"
              :disabled="!newFeedExcludeKeyword.trim()"
            >
              Add
            </ion-button>
          </div>
          <div class="separator"></div>
        </div>

        <div class="section">
          <h3 class="section-title">Content Types</h3>
          <p class="section-subtitle">Choose what can appear in your personalized feed</p>
          <ion-list>
            <ion-item>
              <ion-toggle :checked="feedPreferences.showPosts" @ionChange="onFeedPostsToggle">
                Show posts
              </ion-toggle>
            </ion-item>
            <ion-item>
              <ion-toggle :checked="feedPreferences.showPolls" @ionChange="onFeedPollsToggle">
                Show polls
              </ion-toggle>
            </ion-item>
          </ion-list>
          <div class="separator"></div>
        </div>

        <div class="section">
          <h3 class="section-title">Community Preferences</h3>
          <p class="section-subtitle">Favorite communities are boosted; muted communities are hidden from feeds</p>

          <div v-if="communityStore.isLoading" class="helper-text">Loading communities…</div>
          <ion-list v-else-if="feedCommunities.length > 0">
            <ion-item v-for="community in feedCommunities" :key="community.id">
              <ion-label>
                <h3>{{ community.displayName }}</h3>
                <p class="community-id">{{ community.id }}</p>
              </ion-label>
              <div class="community-pref-actions">
                <ion-button
                  size="small"
                  :fill="isFavoriteCommunity(community.id) ? 'solid' : 'outline'"
                  color="primary"
                  @click.stop="toggleFavoriteCommunityPreference(community.id)"
                >
                  Favorite
                </ion-button>
                <ion-button
                  size="small"
                  :fill="isMutedCommunity(community.id) ? 'solid' : 'outline'"
                  color="medium"
                  @click.stop="toggleMutedCommunityPreference(community.id)"
                >
                  Mute
                </ion-button>
              </div>
            </ion-item>
          </ion-list>
          <p v-else class="helper-text">No communities loaded yet.</p>

          <div class="separator"></div>
        </div>

        <div class="section">
          <h3 class="section-title">Ranking Weights</h3>
          <p class="section-subtitle">Balanced defaults are applied. Increase what matters most to you.</p>

          <div class="range-row">
            <span class="range-label">Freshness: <strong>{{ formatWeight(feedPreferences.rankingWeights.freshness) }}</strong></span>
            <ion-range
              :min="0"
              :max="1"
              :step="0.05"
              :value="feedPreferences.rankingWeights.freshness"
              @ionChange="(ev) => onFeedWeightChange('freshness', ev)"
              :pin="true"
            ></ion-range>
          </div>

          <div class="range-row">
            <span class="range-label">Engagement: <strong>{{ formatWeight(feedPreferences.rankingWeights.engagement) }}</strong></span>
            <ion-range
              :min="0"
              :max="1"
              :step="0.05"
              :value="feedPreferences.rankingWeights.engagement"
              @ionChange="(ev) => onFeedWeightChange('engagement', ev)"
              :pin="true"
            ></ion-range>
          </div>

          <div class="range-row">
            <span class="range-label">Keywords: <strong>{{ formatWeight(feedPreferences.rankingWeights.keywords) }}</strong></span>
            <ion-range
              :min="0"
              :max="1"
              :step="0.05"
              :value="feedPreferences.rankingWeights.keywords"
              @ionChange="(ev) => onFeedWeightChange('keywords', ev)"
              :pin="true"
            ></ion-range>
          </div>

          <div class="range-row">
            <span class="range-label">Community affinity: <strong>{{ formatWeight(feedPreferences.rankingWeights.community) }}</strong></span>
            <ion-range
              :min="0"
              :max="1"
              :step="0.05"
              :value="feedPreferences.rankingWeights.community"
              @ionChange="(ev) => onFeedWeightChange('community', ev)"
              :pin="true"
            ></ion-range>
          </div>

          <p class="helper-text">Weights are normalized automatically during ranking.</p>
          <div class="separator"></div>
        </div>

        <div class="section">
          <ion-button expand="block" fill="outline" color="medium" @click="resetFeedPreferencesToDefaults">
            Reset Feed Preferences
          </ion-button>
        </div>
      </div>

      <!-- MODERATION TAB -->
      <div v-if="activeTab === 'moderation'">
        <!-- Karma Filter -->
        <div class="section">
          <h3 class="section-title">Karma Filter</h3>
          <p class="section-subtitle">Hide posts from low-reputation users</p>
          <div class="range-row">
            <span class="range-label">Min karma: <strong>{{ modSettings.minUserKarma <= -1000 ? 'Off' : modSettings.minUserKarma }}</strong></span>
            <ion-range
              :min="-100"
              :max="100"
              :step="5"
              :value="modSettings.minUserKarma <= -1000 ? -100 : modSettings.minUserKarma"
              @ionChange="onKarmaRangeChange"
              :pin="true"
            ></ion-range>
          </div>
          <p class="helper-text">
            Drag to −100 to show everyone. Posts and comments from users with karma below this value are hidden.
          </p>
          <div class="separator"></div>
        </div>

        <!-- Score Filter -->
        <div class="section">
          <h3 class="section-title">Score Filter</h3>
          <p class="section-subtitle">Hide heavily downvoted content</p>
          <div class="range-row">
            <span class="range-label">Min score: <strong>{{ modSettings.minContentScore }}</strong></span>
            <ion-range
              :min="-50"
              :max="50"
              :step="1"
              v-model="modSettings.minContentScore"
              @ionKnobMoveEnd="saveModerationSettings"
              :pin="true"
            ></ion-range>
          </div>
          <p class="helper-text">
            Posts and comments with net score (upvotes − downvotes) below this value are hidden.
          </p>
          <div class="separator"></div>
        </div>

        <!-- Word Filter -->
        <div class="section">
          <h3 class="section-title">Word Filter</h3>
          <p class="section-subtitle">Filter content containing specific words</p>

          <ion-list>
            <ion-item>
              <ion-toggle v-model="modSettings.wordFilterEnabled" @ionChange="saveModerationSettings">
                Enable word filter
              </ion-toggle>
            </ion-item>
          </ion-list>

          <div v-if="modSettings.wordFilterEnabled" class="mt-3">
            <!-- Action -->
            <ion-list>
              <ion-item>
                <ion-label>Action for flagged content</ion-label>
                <ion-select v-model="modSettings.wordFilterAction" @ionChange="saveModerationSettings">
                  <ion-select-option value="blur">Blur (reveal on click)</ion-select-option>
                  <ion-select-option value="hide">Hide completely</ion-select-option>
                  <ion-select-option value="flag">Show with warning icon</ion-select-option>
                </ion-select>
              </ion-item>
            </ion-list>

            <!-- Category Toggles -->
            <h4 class="subsection-title mt-3">Categories</h4>
            <ion-list>
              <ion-item v-for="cat in wordCategories" :key="cat.id">
                <ion-toggle
                  :checked="!modSettings.disabledCategories.includes(cat.id)"
                  @ionChange="toggleCategory(cat.id, $event)"
                >
                  {{ cat.label }} <span class="category-count">({{ cat.count }})</span>
                </ion-toggle>
              </ion-item>
            </ion-list>

            <!-- Custom Blocked Words -->
            <h4 class="subsection-title mt-3">Custom Blocked Words</h4>
            <div class="chip-list" v-if="modSettings.customBlockedWords.length">
              <ion-chip v-for="w in modSettings.customBlockedWords" :key="w" @click="removeCustomBlocked(w)" color="danger" outline>
                {{ w }}
                <ion-icon :icon="closeCircleOutline"></ion-icon>
              </ion-chip>
            </div>
            <div class="inline-add">
              <ion-input
                v-model="newBlockedWord"
                placeholder="Add word…"
                @keyup.enter="addCustomBlocked"
                class="inline-input"
              ></ion-input>
              <ion-button size="small" fill="clear" @click="addCustomBlocked" :disabled="!newBlockedWord.trim()">Add</ion-button>
            </div>

            <!-- Custom Allowed Words -->
            <h4 class="subsection-title mt-3">Allowed Words (override defaults)</h4>
            <div class="chip-list" v-if="modSettings.customAllowedWords.length">
              <ion-chip v-for="w in modSettings.customAllowedWords" :key="w" @click="removeCustomAllowed(w)" color="success" outline>
                {{ w }}
                <ion-icon :icon="closeCircleOutline"></ion-icon>
              </ion-chip>
            </div>
            <div class="inline-add">
              <ion-input
                v-model="newAllowedWord"
                placeholder="Allow word…"
                @keyup.enter="addCustomAllowed"
                class="inline-input"
              ></ion-input>
              <ion-button size="small" fill="clear" @click="addCustomAllowed" :disabled="!newAllowedWord.trim()">Add</ion-button>
            </div>

            <!-- Test Preview -->
            <h4 class="subsection-title mt-3">Test Filter</h4>
            <ion-input
              v-model="testText"
              placeholder="Type text to test…"
              class="test-input"
            ></ion-input>
            <div v-if="testText.trim()" class="test-result" :class="testResult.flagged ? 'flagged' : 'clean'">
              <template v-if="testResult.flagged">
                <ion-icon :icon="warningOutline"></ion-icon>
                <span>Flagged ({{ testResult.severity }}) — matches: {{ testResult.matches.map(m => m.word).join(', ') }}</span>
              </template>
              <template v-else>
                <ion-icon :icon="checkmarkCircleOutline"></ion-icon>
                <span>Clean — no matches</span>
              </template>
            </div>
          </div>

          <div class="separator"></div>
        </div>

        <!-- Image Filter -->
        <div class="section">
          <h3 class="section-title">Image Filter</h3>
          <p class="section-subtitle">Detect and blur sensitive images using on-device AI</p>

          <ion-list>
            <ion-item>
              <ion-toggle v-model="modSettings.imageFilterEnabled" @ionChange="saveModerationSettings">
                Enable image filter
              </ion-toggle>
            </ion-item>
          </ion-list>

          <div v-if="modSettings.imageFilterEnabled" class="mt-3">
            <div class="range-row">
              <span class="range-label">Sensitivity: <strong>{{ sensitivityLabel }}</strong></span>
              <ion-range
                :min="0.3"
                :max="0.9"
                :step="0.05"
                v-model="modSettings.imageFilterSensitivity"
                @ionKnobMoveEnd="saveModerationSettings"
                :pin="true"
                :pin-formatter="(v: number) => Math.round(v * 100) + '%'"
              ></ion-range>
            </div>
            <p class="helper-text">
              Lower sensitivity catches more images but may have false positives. The AI model (~3 MB) loads on first image encounter. All detection runs locally in your browser — no images are sent to any server.
            </p>
          </div>

          <div class="separator"></div>
        </div>

        <!-- Reset -->
        <div class="section">
          <ion-button expand="block" fill="outline" color="medium" @click="resetModerationDefaults">
            <ion-icon slot="start" :icon="refreshOutline"></ion-icon>
            Reset Moderation to Defaults
          </ion-button>
        </div>
      </div>

      <!-- NETWORK TAB -->
      <div v-if="activeTab === 'network'">
        <!-- Connection Status -->
        <div class="section">
          <div class="status-header">
            <h3 class="section-title">Connection Status</h3>
            <div class="status-indicator" :class="connectionStatusClass">
              <span class="status-dot"></span>
              {{ connectionStatusLabel }}
            </div>
          </div>

          <div class="service-status-list">
            <div class="service-status-row">
              <div class="service-info">
                <span class="service-dot" :class="{ online: networkStatus.wsConnected }"></span>
                <span class="service-name">WebSocket Relay</span>
              </div>
              <span class="service-state" :class="networkStatus.wsConnected ? 'state-ok' : 'state-off'">
                {{ networkStatus.wsConnected ? 'Connected' : 'Disconnected' }}
              </span>
            </div>
            <div class="service-status-row">
              <div class="service-info">
                <span class="service-dot" :class="{ online: networkStatus.gunConnected }"></span>
                <span class="service-name">GunDB Relay</span>
              </div>
              <span class="service-state" :class="networkStatus.gunConnected ? 'state-ok' : 'state-off'">
                {{ networkStatus.gunConnected ? 'Connected' : 'Disconnected' }}
              </span>
            </div>
          </div>

          <div class="metrics-grid">
            <div class="metric-card">
              <div class="metric-value">{{ networkStatus.peerCount }}</div>
              <div class="metric-label">Active Peers</div>
            </div>
            <div class="metric-card">
              <div class="metric-value">{{ networkStatus.gunPeerCount }}</div>
              <div class="metric-label">DB Peers</div>
            </div>
            <div class="metric-card">
              <div class="metric-value">{{ networkStatus.blockHeight }}</div>
              <div class="metric-label">Block Height</div>
            </div>
            <div class="metric-card">
              <div class="metric-value" :class="networkStatus.chainValid ? 'text-success' : 'text-danger'">
                {{ networkStatus.chainValid ? 'Valid' : 'Invalid' }}
              </div>
              <div class="metric-label">Chain Status</div>
            </div>
          </div>
          <div class="separator"></div>
        </div>

        <!-- Relay Configuration -->
        <div class="section">
          <div class="status-header">
            <h3 class="section-title">Relay Configuration</h3>
            <ion-badge v-if="hasCustomRelay" color="warning">Custom</ion-badge>
          </div>
          <p class="section-subtitle">Change the servers your node connects to</p>

          <div class="relay-form">
            <div class="relay-field">
              <label class="relay-label">WebSocket Relay</label>
              <input
                v-model="editRelay.websocket"
                type="text"
                class="relay-input"
                placeholder="ws://localhost:8080"
              />
            </div>
            <div class="relay-field">
              <label class="relay-label">GunDB Relay</label>
              <input
                v-model="editRelay.gun"
                type="text"
                class="relay-input"
                placeholder="http://localhost:8765/gun"
              />
            </div>
            <div class="relay-field">
              <label class="relay-label">API Server</label>
              <input
                v-model="editRelay.api"
                type="text"
                class="relay-input"
                placeholder="http://localhost:8080"
              />
            </div>
          </div>

          <ion-button expand="block" @click="applyRelayConfig" class="mt-3">
            <ion-icon slot="start" :icon="swapHorizontalOutline"></ion-icon>
            Apply &amp; Reconnect
          </ion-button>

          <ion-button
            v-if="hasCustomRelay"
            expand="block"
            fill="outline"
            color="medium"
            @click="resetRelayConfig"
            class="mt-2"
          >
            Reset to Defaults
          </ion-button>
          <div class="separator"></div>
        </div>

        <!-- Known Servers -->
        <div class="section">
          <div class="status-header">
            <h3 class="section-title">Known Servers</h3>
            <ion-badge color="primary">{{ knownServers.length }}</ion-badge>
          </div>
          <p class="section-subtitle">Servers discovered from the network</p>

          <div v-if="knownServers.length === 0" class="empty-state">
            <ion-icon :icon="serverOutline" size="large"></ion-icon>
            <p>No servers discovered yet</p>
            <p class="helper-text">Servers shared by peers will appear here</p>
          </div>

          <div v-else class="server-list">
            <div
              v-for="server in knownServers"
              :key="server.websocket"
              class="server-item"
              :class="{ active: isActiveServer(server.websocket) }"
            >
              <div class="server-header">
                <div class="server-url-badge">
                  <span class="server-dot" :class="{ active: isActiveServer(server.websocket) }"></span>
                  {{ shortenUrl(server.websocket) }}
                </div>
                <span class="server-seen">{{ formatPeerTime(server.firstSeen) }}</span>
              </div>
              <div class="server-details">
                <div class="server-detail">
                  <span class="detail-label">WS</span>
                  <code>{{ server.websocket }}</code>
                </div>
                <div class="server-detail">
                  <span class="detail-label">Gun</span>
                  <code>{{ server.gun }}</code>
                </div>
                <div class="server-detail">
                  <span class="detail-label">API</span>
                  <code>{{ server.api }}</code>
                </div>
              </div>
              <ion-button
                v-if="!isActiveServer(server.websocket)"
                expand="block"
                size="small"
                fill="outline"
                @click="switchToServer(server)"
                class="mt-2"
              >
                <ion-icon slot="start" :icon="swapHorizontalOutline"></ion-icon>
                Switch to this server
              </ion-button>
              <div v-else class="active-badge">Currently connected</div>
            </div>
          </div>
          <div class="separator"></div>
        </div>

        <!-- Connected Peers -->
        <div class="section">
          <div class="status-header">
            <h3 class="section-title">Connected Peers</h3>
            <ion-button fill="clear" size="small" @click="refreshNetwork">
              <ion-icon :icon="refreshOutline"></ion-icon>
            </ion-button>
          </div>
          <p class="section-subtitle">Peers sharing relay addresses automatically</p>

          <div v-if="peerList.length === 0" class="empty-state">
            <ion-icon :icon="globeOutline" size="large"></ion-icon>
            <p>No peers connected yet</p>
            <p class="helper-text">Peers will appear here once they join the network. Relay addresses are shared automatically on connect.</p>
          </div>

          <div v-else class="peer-list">
            <div v-for="peer in peerList" :key="peer.peerId" class="peer-item">
              <div class="peer-header">
                <div class="peer-id-badge">
                  <span class="peer-dot"></span>
                  {{ peer.peerId }}
                </div>
                <span class="peer-joined">{{ formatPeerTime(peer.joinedAt) }}</span>
              </div>
              <div class="peer-details">
                <div class="peer-detail" v-if="peer.relayUrl">
                  <span class="detail-label">Relay</span>
                  <code>{{ peer.relayUrl }}</code>
                </div>
                <div class="peer-detail" v-if="peer.gunPeers?.length">
                  <span class="detail-label">DB Peers</span>
                  <code v-for="gun in peer.gunPeers" :key="gun">{{ gun }}</code>
                </div>
              </div>
            </div>
          </div>
          <div class="separator"></div>
        </div>

        <!-- Your Peer Identity -->
        <div class="section">
          <h3 class="section-title">Your Node</h3>
          <div class="info-grid">
            <div class="info-row">
              <span>Peer ID</span>
              <code>{{ myPeerId }}</code>
            </div>
            <div class="info-row">
              <span>Device ID</span>
              <code>{{ fullDeviceId }}</code>
            </div>
          </div>
        </div>
      </div>

      <!-- DATA TAB -->
      <div v-if="activeTab === 'data'">
        <!-- Storage Usage -->
        <div class="section">
          <h3 class="section-title">Storage Usage</h3>
          <p class="section-subtitle">Local device storage</p>

          <div class="storage-stats">
            <div class="stat-row">
              <span>Used Storage</span>
              <strong>{{ storageStats.used.toFixed(1) }} MB</strong>
            </div>
            <div class="stat-row">
              <span>Available</span>
              <strong>{{ storageStats.quota.toFixed(0) }} MB</strong>
            </div>
            <div class="stat-row">
              <span>Pinned Images</span>
              <strong>{{ storageStats.pinnedItems }}</strong>
            </div>
          </div>

          <div class="progress-bar">
            <div
              class="progress-fill"
              :style="{ width: `${storagePercent}%` }"
              :class="{ warning: storagePercent > 80, danger: storagePercent > 95 }"
            ></div>
          </div>
          <p class="progress-text">{{ storagePercent.toFixed(1) }}% used</p>

          <ion-button
            expand="block"
            fill="outline"
            @click="refreshStorageStats"
            class="mt-3"
          >
            <ion-icon slot="start" :icon="refreshOutline"></ion-icon>
            Refresh Stats
          </ion-button>
          <div class="separator"></div>
        </div>

        <!-- Data Versions -->
        <div class="section">
          <h3 class="section-title">Data Versions</h3>
          <p class="section-subtitle">Choose which GunDB data versions to display</p>

          <ion-list>
            <ion-item v-if="isProbing">
              <ion-spinner name="dots" slot="start"></ion-spinner>
              <ion-label>Scanning for data versions…</ion-label>
            </ion-item>
            <ion-item v-for="ver in availableVersions" :key="ver">
              <ion-toggle
                :checked="versionToggles[ver]"
                @ionChange="onToggleVersion(ver, $event)"
              >
                {{ ver }} {{ versionLabel(ver) }}
              </ion-toggle>
            </ion-item>
          </ion-list>

          <p class="helper-text">
            Legacy posts were created before the namespace migration. Enable older versions to see that content. Changes take effect on next page load.
          </p>
          <div class="separator"></div>
        </div>

        <!-- Storage Policy -->
        <div class="section">
          <h3 class="section-title">Storage Policy</h3>
          <p class="section-subtitle">Control what gets stored locally</p>

          <ion-list>
            <ion-item>
              <ion-toggle v-model="policy.myPosts" @ionChange="savePolicy">
                Always store my posts
              </ion-toggle>
            </ion-item>

            <ion-item>
              <ion-toggle v-model="policy.myUpvotes" @ionChange="savePolicy">
                Store posts I upvoted
              </ion-toggle>
            </ion-item>

            <ion-item>
              <ion-toggle v-model="policy.myCommunities" @ionChange="savePolicy">
                Store my communities
              </ion-toggle>
            </ion-item>

            <ion-item>
              <ion-toggle v-model="policy.popularPosts" @ionChange="savePolicy">
                Cache popular posts (100+ upvotes)
              </ion-toggle>
            </ion-item>

            <ion-item>
              <ion-toggle v-model="policy.autoPruneOldContent" @ionChange="savePolicy">
                Auto-delete old cached content
              </ion-toggle>
            </ion-item>

            <ion-item>
              <ion-label>Keep recent posts</ion-label>
              <ion-select v-model="policy.recentPosts" @ionChange="savePolicy">
                <ion-select-option :value="20">Last 20</ion-select-option>
                <ion-select-option :value="50">Last 50</ion-select-option>
                <ion-select-option :value="100">Last 100</ion-select-option>
                <ion-select-option :value="200">Last 200</ion-select-option>
              </ion-select>
            </ion-item>

            <ion-item>
              <ion-label>Max storage (MB)</ion-label>
              <ion-select v-model="policy.maxStorageMB" @ionChange="savePolicy">
                <ion-select-option :value="50">50 MB</ion-select-option>
                <ion-select-option :value="100">100 MB</ion-select-option>
                <ion-select-option :value="250">250 MB</ion-select-option>
                <ion-select-option :value="500">500 MB</ion-select-option>
                <ion-select-option :value="1000">1 GB</ion-select-option>
              </ion-select>
            </ion-item>
          </ion-list>
          <div class="separator"></div>
        </div>

        <!-- Data Management -->
        <div class="section">
          <h3 class="section-title">Data Management</h3>
          <p class="section-subtitle">Export, import, or clear data</p>

          <ion-button expand="block" fill="outline" @click="exportData">
            <ion-icon slot="start" :icon="downloadOutline"></ion-icon>
            Export All Data
          </ion-button>

          <ion-button expand="block" fill="outline" @click="importData" class="mt-2">
            <ion-icon slot="start" :icon="cloudUploadOutline"></ion-icon>
            Import Data
          </ion-button>

          <ion-button
            expand="block"
            fill="outline"
            @click="pruneOldContent"
            class="mt-2"
          >
            <ion-icon slot="start" :icon="trashOutline"></ion-icon>
            Clean Up Old Content
          </ion-button>

          <ion-button
            expand="block"
            color="danger"
            fill="outline"
            @click="confirmClearAll"
            class="mt-2"
          >
            <ion-icon slot="start" :icon="warningOutline"></ion-icon>
            Clear All Data
          </ion-button>

          <input
            ref="importFileInput"
            type="file"
            accept=".json"
            style="display: none"
            @change="handleImportFile"
          />
        </div>
      </div>
    </ion-content>
  </ion-page>
</template>


<style scoped>
/* Section Layout */
.section {
  padding: 14px;
  background: transparent;
}

.section-title {
  font-size: 18px;
  font-weight: 600;
  margin: 0 0 4px 0;
  color: var(--ion-text-color);
}

.section-subtitle {
  font-size: 13px;
  color: var(--ion-color-medium);
  margin: 0 0 12px 0;
}

.separator {
  height: 1px;
  background: rgba(var(--ion-text-color-rgb), 0.08);
  margin: 16px 0;
}

.mt-2 { margin-top: 8px; }
.mt-3 { margin-top: 12px; }

.helper-text {
  font-size: 13px;
  color: var(--ion-color-medium);
  margin: 8px 0;
  line-height: 1.5;
}

/* Moderation Tab */
.range-row {
  padding: 8px 0;
}

.range-label {
  font-size: 14px;
  color: var(--ion-text-color);
  display: block;
  margin-bottom: 4px;
}

.subsection-title {
  font-size: 15px;
  font-weight: 600;
  margin: 0 0 8px 0;
  color: var(--ion-text-color);
}

.category-count {
  font-size: 12px;
  color: var(--ion-color-medium);
  font-weight: 400;
}

.chip-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 8px;
}

.inline-add {
  display: flex;
  align-items: center;
  gap: 8px;
}

.community-pref-actions {
  display: flex;
  gap: 6px;
  margin-left: 8px;
}

.community-id {
  margin-top: 2px;
  font-size: 12px;
  color: var(--ion-color-medium);
}

.inline-input {
  flex: 1;
  --padding-start: 8px;
  --padding-end: 8px;
  border: 1px solid rgba(var(--ion-text-color-rgb), 0.12);
  border-radius: 8px;
  font-size: 14px;
}

.test-input {
  --padding-start: 8px;
  --padding-end: 8px;
  border: 1px solid rgba(var(--ion-text-color-rgb), 0.12);
  border-radius: 8px;
  font-size: 14px;
  margin-bottom: 8px;
}

.test-result {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  border-radius: 8px;
  font-size: 13px;
}

.test-result.flagged {
  background: rgba(var(--ion-color-warning-rgb), 0.10);
  color: var(--ion-color-warning-shade);
}

.test-result.clean {
  background: rgba(var(--ion-color-success-rgb), 0.10);
  color: var(--ion-color-success-shade);
}

.test-result ion-icon {
  font-size: 18px;
  flex-shrink: 0;
}

/* Storage */
.storage-stats {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-bottom: 16px;
}

.stat-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.stat-row span {
  color: var(--ion-color-medium);
  font-size: 14px;
}

.stat-row strong {
  font-size: 16px;
}

.progress-bar {
  width: 100%;
  height: 8px;
  background: rgba(var(--ion-text-color-rgb), 0.08);
  border-radius: 8px;
  overflow: hidden;
  margin-top: 16px;
}

.progress-fill {
  height: 100%;
  background: var(--ion-color-primary);
  border-radius: 8px;
  transition: width 0.5s ease;
}

.progress-fill.warning {
  background: var(--ion-color-warning);
}

.progress-fill.danger {
  background: var(--ion-color-danger);
}

.progress-text {
  text-align: center;
  font-size: 12px;
  color: var(--ion-color-medium);
  margin-top: 4px;
}

/* Info Grid */
.info-grid {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-bottom: 16px;
}

.info-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.info-row span {
  color: var(--ion-color-medium);
  font-size: 14px;
}

.info-row code {
  font-size: 12px;
  background: rgba(var(--ion-text-color-rgb), 0.05);
  padding: 4px 8px;
  border-radius: 8px;
}

/* Network Status */
.status-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.status-indicator {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 500;
  color: var(--ion-color-danger);
  padding: 4px 10px;
  border-radius: 20px;
  background: rgba(var(--ion-color-danger-rgb), 0.08);
  border: 1px solid rgba(var(--ion-color-danger-rgb), 0.12);
}

.status-indicator.connected {
  color: var(--ion-color-success);
  background: rgba(var(--ion-color-success-rgb), 0.08);
  border-color: rgba(var(--ion-color-success-rgb), 0.12);
}

.status-indicator.partial {
  color: var(--ion-color-warning);
  background: rgba(var(--ion-color-warning-rgb), 0.08);
  border-color: rgba(var(--ion-color-warning-rgb), 0.12);
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: currentColor;
}

/* Service Status */
.service-status-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-bottom: 16px;
  padding: 12px;
  background: rgba(var(--ion-text-color-rgb), 0.03);
  border: 1px solid rgba(var(--ion-text-color-rgb), 0.08);
  border-radius: 12px;
}

.service-status-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.service-info {
  display: flex;
  align-items: center;
  gap: 8px;
}

.service-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--ion-color-danger);
  flex-shrink: 0;
}

.service-dot.online {
  background: var(--ion-color-success);
}

.service-name {
  font-size: 13px;
  font-weight: 500;
}

.service-state {
  font-size: 12px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 8px;
}

.service-state.state-ok {
  color: var(--ion-color-success);
  background: rgba(var(--ion-color-success-rgb), 0.08);
}

.service-state.state-off {
  color: var(--ion-color-danger);
  background: rgba(var(--ion-color-danger-rgb), 0.08);
}

/* Metrics */
.metrics-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.metric-card {
  padding: 16px;
  background: rgba(var(--ion-text-color-rgb), 0.03);
  border: 1px solid rgba(var(--ion-text-color-rgb), 0.08);
  border-radius: 12px;
  text-align: center;
}

.metric-value {
  font-size: 24px;
  font-weight: 700;
  color: var(--ion-color-primary);
  line-height: 1.2;
}

.metric-value.text-success {
  color: var(--ion-color-success);
}

.metric-value.text-danger {
  color: var(--ion-color-danger);
}

.metric-label {
  font-size: 12px;
  color: var(--ion-color-medium);
  margin-top: 4px;
  text-transform: uppercase;
}

/* Relay Config */
.relay-form {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.relay-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.relay-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--ion-color-medium);
  text-transform: uppercase;
}

.relay-input {
  font-size: 13px;
  font-family: monospace;
  background: rgba(var(--ion-text-color-rgb), 0.03);
  color: var(--ion-text-color);
  border: 1px solid rgba(var(--ion-text-color-rgb), 0.1);
  padding: 10px 12px;
  border-radius: 8px;
  outline: none;
  width: 100%;
}

.relay-input:focus {
  border-color: var(--ion-color-primary);
}

/* Servers & Peers */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 32px 16px;
  text-align: center;
  gap: 8px;
}

.empty-state ion-icon {
  font-size: 48px;
  color: var(--ion-color-medium);
}

.empty-state p {
  margin: 0;
  color: var(--ion-color-medium);
}

.server-list,
.peer-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.server-item,
.peer-item {
  border: 1px solid rgba(var(--ion-text-color-rgb), 0.1);
  border-radius: 12px;
  padding: 12px;
  background: rgba(var(--ion-text-color-rgb), 0.02);
}

.server-item.active {
  border-color: rgba(var(--ion-color-success-rgb), 0.3);
  background: rgba(var(--ion-color-success-rgb), 0.04);
}

.server-header,
.peer-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.server-url-badge,
.peer-id-badge {
  display: flex;
  align-items: center;
  gap: 6px;
  font-weight: 600;
  font-size: 14px;
}

.server-dot,
.peer-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--ion-color-medium);
}

.server-dot.active,
.peer-dot {
  background: var(--ion-color-success);
}

.server-seen,
.peer-joined {
  font-size: 12px;
  color: var(--ion-color-medium);
}

.server-details,
.peer-details {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.server-detail,
.peer-detail {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}

.detail-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--ion-color-medium);
  text-transform: uppercase;
  min-width: 60px;
  padding-top: 4px;
}

.server-detail code,
.peer-detail code {
  font-size: 12px;
  background: rgba(var(--ion-text-color-rgb), 0.05);
  padding: 2px 6px;
  border-radius: 6px;
  word-break: break-all;
}

.active-badge {
  margin-top: 8px;
  font-size: 12px;
  font-weight: 600;
  color: var(--ion-color-success);
  text-align: center;
  text-transform: uppercase;
}

/* Crypto Keys */
.key-display {
  display: flex;
  align-items: flex-start;
  gap: 4px;
}

.key-value {
  font-size: 11px;
  background: rgba(var(--ion-text-color-rgb), 0.05);
  padding: 6px 10px;
  border-radius: 8px;
  word-break: break-all;
  flex: 1;
}

.key-hidden {
  color: var(--ion-color-medium);
  font-style: italic;
}

.key-danger {
  border: 1px solid rgba(var(--ion-color-warning-rgb), 0.3);
  background: rgba(var(--ion-color-warning-rgb), 0.06);
}

.key-warning {
  font-size: 12px;
  color: var(--ion-color-warning);
  margin-top: 6px;
  line-height: 1.4;
}
</style>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import {
  IonPage,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonButtons,
  IonBackButton,
  IonCard,
  IonCardHeader,
  IonCardTitle,
  IonCardSubtitle,
  IonCardContent,
  IonList,
  IonItem,
  IonLabel,
  IonToggle,
  IonSelect,
  IonSelectOption,
  IonButton,
  IonIcon,
  IonBadge,
  IonSegment,
  IonSegmentButton,
  IonRange,
  IonChip,
  IonInput,
  IonSpinner,
  alertController,
  toastController
} from '@ionic/vue';
import {
  refreshOutline,
  downloadOutline,
  cloudUploadOutline,
  trashOutline,
  warningOutline,
  personCircleOutline,
  globeOutline,
  swapHorizontalOutline,
  serverOutline,
  copyOutline,
  eyeOutline,
  closeCircleOutline,
  checkmarkCircleOutline
} from 'ionicons/icons';
import { PinningService } from '../services/pinningService';
import { StorageManager } from '../services/storageManager';
import { UserService } from '../services/userService';
import { VoteTrackerService } from '../services/voteTrackerService';
import { WebSocketService, type KnownServer } from '../services/websocketService';
import { GunService } from '../services/gunService';
import { KeyService } from '../services/keyService';
import { useChainStore } from '../stores/chainStore';
import { useCommunityStore } from '../stores/communityStore';
import config from '../config';
import { ModerationService, moderationVersion, type ModerationSettings, type WordCategory } from '../services/moderationService';
import { NsfwService } from '../services/nsfwService';
import { getEnabledVersions, setEnabledVersions, probeForVersions, availableVersions, type DataVersion } from '../utils/dataVersionSettings';
import { GUN_NAMESPACE } from '../services/gunService';
import { betaFeatures, setBetaFeature } from '../utils/betaFeatures';
import { useFeedPreferences } from '../composables/useFeedPreferences';
import type { FeedMode, FeedRankingWeights } from '../services/feedPreferencesService';

const router = useRouter();
const chainStore = useChainStore();
const communityStore = useCommunityStore();
const importFileInput = ref<HTMLInputElement | null>(null);
const activeTab = ref('general');
const {
  preferences: feedPreferences,
  setMode: setFeedMode,
  setContentTypeVisibility,
  setRankingWeights,
  addIncludeKeyword,
  removeIncludeKeyword,
  addExcludeKeyword,
  removeExcludeKeyword,
  toggleMutedCommunity,
  toggleFavoriteCommunity,
  resetPreferences: resetFeedPreferences,
} = useFeedPreferences();
const newFeedIncludeKeyword = ref('');
const newFeedExcludeKeyword = ref('');

function onToggleResilienceBeta(ev: CustomEvent) {
  setBetaFeature('resilience', ev.detail.checked);
}

const storageStats = ref({ used: 0, quota: 0, pinnedItems: 0 });

const policy = ref({
  myPosts: true,
  myUpvotes: true,
  myCommunities: true,
  popularPosts: true,
  recentPosts: 50,
  maxStorageMB: 100,
  autoPruneOldContent: true
});

const isDarkMode = ref(false);
const minUserKarma = ref<number>(-1000);
const userProfile = ref<any>(null);
const deviceId = ref('');

// Data version toggles — dynamic, based on GunDB probe
const currentNamespace = GUN_NAMESPACE;
const isProbing = ref(true);
const versionToggles = ref<Record<string, boolean>>({});
const feedCommunities = computed(() =>
  [...communityStore.communities].sort((a, b) => a.displayName.localeCompare(b.displayName)),
);

function versionLabel(ver: string): string {
  if (ver === currentNamespace) return '(current)';
  const verNum = parseInt(ver.replace('v', ''), 10);
  const curNum = parseInt(currentNamespace.replace('v', ''), 10);
  return verNum > curNum ? '(newer)' : '(legacy)';
}

function initVersionToggles() {
  const enabled = getEnabledVersions();
  const toggles: Record<string, boolean> = {};
  for (const v of availableVersions.value) {
    toggles[v] = enabled.includes(v);
  }
  versionToggles.value = toggles;
}

function onToggleVersion(ver: string, ev: CustomEvent) {
  versionToggles.value = {
    ...versionToggles.value,
    [ver]: ev.detail.checked,
  };
  syncDataVersions();
}

async function syncDataVersions() {
  const versions: DataVersion[] = Object.entries(versionToggles.value)
    .filter(([, on]) => on)
    .map(([v]) => v);
  setEnabledVersions(versions);

  // Re-sync in case setEnabledVersions applied a fallback
  const actual = getEnabledVersions();
  const synced: Record<string, boolean> = {};
  for (const v of availableVersions.value) {
    synced[v] = actual.includes(v);
  }
  versionToggles.value = synced;

  const toast = await toastController.create({
    message: `Showing ${actual.join(' + ')} posts — reload to apply`,
    duration: 2000,
    color: 'success',
  });
  await toast.present();
}

function onFeedModeChange(ev: CustomEvent) {
  const mode = ev.detail.value;
  if (mode === 'latest' || mode === 'for-you') {
    setFeedMode(mode as FeedMode);
  }
}

function addFeedIncludeKeyword() {
  const keyword = newFeedIncludeKeyword.value.trim();
  if (!keyword) return;
  addIncludeKeyword(keyword);
  newFeedIncludeKeyword.value = '';
}

function removeFeedIncludeKeyword(keyword: string) {
  removeIncludeKeyword(keyword);
}

function addFeedExcludeKeyword() {
  const keyword = newFeedExcludeKeyword.value.trim();
  if (!keyword) return;
  addExcludeKeyword(keyword);
  newFeedExcludeKeyword.value = '';
}

function removeFeedExcludeKeyword(keyword: string) {
  removeExcludeKeyword(keyword);
}

function onFeedPostsToggle(ev: CustomEvent) {
  const checked = Boolean(ev.detail.checked);
  setContentTypeVisibility(checked, feedPreferences.value.showPolls);
}

function onFeedPollsToggle(ev: CustomEvent) {
  const checked = Boolean(ev.detail.checked);
  setContentTypeVisibility(feedPreferences.value.showPosts, checked);
}

function onFeedWeightChange(weight: keyof FeedRankingWeights, ev: CustomEvent) {
  const value = Number(ev.detail.value);
  if (Number.isNaN(value)) return;
  setRankingWeights({ [weight]: value });
}

function formatWeight(weight: number): string {
  return `${Math.round(weight * 100)}%`;
}

function isMutedCommunity(communityId: string): boolean {
  return feedPreferences.value.mutedCommunities.includes(communityId);
}

function isFavoriteCommunity(communityId: string): boolean {
  return feedPreferences.value.favoriteCommunities.includes(communityId);
}

function toggleMutedCommunityPreference(communityId: string) {
  toggleMutedCommunity(communityId);
}

function toggleFavoriteCommunityPreference(communityId: string) {
  toggleFavoriteCommunity(communityId);
}

async function resetFeedPreferencesToDefaults() {
  const alert = await alertController.create({
    header: 'Reset feed preferences?',
    message: 'This will reset keywords, community preferences, and ranking weights.',
    buttons: [
      { text: 'Cancel', role: 'cancel' },
      {
        text: 'Reset',
        role: 'destructive',
        handler: async () => {
          resetFeedPreferences();
          const toast = await toastController.create({
            message: 'Feed preferences reset',
            duration: 1500,
            color: 'success',
          });
          await toast.present();
        },
      },
    ],
  });
  await alert.present();
}

// Moderation state
const modSettings = ref<ModerationSettings>(ModerationService.getSettings());
const newBlockedWord = ref('');
const newAllowedWord = ref('');
const testText = ref('');

const wordCategories = computed(() => {
  const list = ModerationService.getDefaultWordList();
  const cats: { id: WordCategory; label: string; count: number }[] = [
    { id: 'profanity', label: 'Profanity', count: 0 },
    { id: 'slurs', label: 'Slurs & hate speech', count: 0 },
    { id: 'sexual', label: 'Sexual content', count: 0 },
    { id: 'threats', label: 'Threats & violence', count: 0 },
    { id: 'spam', label: 'Spam phrases', count: 0 },
    { id: 'drugs', label: 'Drug references', count: 0 },
  ];
  for (const entry of list) {
    const cat = cats.find(c => c.id === entry.category);
    if (cat) cat.count++;
  }
  return cats;
});

const testResult = computed(() => {
  moderationVersion.value; // re-evaluate when settings change
  return ModerationService.checkContent(testText.value);
});

const sensitivityLabel = computed(() => {
  const v = modSettings.value.imageFilterSensitivity;
  if (v <= 0.4) return 'Very strict';
  if (v <= 0.55) return 'Strict';
  if (v <= 0.7) return 'Balanced';
  if (v <= 0.8) return 'Relaxed';
  return 'Very relaxed';
});

function onKarmaRangeChange(ev: CustomEvent) {
  const val = ev.detail.value as number;
  modSettings.value.minUserKarma = val <= -100 ? -1000 : val;
  saveModerationSettings();
}

function saveModerationSettings() {
  ModerationService.saveSettings({ ...modSettings.value });
  NsfwService.clearCache();
  minUserKarma.value = modSettings.value.minUserKarma;
}

function toggleCategory(catId: WordCategory, ev: CustomEvent) {
  const enabled = ev.detail.checked;
  const disabled = [...modSettings.value.disabledCategories];
  if (enabled) {
    const idx = disabled.indexOf(catId);
    if (idx !== -1) disabled.splice(idx, 1);
  } else {
    if (!disabled.includes(catId)) disabled.push(catId);
  }
  modSettings.value.disabledCategories = disabled;
  saveModerationSettings();
}

function addCustomBlocked() {
  const w = newBlockedWord.value.trim().toLowerCase();
  if (!w || modSettings.value.customBlockedWords.includes(w)) return;
  modSettings.value.customBlockedWords.push(w);
  newBlockedWord.value = '';
  saveModerationSettings();
}

function removeCustomBlocked(w: string) {
  modSettings.value.customBlockedWords = modSettings.value.customBlockedWords.filter(x => x !== w);
  saveModerationSettings();
}

function addCustomAllowed() {
  const w = newAllowedWord.value.trim().toLowerCase();
  if (!w || modSettings.value.customAllowedWords.includes(w)) return;
  modSettings.value.customAllowedWords.push(w);
  newAllowedWord.value = '';
  saveModerationSettings();
}

function removeCustomAllowed(w: string) {
  modSettings.value.customAllowedWords = modSettings.value.customAllowedWords.filter(x => x !== w);
  saveModerationSettings();
}

async function resetModerationDefaults() {
  const defaults = ModerationService.getDefaultSettings();
  ModerationService.saveSettings(defaults);
  modSettings.value = ModerationService.getSettings();
  minUserKarma.value = modSettings.value.minUserKarma;
  const toast = await toastController.create({
    message: 'Moderation settings reset to defaults',
    duration: 1500,
    color: 'success'
  });
  await toast.present();
}

// Crypto identity state
const publicKeyHex = ref('');
const privateKeyHex = ref('');
const showPrivateKey = ref(false);

// Network state
const networkStatus = ref({
  wsConnected: false,
  gunConnected: false,
  peerCount: 0,
  gunPeerCount: 0,
  blockHeight: 0,
  chainValid: true
});

const connectionStatusClass = computed(() => {
  if (networkStatus.value.wsConnected && networkStatus.value.gunConnected) return 'connected';
  if (networkStatus.value.wsConnected || networkStatus.value.gunConnected) return 'partial';
  return '';
});

const connectionStatusLabel = computed(() => {
  if (networkStatus.value.wsConnected && networkStatus.value.gunConnected) return 'Fully Connected';
  if (networkStatus.value.wsConnected) return 'WS Only';
  if (networkStatus.value.gunConnected) return 'Gun Only';
  return 'Disconnected';
});

const peerList = ref<Array<{ peerId: string; relayUrl: string; gunPeers: string[]; joinedAt: number }>>([]);
const myPeerId = ref('');
const knownServers = ref<KnownServer[]>([]);

// Relay editing
const editRelay = ref({
  websocket: config.relay.websocket,
  gun: config.relay.gun,
  api: config.relay.api
});

const hasCustomRelay = computed(() => {
  const overrides = config.getRelayOverrides();
  return !!(overrides.websocket || overrides.gun || overrides.api);
});

let statusCleanup: (() => void) | null = null;
let networkPollInterval: ReturnType<typeof setInterval> | null = null;

const storagePercent = computed(() => {
  if (storageStats.value.quota === 0) return 0;
  return (storageStats.value.used / storageStats.value.quota) * 100;
});

const fullDeviceId = computed(() => {
  return deviceId.value || '';
});

function isActiveServer(wsUrl: string): boolean {
  return config.relay.websocket === wsUrl;
}

function shortenUrl(url: string): string {
  try {
    const u = new URL(url);
    return u.host;
  } catch {
    return url;
  }
}

function refreshNetwork() {
  const wsConnected = WebSocketService.getConnectionStatus();
  const gunStats = GunService.getPeerStats();
  const peerAddresses = WebSocketService.getPeerAddresses();

  networkStatus.value = {
    wsConnected,
    gunConnected: gunStats.isConnected,
    peerCount: WebSocketService.getPeerCount(),
    gunPeerCount: gunStats.peerCount,
    blockHeight: chainStore.blocks.length,
    chainValid: chainStore.chainValid
  };

  peerList.value = Array.from(peerAddresses.values());
  myPeerId.value = WebSocketService.getPeerId();
  knownServers.value = WebSocketService.getKnownServers();
}

async function applyRelayConfig() {
  const ws = editRelay.value.websocket.trim();
  const gun = editRelay.value.gun.trim();
  const api = editRelay.value.api.trim();

  if (!ws || !gun || !api) {
    const toast = await toastController.create({
      message: 'All relay fields are required',
      duration: 2000,
      color: 'warning'
    });
    await toast.present();
    return;
  }

  config.setRelayOverrides({ websocket: ws, gun, api });

  // Reconnect both services
  WebSocketService.reconnect(ws);
  GunService.reconnect(gun);

  const toast = await toastController.create({
    message: 'Relay configuration updated, reconnecting...',
    duration: 2000,
    color: 'success'
  });
  await toast.present();

  // Refresh after a short delay to pick up new connection status
  setTimeout(refreshNetwork, 2000);
}

async function resetRelayConfig() {
  config.resetRelayOverrides();

  editRelay.value = {
    websocket: config.relay.websocket,
    gun: config.relay.gun,
    api: config.relay.api
  };

  WebSocketService.reconnect();
  GunService.reconnect();

  const toast = await toastController.create({
    message: 'Relay reset to defaults, reconnecting...',
    duration: 2000,
    color: 'success'
  });
  await toast.present();

  setTimeout(refreshNetwork, 2000);
}

async function switchToServer(server: KnownServer) {
  config.setRelayOverrides({
    websocket: server.websocket,
    gun: server.gun,
    api: server.api
  });

  editRelay.value = {
    websocket: server.websocket,
    gun: server.gun,
    api: server.api
  };

  WebSocketService.reconnect(server.websocket);
  GunService.reconnect(server.gun);

  const toast = await toastController.create({
    message: `Switching to ${shortenUrl(server.websocket)}...`,
    duration: 2000,
    color: 'success'
  });
  await toast.present();

  setTimeout(refreshNetwork, 2000);
}

function formatPeerTime(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

async function revealPrivateKey() {
  const keyPair = await KeyService.getKeyPair();
  privateKeyHex.value = keyPair.privateKey;
  showPrivateKey.value = true;
}

async function copyPublicKey() {
  try {
    await navigator.clipboard.writeText(publicKeyHex.value);
    const toast = await toastController.create({
      message: 'Public key copied',
      duration: 1500,
      color: 'success',
    });
    await toast.present();
  } catch { /* clipboard not available */ }
}

async function copyPrivateKey() {
  try {
    await navigator.clipboard.writeText(privateKeyHex.value);
    const toast = await toastController.create({
      message: 'Private key copied — keep it safe!',
      duration: 2000,
      color: 'warning',
    });
    await toast.present();
  } catch { /* clipboard not available */ }
}

onMounted(async () => {
  await refreshStorageStats();
  await loadPolicy();
  userProfile.value = await UserService.getCurrentUser();
  deviceId.value = await VoteTrackerService.getDeviceId();
  void communityStore.loadCommunities();

  // Probe GunDB for available data versions
  try {
    const rawGun = GunService.getRawGun();
    await probeForVersions(rawGun, currentNamespace);
  } catch (err) {
    console.warn('Version probe failed:', err);
    availableVersions.value = [currentNamespace];
  }
  initVersionToggles();
  isProbing.value = false;

  // Load crypto keypair
  try {
    const keyPair = await KeyService.getKeyPair();
    publicKeyHex.value = keyPair.publicKey;
  } catch {
    // Key generation failed silently
  }

  const storedTheme = localStorage.getItem('theme');
  if (storedTheme === 'dark') {
    isDarkMode.value = true;
    document.body.classList.add('dark');
  }

  const storedMinKarma = localStorage.getItem('minUserKarma');
  if (storedMinKarma !== null) {
    minUserKarma.value = Number(storedMinKarma) || -1000;
  }

  // Load moderation settings (may have migrated legacy minUserKarma)
  modSettings.value = ModerationService.getSettings();
  minUserKarma.value = modSettings.value.minUserKarma;

  // Network polling
  refreshNetwork();
  statusCleanup = WebSocketService.onStatusChange(() => refreshNetwork());
  networkPollInterval = setInterval(refreshNetwork, 5000);
});

onUnmounted(() => {
  if (statusCleanup) statusCleanup();
  if (networkPollInterval) clearInterval(networkPollInterval);
});

const refreshStorageStats = async () => {
  storageStats.value = await PinningService.getStorageStats();
};

const loadPolicy = async () => {
  policy.value = await PinningService.getPolicy();
};

const savePolicy = async () => {
  await PinningService.setPolicy(policy.value);

  const toast = await toastController.create({
    message: 'Policy saved',
    duration: 1500,
    color: 'success'
  });
  await toast.present();
};

const toggleDarkMode = () => {
  if (isDarkMode.value) {
    document.documentElement.classList.add('dark');
    document.body.classList.add('dark');
    localStorage.setItem('theme', 'dark');
  } else {
    document.documentElement.classList.remove('dark');
    document.body.classList.remove('dark');
    localStorage.setItem('theme', 'light');
  }
};

const exportData = async () => {
  try {
    const data = await StorageManager.exportAllData();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `interpoll-backup-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);

    const toast = await toastController.create({
      message: 'Data exported successfully',
      duration: 2000,
      color: 'success'
    });
    await toast.present();
  } catch (_error) {
    const toast = await toastController.create({
      message: 'Export failed',
      duration: 2000,
      color: 'danger'
    });
    await toast.present();
  }
};

const importData = () => {
  importFileInput.value?.click();
};

const handleImportFile = async (event: Event) => {
  const target = event.target as HTMLInputElement;
  const file = target.files?.[0];

  if (!file) return;

  try {
    const text = await file.text();
    const data = JSON.parse(text);

    await StorageManager.importData(data);

    const toast = await toastController.create({
      message: 'Data imported successfully',
      duration: 2000,
      color: 'success'
    });
    await toast.present();

    await refreshStorageStats();
  } catch (_error) {
    const toast = await toastController.create({
      message: 'Import failed',
      duration: 2000,
      color: 'danger'
    });
    await toast.present();
  }
};

const pruneOldContent = async () => {
  const alert = await alertController.create({
    header: 'Clean Up Storage',
    message: 'This will remove old cached content. Your posts and important data will be kept.',
    buttons: [
      { text: 'Cancel', role: 'cancel' },
      {
        text: 'Clean Up',
        handler: async () => {
          const result = await StorageManager.pruneOldData();

          const toast = await toastController.create({
            message: `Cleaned up ${result.pollsDeleted} items`,
            duration: 2000,
            color: 'success'
          });
          await toast.present();

          await refreshStorageStats();
        }
      }
    ]
  });

  await alert.present();
};

const confirmClearAll = async () => {
  const alert = await alertController.create({
    header: 'Clear All Data',
    message: 'This will delete EVERYTHING from local storage. This cannot be undone!',
    buttons: [
      { text: 'Cancel', role: 'cancel' },
      {
        text: 'Clear All',
        role: 'destructive',
        handler: async () => {
          await StorageManager.clearAll();

          const toast = await toastController.create({
            message: 'All data cleared',
            duration: 2000,
            color: 'success'
          });
          await toast.present();

          await refreshStorageStats();
          router.push('/home');
        }
      }
    ]
  });

  await alert.present();
};
</script>
