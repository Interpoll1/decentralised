<template>
  <ion-page class="settings-page">
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start">
          <button class="back-btn" @click="router.back()">
            <svg viewBox="0 0 24 24" fill="none"><path d="M15 18l-6-6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
        </ion-buttons>
        <ion-title>Settings</ion-title>
      </ion-toolbar>


      <!-- Custom tab bar — replaces ion-segment -->
      <div class="settings-tab-bar">
        <button v-for="tab in tabs" :key="tab.id"
          class="settings-tab" :class="{ active: activeTab === tab.id }"
          @click="activeTab = tab.id">
          <ion-icon :icon="tab.icon"></ion-icon>
          <span>{{ tab.label }}</span>
        </button>
      </div>
    </ion-header>

    <ion-content>
      <DesktopPageShell>
      <div class="settings-body">

        <!-- ══════════════════════ GENERAL TAB ══════════════════════ -->
        <div v-if="activeTab === 'general'">

          <!-- Account card -->
          <div class="settings-card">
            <div class="card-heading">
              <div class="card-heading-icon accent-violet">
                <ion-icon :icon="personCircleOutline"></ion-icon>
              </div>
              <div>
                <h3>Account</h3>
                <p>Your identity on Interpoll</p>
              </div>
            </div>
            <div class="info-table">
              <div class="info-row">
                <span class="info-key">Device ID</span>
                <code class="info-val mono-sm">{{ fullDeviceId }}</code>
              </div>
              <div class="info-row">
                <span class="info-key">Username</span>
                <div class="info-val flex-end">
                  <UserIdentityBadge v-if="userProfile"
                    :username="userProfile.customUsername || userProfile.username"
                    :pubkey="publicKeyHex" />
                  <button class="pill-btn accent" @click="$router.push('/claim-username')">
                    {{ userProfile?.customUsername ? 'Change' : 'Set username' }}
                  </button>
                </div>
              </div>
              <div class="info-row">
                <span class="info-key">Karma</span>
                <span class="karma-badge">{{ userProfile?.karma || 0 }}</span>
              </div>
            </div>
            <button class="block-btn outline mt-12" @click="$router.push('/profile')">
              <ion-icon :icon="personCircleOutline"></ion-icon>
              Edit Profile
            </button>
          </div>

          <!-- Cryptographic identity -->
          <div class="settings-card danger-zone">
            <div class="card-heading">
              <div class="card-heading-icon accent-amber">
                <ion-icon :icon="keyOutline"></ion-icon>
              </div>
              <div>
                <h3>Cryptographic Identity</h3>
                <p>Schnorr / secp256k1 keypair for signing events</p>
              </div>
            </div>
            <div class="key-block">
              <div class="key-row">
                <span class="key-label">Public Key</span>
                <div class="key-value-row">
                  <code class="key-val">{{ publicKeyHex }}</code>
                  <button class="icon-btn" @click="copyPublicKey" title="Copy"><ion-icon :icon="copyOutline"></ion-icon></button>
                </div>
              </div>
              <div class="key-row">
                <span class="key-label">Private Key</span>
                <div v-if="!showPrivateKey" class="key-value-row">
                  <code class="key-val muted">•••• hidden ••••</code>
                  <button class="icon-btn warning" @click="revealPrivateKey" title="Reveal"><ion-icon :icon="eyeOutline"></ion-icon></button>
                </div>
                <div v-else class="key-value-row">
                  <code class="key-val danger">{{ privateKeyHex }}</code>
                  <button class="icon-btn" @click="copyPrivateKey" title="Copy"><ion-icon :icon="copyOutline"></ion-icon></button>
                </div>
              </div>
              <div v-if="showPrivateKey" class="alert-box warning">
                <ion-icon :icon="warningOutline"></ion-icon>
                Never share your private key. Anyone with it can sign events as you.
              </div>
            </div>
          </div>

          <!-- Appearance -->
          <div class="settings-card">
            <div class="card-heading">
              <div class="card-heading-icon accent-blue">
                <ion-icon :icon="colorPaletteOutline"></ion-icon>
              </div>
              <div><h3>Appearance</h3></div>
            </div>
            <div class="toggle-row">
              <div>
                <div class="toggle-label">{{ isDarkMode ? 'Dark mode' : 'Light mode' }}</div>
                <div class="toggle-sub">Switch between light and dark theme</div>
              </div>
              <label class="toggle-switch">
                <input type="checkbox" v-model="isDarkMode" @change="toggleDarkMode" />
                <span class="toggle-track"></span>
              </label>
            </div>
          </div>

          <!-- Home Feed Moderation -->
          <div class="settings-card">
            <div class="card-heading">
              <div class="card-heading-icon accent-rose">
                <ion-icon :icon="shieldCheckmarkOutline"></ion-icon>
              </div>
              <div>
                <h3>Home Feed Moderation</h3>
                <p>Use a moderation API to filter your feed</p>
              </div>
            </div>
            <div class="toggle-row">
              <div><div class="toggle-label">Moderate home feed</div></div>
              <label class="toggle-switch">
                <input type="checkbox" v-model="modSettings.moderateHomeFeed" @change="saveModerationSettings" />
                <span class="toggle-track"></span>
              </label>
            </div>
            <div class="field-group mt-12">
              <label class="field-label">API Provider</label>
              <div class="field-wrap">
                <select class="field-native" v-model="modSettings.moderationProvider" @change="onModerationProviderChange">
                  <option value="interpoll">InterPoll default API</option>
                  <option value="custom">Custom API</option>
                </select>
              </div>
            </div>
            <div v-if="modSettings.moderationProvider === 'custom'" class="field-group mt-8">
              <label class="field-label">Custom API URL</label>
              <div class="field-wrap">
                <input class="field-native" v-model="modSettings.moderationApiBaseUrl"
                  placeholder="https://example.com/moderation" @blur="saveModerationSettings" />
              </div>
            </div>
            <p class="helper-text mt-8">Default: {{ moderationDefaultApiUrl }}</p>
          </div>

        </div>

        <!-- ══════════════════════ FEED TAB ══════════════════════ -->
        <div v-if="activeTab === 'feed'">

          <div class="settings-card">
            <div class="card-heading">
              <div class="card-heading-icon accent-violet">
                <ion-icon :icon="rocketOutline"></ion-icon>
              </div>
              <div>
                <h3>Feed Mode</h3>
                <p>Chronological or personalised ranking</p>
              </div>
            </div>
            <div class="seg-pills">
              <button class="seg-pill" :class="{ active: feedPreferences.mode === 'for-you' }"
                @click="onFeedModeChange({ detail: { value: 'for-you' } })">For You</button>
              <button class="seg-pill" :class="{ active: feedPreferences.mode === 'latest' }"
                @click="onFeedModeChange({ detail: { value: 'latest' } })">Latest</button>
            </div>
            <p class="helper-text mt-8">For You uses keyword and community preferences plus engagement/freshness scoring. Latest is purely chronological.</p>
          </div>

          <div class="settings-card">
            <div class="card-heading">
              <div class="card-heading-icon accent-teal">
                <ion-icon :icon="optionsOutline"></ion-icon>
              </div>
              <div><h3>Content Types</h3><p>What appears in your feed</p></div>
            </div>
            <div class="toggle-row">
              <div class="toggle-label">Show posts</div>
              <label class="toggle-switch">
                <input type="checkbox" :checked="feedPreferences.showPosts" @change="onFeedPostsToggle" />
                <span class="toggle-track"></span>
              </label>
            </div>
            <div class="toggle-row mt-8">
              <div class="toggle-label">Show polls</div>
              <label class="toggle-switch">
                <input type="checkbox" :checked="feedPreferences.showPolls" @change="onFeedPollsToggle" />
                <span class="toggle-track"></span>
              </label>
            </div>
          </div>

          <div class="settings-card">
            <div class="card-heading">
              <div class="card-heading-icon accent-green">
                <ion-icon :icon="addCircleOutline"></ion-icon>
              </div>
              <div><h3>Include Keywords</h3><p>Boost content containing these words</p></div>
            </div>
            <div class="chip-list" v-if="feedPreferences.includeKeywords.length">
              <button class="kw-chip include" v-for="kw in feedPreferences.includeKeywords" :key="kw"
                @click="removeFeedIncludeKeyword(kw)">{{ kw }} ×</button>
            </div>
            <div class="inline-add mt-8">
              <div class="field-wrap flex1">
                <input class="field-native" v-model="newFeedIncludeKeyword"
                  placeholder="Add keyword…" @keyup.enter="addFeedIncludeKeyword" />
              </div>
              <button class="pill-btn accent" @click="addFeedIncludeKeyword"
                :disabled="!newFeedIncludeKeyword.trim()">Add</button>
            </div>
          </div>

          <div class="settings-card">
            <div class="card-heading">
              <div class="card-heading-icon accent-amber">
                <ion-icon :icon="removeCircleOutline"></ion-icon>
              </div>
              <div><h3>Exclude Keywords</h3><p>Demote content with these words</p></div>
            </div>
            <div class="chip-list" v-if="feedPreferences.excludeKeywords.length">
              <button class="kw-chip exclude" v-for="kw in feedPreferences.excludeKeywords" :key="kw"
                @click="removeFeedExcludeKeyword(kw)">{{ kw }} ×</button>
            </div>
            <div class="inline-add mt-8">
              <div class="field-wrap flex1">
                <input class="field-native" v-model="newFeedExcludeKeyword"
                  placeholder="Add keyword…" @keyup.enter="addFeedExcludeKeyword" />
              </div>
              <button class="pill-btn accent" @click="addFeedExcludeKeyword"
                :disabled="!newFeedExcludeKeyword.trim()">Add</button>
            </div>
          </div>

          <div class="settings-card">
            <div class="card-heading">
              <div class="card-heading-icon accent-blue">
                <ion-icon :icon="peopleOutline"></ion-icon>
              </div>
              <div><h3>Community Preferences</h3><p>Favourite = boost, Muted = hidden</p></div>
            </div>
            <div v-if="communityStore.isLoading" class="helper-text">Loading…</div>
            <div v-else-if="feedCommunities.length > 0" class="community-pref-list">
              <div v-for="community in feedCommunities" :key="community.id" class="community-pref-row">
                <div>
                  <div class="toggle-label">{{ community.displayName }}</div>
                  <div class="community-id-text">{{ community.id }}</div>
                </div>
                <div class="pref-btns">
                  <button class="pref-btn" :class="{ active: isFavoriteCommunity(community.id) }"
                    @click="toggleFavoriteCommunityPreference(community.id)">★ Fav</button>
                  <button class="pref-btn mute" :class="{ active: isMutedCommunity(community.id) }"
                    @click="toggleMutedCommunityPreference(community.id)">Mute</button>
                </div>
              </div>
            </div>
            <p v-else class="helper-text">No communities loaded yet.</p>
          </div>

          <div class="settings-card">
            <div class="card-heading">
              <div class="card-heading-icon accent-violet">
                <ion-icon :icon="analyticsOutline"></ion-icon>
              </div>
              <div><h3>Ranking Weights</h3><p>Tweak what matters in your feed</p></div>
            </div>
            <div class="range-row" v-for="(weight, key) in feedPreferences.rankingWeights" :key="key">
              <div class="range-header">
                <span>{{ { freshness: 'Freshness', engagement: 'Engagement', keywords: 'Keywords', community: 'Community affinity' }[key] }}</span>
                <strong class="range-val">{{ formatWeight(weight) }}</strong>
              </div>
              <ion-range :min="0" :max="1" :step="0.05" :value="weight"
                @ionChange="(ev) => onFeedWeightChange(key, ev)" :pin="true"></ion-range>
            </div>
            <button class="block-btn outline mt-12" @click="resetFeedPreferencesToDefaults">Reset Feed Preferences</button>
          </div>
        </div>

        <!-- ══════════════════════ MODERATION TAB ══════════════════════ -->
        <div v-if="activeTab === 'moderation'">
          <div class="settings-card">
            <div class="card-heading">
              <div class="card-heading-icon accent-amber">
                <ion-icon :icon="personOutline"></ion-icon>
              </div>
              <div><h3>Karma Filter</h3><p>Hide posts from low-rep users</p></div>
            </div>
            <div class="range-row">
              <div class="range-header">
                <span>Min karma</span>
                <strong class="range-val">{{ modSettings.minUserKarma <= -1000 ? 'Off' : modSettings.minUserKarma }}</strong>
              </div>
              <ion-range :min="-100" :max="100" :step="5"
                :value="modSettings.minUserKarma <= -1000 ? -100 : modSettings.minUserKarma"
                @ionChange="onKarmaRangeChange" :pin="true"></ion-range>
            </div>
            <p class="helper-text">Drag to −100 to disable.</p>
          </div>

          <div class="settings-card">
            <div class="card-heading">
              <div class="card-heading-icon accent-rose">
                <ion-icon :icon="arrowDownOutline"></ion-icon>
              </div>
              <div><h3>Score Filter</h3><p>Hide heavily downvoted content</p></div>
            </div>
            <div class="range-row">
              <div class="range-header">
                <span>Min score</span>
                <strong class="range-val">{{ modSettings.minContentScore }}</strong>
              </div>
              <ion-range :min="-50" :max="50" :step="1" v-model="modSettings.minContentScore"
                @ionKnobMoveEnd="saveModerationSettings" :pin="true"></ion-range>
            </div>
            <p class="helper-text">Posts with net score below this are hidden.</p>
          </div>

          <div class="settings-card">
            <div class="card-heading">
              <div class="card-heading-icon accent-rose">
                <ion-icon :icon="chatbubbleOutline"></ion-icon>
              </div>
              <div><h3>Word Filter</h3><p>Hide or blur content with flagged words</p></div>
            </div>
            <div class="field-group">
              <label class="field-label">Filter Action</label>
              <div class="seg-pills">
                <button class="seg-pill" :class="{ active: modSettings.wordFilterAction === 'blur' }"
                  @click="modSettings.wordFilterAction = 'blur'; saveModerationSettings()">Blur</button>
                <button class="seg-pill" :class="{ active: modSettings.wordFilterAction === 'hide' }"
                  @click="modSettings.wordFilterAction = 'hide'; saveModerationSettings()">Hide</button>
                <button class="seg-pill" :class="{ active: modSettings.wordFilterAction === 'flag' }"
                  @click="modSettings.wordFilterAction = 'flag'; saveModerationSettings()">Flag</button>
              </div>
            </div>
            <button class="block-btn outline danger mt-12" @click="resetModerationDefaults">
              <ion-icon :icon="refreshOutline"></ion-icon>
              Reset Moderation to Defaults
            </button>
          </div>
        </div>

        <!-- ══════════════════════ ADVANCED TAB ══════════════════════ -->
        <div v-if="activeTab === 'advanced'">
          <div class="settings-card">
            <div class="card-heading">
              <div class="card-heading-icon accent-violet">
                <ion-icon :icon="keyOutline"></ion-icon>
              </div>
              <div><h3>Moderation API</h3><p>Authenticate and enable click-to-submit from Home feed</p></div>
            </div>
            <div class="field-group">
              <label class="field-label">Provider</label>
              <div class="field-wrap">
                <select class="field-native" v-model="modSettings.moderationProvider" @change="saveModerationSettings">
                  <option value="interpoll">Interpoll Moderation API</option>
                  <option value="custom">Custom API</option>
                </select>
              </div>
            </div>
            <div class="field-group mt-8">
              <label class="field-label">API Base URL</label>
              <div class="field-wrap">
                <input class="field-native mono-sm" v-model="modSettings.moderationApiBaseUrl"
                  @blur="saveModerationSettings" placeholder="https://interpoll.endless.sbs/moderation" />
              </div>
            </div>
            <div class="field-group mt-8">
              <label class="field-label">API Key</label>
              <div class="field-wrap">
                <input class="field-native mono-sm" type="password" v-model="moderationApiKeyInput" placeholder="mod_sk_..." />
              </div>
            </div>
            <div class="button-row mt-12">
              <button class="pill-btn accent" @click="authenticateModerationApi">Authenticate</button>
              <button class="pill-btn outline" @click="clearModerationApiAuth">Clear Auth</button>
            </div>
            <p class="helper-text mt-8">{{ moderationAuthMessage }}</p>
          </div>

          <div class="settings-card">
            <div class="card-heading">
              <div class="card-heading-icon accent-teal">
                <ion-icon :icon="fingerPrintOutline"></ion-icon>
              </div>
              <div><h3>Manual Hash Submission</h3><p>SHA-256 of post body sent to moderation API on click</p></div>
            </div>
            <div class="toggle-row">
              <div>
                <div class="toggle-label">Click post to submit hash</div>
                <div class="toggle-sub">No author fields included — content hash only</div>
              </div>
              <label class="toggle-switch">
                <input type="checkbox" v-model="modSettings.moderationClickToSubmit" @change="saveModerationSettings" />
                <span class="toggle-track"></span>
              </label>
            </div>
          </div>
        </div>

        <!-- ══════════════════════ NETWORK TAB ══════════════════════ -->
        <div v-if="activeTab === 'network'">

          <!-- P2P health banner -->
          <div class="p2p-banner" :class="networkStatus.gunConnected ? 'banner-ok' : 'banner-warn'">
            <div class="banner-left">
              <div class="banner-dot" :class="networkStatus.gunConnected ? 'dot-ok' : 'dot-warn'"></div>
              <div>
                <div class="banner-title">{{ networkStatus.gunConnected ? 'Decentralised Network Active' : 'Network Degraded' }}</div>
                <div class="banner-sub">{{ networkStatus.gunConnectedCount }} peer{{ networkStatus.gunConnectedCount !== 1 ? 's' : '' }} connected · {{ networkStatus.gunAvgLatencyMs != null ? networkStatus.gunAvgLatencyMs + 'ms avg' : 'measuring…' }}</div>
              </div>
            </div>
            <div class="banner-metrics">
              <div class="bmetric">
                <span>{{ networkStatus.peerCount }}</span>
                <small>Relay peers</small>
              </div>
              <div class="bmetric">
                <span>{{ networkStatus.gunConnectedCount }}/{{ networkStatus.gunPeerCount }}</span>
                <small>DB relays</small>
              </div>
              <div class="bmetric" :class="networkStatus.chainValid ? 'ok' : 'danger'">
                <span>{{ networkStatus.chainValid ? '✓' : '✗' }}</span>
                <small>Chain</small>
              </div>
            </div>
          </div>

          <!-- Privacy & Tor -->
          <div class="settings-card">
            <div class="card-heading">
              <div class="card-heading-icon accent-violet">
                <ion-icon :icon="shieldCheckmarkOutline"></ion-icon>
              </div>
              <div>
                <h3>Privacy &amp; Tor</h3>
                <p>Restrict network features that may leak your IP or device fingerprint. Enable this when routing traffic through Tor or a VPN for enhanced anonymity.</p>
              </div>
              <span class="status-pill" :class="anonymityMode ? 'pill-ok' : 'pill-off'">
                {{ anonymityMode ? 'Anonymity ON' : 'OFF' }}
              </span>
            </div>
            <div class="toggle-row">
              <div>
                <div class="toggle-label">Anonymity (Tor) Mode</div>
                <div class="toggle-sub">Disables WebRTC, prefers .onion relays</div>
              </div>
              <label class="toggle-switch">
                <input type="checkbox" v-model="anonymityMode" @change="onAnonymityToggle" />
                <span class="toggle-track"></span>
              </label>
            </div>
            <div class="alert-box info mt-12">
              <ion-icon :icon="informationCircleOutline"></ion-icon>
              <span>Web applications cannot route their own TCP traffic through Tor. To use Interpoll over Tor, open it in <a href="https://www.torproject.org" target="_blank" class="link">Tor Browser</a>, or proxy this browser's traffic through <a href="https://orbot.app" target="_blank" class="link">Orbot</a>.</span>
            </div>
            <div v-if="anonymityMode" class="mt-12">
              <div class="status-row" :class="activeRelayIsOnion ? 'row-ok' : 'row-warn'">
                <ion-icon :icon="activeRelayIsOnion ? lockClosedOutline : warningOutline"></ion-icon>
                <span v-if="activeRelayIsOnion">Active relay is a <code>.onion</code> address — routing via Tor hidden service.</span>
                <span v-else>Active relay is <strong>clearnet</strong> — add a <code>.onion</code> relay below for hidden-service routing.</span>
              </div>
              <button class="pill-btn outline mt-8" :disabled="torChecking" @click="checkTorStatus">
                <ion-icon :icon="refreshOutline"></ion-icon>
                {{ torChecking ? 'Checking…' : 'Check Tor status' }}
              </button>
              <div v-if="torStatus.checked" class="alert-box mt-8"
                :class="torStatus.isTor === true ? 'info' : torStatus.isTor === false ? 'warning' : ''">
                {{ torStatus.note }}
              </div>
            </div>
          </div>

          <!-- Relay Peers -->
          <div class="settings-card">
            <div class="card-heading">
              <div class="card-heading-icon accent-teal">
                <ion-icon :icon="serverOutline"></ion-icon>
              </div>
              <div>
                <h3>Relay Peers</h3>
                <p>GunDB relay servers that sync data across the network. Connecting to multiple peers ensures continuity if any single server becomes unavailable.</p>
              </div>
              <span class="count-badge">{{ networkStatus.gunConnectedCount }}/{{ gunPeersList.length }}</span>
            </div>

            <div class="peer-health-list">
              <div v-for="peer in gunPeersDetail.length ? gunPeersDetail : gunPeersList.map(u => ({ url: u, connected: false }))"
                :key="peer.url" class="peer-health-row">
                <div class="peer-health-left">
                  <span class="health-dot" :class="peer.connected ? 'dot-ok' : 'dot-off'"></span>
                  <div>
                    <div class="peer-name">{{ labelForGunUrl(peer.url) }}</div>
                    <div class="peer-url">{{ peer.url }}</div>
                  </div>
                </div>
                <div class="peer-health-right">
                  <span v-if="peer.latencyMs != null" class="latency-badge">{{ peer.latencyMs }}ms</span>
                  <span class="status-chip" :class="peer.connected ? 'chip-ok' : 'chip-off'">
                    {{ peer.connected ? 'Live' : 'Connecting…' }}
                  </span>
                  <button v-if="gunPeersList.length > 1" class="icon-btn danger" @click="removeGunPeer(peer.url)" title="Remove">
                    <ion-icon :icon="trashOutline"></ion-icon>
                  </button>
                </div>
              </div>
            </div>

            <!-- Add preset -->
            <div v-if="availableGunPresets.length" class="field-group mt-12">
              <label class="field-label">Add from presets</label>
              <div class="inline-add">
                <div class="field-wrap flex1">
                  <select class="field-native" v-model="selectedGunPreset">
                    <option value="">— choose a preset —</option>
                    <option v-for="p in availableGunPresets" :key="p.url" :value="p.url">{{ p.label }}</option>
                  </select>
                </div>
                <button class="pill-btn accent" :disabled="!selectedGunPreset" @click="addGunPeerFromPreset">Add</button>
              </div>
            </div>

            <!-- Add custom -->
            <div class="field-group mt-8">
              <label class="field-label">Add custom relay URL</label>
              <div class="inline-add">
                <div class="field-wrap flex1">
                  <input class="field-native mono-sm" v-model="newGunPeerUrl"
                    placeholder="https://your-relay.example.com/gun"
                    @keyup.enter="addGunPeerFromInput" />
                </div>
                <button class="pill-btn accent" :disabled="!newGunPeerUrl.trim()" @click="addGunPeerFromInput">Add</button>
              </div>
            </div>
            <button class="pill-btn outline mt-8" @click="resetGunPeersToDefaults">Reset to defaults</button>
          </div>

          <!-- Run a Relay Node -->
          <div class="settings-card decentralised-feature">
            <div class="decentral-badge">
              <ion-icon :icon="globeOutline"></ion-icon>
              DECENTRALISED
            </div>
            <div class="card-heading">
              <div class="card-heading-icon accent-violet">
                <ion-icon :icon="cloudUploadOutline"></ion-icon>
              </div>
              <div>
                <h3>Run a Relay Node</h3>
                <p>Contribute to the network by hosting a GunDB relay. Each additional node improves data availability and reduces latency for all users. Choose the setup path that suits your environment.</p>
              </div>
            </div>

            <div class="relay-options">
              <div class="relay-option">
                <div class="relay-option-header">
                  <span class="relay-difficulty easy">Easy</span>
                  <span class="relay-option-name">Browser Tab</span>
                </div>
                <p class="relay-option-desc">Runs a relay directly in this browser tab via a WebSocket bridge. Automatically receives a public <code>wss://tunnel.interpoll.endless.sbs</code> URL — no server or port-forwarding required.</p>
                <button class="pill-btn accent">Enable Browser Relay</button>
              </div>

              <div class="relay-option">
                <div class="relay-option-header">
                  <span class="relay-difficulty medium">Medium</span>
                  <span class="relay-option-name">Home Server</span>
                </div>
                <p class="relay-option-desc">Deploys a GunDB relay on a Raspberry Pi or spare Linux machine on your local network. The installer prints the relay URL and optionally guides you through port-forwarding for external access.</p>
                <div class="code-block">curl -sSL https://interpoll.endless.sbs/install.sh | bash</div>
              </div>

              <div class="relay-option">
                <div class="relay-option-header">
                  <span class="relay-difficulty advanced">Technical</span>
                  <span class="relay-option-name">Cloud VPS</span>
                </div>
                <p class="relay-option-desc">Provisions a production-grade relay on any VPS with a domain name. The script handles Docker, Caddy reverse-proxy, and automatic TLS certificate issuance in a single command.</p>
                <div class="code-block">curl -sSL https://interpoll.endless.sbs/vps.sh | bash -s yourdomain.com</div>
              </div>
            </div>
          </div>

          <!-- Relay Configuration -->
          <div class="settings-card">
            <div class="card-heading">
              <div class="card-heading-icon accent-blue">
                <ion-icon :icon="constructOutline"></ion-icon>
              </div>
              <div><h3>Relay Configuration</h3><p>Change the servers your node connects to</p></div>
              <span v-if="hasCustomRelay" class="status-pill pill-warn">Custom</span>
            </div>
            <div class="field-group">
              <label class="field-label">WebSocket Relay</label>
              <div class="field-wrap"><input class="field-native mono-sm" v-model="editRelay.websocket" placeholder="ws://localhost:8080" /></div>
            </div>
            <div class="field-group mt-8">
              <label class="field-label">GunDB Relay</label>
              <div class="field-wrap"><input class="field-native mono-sm" v-model="editRelay.gun" placeholder="http://localhost:8765/gun" /></div>
            </div>
            <div class="field-group mt-8">
              <label class="field-label">API Server</label>
              <div class="field-wrap"><input class="field-native mono-sm" v-model="editRelay.api" placeholder="http://localhost:8080" /></div>
            </div>
            <button class="block-btn accent mt-12" @click="applyRelayConfig">
              <ion-icon :icon="swapHorizontalOutline"></ion-icon>
              Apply &amp; Reconnect
            </button>
            <button v-if="hasCustomRelay" class="block-btn outline mt-8" @click="resetRelayConfig">Reset to Defaults</button>
          </div>

          <!-- Bootstrap Recovery -->
          <div class="settings-card">
            <div class="card-heading">
              <div class="card-heading-icon accent-amber">
                <ion-icon :icon="refreshOutline"></ion-icon>
              </div>
              <div>
                <h3>Bootstrap Recovery</h3>
                <p>Re-establish network connectivity when primary relays are unreachable. Discover active peers via the Gun mesh, or exchange signed invite bundles out-of-band to restore access.</p>
              </div>
            </div>
            <div class="button-row">
              <button class="pill-btn outline" :disabled="bootstrapDiscovering" @click="discoverBootstrapFromGun">
                <ion-icon :icon="refreshOutline"></ion-icon>
                {{ bootstrapDiscovering ? 'Discovering…' : 'Discover from Gun' }}
              </button>
              <button class="pill-btn outline" @click="generateBootstrapInvite">
                <ion-icon :icon="downloadOutline"></ion-icon>
                Generate Invite
              </button>
              <button class="pill-btn outline" :disabled="!generatedBootstrapInvite" @click="copyGeneratedBootstrapInvite">
                <ion-icon :icon="copyOutline"></ion-icon>
                Copy Invite
              </button>
            </div>
            <p class="helper-text mt-8">Imported endpoints are validated before connecting — no silent relay switching occurs.</p>
          </div>

          <!-- Connected Peers & Your Node -->
          <div class="settings-card">
            <div class="card-heading">
              <div class="card-heading-icon accent-teal">
                <ion-icon :icon="peopleOutline"></ion-icon>
              </div>
              <div><h3>Connected Peers</h3><p>Peers sharing relay addresses automatically</p></div>
              <button class="icon-btn" @click="refreshNetwork"><ion-icon :icon="refreshOutline"></ion-icon></button>
            </div>
            <div v-if="peerList.length === 0" class="empty-peers">
              <ion-icon :icon="globeOutline"></ion-icon>
              <p>No peers connected yet</p>
            </div>
            <div v-else class="peer-health-list">
              <div v-for="peer in peerList" :key="peer.peerId" class="peer-health-row">
                <div class="peer-health-left">
                  <span class="health-dot dot-ok"></span>
                  <div>
                    <div class="peer-name">{{ peer.peerId }}</div>
                    <div class="peer-url" v-if="peer.relayUrl">{{ peer.relayUrl }}</div>
                  </div>
                </div>
                <span class="peer-joined-time">{{ formatPeerTime(peer.joinedAt) }}</span>
              </div>
            </div>
            <div class="info-table mt-12">
              <div class="info-row">
                <span class="info-key">Your Peer ID</span>
                <code class="info-val mono-sm">{{ myPeerId }}</code>
              </div>
              <div class="info-row">
                <span class="info-key">Device ID</span>
                <code class="info-val mono-sm">{{ fullDeviceId }}</code>
              </div>
            </div>
          </div>
        </div>

        <!-- ══════════════════════ DATA TAB ══════════════════════ -->
        <div v-if="activeTab === 'data'">

          <!-- Storage usage -->
          <div class="settings-card">
            <div class="card-heading">
              <div class="card-heading-icon accent-blue">
                <ion-icon :icon="serverOutline"></ion-icon>
              </div>
              <div><h3>Storage Usage</h3><p>Local device storage</p></div>
            </div>
            <div class="storage-ring-row">
              <div class="storage-ring">
                <svg viewBox="0 0 56 56">
                  <circle cx="28" cy="28" r="24" fill="none" stroke="rgba(255,255,255,0.07)" stroke-width="6"/>
                  <circle cx="28" cy="28" r="24" fill="none"
                    :stroke="storagePercent > 95 ? '#ef4444' : storagePercent > 80 ? '#f59e0b' : '#6366f1'"
                    stroke-width="6" stroke-linecap="round"
                    :stroke-dasharray="`${storagePercent * 1.508} 150.8`"
                    stroke-dashoffset="37.7" transform="rotate(-90 28 28)"/>
                </svg>
                <div class="ring-label">{{ storagePercent.toFixed(0) }}%</div>
              </div>
              <div class="storage-stats">
                <div class="storage-stat-row">
                  <span>Used</span><strong>{{ storageStats.used.toFixed(1) }} MB</strong>
                </div>
                <div class="storage-stat-row">
                  <span>Available</span><strong>{{ storageStats.quota.toFixed(0) }} MB</strong>
                </div>
                <div class="storage-stat-row">
                  <span>Pinned images</span><strong>{{ storageStats.pinnedItems }}</strong>
                </div>
              </div>
            </div>
            <button class="pill-btn outline mt-12" @click="refreshStorageStats">
              <ion-icon :icon="refreshOutline"></ion-icon>
              Refresh Stats
            </button>
          </div>

          <!-- Data Versions -->
          <div class="settings-card">
            <div class="card-heading">
              <div class="card-heading-icon accent-violet">
                <ion-icon :icon="layersOutline"></ion-icon>
              </div>
              <div><h3>Data Versions</h3><p>Which GunDB data versions to display</p></div>
            </div>
            <div v-if="isProbing" class="helper-text">Probing available versions…</div>
            <template v-else>
              <div v-for="version in availableVersions" :key="version" class="toggle-row">
                <div>
                  <div class="toggle-label">{{ version === currentNamespace ? `${version} (current)` : `${version} (legacy)` }}</div>
                  <div class="toggle-sub">{{ version === currentNamespace ? 'Default namespace' : 'Legacy posts from before migration' }}</div>
                </div>
                <label class="toggle-switch">
                  <input type="checkbox" :checked="versionToggles[version]" @change="toggleVersion(version)" />
                  <span class="toggle-track"></span>
                </label>
              </div>
            </template>
            <p class="helper-text mt-8">Legacy posts were created before the namespace migration. Changes take effect on next page load.</p>
          </div>

          <!-- Storage Policy -->
          <div class="settings-card">
            <div class="card-heading">
              <div class="card-heading-icon accent-teal">
                <ion-icon :icon="cloudOutline"></ion-icon>
              </div>
              <div><h3>Storage Policy</h3><p>Control what gets stored locally</p></div>
            </div>
            <div class="toggle-row" v-for="(label, key) in { alwaysStoreMyPosts: 'Always store my posts', storeUpvotedPosts: 'Store posts I upvoted', storeMyCommunities: 'Store my communities', cachePopularPosts: 'Cache popular posts (100+ upvotes)', autoDeleteOldContent: 'Auto-delete old cached content' }" :key="key">
              <div class="toggle-label">{{ label }}</div>
              <label class="toggle-switch">
                <input type="checkbox" v-model="policy[key]" @change="savePolicy" />
                <span class="toggle-track"></span>
              </label>
            </div>
            <div class="field-group mt-12">
              <label class="field-label">Keep recent posts</label>
              <div class="field-wrap">
                <select class="field-native" v-model="policy.keepRecentPostCount" @change="savePolicy">
                  <option :value="25">Last 25</option>
                  <option :value="50">Last 50</option>
                  <option :value="100">Last 100</option>
                  <option :value="250">Last 250</option>
                </select>
              </div>
            </div>
            <div class="field-group mt-8">
              <label class="field-label">Max storage (MB)</label>
              <div class="field-wrap">
                <select class="field-native" v-model="policy.maxStorageMB" @change="savePolicy">
                  <option :value="50">50 MB</option>
                  <option :value="100">100 MB</option>
                  <option :value="250">250 MB</option>
                  <option :value="500">500 MB</option>
                </select>
              </div>
            </div>
          </div>

          <!-- Export / Import / Clear -->
          <div class="settings-card">
            <div class="card-heading">
              <div class="card-heading-icon accent-green">
                <ion-icon :icon="downloadOutline"></ion-icon>
              </div>
              <div><h3>Backup &amp; Restore</h3><p>Export or import all local data</p></div>
            </div>
            <div class="button-row">
              <button class="pill-btn accent" @click="exportData">
                <ion-icon :icon="downloadOutline"></ion-icon>
                Export
              </button>
              <button class="pill-btn outline" @click="importData">
                <ion-icon :icon="cloudUploadOutline"></ion-icon>
                Import
              </button>
            </div>
            <button class="block-btn outline danger mt-12" @click="pruneOldContent">
              <ion-icon :icon="trashOutline"></ion-icon>
              Clean Up Old Content
            </button>
            <button class="block-btn outline danger mt-8" @click="confirmClearAll">
              <ion-icon :icon="warningOutline"></ion-icon>
              Clear All Data
            </button>
            <input ref="importFileInput" type="file" accept=".json" class="hidden" @change="handleImportFile" />
          </div>

          <!-- Build info -->
          <div class="settings-card">
            <div class="card-heading">
              <div class="card-heading-icon accent-blue">
                <ion-icon :icon="informationCircleOutline"></ion-icon>
              </div>
              <div><h3>About this Build</h3></div>
            </div>
            <div class="info-table">
              <div class="info-row">
                <span class="info-key">Build Hash</span>
                <code class="info-val mono-sm">{{ buildHash }}</code>
              </div>
              <div class="info-row">
                <span class="info-key">Built at</span>
                <span class="info-val">{{ formatBuildTime }}</span>
              </div>
            </div>
          </div>
        </div>

      </div>
      </DesktopPageShell>
    </ion-content>
  </ion-page>
