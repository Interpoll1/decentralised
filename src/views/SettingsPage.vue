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
        </ion-segment>
      </ion-toolbar>
    </ion-header>

    <ion-content>
      <div class="page-shell page-shell--settings">
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
            Content filtering has moved to the <a href="#" class="link-primary" @click.prevent="activeTab = 'moderation'">Moderation</a> tab.
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
            <div class="info-row identity-row">
              <span>Username</span>
              <div class="identity-right">
                <UserIdentityBadge
                  v-if="userProfile"
                  :username="userProfile.customUsername || userProfile.username"
                />
              </div>
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

        <!-- Cryptographic Identity -->
        <div class="section">
          <h3 class="section-title">Cryptographic Identity</h3>
          <p class="section-subtitle">Your Security Manager identity (Ethereum address)</p>

          <div class="info-grid">
            <div class="info-row">
              <span>Address</span>
            </div>
            <div class="key-display">
              <code class="key-value">{{ auth.address ? auth.abbrAddr : 'Not signed in' }}</code>
              <ion-button v-if="auth.address" fill="clear" size="small" @click="copyAddress">
                <ion-icon :icon="copyOutline"></ion-icon>
              </ion-button>
            </div>
            <p class="key-warning mt-12">
              Your private key never leaves this device — it is protected by your
              passkey or recovery phrase and signs every action automatically.
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

        <!-- Word filter categories -->

        <!-- Reset -->
        <div class="section">
          <ion-button expand="block" fill="outline" color="medium" @click="resetModerationDefaults">
            <ion-icon slot="start" :icon="refreshOutline"></ion-icon>
            Reset Moderation to Defaults
          </ion-button>
        </div>
      </div>
      </div>
    </ion-content>
  </ion-page>
</template>


<style scoped>
/* Section Layout — each tab stacks its sections as spaced panels, matching
   the Home card language instead of bare full-width rows on the background. */
.page-shell--settings > div {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(360px, 1fr));
  gap: 16px;
  align-items: start;
}

.section {
  padding: 18px 20px;
  background:
    linear-gradient(180deg, var(--app-surface-tint-top), var(--app-surface-tint-bottom)),
    var(--app-surface);
  border: 1px solid var(--app-border);
  border-radius: var(--app-radius-lg);
  box-shadow: var(--app-shadow-md), var(--app-shadow-inset);
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

.link-primary {
  color: var(--ion-color-primary);
  cursor: pointer;
}

.separator {
  height: 1px;
  background: rgba(var(--ion-text-color-rgb), 0.08);
  margin: 16px 0;
}

.mt-2 { margin-top: 8px; }
.mt-3 { margin-top: 12px; }
.mt-12 { margin-top: 12px; }

.hidden-input { display: none; }

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

.identity-row {
  align-items: flex-start;
  flex-wrap: wrap;
  gap: 6px;
  padding: 4px 0;
}

.identity-right {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 6px;
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

.relay-textarea {
  min-height: 92px;
  resize: vertical;
}

.bootstrap-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

/* Gun Relay Peers */
.gun-peers-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 8px;
}

.gun-peer-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 12px;
  background: rgba(var(--ion-text-color-rgb), 0.03);
  border: 1px solid rgba(var(--ion-text-color-rgb), 0.08);
  border-radius: 10px;
  gap: 8px;
}

.gun-peer-info {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  flex: 1;
}

.gun-peer-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--ion-color-medium);
  flex-shrink: 0;
  transition: background 0.3s;
}

.gun-peer-dot.online {
  background: var(--ion-color-success);
  box-shadow: 0 0 6px rgba(var(--ion-color-success-rgb), 0.5);
}

.gun-peer-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.gun-peer-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--ion-text-color);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.gun-peer-url {
  font-size: 11px;
  font-family: monospace;
  color: var(--ion-color-medium);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.gun-peer-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.gun-peer-latency {
  font-size: 11px;
  font-family: monospace;
  color: var(--ion-color-medium);
  background: rgba(var(--ion-text-color-rgb), 0.06);
  padding: 2px 6px;
  border-radius: 6px;
}

.gun-peer-status {
  font-size: 11px;
  font-weight: 600;
  padding: 2px 7px;
  border-radius: 8px;
}

.gun-preset-row {
  display: flex;
  gap: 8px;
  align-items: center;
}

.gun-preset-row .relay-input {
  flex: 1;
}

.relay-select {
  appearance: none;
  cursor: pointer;
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
  align-items: flex-start;
  margin-bottom: 8px;
}

.server-meta {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 6px;
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

.active-badge.reconnecting {
  color: var(--ion-color-medium);
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
  toastController,
  onIonViewWillEnter
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
  checkmarkCircleOutline,
  addOutline
} from 'ionicons/icons';
import { UserService } from '../services/userService';
import { VoteTrackerService } from '../services/voteTrackerService';
import { useCommunityStore } from '../stores/communityStore';
import { useAuthStore } from '../stores/authStore';
import { ModerationService, moderationVersion, type ModerationSettings, type WordCategory } from '../services/moderationService';
import { useFeedPreferences } from '../composables/useFeedPreferences';
import type { FeedMode, FeedRankingWeights } from '../services/feedPreferencesService';
import UserIdentityBadge from '../components/UserIdentityBadge.vue';

const router = useRouter();
const auth = useAuthStore();
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

const isDarkMode = ref(false);
const userProfile = ref<any>(null);
const deviceId = ref('');

const feedCommunities = computed(() =>
  [...communityStore.communities].sort((a, b) => a.displayName.localeCompare(b.displayName)),
);

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

function onKarmaRangeChange(ev: CustomEvent) {
  const val = ev.detail.value as number;
  modSettings.value.minUserKarma = val <= -100 ? -1000 : val;
  saveModerationSettings();
}

function saveModerationSettings() {
  ModerationService.saveSettings({ ...modSettings.value });
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
  const toast = await toastController.create({
    message: 'Moderation settings reset to defaults',
    duration: 1500,
    color: 'success'
  });
  await toast.present();
}

// Crypto identity state
onMounted(async () => {
  userProfile.value = await UserService.getCurrentUserWithKarma(true);
  deviceId.value = await VoteTrackerService.getDeviceId();
  void communityStore.loadCommunities();

  const storedTheme = localStorage.getItem('theme');
  if (storedTheme === 'dark') {
    isDarkMode.value = true;
    document.documentElement.classList.add('dark');
    document.body.classList.add('dark');
  }

  // Load moderation settings (may have migrated legacy minUserKarma)
  modSettings.value = ModerationService.getSettings();
});

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

/** Copy the active Security Manager Ethereum address to the clipboard. */
const copyAddress = async () => {
  if (!auth.address) return;
  try {
    await navigator.clipboard.writeText(auth.address);
    const toast = await toastController.create({ message: 'Address copied', duration: 1500, color: 'success' });
    await toast.present();
  } catch { /* clipboard unavailable */ }
};

</script>