</template>


<style scoped>
/* ── Global resets ──────────────────────────── */
ion-header::after { display: none !important; }
ion-toolbar { --border-width: 0 !important; }

/* Settings content area — show the gradient through ion-content */
ion-content {
  --background:
    radial-gradient(ellipse at 15% 0%,   rgba(139, 92, 246, 0.35) 0%, transparent 50%),
    radial-gradient(ellipse at 88% 8%,   rgba(236, 72, 153, 0.22) 0%, transparent 45%),
    radial-gradient(ellipse at 50% 100%, rgba(99, 102, 241, 0.24) 0%, transparent 55%),
    radial-gradient(ellipse at 0%  55%,  rgba(79,  70, 229, 0.15) 0%, transparent 40%),
    #0d0e1c;
}

/* Kill DesktopPageShell's opaque surface-card so our gradient shows through */
:deep(.surface-card),
:deep(.main-content),
:deep(.page-layout) {
  background: transparent !important;
  backdrop-filter: none !important;
  -webkit-backdrop-filter: none !important;
  box-shadow: none !important;
  border: none !important;
}

.back-btn {
  display: flex; align-items: center; justify-content: center;
  width: 36px; height: 36px; background: none; border: none;
  border-radius: 50%; color: var(--app-text-muted); cursor: pointer;
  margin-left: 4px; transition: color 160ms ease;
}
.back-btn:hover { color: var(--app-text); }
.back-btn svg { width: 22px; height: 22px; }

/* ── Settings tab bar ───────────────────────── */
.settings-tab-bar {
  display: flex;
  overflow-x: auto;
  scrollbar-width: none;
  gap: 4px;
  padding: 10px 14px;
  background: rgba(18, 12, 40, 0.55);
  border-bottom: 1px solid rgba(139, 92, 246, 0.12);
  justify-content: center;
}
@media (max-width: 700px) {
  .settings-tab-bar { justify-content: flex-start; }
}
.settings-tab-bar::-webkit-scrollbar { display: none; }

.settings-tab {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--app-text-muted);
  font-size: 12.5px;
  font-weight: 600;
  letter-spacing: 0.01em;
  white-space: nowrap;
  cursor: pointer;
  border-radius: 10px;
  transition: color 160ms ease, background 160ms ease, border-color 160ms ease;
  -webkit-tap-highlight-color: transparent;
}
.settings-tab ion-icon { font-size: 16px; flex-shrink: 0; }
.settings-tab:hover {
  color: var(--app-text);
  background: rgba(255,255,255,0.06);
}
.settings-tab.active {
  color: #e0e7ff;
  background: rgba(99,102,241,0.18);
  border-color: rgba(99,102,241,0.35);
}

/* ── Body ───────────────────────────────────── */
.settings-body {
  max-width: 920px;
  margin: 0 auto;
  padding: 20px 24px 60px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
/* ── Cards ──────────────────────────────────── */
.settings-card {
  border-radius: 18px;
  background: rgba(15, 12, 32, 0.55);
  border: 1px solid rgba(139, 92, 246, 0.15);
  padding: 18px 20px;
  position: relative;
  overflow: hidden;
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
}
.settings-card.danger-zone {
  border-color: rgba(239,68,68,0.18);
  background: rgba(30, 10, 20, 0.55);
}
.settings-card.decentralised-feature {
  border-color: rgba(99,102,241,0.30);
  background: linear-gradient(135deg, rgba(99,102,241,0.10), rgba(139,92,246,0.07));
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
}

/* Card heading */
.card-heading {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  margin-bottom: 16px;
}
.card-heading h3 {
  margin: 0 0 3px;
  font-size: 15px;
  font-weight: 700;
  letter-spacing: -0.02em;
  color: var(--app-text);
}
.card-heading p {
  margin: 0;
  font-size: 12.5px;
  color: var(--app-text-muted);
  line-height: 1.4;
}
.card-heading > div:not(.card-heading-icon) { flex: 1; min-width: 0; }

/* Icon bubble */
.card-heading-icon {
  width: 40px; height: 40px; border-radius: 12px;
  display: flex; align-items: center; justify-content: center;
  font-size: 20px; color: #fff; flex-shrink: 0;
}
.accent-violet { background: linear-gradient(135deg, #6366f1, #8b5cf6); box-shadow: 0 4px 12px rgba(99,102,241,0.3); }
.accent-blue   { background: linear-gradient(135deg, #3b82f6, #6366f1); box-shadow: 0 4px 12px rgba(59,130,246,0.3); }
.accent-teal   { background: linear-gradient(135deg, #14b8a6, #3b82f6); box-shadow: 0 4px 12px rgba(20,184,166,0.3); }
.accent-amber  { background: linear-gradient(135deg, #f59e0b, #ef4444); box-shadow: 0 4px 12px rgba(245,158,11,0.3); }
.accent-rose   { background: linear-gradient(135deg, #ec4899, #ef4444); box-shadow: 0 4px 12px rgba(236,72,153,0.3); }
.accent-green  { background: linear-gradient(135deg, #22c55e, #14b8a6); box-shadow: 0 4px 12px rgba(34,197,94,0.3); }

/* ── Info table ─────────────────────────────── */
.info-table { display: flex; flex-direction: column; gap: 10px; }
.info-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  background: rgba(255,255,255,0.04);
  border: 1px solid rgba(139,92,246,0.12);
  border-radius: 12px;
}
.info-key { font-size: 12.5px; color: var(--app-text-muted); font-weight: 600; }
.info-val { font-size: 12.5px; color: var(--app-text); }
.info-val.flex-end { display: flex; flex-direction: column; align-items: flex-end; gap: 6px; }
.mono-sm { font-family: monospace; font-size: 11.5px; word-break: break-all; }

/* ── Toggle rows ─────────────────────────────── */
.toggle-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 0;
  border-bottom: 1px solid rgba(255,255,255,0.05);
}
.toggle-row:last-child { border-bottom: none; }
.toggle-label { font-size: 14px; font-weight: 600; color: var(--app-text); }
.toggle-sub { font-size: 12px; color: var(--app-text-muted); margin-top: 2px; }

/* Toggle switch */
.toggle-switch { position: relative; width: 44px; height: 26px; flex-shrink: 0; }
.toggle-switch input { opacity: 0; width: 0; height: 0; }
.toggle-track {
  position: absolute; inset: 0; border-radius: 999px;
  background: rgba(255,255,255,0.12);
  border: 1px solid rgba(255,255,255,0.1);
  cursor: pointer;
  transition: background 200ms ease;
}
.toggle-switch input:checked + .toggle-track { background: #6366f1; border-color: #6366f1; }
.toggle-track::after {
  content: ''; position: absolute; top: 3px; left: 3px;
  width: 18px; height: 18px; border-radius: 50%;
  background: #fff; box-shadow: 0 1px 4px rgba(0,0,0,0.3);
  transition: transform 200ms ease;
}
.toggle-switch input:checked + .toggle-track::after { transform: translateX(18px); }

/* ── Field inputs ───────────────────────────── */
.field-group { display: flex; flex-direction: column; gap: 6px; }
.field-label {
  font-size: 10.5px; font-weight: 700; text-transform: uppercase;
  letter-spacing: 0.08em; color: var(--app-text-subtle);
}
.field-wrap {
  border-radius: 12px;
  background: rgba(255,255,255,0.05);
  border: 1px solid rgba(255,255,255,0.09);
  overflow: hidden;
  transition: border-color 180ms ease, box-shadow 180ms ease;
}
.field-wrap:focus-within {
  border-color: rgba(99,102,241,0.5);
  box-shadow: 0 0 0 3px rgba(99,102,241,0.1);
}
.field-native {
  width: 100%; background: transparent; border: none; outline: none;
  padding: 11px 14px; font-size: 14px; font-family: inherit;
  color: var(--ion-text-color); -webkit-appearance: none; appearance: none;
}
.field-native::placeholder { color: var(--app-text-subtle); }
select.field-native {
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='rgba(255,255,255,0.4)' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 14px center;
  padding-right: 36px;
  cursor: pointer;
}
select.field-native option { background: #1a1a2e; color: #fff; }

/* ── Buttons ────────────────────────────────── */
.block-btn {
  width: 100%; padding: 13px; border-radius: 14px; border: none;
  font-size: 14px; font-weight: 700; cursor: pointer;
  display: flex; align-items: center; justify-content: center; gap: 8px;
  transition: opacity 160ms ease, transform 160ms ease;
}
.block-btn.accent {
  background: linear-gradient(135deg, #6366f1, #8b5cf6);
  color: #fff; box-shadow: 0 6px 20px rgba(99,102,241,0.35);
}
.block-btn.outline {
  background: rgba(255,255,255,0.05);
  border: 1px solid rgba(255,255,255,0.1);
  color: var(--app-text-muted);
}
.block-btn.danger { color: #ef4444; border-color: rgba(239,68,68,0.25); }
.block-btn:hover:not(:disabled) { opacity: 0.88; transform: translateY(-1px); }
.block-btn:disabled { opacity: 0.4; cursor: not-allowed; }

.pill-btn {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 8px 16px; border-radius: 999px; border: none;
  font-size: 13px; font-weight: 700; cursor: pointer;
  transition: opacity 160ms ease, transform 160ms ease;
  white-space: nowrap;
}
.pill-btn.accent {
  background: linear-gradient(135deg, #6366f1, #8b5cf6);
  color: #fff; box-shadow: 0 4px 14px rgba(99,102,241,0.35);
}
.pill-btn.outline {
  background: rgba(255,255,255,0.05);
  border: 1px solid rgba(255,255,255,0.1);
  color: var(--app-text-muted);
}
.pill-btn:hover:not(:disabled) { opacity: 0.88; transform: translateY(-1px); }
.pill-btn:disabled { opacity: 0.35; cursor: not-allowed; }

.icon-btn {
  width: 32px; height: 32px; border-radius: 50%;
  border: none; background: rgba(255,255,255,0.06);
  color: var(--app-text-muted); cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  font-size: 16px; transition: background 160ms ease, color 160ms ease;
}
.icon-btn:hover { background: rgba(255,255,255,0.1); color: var(--app-text); }
.icon-btn.warning { color: #fbbf24; }
.icon-btn.danger { color: #ef4444; background: rgba(239,68,68,0.1); }

.button-row {
  display: flex; flex-wrap: wrap; gap: 8px;
}

.inline-add { display: flex; align-items: center; gap: 8px; }
.flex1 { flex: 1; }

/* ── Seg pills ──────────────────────────────── */
.seg-pills {
  display: flex; gap: 4px; padding: 4px;
  background: rgba(255,255,255,0.04);
  border: 1px solid rgba(255,255,255,0.07);
  border-radius: 999px;
  width: fit-content;
}
.seg-pill {
  padding: 6px 16px; border-radius: 999px; border: none;
  background: transparent; color: var(--app-text-muted);
  font-size: 13px; font-weight: 600; cursor: pointer;
  transition: background 160ms, color 160ms;
}
.seg-pill:hover { color: var(--app-text); }
.seg-pill.active {
  background: linear-gradient(135deg, #6366f1, #8b5cf6);
  color: #fff; box-shadow: 0 2px 10px rgba(99,102,241,0.35);
}

/* ── Keyword chips ──────────────────────────── */
.chip-list { display: flex; flex-wrap: wrap; gap: 6px; }
.kw-chip {
  padding: 4px 10px; border-radius: 999px; border: none;
  font-size: 12.5px; font-weight: 600; cursor: pointer;
  transition: opacity 160ms;
}
.kw-chip.include { background: rgba(52,211,153,0.12); color: #34d399; border: 1px solid rgba(52,211,153,0.25); }
.kw-chip.exclude { background: rgba(251,191,36,0.12); color: #fbbf24; border: 1px solid rgba(251,191,36,0.25); }
.kw-chip:hover { opacity: 0.7; }

/* ── Karma badge ────────────────────────────── */
.karma-badge {
  padding: 4px 12px; border-radius: 999px;
  background: linear-gradient(135deg, rgba(99,102,241,0.15), rgba(139,92,246,0.15));
  border: 1px solid rgba(99,102,241,0.25);
  color: #818cf8; font-weight: 700; font-size: 13px;
}

/* ── Key block ──────────────────────────────── */
.key-block { display: flex; flex-direction: column; gap: 12px; }
.key-row { display: flex; flex-direction: column; gap: 6px; }
.key-label { font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: var(--app-text-subtle); }
.key-value-row {
  display: flex; align-items: center; gap: 8px;
  padding: 10px 14px;
  background: rgba(255,255,255,0.03);
  border: 1px solid rgba(255,255,255,0.07);
  border-radius: 12px;
}
.key-val {
  flex: 1; font-family: monospace; font-size: 11px;
  word-break: break-all; color: var(--app-text);
}
.key-val.muted { color: var(--app-text-subtle); }
.key-val.danger { color: #ef4444; }

/* ── Alert boxes ────────────────────────────── */
.alert-box {
  display: flex; align-items: flex-start; gap: 10px;
  padding: 12px 14px; border-radius: 12px;
  font-size: 13px; line-height: 1.5;
}
.alert-box ion-icon { font-size: 16px; flex-shrink: 0; margin-top: 1px; }
.alert-box.info {
  background: rgba(99,102,241,0.08);
  border: 1px solid rgba(99,102,241,0.2);
  color: #a5b4fc;
}
.alert-box.warning {
  background: rgba(251,191,36,0.08);
  border: 1px solid rgba(251,191,36,0.2);
  color: #fbbf24;
}
.link { color: #818cf8; text-decoration: none; }
.link:hover { text-decoration: underline; }

/* ── Status pills / chips ───────────────────── */
.status-pill {
  padding: 4px 10px; border-radius: 999px;
  font-size: 10.5px; font-weight: 700;
  text-transform: uppercase; letter-spacing: 0.06em;
  align-self: flex-start; flex-shrink: 0;
}
.pill-ok { background: rgba(52,211,153,0.12); color: #34d399; border: 1px solid rgba(52,211,153,0.25); }
.pill-off { background: rgba(255,255,255,0.06); color: var(--app-text-muted); border: 1px solid rgba(255,255,255,0.09); }
.pill-warn { background: rgba(251,191,36,0.12); color: #fbbf24; border: 1px solid rgba(251,191,36,0.2); }

.count-badge {
  padding: 4px 10px; border-radius: 999px;
  background: rgba(99,102,241,0.12);
  border: 1px solid rgba(99,102,241,0.2);
  color: #818cf8; font-size: 12px; font-weight: 700;
  align-self: flex-start; flex-shrink: 0;
}

.status-chip {
  padding: 3px 8px; border-radius: 999px;
  font-size: 11px; font-weight: 700;
}
.chip-ok { background: rgba(52,211,153,0.12); color: #34d399; }
.chip-off { background: rgba(255,255,255,0.06); color: var(--app-text-muted); }

.status-row {
  display: flex; align-items: flex-start; gap: 8px;
  padding: 10px 12px; border-radius: 10px; font-size: 13px; line-height: 1.5;
}
.row-ok { background: rgba(52,211,153,0.08); color: #34d399; border: 1px solid rgba(52,211,153,0.2); }
.row-warn { background: rgba(251,191,36,0.08); color: #fbbf24; border: 1px solid rgba(251,191,36,0.2); }
.status-row ion-icon { font-size: 16px; flex-shrink: 0; margin-top: 1px; }
code { font-family: monospace; font-size: 11.5px; background: rgba(255,255,255,0.07); padding: 1px 5px; border-radius: 4px; }

/* ── Network banner ─────────────────────────── */
.p2p-banner {
  border-radius: 18px; padding: 18px 20px;
  border: 1px solid; display: flex;
  align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap;
}
.banner-ok {
  background: linear-gradient(135deg, rgba(52,211,153,0.08), rgba(20,184,166,0.06));
  border-color: rgba(52,211,153,0.2);
}
.banner-warn {
  background: linear-gradient(135deg, rgba(251,191,36,0.08), rgba(239,68,68,0.06));
  border-color: rgba(251,191,36,0.2);
}
.banner-left { display: flex; align-items: center; gap: 14px; }
.banner-dot {
  width: 14px; height: 14px; border-radius: 50%; flex-shrink: 0;
}
.dot-ok { background: #34d399; box-shadow: 0 0 8px rgba(52,211,153,0.6); animation: pulse 2s infinite; }
.dot-warn { background: #fbbf24; box-shadow: 0 0 8px rgba(251,191,36,0.6); }
.dot-off { background: rgba(255,255,255,0.2); }
@keyframes pulse {
  0%, 100% { box-shadow: 0 0 6px rgba(52,211,153,0.5); }
  50% { box-shadow: 0 0 14px rgba(52,211,153,0.85); }
}
.banner-title { font-size: 15px; font-weight: 700; letter-spacing: -0.02em; color: var(--app-text); }
.banner-sub { font-size: 12.5px; color: var(--app-text-muted); margin-top: 2px; }
.banner-metrics { display: flex; gap: 20px; }
.bmetric { text-align: center; }
.bmetric span { display: block; font-size: 20px; font-weight: 800; letter-spacing: -0.03em; color: var(--app-text); }
.bmetric small { font-size: 10.5px; color: var(--app-text-muted); text-transform: uppercase; letter-spacing: 0.06em; }
.bmetric.ok span { color: #34d399; }
.bmetric.danger span { color: #ef4444; }

/* ── Peer health list ───────────────────────── */
.peer-health-list { display: flex; flex-direction: column; gap: 8px; }
.peer-health-row {
  display: flex; align-items: center; justify-content: space-between; gap: 10px;
  padding: 12px 14px;
  background: rgba(255,255,255,0.03);
  border: 1px solid rgba(255,255,255,0.06);
  border-radius: 12px;
}
.peer-health-left { display: flex; align-items: center; gap: 10px; min-width: 0; flex: 1; }
.health-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.peer-name { font-size: 13.5px; font-weight: 600; color: var(--app-text); }
.peer-url { font-size: 11px; font-family: monospace; color: var(--app-text-subtle); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 260px; }
.peer-health-right { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
.latency-badge {
  font-size: 11px; font-family: monospace;
  background: rgba(255,255,255,0.06); color: var(--app-text-muted);
  padding: 2px 7px; border-radius: 6px;
}
.peer-joined-time { font-size: 11.5px; color: var(--app-text-subtle); }

.empty-peers {
  display: flex; flex-direction: column; align-items: center; gap: 8px;
  padding: 36px 16px; color: var(--app-text-muted);
}
.empty-peers ion-icon { font-size: 36px; opacity: 0.4; }
.empty-peers p { margin: 0; font-size: 14px; }

/* ── Decentralised feature card ─────────────── */
.decentral-badge {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 4px 10px; border-radius: 999px;
  background: linear-gradient(135deg, rgba(99,102,241,0.2), rgba(139,92,246,0.2));
  border: 1px solid rgba(99,102,241,0.3);
  color: #a5b4fc; font-size: 9.5px; font-weight: 800;
  letter-spacing: 0.1em; text-transform: uppercase;
  margin-bottom: 14px;
}
.decentral-badge ion-icon { font-size: 13px; }

.relay-options { display: flex; flex-direction: column; gap: 12px; }
.relay-option {
  padding: 16px;
  background: rgba(255,255,255,0.03);
  border: 1px solid rgba(255,255,255,0.07);
  border-radius: 14px;
}
.relay-option-header { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.relay-difficulty {
  padding: 3px 8px; border-radius: 999px;
  font-size: 9.5px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.06em;
}
.relay-difficulty.easy { background: rgba(52,211,153,0.12); color: #34d399; border: 1px solid rgba(52,211,153,0.25); }
.relay-difficulty.medium { background: rgba(251,191,36,0.12); color: #fbbf24; border: 1px solid rgba(251,191,36,0.25); }
.relay-difficulty.advanced { background: rgba(239,68,68,0.12); color: #f87171; border: 1px solid rgba(239,68,68,0.25); }
.relay-option-name { font-size: 14px; font-weight: 700; color: var(--app-text); }
.relay-option-desc { font-size: 13px; color: var(--app-text-muted); line-height: 1.55; margin: 0 0 12px; }
.code-block {
  font-family: monospace; font-size: 12px;
  background: rgba(0,0,0,0.4); border: 1px solid rgba(255,255,255,0.1);
  padding: 10px 14px; border-radius: 10px; color: #a5b4fc;
  word-break: break-all;
}

/* ── Range rows ─────────────────────────────── */
.range-row { padding: 6px 0; }
.range-header { display: flex; justify-content: space-between; margin-bottom: 4px; font-size: 13.5px; color: var(--app-text-muted); }
.range-val { font-weight: 700; color: var(--app-text); }

/* ── Community prefs ────────────────────────── */
.community-pref-list { display: flex; flex-direction: column; gap: 8px; }
.community-pref-row {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: 10px 14px;
  background: rgba(255,255,255,0.03);
  border: 1px solid rgba(255,255,255,0.06);
  border-radius: 12px;
}
.community-id-text { font-size: 11.5px; color: var(--app-text-subtle); margin-top: 2px; }
.pref-btns { display: flex; gap: 6px; }
.pref-btn {
  padding: 5px 10px; border-radius: 999px; border: 1px solid rgba(255,255,255,0.1);
  background: rgba(255,255,255,0.05); color: var(--app-text-muted);
  font-size: 12px; font-weight: 600; cursor: pointer;
  transition: all 160ms ease;
}
.pref-btn.active { background: rgba(99,102,241,0.15); color: #818cf8; border-color: rgba(99,102,241,0.3); }
.pref-btn.mute.active { background: rgba(255,255,255,0.08); color: var(--app-text); border-color: rgba(255,255,255,0.15); }

/* ── Storage ring ───────────────────────────── */
.storage-ring-row { display: flex; align-items: center; gap: 20px; }
.storage-ring { position: relative; width: 80px; height: 80px; flex-shrink: 0; }
.storage-ring svg { width: 80px; height: 80px; }
.ring-label {
  position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
  font-size: 14px; font-weight: 800; color: var(--app-text); letter-spacing: -0.02em;
}
.storage-stats { display: flex; flex-direction: column; gap: 8px; }
.storage-stat-row { display: flex; justify-content: space-between; gap: 20px; font-size: 13px; }
.storage-stat-row span { color: var(--app-text-muted); }
.storage-stat-row strong { color: var(--app-text); font-weight: 700; }

/* ── Helpers ────────────────────────────────── */
.helper-text { font-size: 12.5px; color: var(--app-text-muted); line-height: 1.5; }
.mt-8 { margin-top: 8px; }
.mt-12 { margin-top: 12px; }
.hidden { display: none; }

@media (max-width: 576px) {
  .settings-tab { padding: 7px 11px; font-size: 11.5px; gap: 5px; }
  .settings-tab ion-icon { font-size: 14px; }
  .banner-metrics { gap: 12px; }
  .bmetric span { font-size: 16px; }
}

</style>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import DesktopPageShell from '../components/DesktopPageShell.vue';
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
  IonText,
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
  addOutline,
  lockClosedOutline,
  shieldCheckmarkOutline
,
  rocketOutline,
  keyOutline,
  colorPaletteOutline,
  analyticsOutline,
  layersOutline,
  cloudOutline,
  constructOutline,
  fingerPrintOutline,
  addCircleOutline,
  removeCircleOutline,
  arrowDownOutline,
  optionsOutline,
  informationCircleOutline,
  chatbubbleOutline,
  personOutline} from 'ionicons/icons';
import { PinningService } from '../services/pinningService';
import { StorageManager } from '../services/storageManager';
import { UserService } from '../services/userService';
import { VoteTrackerService } from '../services/voteTrackerService';
import { WebSocketService, type KnownServer } from '../services/websocketService';
import { GunService } from '../services/gunService';
import { StorageService } from '../services/storageService';
import { KeyService } from '../services/keyService';
import { RelayManager } from '../services/relayManager';
import { RelayHealthService } from '../services/relayHealthService';
import { WebRTCService } from '../services/webrtcService';
import { MeshService } from '../services/meshService';
import { BootstrapInviteService, type BootstrapEndpoint } from '../services/bootstrapInviteService';
import { useChainStore } from '../stores/chainStore';
import { useCommunityStore } from '../stores/communityStore';
import config from '../config';
import { ModerationService, moderationVersion, MODERATION_API_DEFAULT_BASE_URL, type ModerationSettings, type WordCategory } from '../services/moderationService';
import { getEnabledVersions, setEnabledVersions, probeForVersions, availableVersions, type DataVersion } from '../utils/dataVersionSettings';
import { GUN_NAMESPACE } from '../services/gunService';
import { useFeedPreferences } from '../composables/useFeedPreferences';
import type { FeedMode, FeedRankingWeights } from '../services/feedPreferencesService';
import { BUILD_HASH, BUILD_TIME } from '../utils/buildHash';
import UserIdentityBadge from '../components/UserIdentityBadge.vue';
import { GUN_RELAY_PRESETS, isValidGunUrl, labelForGunUrl, DEFAULT_GUN_PEERS } from '../services/gunRelayPresets';

const chainStore = useChainStore();
const communityStore = useCommunityStore();
const router = useRouter();
const importFileInput = ref<HTMLInputElement | null>(null);
const activeTab = ref('general');

const tabs = [
  { id: 'general',    label: 'General',    icon: personCircleOutline },
  { id: 'network',    label: 'Network',    icon: globeOutline },
  { id: 'data',       label: 'Data',       icon: serverOutline },
  { id: 'feed',       label: 'Feed',       icon: rocketOutline },
  { id: 'moderation', label: 'Moderation', icon: shieldCheckmarkOutline },
  { id: 'advanced',   label: 'Advanced',   icon: keyOutline },
];

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
const userProfile = ref<any>(null);
const deviceId = ref('');
const buildHash = BUILD_HASH;
const formatBuildTime = computed(() => {
  if (BUILD_TIME === 'unknown' || BUILD_TIME === 'development') return BUILD_TIME;
  try {
    const date = new Date(BUILD_TIME);
    return date.toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch {
    return BUILD_TIME;
  }
});

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
const moderationApiKeyInput = ref('');
const moderationAuthMessage = ref('Not authenticated.');
const moderationDefaultApiUrl = MODERATION_API_DEFAULT_BASE_URL;

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
  if (modSettings.value.moderationProvider === 'interpoll') {
    modSettings.value.moderationApiBaseUrl = moderationDefaultApiUrl;
  }
  ModerationService.saveSettings({ ...modSettings.value });
  moderationAuthMessage.value = modSettings.value.moderationApiKey.trim()
    ? 'Authenticated key is stored.'
    : 'Not authenticated.';
}

function onModerationProviderChange() {
  if (modSettings.value.moderationProvider === 'interpoll') {
    modSettings.value.moderationApiBaseUrl = moderationDefaultApiUrl;
  }
  saveModerationSettings();
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
  moderationApiKeyInput.value = '';
  moderationAuthMessage.value = 'Not authenticated.';
  const toast = await toastController.create({
    message: 'Moderation settings reset to defaults',
    duration: 1500,
    color: 'success'
  });
  await toast.present();
}

async function authenticateModerationApi() {
  const result = await ModerationService.authenticateModerationApiKey(moderationApiKeyInput.value);
  moderationAuthMessage.value = result.message;
  if (result.ok) {
    modSettings.value = ModerationService.getSettings();
    moderationApiKeyInput.value = '';
  }
  const toast = await toastController.create({
    message: result.message,
    duration: 2000,
    color: result.ok ? 'success' : 'warning',
  });
  await toast.present();
}

async function clearModerationApiAuth() {
  ModerationService.clearModerationApiKey();
  modSettings.value = ModerationService.getSettings();
  moderationApiKeyInput.value = '';
  moderationAuthMessage.value = 'Not authenticated.';
  const toast = await toastController.create({
    message: 'Moderation API authentication cleared',
    duration: 1800,
    color: 'success',
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
  connectedWsUrl: '',
  gunConnected: false,
  peerCount: 0,
  registrationRejected: false,
  gunPeerCount: 0,
  gunConnectedCount: 0,
  gunAvgLatencyMs: undefined as number | undefined,
  blockHeight: 0,
  chainValid: true
});

const connectionStatusClass = computed(() => {
  if (networkStatus.value.wsConnected && networkStatus.value.gunConnected) return 'connected';
  if (networkStatus.value.wsConnected || networkStatus.value.gunConnected) return 'partial';
  return '';
});

const connectionStatusLabel = computed(() => {
  if (networkStatus.value.wsConnected && networkStatus.value.gunConnected) {
    const gunPeers = networkStatus.value.gunConnectedCount || networkStatus.value.gunPeerCount;
    const latency = networkStatus.value.gunAvgLatencyMs;
    const latencyStr = latency ? ` · ${latency}ms` : '';
    return `Connected · ${gunPeers} DB peer${gunPeers !== 1 ? 's' : ''}${latencyStr}`;
  }
  if (networkStatus.value.wsConnected) return 'WS Only';
  if (networkStatus.value.gunConnected) {
    const gunPeers = networkStatus.value.gunConnectedCount || networkStatus.value.gunPeerCount;
    return `DB Only · ${gunPeers} peer${gunPeers !== 1 ? 's' : ''}`;
  }
  return 'Disconnected';
});

const peerList = ref<Array<{ peerId: string; relayUrl: string; gunPeers: string[]; joinedAt: number }>>([]);
const myPeerId = ref('');
const knownServers = ref<KnownServer[]>([]);
const bootstrapInviteInput = ref('');
const generatedBootstrapInvite = ref('');
const bootstrapImporting = ref(false);
const bootstrapDiscovering = ref(false);

// Gun multi-relay peers management
const gunPeersList = ref<string[]>(config.getGunPeers());
const gunPeersDetail = ref<Array<{ url: string; connected: boolean; latencyMs?: number }>>([]);
const newGunPeerUrl = ref('');
const selectedGunPreset = ref('');
const gunStartupProbeRunning = ref(false);

function refreshGunPeers() {
  gunPeersList.value = config.getGunPeers();
  gunPeersDetail.value = GunService.getDetailedPeerStats();
  gunStartupProbeRunning.value = GunService.presetProbeRunning;
}

async function addGunPeer(url: string) {
  const trimmed = url.trim();
  if (!isValidGunUrl(trimmed)) {
    const toast = await toastController.create({ message: 'Invalid Gun relay URL', duration: 2000, color: 'warning' });
    await toast.present();
    return;
  }
  const current = config.getGunPeers();
  if (current.includes(trimmed)) {
    const toast = await toastController.create({ message: 'Relay already in list', duration: 1800, color: 'medium' });
    await toast.present();
    return;
  }
  const updated = [...current, trimmed];
  config.setGunPeers(updated);
  GunService.addPeerDynamic(trimmed);
  refreshGunPeers();
  const toast = await toastController.create({ message: `Added ${labelForGunUrl(trimmed)}`, duration: 2000, color: 'success' });
  await toast.present();
}

async function removeGunPeer(url: string) {
  const current = config.getGunPeers();
  if (current.length <= 1) {
    const toast = await toastController.create({ message: 'Cannot remove last Gun relay', duration: 2000, color: 'warning' });
    await toast.present();
    return;
  }
  const updated = current.filter(u => u !== url);
  config.setGunPeers(updated);
  GunService.reconnect(updated);
  refreshGunPeers();
  const toast = await toastController.create({ message: 'Relay removed', duration: 1600, color: 'medium' });
  await toast.present();
}

async function addGunPeerFromInput() {
  await addGunPeer(newGunPeerUrl.value);
  newGunPeerUrl.value = '';
}

async function addGunPeerFromPreset() {
  if (!selectedGunPreset.value) return;
  await addGunPeer(selectedGunPreset.value);
  selectedGunPreset.value = '';
}

async function resetGunPeersToDefaults() {
  config.resetGunPeers();
  GunService.reconnect(DEFAULT_GUN_PEERS);
  refreshGunPeers();
  const toast = await toastController.create({ message: 'Gun peers reset to defaults', duration: 2000, color: 'success' });
  await toast.present();
}

const availableGunPresets = computed(() =>
  GUN_RELAY_PRESETS.filter(p => !gunPeersList.value.includes(p.url))
);

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

// ── Anonymity (Tor) Mode ─────────────────────────────────────
const anonymityMode = ref(config.anonymityMode);
const torChecking = ref(false);
const torStatus = ref<{ checked: boolean; isTor: boolean | null; note: string }>({
  checked: false,
  isTor: null,
  note: '',
});

/** Match `.onion` hosts (end-of-host boundary avoids matching e.g. "onion.example.com"). */
function isOnionUrl(url: string): boolean {
  return /\.onion(?::\d+)?(?:\/|$)/i.test(url || '');
}

const activeRelayIsOnion = computed(() =>
  isOnionUrl(config.relay.websocket) &&
  isOnionUrl(config.relay.gun) &&
  isOnionUrl(config.relay.api),
);

/** Switch the active relay to a .onion endpoint if one exists. Returns true if switched. */
async function preferOnionRelay(): Promise<boolean> {
  try {
    const onion = RelayManager.getRelayList().find(
      (r) => r.isTor || isOnionUrl(r.ws) || isOnionUrl(r.gun) || isOnionUrl(r.api),
    );
    const active = RelayManager.getActiveRelay();
    if (onion && onion.id !== active?.id) {
      await RelayManager.switchToRelay(onion.id);
      return true;
    }
  } catch (e) {
    console.warn('[Settings] preferOnionRelay failed', e);
  }
  return false;
}

async function onAnonymityToggle() {
  const on = anonymityMode.value;
  config.setAnonymityMode(on);

  if (on) {
    // Kill the IP-leaking peer mesh immediately (tears down live connections).
    WebRTCService.setEnabled(false);
    const switched = await preferOnionRelay();
    const toast = await toastController.create({
      message: switched
        ? 'Anonymity Mode on — mesh disabled, switched to a .onion relay.'
        : 'Anonymity Mode on — peer mesh disabled. Use Tor Browser and add a .onion relay for full anonymity.',
      duration: 3500,
      color: 'success',
    });
    await toast.present();
  } else {
    // Restore the peer mesh (default-on) so P2P sync resumes.
    WebRTCService.setEnabled(true);
    MeshService.initialize();
    torStatus.value = { checked: false, isTor: null, note: '' };
    const toast = await toastController.create({
      message: 'Anonymity Mode off — peer mesh re-enabled.',
      duration: 2500,
      color: 'medium',
    });
    await toast.present();
  }
}

/**
 * Best-effort, on-demand Tor reachability check. Uses the canonical Tor Project
 * endpoint. Reads the result only if CORS allows; otherwise reports "unknown"
 * rather than overclaiming. Never runs automatically (no silent egress).
 */
async function checkTorStatus() {
  torChecking.value = true;
  torStatus.value = { checked: false, isTor: null, note: '' };
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const res = await fetch('https://check.torproject.org/api/ip', {
      signal: controller.signal,
      cache: 'no-store',
    });
    clearTimeout(timer);
    const data = await res.json();
    const isTor = data?.IsTor === true;
    torStatus.value = {
      checked: true,
      isTor,
      note: isTor
        ? 'Confirmed: this browser is reaching the network over Tor.'
        : 'This browser is NOT on Tor. Open InterPoll in Tor Browser to be anonymous.',
    };
  } catch {
    // CORS-blocked or offline — cannot read the result. Do not overclaim.
    torStatus.value = {
      checked: true,
      isTor: null,
      note: 'Could not verify automatically. Make sure you opened InterPoll in Tor Browser.',
    };
  } finally {
    torChecking.value = false;
  }
}

let statusCleanup: (() => void) | null = null;
let networkPollInterval: ReturnType<typeof setInterval> | null = null;

const storagePercent = computed(() => {
  if (storageStats.value.quota === 0) return 0;
  return (storageStats.value.used / storageStats.value.quota) * 100;
});

const fullDeviceId = computed(() => {
  return deviceId.value || '';
});

function isConfiguredServer(wsUrl: string): boolean {
  return config.relay.websocket === wsUrl;
}

function isCurrentlyConnectedServer(wsUrl: string): boolean {
  return networkStatus.value.wsConnected && networkStatus.value.connectedWsUrl === wsUrl;
}

function shortenUrl(url: string): string {
  try {
    const u = new URL(url);
    return u.host;
  } catch {
    return url;
  }
}

function escapeHtml(value: string): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function endpointToKnownServer(
  endpoint: BootstrapEndpoint,
  options: { addedBy: string; source: KnownServer['source']; signatureValid: boolean },
): KnownServer {
  return {
    websocket: endpoint.websocket,
    gun: endpoint.gun,
    api: endpoint.api,
    firstSeen: Date.now(),
    addedBy: options.addedBy,
    source: options.source,
    signatureValid: options.signatureValid,
    lastVerifiedAt: Date.now(),
  };
}

function seedRelayList(endpoint: BootstrapEndpoint): void {
  const existing = RelayManager.getRelayList().find(
    (relay) =>
      relay.ws === endpoint.websocket &&
      relay.gun === endpoint.gun &&
      relay.api === endpoint.api,
  );
  if (existing) return;

  RelayManager.addRelay({
    label: endpoint.label?.trim() || shortenUrl(endpoint.websocket),
    ws: endpoint.websocket,
    gun: endpoint.gun,
    api: endpoint.api,
    isTor: endpoint.isTor ?? endpoint.websocket.includes('.onion'),
    priority: endpoint.priority ?? 20,
  });
}

function uniqueBootstrapEndpoints(endpoints: Array<BootstrapEndpoint | undefined>): BootstrapEndpoint[] {
  const deduped = new Map<string, BootstrapEndpoint>();
  for (const endpoint of endpoints) {
    if (!endpoint) continue;
    const key = `${endpoint.websocket}|${endpoint.gun}|${endpoint.api}`;
    if (!deduped.has(key)) deduped.set(key, endpoint);
  }
  return Array.from(deduped.values());
}

function estimateLocalPostCount(): number {
  try {
    const raw = localStorage.getItem('seen-post-ids');
    if (!raw) return 0;
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.length : 0;
  } catch {
    return 0;
  }
}

async function probeCandidate(endpoint: BootstrapEndpoint) {
  const [ws, gun, api] = await Promise.all([
    RelayHealthService.probeWebSocket(endpoint.websocket),
    RelayHealthService.probeGun(endpoint.gun),
    RelayHealthService.probeApi(endpoint.api),
  ]);
  const okCount = [ws.reachable, gun.reachable, api.reachable].filter(Boolean).length;
  const overall = okCount === 3 ? 'online' : okCount === 0 ? 'offline' : 'degraded';
  return { ws, gun, api, overall };
}

async function generateBootstrapInvite() {
  const endpoint: BootstrapEndpoint = {
    websocket: editRelay.value.websocket.trim(),
    gun: editRelay.value.gun.trim(),
    api: editRelay.value.api.trim(),
    label: shortenUrl(editRelay.value.websocket),
  };

  const validation = BootstrapInviteService.validateEndpoint(endpoint);
  if (!validation.valid) {
    const toast = await toastController.create({
      message: validation.errors[0],
      duration: 2200,
      color: 'warning',
    });
    await toast.present();
    return;
  }

  const postCount = estimateLocalPostCount();
  const pollCount = await StorageService.getAllPolls()
    .then((polls: Array<unknown>) => polls.length)
    .catch(() => 0);
  const connectedServer: BootstrapEndpoint = {
    websocket: networkStatus.value.connectedWsUrl || endpoint.websocket,
    gun: config.relay.gun,
    api: config.relay.api,
    label: shortenUrl(networkStatus.value.connectedWsUrl || endpoint.websocket),
  };

  generatedBootstrapInvite.value = BootstrapInviteService.createInvite(endpoint, {
    createdBy: myPeerId.value || 'local-node',
    note: 'InterPoll relay bootstrap',
    handoff: {
      sourcePeerId: myPeerId.value || WebSocketService.getPeerId(),
      connectedServer,
      status: {
        wsConnected: networkStatus.value.wsConnected,
        gunConnected: networkStatus.value.gunConnected,
        peerCount: networkStatus.value.peerCount,
        blockHeight: networkStatus.value.blockHeight,
        postCount,
        pollCount,
        generatedAt: Date.now(),
      },
    },
  });
}

async function copyGeneratedBootstrapInvite() {
  if (!generatedBootstrapInvite.value) return;
  try {
    await navigator.clipboard.writeText(generatedBootstrapInvite.value);
    const toast = await toastController.create({
      message: 'Bootstrap invite copied',
      duration: 1600,
      color: 'success',
    });
    await toast.present();
  } catch {
    const toast = await toastController.create({
      message: 'Clipboard unavailable',
      duration: 2000,
      color: 'warning',
    });
    await toast.present();
  }
}

async function seedCandidate(
  endpoint: BootstrapEndpoint,
  options: { addedBy: string; source: KnownServer['source']; signatureValid: boolean; refresh?: boolean },
) {
  WebSocketService.addKnownServer(endpointToKnownServer(endpoint, options));
  seedRelayList(endpoint);
  if (options.refresh !== false) refreshNetwork();
}

async function importBootstrapInvite() {
  bootstrapImporting.value = true;
  try {
    const artifact = BootstrapInviteService.parseInvite(bootstrapInviteInput.value);
    const candidateEndpoints = uniqueBootstrapEndpoints([
      artifact.handoff?.connectedServer,
      artifact.endpoint,
    ]);
    if (candidateEndpoints.length === 0) {
      throw new Error('Bootstrap invite does not contain any valid endpoint');
    }

    const validatedCandidates = candidateEndpoints.map((endpoint) => ({
      endpoint,
      validation: BootstrapInviteService.validateEndpoint(endpoint),
    }));
    const validCandidateEndpoints = validatedCandidates
      .filter((entry) => entry.validation.valid)
      .map((entry) => entry.endpoint);
    if (validCandidateEndpoints.length === 0) {
      const firstInvalidReason = validatedCandidates.find((entry) => !entry.validation.valid)?.validation.errors[0];
      throw new Error(firstInvalidReason || 'Bootstrap invite endpoints are invalid');
    }
    const candidateProbeResults = await Promise.all(
      validCandidateEndpoints.map(async (endpoint) => ({
        endpoint,
        probe: await probeCandidate(endpoint),
      })),
    );
    const selectedProbeResult = candidateProbeResults.find((result) => result.probe.overall === 'online')
      ?? candidateProbeResults.find((result) => result.probe.overall === 'degraded')
      ?? candidateProbeResults[0];
    const primaryEndpoint = selectedProbeResult.endpoint;
    const probe = selectedProbeResult.probe;
    const switchDisabled = probe.overall === 'offline';
    const hasSignatureMetadata = Boolean(artifact.signature?.alg && artifact.signature?.sig);
    const signatureLabel = hasSignatureMetadata ? 'present' : 'none';
    const sourcePeerLabel = escapeHtml(artifact.handoff?.sourcePeerId || artifact.meta?.createdBy || 'unknown');
    const status = artifact.handoff?.status;
    const connectedServerLabel = escapeHtml(artifact.handoff?.connectedServer?.websocket || artifact.endpoint.websocket);
    const message = [
      `Probe: ${probe.overall}`,
      `WS: ${probe.ws.reachable ? 'ok' : 'fail'} · Gun: ${probe.gun.reachable ? 'ok' : 'fail'} · API: ${probe.api.reachable ? 'ok' : 'fail'}`,
      `Signature metadata: ${signatureLabel}`,
      `From peer: ${sourcePeerLabel}`,
      `Connected server: ${connectedServerLabel}`,
      ...(status
        ? [`Shared status: posts ${status.postCount} · polls ${status.pollCount} · chain ${status.blockHeight} · peers ${status.peerCount}`]
        : []),
      'Choose how to proceed:',
    ].join('\n');

    const alert = await alertController.create({
      header: 'Bootstrap invite imported',
      message,
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Seed only',
          handler: async () => {
            try {
              for (const endpoint of validCandidateEndpoints) {
                await seedCandidate(endpoint, {
                  addedBy: 'bootstrap-invite',
                  source: 'local',
                  signatureValid: false,
                  refresh: false,
                });
              }
              refreshNetwork();
              const toast = await toastController.create({
                message: `Seeded ${validCandidateEndpoints.length} endpoint(s) from invite`,
                duration: 2000,
                color: 'success',
              });
              await toast.present();
              return true;
            } catch (e) {
              const toast = await toastController.create({
                message: e instanceof Error ? e.message : 'Seeding failed',
                duration: 2200,
                color: 'danger',
              });
              await toast.present();
              return false;
            }
          },
        },
        ...(!switchDisabled
          ? [{
              text: 'Seed + Switch',
              handler: async () => {
                try {
                  for (const endpoint of validCandidateEndpoints) {
                    await seedCandidate(endpoint, {
                      addedBy: 'bootstrap-invite',
                      source: 'local',
                      signatureValid: false,
                      refresh: false,
                    });
                  }
                  await applyRelayCandidate(primaryEndpoint, false);
                } catch (e) {
                  const toast = await toastController.create({
                    message: e instanceof Error ? e.message : 'Switch failed',
                    duration: 2200,
                    color: 'danger',
                  });
                  await toast.present();
                  return false;
                }
                return true;
              },
            }]
          : []),
      ],
    });
    await alert.present();
    await alert.onDidDismiss();
  } catch (error) {
    const toast = await toastController.create({
      message: error instanceof Error ? error.message : 'Invite import failed',
      duration: 2500,
      color: 'danger',
    });
    await toast.present();
  } finally {
    bootstrapImporting.value = false;
  }
}

async function discoverBootstrapFromGun() {
  bootstrapDiscovering.value = true;
  try {
    const discovered = await BootstrapInviteService.discoverFromGun();
    if (discovered.length === 0) {
      const toast = await toastController.create({
        message: 'No Gun bootstrap endpoints discovered',
        duration: 2200,
      });
      await toast.present();
      return;
    }

    for (const endpoint of discovered) {
      await seedCandidate(endpoint, {
        addedBy: 'gun-discovery',
        source: 'gun',
        signatureValid: false,
        refresh: false,
      });
    }
    refreshNetwork();
    const toast = await toastController.create({
      message: `Discovered and seeded ${discovered.length} endpoint(s) from Gun`,
      duration: 2400,
      color: 'success',
    });
    await toast.present();
  } catch (error) {
    const toast = await toastController.create({
      message: error instanceof Error ? error.message : 'Gun discovery failed',
      duration: 2200,
      color: 'danger',
    });
    await toast.present();
  } finally {
    bootstrapDiscovering.value = false;
  }
}

async function applyRelayCandidate(endpoint: BootstrapEndpoint, requireProbe = true) {
  const validation = BootstrapInviteService.validateEndpoint(endpoint);
  if (!validation.valid) {
    const toast = await toastController.create({
      message: validation.errors[0],
      duration: 2200,
      color: 'warning',
    });
    await toast.present();
    return false;
  }

  if (requireProbe) {
    const probe = await probeCandidate(endpoint);
    const proceed = probe.overall !== 'offline';
    if (!proceed) {
      const toast = await toastController.create({
        message: 'Candidate endpoints are offline. Switch aborted.',
        duration: 2400,
        color: 'danger',
      });
      await toast.present();
      return false;
    }
  }

  config.setRelayOverrides({
    websocket: endpoint.websocket,
    gun: endpoint.gun,
    api: endpoint.api,
  });

  editRelay.value = {
    websocket: endpoint.websocket,
    gun: endpoint.gun,
    api: endpoint.api,
  };

  WebSocketService.reconnect(endpoint.websocket);
  GunService.reconnect(endpoint.gun);
  refreshNetwork();
  return true;
}

function refreshNetwork() {
  const wsConnected = WebSocketService.getConnectionStatus();
  const connectedWsUrl = WebSocketService.getConnectedUrl() || '';
  const gunStats = GunService.getPeerStats();
  const peerAddresses = WebSocketService.getPeerAddresses();

  networkStatus.value = {
    wsConnected,
    connectedWsUrl,
    gunConnected: gunStats.isConnected,
    peerCount: WebSocketService.getPeerCount(),
    registrationRejected: WebSocketService.isRegistrationRejected(),
    gunPeerCount: gunStats.peerCount,
    gunConnectedCount: gunStats.connectedCount,
    gunAvgLatencyMs: gunStats.avgLatencyMs,
    blockHeight: chainStore.blocks.length,
    chainValid: chainStore.chainValid
  };

  peerList.value = Array.from(peerAddresses.values());
  myPeerId.value = WebSocketService.getPeerId();
  knownServers.value = WebSocketService.getKnownServers();
  refreshGunPeers();
}

async function applyRelayConfig() {
  const endpoint: BootstrapEndpoint = {
    websocket: editRelay.value.websocket.trim(),
    gun: editRelay.value.gun.trim(),
    api: editRelay.value.api.trim(),
    label: shortenUrl(editRelay.value.websocket),
  };

  if (!endpoint.websocket || !endpoint.gun || !endpoint.api) {
    const toast = await toastController.create({
      message: 'All relay fields are required',
      duration: 2000,
      color: 'warning',
    });
    await toast.present();
    return;
  }

  const applied = await applyRelayCandidate(endpoint, true);
  if (!applied) return;

  await seedCandidate(endpoint, {
    addedBy: 'manual-config',
    source: 'local',
    signatureValid: false,
    refresh: false,
  });
  const toast = await toastController.create({
    message: 'Relay configuration updated, reconnecting...',
    duration: 2000,
    color: 'success',
  });
  await toast.present();

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

  refreshNetwork();
}

async function probeAndSwitchToServer(server: KnownServer) {
  const endpoint: BootstrapEndpoint = {
    websocket: server.websocket,
    gun: server.gun,
    api: server.api,
    label: shortenUrl(server.websocket),
  };
  let probe: Awaited<ReturnType<typeof probeCandidate>>;
  try {
    probe = await probeCandidate(endpoint);
  } catch (error) {
    const toast = await toastController.create({
      message: error instanceof Error ? error.message : 'Probe failed',
      duration: 2200,
      color: 'danger',
    });
    await toast.present();
    return;
  }

  if (probe.overall === 'offline') {
    const toast = await toastController.create({
      message: 'Candidate endpoints are offline. Switch blocked.',
      duration: 2400,
      color: 'danger',
    });
    await toast.present();
    return;
  }

  const alert = await alertController.create({
    header: `Switch to ${escapeHtml(shortenUrl(server.websocket))}?`,
    message: [
      `Probe: ${probe.overall}`,
      `WS: ${probe.ws.reachable ? 'ok' : 'fail'} · Gun: ${probe.gun.reachable ? 'ok' : 'fail'} · API: ${probe.api.reachable ? 'ok' : 'fail'}`,
      'You must confirm before switching.',
    ].join('\n'),
    buttons: [
      { text: 'Cancel', role: 'cancel' },
      {
        text: 'Switch',
        handler: async () => {
          try {
            const applied = await applyRelayCandidate(endpoint, false);
            if (!applied) return false;
            const toast = await toastController.create({
              message: `Switching to ${shortenUrl(server.websocket)}...`,
              duration: 2000,
              color: 'success',
            });
            await toast.present();
          } catch (e) {
            const toast = await toastController.create({
              message: e instanceof Error ? e.message : 'Switch failed',
              duration: 2200,
              color: 'danger',
            });
            await toast.present();
            return false;
          }
          return true;
        },
      },
    ],
  });
  await alert.present();
}

function formatPeerTime(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

function formatServerTtl(server: KnownServer): string {
  if (typeof server.expiresAt !== 'number') return 'TTL n/a';
  const expiresAt = server.expiresAt;
  const msLeft = expiresAt - Date.now();
  if (msLeft <= 0) return 'expired';
  const minutesLeft = Math.ceil(msLeft / 60_000);
  return `TTL ${minutesLeft}m`;
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

onIonViewWillEnter(async () => {
  userProfile.value = await UserService.getCurrentUser(true);
});

onMounted(async () => {
  await refreshStorageStats();
  await loadPolicy();
  userProfile.value = await UserService.getCurrentUser(true);
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
    document.documentElement.classList.add('dark');
    document.body.classList.add('dark');
  }

  // Load moderation settings (may have migrated legacy minUserKarma)
  modSettings.value = ModerationService.getSettings();
  moderationAuthMessage.value = modSettings.value.moderationApiKey.trim()
    ? 'Authenticated key is stored.'
    : 'Not authenticated.';

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
  } finally {
    target.value = '';
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

          window.location.href = '/home';
        }
      }
    ]
  });

  await alert.present();
};
</script>