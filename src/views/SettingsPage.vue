<template>
  <ion-page class="settings-page">
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start">
          <button class="back-btn" @click="router.back()">
            <svg viewBox="0 0 24 24" fill="none"><path d="M15 18l-6-6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
        </ion-buttons>
        <ion-title>{{ $ui("Settings") }}</ion-title>
      </ion-toolbar>


      <!-- Custom tab bar — replaces ion-segment -->
      <div class="settings-tab-bar">
        <button v-for="tab in tabs" :key="tab.id"
          class="settings-tab" :class="{ active: activeTab === tab.id }"
          @click="activeTab = tab.id">
          <ion-icon :icon="tab.icon"></ion-icon>
          <span>{{ $ui(tab.label) }}</span>
        </button>
      </div>
    </ion-header>

    <ion-content>
      <DesktopPageShell>
      <div class="settings-body">

        <!-- ══════════════════════ GENERAL TAB ══════════════════════ -->
        <div v-if="activeTab === 'general'">
          <div class="settings-card"><LanguagePicker /></div>

          <!-- Account card -->
          <div class="settings-card">
            <div class="card-heading">
              <div class="card-heading-icon accent-violet">
                <ion-icon :icon="personCircleOutline"></ion-icon>
              </div>
              <div>
                <h3>{{ $ui("Account") }}</h3>
                <p>{{ $ui("Your identity on Echo") }}</p>
              </div>
            </div>
            <div class="info-table">
              <div class="info-row">
                <span class="info-key">{{ $ui("Device ID") }}</span>
                <code class="info-val mono-sm">{{ fullDeviceId }}</code>
              </div>
              <div class="info-row">
                <span class="info-key">{{ $ui("Username") }}</span>
                <div class="info-val flex-end">
                  <UserIdentityBadge v-if="userProfile"
                    :username="userProfile.customUsername || userProfile.username"
                    :pubkey="publicKeyHex" />
                  <button class="pill-btn accent" @click="$router.push('/claim-username')">
                    {{ userProfile?.customUsername ? $ui("Change") : $ui("Set username") }}
                  </button>
                </div>
              </div>
              <div class="info-row">
                <span class="info-key">{{ $ui("Karma") }}</span>
                <span class="karma-badge">{{ userProfile?.karma || 0 }}</span>
              </div>
            </div>
            <button class="block-btn outline mt-12" @click="showRestore = !showRestore">
              {{ showRestore ? $ui("Cancel restore") : $ui("Restore identity from recovery phrase") }}
            </button>
            <div v-if="showRestore" class="mt-12"><DeviceVaultPanel mode="restore" @restored="onIdentityRestored" /><RestoreKeyForm @restored="onIdentityRestored" /></div>
            <button class="block-btn outline mt-12" @click="replayBitTour"> {{ $ui("Replay Bit's tour") }} </button>
            <button class="block-btn outline mt-12" @click="$router.push('/profile')">
              <ion-icon :icon="personCircleOutline"></ion-icon> {{ $ui("Edit Profile") }} </button>
          </div>

          <!-- Name recovery (IPP-10) -->
          <div class="settings-card">
            <NameRecoveryCard />
          </div>

          <!-- Cryptographic identity -->
          <div class="settings-card danger-zone">
            <div class="card-heading">
              <div class="card-heading-icon accent-amber">
                <ion-icon :icon="keyOutline"></ion-icon>
              </div>
              <div>
                <h3>{{ $ui("Cryptographic Identity") }}</h3>
                <p>{{ $ui("Schnorr / secp256k1 keypair for signing events") }}</p>
              </div>
            </div>
            <div class="key-block">
              <div class="key-row">
                <span class="key-label">{{ $ui("Public Key") }}</span>
                <div class="key-value-row">
                  <code class="key-val">{{ publicKeyHex }}</code>
                  <button class="icon-btn" @click="copyPublicKey" :title="$ui('Copy')"><ion-icon :icon="copyOutline"></ion-icon></button>
                </div>
              </div>
              <div class="key-row">
                <span class="key-label">{{ $ui("Private Key") }}</span>
                <div v-if="!showPrivateKey" class="key-value-row">
                  <code class="key-val muted">•••• hidden ••••</code>
                  <button class="icon-btn warning" @click="revealPrivateKey" :title="$ui('Reveal')"><ion-icon :icon="eyeOutline"></ion-icon></button>
                </div>
                <div v-else class="key-value-row">
                  <code class="key-val danger">{{ privateKeyHex }}</code>
                  <button class="icon-btn" @click="copyPrivateKey" :title="$ui('Copy')"><ion-icon :icon="copyOutline"></ion-icon></button>
                </div>
              </div>
              <RecoveryPhrasePanel />
              <DeviceVaultPanel />
              <div v-if="showPrivateKey" class="alert-box warning">
                <ion-icon :icon="warningOutline"></ion-icon> {{ $ui("Never share your private key. Anyone with it can sign events as you.") }} </div>
            </div>
          </div>

          <!-- Appearance -->
          <div class="settings-card">
            <div class="card-heading">
              <div class="card-heading-icon accent-blue">
                <ion-icon :icon="colorPaletteOutline"></ion-icon>
              </div>
              <div><h3>{{ $ui("Appearance") }}</h3></div>
            </div>
            <div class="toggle-row">
              <div>
                <div class="toggle-label">{{ $ui("Dark mode") }}</div>
                <div class="toggle-sub">{{ isDarkMode ? $ui("Dark graphite") : $ui("Light graphite") }}</div>
              </div>
              <label class="toggle-switch theme-toggle">
                <input type="checkbox" role="switch" :aria-label="$ui('Dark mode')" :checked="isDarkMode" @change="onThemeChange" />
                <span class="toggle-track"></span>
              </label>
            </div>
          </div>

          <!-- Navigation & notifications -->
          <div class="settings-card">
            <div class="card-heading">
              <div class="card-heading-icon accent-teal">
                <ion-icon :icon="notificationsOutline"></ion-icon>
              </div>
              <div><h3>{{ $ui("Navigation & notifications") }}</h3></div>
            </div>

            <div class="toggle-row">
              <div>
                <div class="toggle-label">{{ $ui("Show bottom bar") }}</div>
                <div class="toggle-sub">{{ $ui("Mobile only. Turn off to hide the tab bar on the home feed.") }}</div>
              </div>
              <label class="toggle-switch">
                <input type="checkbox" :checked="navStore.enabled" @change="navStore.setEnabled(($event.target as HTMLInputElement).checked)" />
                <span class="toggle-track"></span>
              </label>
            </div>

            <div class="toggle-row">
              <div>
                <div class="toggle-label">{{ $ui("Bottom bar items") }}</div>
                <div class="toggle-sub"> {{ $ui("Mobile: hold a tab and drag it onto another to swap places. The first tab is where the app opens.") }} </div>
              </div>
              <div class="settings-inline-actions">
                <button v-if="isMobileViewport" class="settings-inline-btn" :disabled="!navStore.enabled" @click="replayNavTip">{{ $ui("Show me how") }}</button>
                <button class="settings-inline-btn" :disabled="!navStore.enabled" @click="navStore.reset()">{{ $ui("Reset") }}</button>
              </div>
            </div>

            <div class="toggle-row">
              <div>
                <div class="toggle-label">{{ $ui("Background push") }}</div>
                <div class="toggle-sub"> {{ $ui("Get message notifications when the app is closed. Needs the relay's Firebase setup — see docs/push-notifications.md.") }} </div>
              </div>
              <label class="toggle-switch">
                <input type="checkbox" :checked="pushEnabled" @change="togglePush(($event.target as HTMLInputElement).checked)" />
                <span class="toggle-track"></span>
              </label>
            </div>

            <div class="toggle-row toggle-row-stacked">
              <div>
                <div class="toggle-label">{{ $ui("Email me when push can't reach me") }}</div>
                <div class="toggle-sub"> {{ $ui("A fallback for the web app or a device with push switched off. The relay emails you at most once every 15 minutes, and the mail says only that a message arrived — never its contents or who sent it.") }} <strong>{{ $ui("This ties your identity key to a real address on the relay") }}</strong>{{ $ui(", so leave it off if you rely on being anonymous.") }} </div>
                <div class="email-notify-row">
                  <input
                    v-model="emailNotifyAddress"
                    type="email"
                    class="settings-input"
                    :placeholder="$ui('you@example.com')"
                    autocomplete="email"
                    :disabled="emailNotifyBusy"
                  />
                  <button
                    class="settings-inline-btn"
                    :disabled="emailNotifyBusy || !emailNotifyAddress.trim()"
                    @click="saveEmailNotifications"
                  >{{ $ui("Save") }}</button>
                  <button
                    v-if="emailNotifyRegistered"
                    class="settings-inline-btn"
                    :disabled="emailNotifyBusy"
                    @click="clearEmailNotifications"
                  >{{ $ui("Turn off") }}</button>
                </div>
                <div v-if="emailNotifyStatus" class="email-notify-status" :class="{ 'is-error': emailNotifyError }">
                  {{ emailNotifyStatus }}
                </div>
              </div>
            </div>
          </div>

          <!-- Home Feed Moderation -->
          <div class="settings-card">
            <div class="card-heading">
              <div class="card-heading-icon accent-rose">
                <ion-icon :icon="shieldCheckmarkOutline"></ion-icon>
              </div>
              <div>
                <h3>{{ $ui("Home Feed Moderation") }}</h3>
                <p>{{ $ui("Use a moderation API to filter your feed") }}</p>
              </div>
            </div>
            <div class="toggle-row">
              <div><div class="toggle-label">{{ $ui("Moderate home feed") }}</div></div>
              <label class="toggle-switch">
                <input type="checkbox" v-model="modSettings.moderateHomeFeed" @change="saveModerationSettings" />
                <span class="toggle-track"></span>
              </label>
            </div>
            <div class="field-group mt-12">
              <label class="field-label">{{ $ui("API Provider") }}</label>
              <div class="field-wrap">
                <select class="field-native" v-model="modSettings.moderationProvider" @change="onModerationProviderChange">
                  <option value="interpoll">{{ $ui("Echo default API") }}</option>
                  <option value="custom">{{ $ui("Custom API") }}</option>
                </select>
              </div>
            </div>
            <div v-if="modSettings.moderationProvider === 'custom'" class="field-group mt-8">
              <label class="field-label">{{ $ui("Custom API URL") }}</label>
              <div class="field-wrap">
                <input class="field-native" v-model="modSettings.moderationApiBaseUrl"
                  placeholder="https://example.com/moderation" @blur="saveModerationSettings" />
              </div>
            </div>
            <p class="helper-text mt-8">{{ $ui("Default:") }} {{ moderationDefaultApiUrl }}</p>
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
                <h3>{{ $ui("Feed Mode") }}</h3>
                <p>{{ $ui("Chronological or personalised ranking") }}</p>
              </div>
            </div>
            <div class="seg-pills">
              <button class="seg-pill" :class="{ active: feedPreferences.mode === 'for-you' }"
                @click="onFeedModeChange({ detail: { value: 'for-you' } })">{{ $ui("For You") }}</button>
              <button class="seg-pill" :class="{ active: feedPreferences.mode === 'latest' }"
                @click="onFeedModeChange({ detail: { value: 'latest' } })">{{ $ui("Latest") }}</button>
            </div>
            <p class="helper-text mt-8">{{ $ui("For You uses keyword and community preferences plus engagement/freshness scoring. Latest is purely chronological.") }}</p>
          </div>

          <div class="settings-card">
            <div class="card-heading">
              <div class="card-heading-icon accent-teal">
                <ion-icon :icon="optionsOutline"></ion-icon>
              </div>
              <div><h3>{{ $ui("Content Types") }}</h3><p>{{ $ui("What appears in your feed") }}</p></div>
            </div>
            <div class="toggle-row">
              <div class="toggle-label">{{ $ui("Show posts") }}</div>
              <label class="toggle-switch">
                <input type="checkbox" :checked="feedPreferences.showPosts" @change="onFeedPostsToggle" />
                <span class="toggle-track"></span>
              </label>
            </div>
            <div class="toggle-row mt-8">
              <div class="toggle-label">{{ $ui("Show polls") }}</div>
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
              <div><h3>{{ $ui("Include Keywords") }}</h3><p>{{ $ui("Boost content containing these words") }}</p></div>
            </div>
            <div class="chip-list" v-if="feedPreferences.includeKeywords.length">
              <button class="kw-chip include" v-for="kw in feedPreferences.includeKeywords" :key="kw"
                @click="removeFeedIncludeKeyword(kw)">{{ kw }} ×</button>
            </div>
            <div class="inline-add mt-8">
              <div class="field-wrap flex1">
                <input class="field-native" v-model="newFeedIncludeKeyword"
                  :placeholder="$ui('Add keyword…')" @keyup.enter="addFeedIncludeKeyword" />
              </div>
              <button class="pill-btn accent" @click="addFeedIncludeKeyword"
                :disabled="!newFeedIncludeKeyword.trim()">{{ $ui("Add") }}</button>
            </div>
          </div>

          <div class="settings-card">
            <div class="card-heading">
              <div class="card-heading-icon accent-amber">
                <ion-icon :icon="removeCircleOutline"></ion-icon>
              </div>
              <div><h3>{{ $ui("Exclude Keywords") }}</h3><p>{{ $ui("Demote content with these words") }}</p></div>
            </div>
            <div class="chip-list" v-if="feedPreferences.excludeKeywords.length">
              <button class="kw-chip exclude" v-for="kw in feedPreferences.excludeKeywords" :key="kw"
                @click="removeFeedExcludeKeyword(kw)">{{ kw }} ×</button>
            </div>
            <div class="inline-add mt-8">
              <div class="field-wrap flex1">
                <input class="field-native" v-model="newFeedExcludeKeyword"
                  :placeholder="$ui('Add keyword…')" @keyup.enter="addFeedExcludeKeyword" />
              </div>
              <button class="pill-btn accent" @click="addFeedExcludeKeyword"
                :disabled="!newFeedExcludeKeyword.trim()">{{ $ui("Add") }}</button>
            </div>
          </div>

          <div class="settings-card">
            <div class="card-heading">
              <div class="card-heading-icon accent-blue">
                <ion-icon :icon="peopleOutline"></ion-icon>
              </div>
              <div><h3>{{ $ui("Community Preferences") }}</h3><p>{{ $ui("Favourite = boost, Muted = hidden") }}</p></div>
            </div>
            <div v-if="communityStore.isLoading" class="helper-text">{{ $ui("Loading…") }}</div>
            <div v-else-if="feedCommunities.length > 0" class="community-pref-list">
              <div v-for="community in feedCommunities" :key="community.id" class="community-pref-row">
                <div>
                  <div class="toggle-label">{{ community.displayName }}</div>
                  <div class="community-id-text">{{ community.id }}</div>
                </div>
                <div class="pref-btns">
                  <button class="pref-btn" :class="{ active: isFavoriteCommunity(community.id) }"
                    @click="toggleFavoriteCommunityPreference(community.id)">{{ $ui("★ Fav") }}</button>
                  <button class="pref-btn mute" :class="{ active: isMutedCommunity(community.id) }"
                    @click="toggleMutedCommunityPreference(community.id)">{{ $ui("Mute") }}</button>
                </div>
              </div>
            </div>
            <p v-else class="helper-text">{{ $ui("No communities loaded yet.") }}</p>
          </div>

          <div class="settings-card">
            <div class="card-heading">
              <div class="card-heading-icon accent-violet">
                <ion-icon :icon="analyticsOutline"></ion-icon>
              </div>
              <div><h3>{{ $ui("Ranking Weights") }}</h3><p>{{ $ui("Tweak what matters in your feed") }}</p></div>
            </div>
            <div class="range-row" v-for="(weight, key) in feedPreferences.rankingWeights" :key="key">
              <div class="range-header">
                <span>{{ { freshness: $ui("Freshness"), engagement: $ui("Engagement"), keywords: $ui("Keywords"), community: $ui("Community affinity") }[key] }}</span>
                <strong class="range-val">{{ formatWeight(weight) }}</strong>
              </div>
              <ion-range :min="0" :max="1" :step="0.05" :value="weight"
                @ionChange="(ev) => onFeedWeightChange(key, ev)" :pin="true"></ion-range>
            </div>
            <button class="block-btn outline mt-12" @click="resetFeedPreferencesToDefaults">{{ $ui("Reset Feed Preferences") }}</button>
          </div>
        </div>

        <!-- ══════════════════════ MODERATION TAB ══════════════════════ -->
        <div v-if="activeTab === 'moderation'">
          <div class="settings-card">
            <div class="card-heading">
              <div class="card-heading-icon accent-amber">
                <ion-icon :icon="personOutline"></ion-icon>
              </div>
              <div><h3>{{ $ui("Karma Filter") }}</h3><p>{{ $ui("Hide posts from low-rep users") }}</p></div>
            </div>
            <div class="range-row">
              <div class="range-header">
                <span>{{ $ui("Min karma") }}</span>
                <strong class="range-val">{{ modSettings.minUserKarma <= -1000 ? $ui("Off") : modSettings.minUserKarma }}</strong>
              </div>
              <ion-range :min="-100" :max="100" :step="5"
                :value="modSettings.minUserKarma <= -1000 ? -100 : modSettings.minUserKarma"
                @ionChange="onKarmaRangeChange" :pin="true"></ion-range>
            </div>
            <p class="helper-text">{{ $ui("Drag to −100 to disable.") }}</p>
          </div>

          <div class="settings-card">
            <div class="card-heading">
              <div class="card-heading-icon accent-rose">
                <ion-icon :icon="arrowDownOutline"></ion-icon>
              </div>
              <div><h3>{{ $ui("Score Filter") }}</h3><p>{{ $ui("Hide heavily downvoted content") }}</p></div>
            </div>
            <div class="range-row">
              <div class="range-header">
                <span>{{ $ui("Min score") }}</span>
                <strong class="range-val">{{ modSettings.minContentScore }}</strong>
              </div>
              <ion-range :min="-50" :max="50" :step="1" v-model="modSettings.minContentScore"
                @ionKnobMoveEnd="saveModerationSettings" :pin="true"></ion-range>
            </div>
            <p class="helper-text">{{ $ui("Posts with net score below this are hidden.") }}</p>
          </div>

          <div class="settings-card">
            <div class="card-heading">
              <div class="card-heading-icon accent-rose">
                <ion-icon :icon="chatbubbleOutline"></ion-icon>
              </div>
              <div><h3>{{ $ui("Word Filter") }}</h3><p>{{ $ui("Hide or blur content with flagged words") }}</p></div>
            </div>
            <div class="field-group">
              <label class="field-label">{{ $ui("Filter Action") }}</label>
              <div class="seg-pills">
                <button class="seg-pill" :class="{ active: modSettings.wordFilterAction === 'blur' }"
                  @click="modSettings.wordFilterAction = 'blur'; saveModerationSettings()">{{ $ui("Blur") }}</button>
                <button class="seg-pill" :class="{ active: modSettings.wordFilterAction === 'hide' }"
                  @click="modSettings.wordFilterAction = 'hide'; saveModerationSettings()">{{ $ui("Hide") }}</button>
                <button class="seg-pill" :class="{ active: modSettings.wordFilterAction === 'flag' }"
                  @click="modSettings.wordFilterAction = 'flag'; saveModerationSettings()">{{ $ui("Flag") }}</button>
              </div>
            </div>
            <button class="block-btn outline danger mt-12" @click="resetModerationDefaults">
              <ion-icon :icon="refreshOutline"></ion-icon> {{ $ui("Reset Moderation to Defaults") }} </button>
          </div>
        </div>

        <!-- ══════════════════════ ADVANCED TAB ══════════════════════ -->
        <div v-if="activeTab === 'advanced'">
          <div class="settings-card">
            <div class="card-heading">
              <div class="card-heading-icon accent-violet">
                <ion-icon :icon="keyOutline"></ion-icon>
              </div>
              <div><h3>{{ $ui("Clear app cache") }}</h3><p>{{ $ui("Stuck on an old version? This drops cached app files and reloads. Your keys, chats and settings are kept.") }}</p></div>
            </div>
            <button class="field-native" style="cursor:pointer;font-weight:600" @click="uncache()">{{ $ui("Clear cache & reload") }}</button>
          </div>
          <div class="settings-card">
            <div class="card-heading">
              <div class="card-heading-icon accent-violet">
                <ion-icon :icon="keyOutline"></ion-icon>
              </div>
              <div><h3>{{ $ui("Moderation API") }}</h3><p>{{ $ui("Authenticate and enable click-to-submit from Home feed") }}</p></div>
            </div>
            <div class="field-group">
              <label class="field-label">{{ $ui("Provider") }}</label>
              <div class="field-wrap">
                <select class="field-native" v-model="modSettings.moderationProvider" @change="saveModerationSettings">
                  <option value="interpoll">{{ $ui("Echo Moderation API") }}</option>
                  <option value="custom">{{ $ui("Custom API") }}</option>
                </select>
              </div>
            </div>
            <div class="field-group mt-8">
              <label class="field-label">{{ $ui("API Base URL") }}</label>
              <div class="field-wrap">
                <input class="field-native mono-sm" v-model="modSettings.moderationApiBaseUrl"
                  @blur="saveModerationSettings" placeholder="https://interpoll.endless.social/moderation" />
              </div>
            </div>
            <div class="field-group mt-8">
              <label class="field-label">{{ $ui("API Key") }}</label>
              <div class="field-wrap">
                <input class="field-native mono-sm" type="password" v-model="moderationApiKeyInput" :placeholder="$ui('mod_sk_...')" />
              </div>
            </div>
            <div class="button-row mt-12">
              <button class="pill-btn accent" @click="authenticateModerationApi">{{ $ui("Authenticate") }}</button>
              <button class="pill-btn outline" @click="clearModerationApiAuth">{{ $ui("Clear Auth") }}</button>
            </div>
            <p class="helper-text mt-8">{{ moderationAuthMessage }}</p>
          </div>

          <div class="settings-card">
            <div class="card-heading">
              <div class="card-heading-icon accent-teal">
                <ion-icon :icon="fingerPrintOutline"></ion-icon>
              </div>
              <div><h3>{{ $ui("Manual Hash Submission") }}</h3><p>{{ $ui("SHA-256 of post body sent to moderation API on click") }}</p></div>
            </div>
            <div class="toggle-row">
              <div>
                <div class="toggle-label">{{ $ui("Click post to submit hash") }}</div>
                <div class="toggle-sub">{{ $ui("No author fields included — content hash only") }}</div>
              </div>
              <label class="toggle-switch">
                <input type="checkbox" v-model="modSettings.moderateHomeFeed" @change="saveModerationSettings" />
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
                <div class="banner-title">{{ networkStatus.gunConnected ? $ui("Decentralised Network Active") : $ui("Network Degraded") }}</div>
                <div class="banner-sub">{{ $count(networkStatus.gunConnectedCount, 'peer') }} {{ $ui("connected ·") }} {{ networkStatus.gunAvgLatencyMs != null ? networkStatus.gunAvgLatencyMs + $ui("ms avg") : 'measuring…' }}</div>
              </div>
            </div>
            <div class="banner-metrics">
              <div class="bmetric">
                <span>{{ networkStatus.peerCount }}</span>
                <small>{{ $ui("Relay peers") }}</small>
              </div>
              <div class="bmetric">
                <span>{{ networkStatus.gunConnectedCount }}/{{ networkStatus.gunPeerCount }}</span>
                <small>{{ $ui("DB relays") }}</small>
              </div>
              <div class="bmetric" :class="networkStatus.chainValid ? 'ok' : 'danger'">
                <span>{{ networkStatus.chainValid ? '✓' : '✗' }}</span>
                <small>{{ $ui("Chain") }}</small>
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
                <h3>{{ $ui("Privacy & Tor") }}</h3>
                <p>{{ $ui("Restrict network features that may leak your IP or device fingerprint. Enable this when routing traffic through Tor or a VPN for enhanced anonymity.") }}</p>
              </div>
              <span class="status-pill" :class="anonymityMode ? 'pill-ok' : 'pill-off'">
                {{ anonymityMode ? $ui("Anonymity ON") : $ui("OFF") }}
              </span>
            </div>
            <div class="toggle-row">
              <div>
                <div class="toggle-label">{{ $ui("Anonymity (Tor) Mode") }}</div>
                <div class="toggle-sub">{{ $ui("Disables WebRTC, prefers .onion relays") }}</div>
              </div>
              <label class="toggle-switch">
                <input type="checkbox" v-model="anonymityMode" @change="onAnonymityToggle" />
                <span class="toggle-track"></span>
              </label>
            </div>
            <div class="alert-box info mt-12">
              <ion-icon :icon="informationCircleOutline"></ion-icon>
              <span>{{ $ui("Web applications cannot route their own TCP traffic through Tor. To use Echo over Tor, open it in") }} <a href="https://www.torproject.org" target="_blank" class="link">{{ $ui("Tor Browser") }}</a>{{ $ui(", or proxy this browser's traffic through") }} <a href="https://orbot.app" target="_blank" class="link">{{ $ui("Orbot") }}</a>.</span>
            </div>
            <div v-if="anonymityMode" class="mt-12">
              <div class="status-row" :class="activeRelayIsOnion ? 'row-ok' : 'row-warn'">
                <ion-icon :icon="activeRelayIsOnion ? lockClosedOutline : warningOutline"></ion-icon>
                <span v-if="activeRelayIsOnion">{{ $ui("Active relay is a") }} <code>.onion</code> {{ $ui("address — routing via Tor hidden service.") }}</span>
                <span v-else>{{ $ui("Active relay is") }} <strong>{{ $ui("clearnet") }}</strong> {{ $ui("— add a") }} <code>.onion</code> {{ $ui("relay below for hidden-service routing.") }}</span>
              </div>
              <button class="pill-btn outline mt-8" :disabled="torChecking" @click="checkTorStatus">
                <ion-icon :icon="refreshOutline"></ion-icon>
                {{ torChecking ? $ui("Checking…") : $ui("Check Tor status") }}
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
                <h3>{{ $ui("Relay Peers") }}</h3>
                <p>{{ $ui("GunDB relay servers that sync data across the network. Connecting to multiple peers ensures continuity if any single server becomes unavailable.") }}</p>
              </div>
              <span class="count-badge">{{ networkStatus.gunConnectedCount }}/{{ gunPeersList.length }}</span>
            </div>

            <div class="peer-health-list">
              <div v-for="peer in gunPeersDetail.length ? gunPeersDetail : gunPeersList.map(u => ({ url: u, connected: false, latencyMs: undefined }))"
                :key="peer.url" class="peer-health-row">
                <div class="peer-health-left">
                  <span class="health-dot" :class="peer.connected ? 'dot-ok' : 'dot-off'"></span>
                  <div>
                    <div class="peer-name">{{ labelForGunUrl(peer.url) }}</div>
                    <div class="peer-url">{{ peer.url }}</div>
                  </div>
                </div>
                <div class="peer-health-right">
                  <span v-if="peer.latencyMs != null" class="latency-badge">{{ peer.latencyMs }}{{ $ui("ms") }}</span>
                  <span class="status-chip" :class="peer.connected ? 'chip-ok' : 'chip-off'">
                    {{ peer.connected ? $ui("Live") : $ui("Connecting…") }}
                  </span>
                  <button v-if="gunPeersList.length > 1" class="icon-btn danger" @click="removeGunPeer(peer.url)" :title="$ui('Remove')">
                    <ion-icon :icon="trashOutline"></ion-icon>
                  </button>
                </div>
              </div>
            </div>

            <!-- Add preset -->
            <div v-if="availableGunPresets.length" class="field-group mt-12">
              <label class="field-label">{{ $ui("Add from presets") }}</label>
              <div class="inline-add">
                <div class="field-wrap flex1">
                  <select class="field-native" v-model="selectedGunPreset">
                    <option value="">{{ $ui("— choose a preset —") }}</option>
                    <option v-for="p in availableGunPresets" :key="p.url" :value="p.url">{{ p.label }}</option>
                  </select>
                </div>
                <button class="pill-btn accent" :disabled="!selectedGunPreset" @click="addGunPeerFromPreset">{{ $ui("Add") }}</button>
              </div>
            </div>

            <!-- Add custom -->
            <div class="field-group mt-8">
              <label class="field-label">{{ $ui("Add custom relay URL") }}</label>
              <div class="inline-add">
                <div class="field-wrap flex1">
                  <input class="field-native mono-sm" v-model="newGunPeerUrl"
                    placeholder="https://your-relay.example.com/gun"
                    @keyup.enter="addGunPeerFromInput" />
                </div>
                <button class="pill-btn accent" :disabled="!newGunPeerUrl.trim()" @click="addGunPeerFromInput">{{ $ui("Add") }}</button>
              </div>
            </div>
            <button class="pill-btn outline mt-8" @click="resetGunPeersToDefaults">{{ $ui("Reset to defaults") }}</button>
          </div>

          <!-- Run a Relay Node -->
          <div class="settings-card decentralised-feature">
            <div class="decentral-badge">
              <ion-icon :icon="globeOutline"></ion-icon> {{ $ui("DECENTRALISED") }} </div>
            <div class="card-heading">
              <div class="card-heading-icon accent-violet">
                <ion-icon :icon="cloudUploadOutline"></ion-icon>
              </div>
              <div>
                <h3>{{ $ui("Run a Relay Node") }}</h3>
                <p>{{ $ui("Contribute to the network by hosting a GunDB relay. Each additional node improves data availability and reduces latency for all users. Choose the setup path that suits your environment.") }}</p>
              </div>
            </div>

            <div class="relay-options">
              <div class="relay-option">
                <div class="relay-option-header">
                  <span class="relay-difficulty easy">{{ $ui("Easy") }}</span>
                  <span class="relay-option-name">{{ $ui("Browser Tab") }}</span>
                </div>
                <p class="relay-option-desc">{{ $ui("Runs a relay directly in this browser tab via a WebSocket bridge. Automatically receives a public") }} <code>wss://…/tunnel/…/gun</code> {{ $ui("URL — no server or port-forwarding required. Stops when the tab closes.") }}</p>
                <template v-if="browserRelay.active">
                  <div class="code-block-copy">
                    <code class="code-text">{{ browserRelay.publicUrl }}</code>
                    <button class="copy-btn" @click="copyText(browserRelay.publicUrl || '', 'tab')" :title="copied === 'tab' ? 'Copied!' : 'Copy'">
                      {{ copied === 'tab' ? '✓' : '⎘' }}
                    </button>
                  </div>
                  <p class="relay-option-desc" style="margin-top:6px;font-size:11.5px"> {{ $ui("Running · serving") }} {{ browserRelay.peersServed }} {{ $ui("peer") }}{{ browserRelay.peersServed === 1 ? '' : 's' }}{{ $ui(". Others can add this URL as a GunDB relay.") }} </p>
                  <button class="pill-btn" @click="stopBrowserRelay">{{ $ui("Stop Browser Relay") }}</button>
                </template>
                <template v-else>
                  <button class="pill-btn accent" :disabled="browserRelayStarting" @click="startBrowserRelay">
                    {{ browserRelayStarting ? $ui("Starting…") : $ui("Enable Browser Relay") }}
                  </button>
                </template>
                <p v-if="browserRelay.error" class="relay-option-desc" style="margin-top:6px;font-size:11.5px;color:var(--app-danger, #ef4444)">{{ browserRelay.error }}</p>
              </div>

              <div class="relay-option">
                <div class="relay-option-header">
                  <span class="relay-difficulty medium">{{ $ui("Medium") }}</span>
                  <span class="relay-option-name">{{ $ui("Home Server") }}</span>
                </div>
                <p class="relay-option-desc">{{ $ui("Deploys a GunDB relay on a Raspberry Pi or spare Linux/Windows/Mac machine. The installer prints the relay URL when done.") }}</p>
                <div class="os-tabs">
                  <button v-for="os in ['Linux / Pi', 'macOS', 'Windows']" :key="os"
                    class="os-tab" :class="{ active: homeOs === os }"
                    @click="homeOs = os">{{ os }}</button>
                </div>
                <div class="code-block-copy">
                  <code class="code-text">{{ homeCmd }}</code>
                  <button class="copy-btn" @click="copyText(homeCmd, 'home')" :title="copied === 'home' ? 'Copied!' : 'Copy'">
                    {{ copied === 'home' ? '✓' : '⎘' }}
                  </button>
                </div>
                <p v-if="homeOs === 'Windows'" class="relay-option-desc" style="margin-top:6px;font-size:11.5px">{{ $ui("Run in") }} <strong>{{ $ui("PowerShell as Administrator") }}</strong>.</p>
                <p v-else class="relay-option-desc" style="margin-top:6px;font-size:11.5px">{{ $ui("Run in a terminal on the target machine.") }}</p>
              </div>

              <div class="relay-option">
                <div class="relay-option-header">
                  <span class="relay-difficulty advanced">{{ $ui("Technical") }}</span>
                  <span class="relay-option-name">{{ $ui("Cloud VPS") }}</span>
                </div>
                <p class="relay-option-desc">{{ $ui("Provisions a production-grade relay on any VPS with a domain name. SSH into your server first, then run:") }}</p>
                <div class="os-tabs">
                  <button v-for="os in ['Linux (bash)', 'macOS (zsh)']" :key="os"
                    class="os-tab" :class="{ active: vpsOs === os }"
                    @click="vpsOs = os">{{ os }}</button>
                </div>
                <div class="code-block-copy">
                  <code class="code-text">{{ vpsCmd }}</code>
                  <button class="copy-btn" @click="copyText(vpsCmd, 'vps')" :title="copied === 'vps' ? 'Copied!' : 'Copy'">
                    {{ copied === 'vps' ? '✓' : '⎘' }}
                  </button>
                </div>
                <p class="relay-option-desc" style="margin-top:6px;font-size:11.5px">{{ $ui("Replace") }} <code>yourdomain.com</code> {{ $ui("with your actual domain. Handles Docker, Caddy + TLS automatically.") }}</p>
              </div>
            </div>
          </div>

          <!-- Relay Configuration -->
          <div class="settings-card">
            <div class="card-heading">
              <div class="card-heading-icon accent-blue">
                <ion-icon :icon="constructOutline"></ion-icon>
              </div>
              <div><h3>{{ $ui("Relay Configuration") }}</h3><p>{{ $ui("Change the servers your node connects to") }}</p></div>
              <span v-if="hasCustomRelay" class="status-pill pill-warn">{{ $ui("Custom") }}</span>
            </div>
            <div class="field-group">
              <label class="field-label">{{ $ui("WebSocket Relay") }}</label>
              <div class="field-wrap"><input class="field-native mono-sm" v-model="editRelay.websocket" placeholder="ws://localhost:8080" /></div>
            </div>
            <div class="field-group mt-8">
              <label class="field-label">{{ $ui("GunDB Relay") }}</label>
              <div class="field-wrap"><input class="field-native mono-sm" v-model="editRelay.gun" placeholder="http://localhost:8765/gun" /></div>
            </div>
            <div class="field-group mt-8">
              <label class="field-label">{{ $ui("API Server") }}</label>
              <div class="field-wrap"><input class="field-native mono-sm" v-model="editRelay.api" placeholder="http://localhost:8080" /></div>
            </div>
            <button class="block-btn accent mt-12" @click="applyRelayConfig">
              <ion-icon :icon="swapHorizontalOutline"></ion-icon> {{ $ui("Apply & Reconnect") }} </button>
            <button v-if="hasCustomRelay" class="block-btn outline mt-8" @click="resetRelayConfig">{{ $ui("Reset to Defaults") }}</button>
          </div>

          <!-- Bootstrap Recovery -->
          <div class="settings-card">
            <div class="card-heading">
              <div class="card-heading-icon accent-amber">
                <ion-icon :icon="refreshOutline"></ion-icon>
              </div>
              <div>
                <h3>{{ $ui("Bootstrap Recovery") }}</h3>
                <p>{{ $ui("Re-establish network connectivity when primary relays are unreachable. Discover active peers via the Gun mesh, or exchange signed invite bundles out-of-band to restore access.") }}</p>
              </div>
            </div>
            <div class="button-row">
              <button class="pill-btn outline" :disabled="bootstrapDiscovering" @click="discoverBootstrapFromGun">
                <ion-icon :icon="refreshOutline"></ion-icon>
                {{ bootstrapDiscovering ? $ui("Discovering…") : $ui("Discover from Gun") }}
              </button>
              <button class="pill-btn outline" @click="generateBootstrapInvite">
                <ion-icon :icon="downloadOutline"></ion-icon> {{ $ui("Generate Invite") }} </button>
              <button class="pill-btn outline" :disabled="!generatedBootstrapInvite" @click="copyGeneratedBootstrapInvite">
                <ion-icon :icon="copyOutline"></ion-icon> {{ $ui("Copy Invite") }} </button>
            </div>
            <p class="helper-text mt-8">{{ $ui("Imported endpoints are validated before connecting — no silent relay switching occurs.") }}</p>
          </div>

          <!-- Connected Peers & Your Node -->
          <div class="settings-card">
            <div class="card-heading">
              <div class="card-heading-icon accent-teal">
                <ion-icon :icon="peopleOutline"></ion-icon>
              </div>
              <div><h3>{{ $ui("Connected Peers") }}</h3><p>{{ $ui("Peers sharing relay addresses automatically") }}</p></div>
              <button class="icon-btn" @click="refreshNetwork"><ion-icon :icon="refreshOutline"></ion-icon></button>
            </div>
            <div v-if="peerList.length === 0" class="empty-peers">
              <ion-icon :icon="globeOutline"></ion-icon>
              <p>{{ $ui("No peers connected yet") }}</p>
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
                <span class="info-key">{{ $ui("Your Peer ID") }}</span>
                <code class="info-val mono-sm">{{ myPeerId }}</code>
              </div>
              <div class="info-row">
                <span class="info-key">{{ $ui("Device ID") }}</span>
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
              <div><h3>{{ $ui("Storage Usage") }}</h3><p>{{ $ui("Local device storage") }}</p></div>
            </div>
            <div class="storage-ring-row">
              <div class="storage-ring">
                <svg viewBox="0 0 56 56">
                  <circle cx="28" cy="28" r="24" fill="none" stroke="rgba(255,255,255,0.07)" stroke-width="6"/>
                  <circle cx="28" cy="28" r="24" fill="none"
                    :stroke="storagePercent > 95 ? '#ef4444' : storagePercent > 80 ? '#f59e0b' : '#e6e6e6'"
                    stroke-width="6" stroke-linecap="round"
                    :stroke-dasharray="`${storagePercent * 1.508} 150.8`"
                    stroke-dashoffset="37.7" transform="rotate(-90 28 28)"/>
                </svg>
                <div class="ring-label">{{ storagePercent.toFixed(0) }}%</div>
              </div>
              <div class="storage-stats">
                <div class="storage-stat-row">
                  <span>{{ $ui("Used") }}</span><strong>{{ storageStats.used.toFixed(1) }} {{ $ui("MB") }}</strong>
                </div>
                <div class="storage-stat-row">
                  <span>{{ $ui("Available") }}</span><strong>{{ storageStats.quota.toFixed(0) }} {{ $ui("MB") }}</strong>
                </div>
                <div class="storage-stat-row">
                  <span>{{ $ui("Pinned images") }}</span><strong>{{ storageStats.pinnedItems }}</strong>
                </div>
              </div>
            </div>
            <button class="pill-btn outline mt-12" @click="refreshStorageStats">
              <ion-icon :icon="refreshOutline"></ion-icon> {{ $ui("Refresh Stats") }} </button>
          </div>

          <!-- Data Versions -->
          <div class="settings-card">
            <div class="card-heading">
              <div class="card-heading-icon accent-violet">
                <ion-icon :icon="layersOutline"></ion-icon>
              </div>
              <div><h3>{{ $ui("Data Versions") }}</h3><p>{{ $ui("Which GunDB data versions to display") }}</p></div>
            </div>
            <div v-if="isProbing" class="helper-text">{{ $ui("Probing available versions…") }}</div>
            <template v-else>
              <div v-for="version in availableVersions" :key="version" class="toggle-row">
                <div>
                  <div class="toggle-label">{{ version === currentNamespace ? `${version} (current)` : `${version} (legacy)` }}</div>
                  <div class="toggle-sub">{{ version === currentNamespace ? $ui("Default namespace") : $ui("Legacy posts from before migration") }}</div>
                </div>
                <label class="toggle-switch">
                  <input type="checkbox" :checked="versionToggles[version]" @change="toggleVersion(version)" />
                  <span class="toggle-track"></span>
                </label>
              </div>
            </template>
            <p class="helper-text mt-8">{{ $ui("Legacy posts were created before the namespace migration. Changes take effect on next page load.") }}</p>
          </div>

          <!-- Storage Policy -->
          <div class="settings-card">
            <div class="card-heading">
              <div class="card-heading-icon accent-teal">
                <ion-icon :icon="cloudOutline"></ion-icon>
              </div>
              <div><h3>{{ $ui("Storage Policy") }}</h3><p>{{ $ui("Control what gets stored locally") }}</p></div>
            </div>
            <div class="toggle-row" v-for="(label, key) in { myPosts: 'Always store my posts', myUpvotes: 'Store posts I upvoted', myCommunities: 'Store my communities', popularPosts: 'Cache popular posts (100+ upvotes)', autoPruneOldContent: 'Auto-delete old cached content' }" :key="key">
              <div class="toggle-label">{{ label }}</div>
              <label class="toggle-switch">
                <input type="checkbox" v-model="policy[key]" @change="savePolicy" />
                <span class="toggle-track"></span>
              </label>
            </div>
            <div class="field-group mt-12">
              <label class="field-label">{{ $ui("Keep recent posts") }}</label>
              <div class="field-wrap">
                <select class="field-native" v-model="policy.recentPosts" @change="savePolicy">
                  <option :value="25">{{ $ui("Last 25") }}</option>
                  <option :value="50">{{ $ui("Last 50") }}</option>
                  <option :value="100">{{ $ui("Last 100") }}</option>
                  <option :value="250">{{ $ui("Last 250") }}</option>
                </select>
              </div>
            </div>
            <div class="field-group mt-8">
              <label class="field-label">{{ $ui("Max storage (MB)") }}</label>
              <div class="field-wrap">
                <select class="field-native" v-model="policy.maxStorageMB" @change="savePolicy">
                  <option :value="50">{{ $ui("50 MB") }}</option>
                  <option :value="100">{{ $ui("100 MB") }}</option>
                  <option :value="250">{{ $ui("250 MB") }}</option>
                  <option :value="500">{{ $ui("500 MB") }}</option>
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
              <div><h3>{{ $ui("Backup & Restore") }}</h3><p>{{ $ui("Export or import all local data") }}</p></div>
            </div>
            <div class="button-row">
              <button class="pill-btn accent" @click="exportData">
                <ion-icon :icon="downloadOutline"></ion-icon> {{ $ui("Export") }} </button>
              <button class="pill-btn outline" @click="importData">
                <ion-icon :icon="cloudUploadOutline"></ion-icon> {{ $ui("Import") }} </button>
            </div>
            <button class="block-btn outline danger mt-12" @click="pruneOldContent">
              <ion-icon :icon="trashOutline"></ion-icon> {{ $ui("Clean Up Old Content") }} </button>
            <button class="block-btn outline danger mt-8" @click="confirmClearAll">
              <ion-icon :icon="warningOutline"></ion-icon> {{ $ui("Clear All Data") }} </button>
            <input ref="importFileInput" type="file" accept=".json" class="hidden" @change="handleImportFile" />
          </div>

          <!-- Build info -->
          <div class="settings-card">
            <div class="card-heading">
              <div class="card-heading-icon accent-blue">
                <ion-icon :icon="informationCircleOutline"></ion-icon>
              </div>
              <div><h3>{{ $ui("About this Build") }}</h3></div>
            </div>
            <div class="info-table">
              <div class="info-row">
                <span class="info-key">{{ $ui("Build Hash") }}</span>
                <code class="info-val mono-sm">{{ buildHash }}</code>
              </div>
              <div class="info-row">
                <span class="info-key">{{ $ui("Built at") }}</span>
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
.toggle-switch.theme-toggle { width: 48px; height: 44px; }
.toggle-switch.theme-toggle input { display: block; position: absolute; inset: 0; width: 100%; height: 100%; margin: 0; opacity: 0; z-index: 1; cursor: pointer; }
.toggle-switch.theme-toggle .toggle-track { top: 10px; bottom: 10px; }
.toggle-switch.theme-toggle input:focus-visible + .toggle-track { outline: 2px solid var(--app-accent); outline-offset: 3px; }
/* ── Global resets ──────────────────────────── */
ion-header::after { display: none !important; }
ion-toolbar { --border-width: 0 !important; }

/* Settings content area — show the gradient through ion-content */
ion-content {
  --background:
    radial-gradient(ellipse at 15% 0%,   rgba(230, 230, 230, 0.35) 0%, transparent 50%),
    radial-gradient(ellipse at 88% 8%,   rgba(236, 72, 153, 0.22) 0%, transparent 45%),
    radial-gradient(ellipse at 50% 100%, rgba(230, 230, 230, 0.24) 0%, transparent 55%),
    radial-gradient(ellipse at 0%  55%,  rgba(230, 230, 230, 0.15) 0%, transparent 40%),
    #141414;
}

/* Kill DesktopPageShell's opaque surface-card so our gradient shows through */
/* Only strip glass from the shell content area — leave sidebars intact */
:deep(.dps-main) {
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
  background: var(--app-bg-base);
  border-bottom: 1px solid rgba(230, 230, 230, 0.12);
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
  color: var(--app-on-accent);
  background: var(--app-accent);
  border-color: rgba(230, 230, 230,0.35);
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
  background: var(--app-surface);
  border: 1px solid var(--app-border);
  padding: 18px 20px;
  position: relative;
  overflow: hidden;
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
}
.settings-card.danger-zone {
  border-color: rgba(239,68,68,0.18);
  background: var(--app-surface);
}
.settings-card.decentralised-feature {
  border-color: rgba(230, 230, 230,0.30);
  background: linear-gradient(135deg, rgba(230, 230, 230,0.10), rgba(230, 230, 230,0.07));
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
.accent-violet { background: var(--app-accent); box-shadow: 0 4px 12px rgba(230, 230, 230,0.3); }
.accent-blue   { background: linear-gradient(135deg, #3b82f6, #e6e6e6); box-shadow: 0 4px 12px rgba(59,130,246,0.3); }
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
  border: 1px solid rgba(230, 230, 230,0.12);
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

.settings-inline-btn {
  flex-shrink: 0;
  padding: 7px 14px;
  border: none;
  border-radius: 999px;
  font-size: 13px;
  font-weight: 600;
  color: #fff;
  background: rgba(255, 255, 255, 0.14);
  cursor: pointer;
}
.settings-inline-btn:active { opacity: 0.7; }
.settings-inline-btn:disabled { opacity: 0.4; cursor: default; }
.settings-inline-actions { display: flex; flex-shrink: 0; gap: 8px; }

/* The email fallback needs an input, so its row stacks instead of sitting on one line. */
.toggle-row-stacked { align-items: flex-start; }
.email-notify-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-top: 10px;
}
.settings-input {
  flex: 1 1 180px;
  min-width: 0;
  padding: 7px 12px;
  border: 1px solid rgba(255,255,255,0.14);
  border-radius: 999px;
  font-size: 13px;
  color: var(--app-text);
  background: rgba(255,255,255,0.06);
}
.settings-input:disabled { opacity: 0.5; }
.email-notify-status { margin-top: 8px; font-size: 12px; color: var(--app-text-muted); }
.email-notify-status.is-error { color: #f87171; }
.toggle-label { font-size: 14px; font-weight: 600; color: var(--app-text); }
.toggle-sub { font-size: 12px; color: var(--app-text-muted); margin-top: 2px; }

/* Toggle switch */
.toggle-switch { position: relative; width: 44px; height: 26px; flex-shrink: 0; }
.toggle-switch input { opacity: 0; width: 0; height: 0; }
.toggle-track {
  position: absolute; inset: 0; border-radius: 999px;
  background: var(--app-border-strong);
  border: 1px solid var(--app-border-strong);
  cursor: pointer;
  transition: background 200ms ease;
}
.toggle-switch input:checked + .toggle-track { background: var(--app-accent); border-color: var(--app-accent); }
.toggle-track::after {
  content: ''; position: absolute; top: 3px; left: 3px;
  width: 18px; height: 18px; border-radius: 50%;
  background: #fff; box-shadow: 0 1px 4px rgba(0,0,0,0.3);
  transition: transform 200ms ease;
}
.toggle-switch input:checked + .toggle-track::after { transform: translateX(18px); }

/* Locked toggle — always on, non-interactive */
.toggle-switch--locked { cursor: not-allowed; opacity: 0.7; }
.toggle-switch--locked .toggle-track { cursor: not-allowed; }

/* Light mode coming soon notice */
.theme-coming-soon {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  margin-top: 10px;
  padding: 7px 13px;
  border-radius: 999px;
  background: rgba(255,255,255,0.04);
  border: 1px solid rgba(255,255,255,0.08);
  font-size: 12px;
  font-weight: 500;
  color: var(--app-text-subtle);
  letter-spacing: 0.01em;
  width: fit-content;
}

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
  border-color: rgba(230, 230, 230,0.5);
  box-shadow: 0 0 0 3px rgba(230, 230, 230,0.1);
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
select.field-native option { background: #242424; color: #fff; }

/* ── Buttons ────────────────────────────────── */
.block-btn {
  width: 100%; padding: 13px; border-radius: 14px; border: none;
  font-size: 14px; font-weight: 700; cursor: pointer;
  display: flex; align-items: center; justify-content: center; gap: 8px;
  transition: opacity 160ms ease, transform 160ms ease;
}
.block-btn.accent {
  background: var(--app-accent);
  color: var(--app-on-accent); box-shadow: 0 6px 20px rgba(230, 230, 230,0.35);
}
.block-btn.outline {
  background: rgba(255,255,255,0.05);
  border: 1px solid var(--app-border-strong);
  color: var(--app-text-muted);
}
.block-btn.danger { color: var(--app-danger); border-color: rgba(239,68,68,0.25); }
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
  background: var(--app-accent);
  color: var(--app-on-accent); box-shadow: 0 4px 14px rgba(230, 230, 230,0.35);
}
.pill-btn.outline {
  background: rgba(255,255,255,0.05);
  border: 1px solid var(--app-border-strong);
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
.icon-btn.warning { color: var(--app-warning); }
.icon-btn.danger { color: var(--app-danger); background: rgba(239,68,68,0.1); }

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
  background: var(--app-accent);
  color: var(--app-on-accent); box-shadow: 0 2px 10px rgba(230, 230, 230,0.35);
}

/* ── Keyword chips ──────────────────────────── */
.chip-list { display: flex; flex-wrap: wrap; gap: 6px; }
.kw-chip {
  padding: 4px 10px; border-radius: 999px; border: none;
  font-size: 12.5px; font-weight: 600; cursor: pointer;
  transition: opacity 160ms;
}
.kw-chip.include { background: rgba(52,211,153,0.12); color: var(--app-success); border: 1px solid rgba(52,211,153,0.25); }
.kw-chip.exclude { background: rgba(251,191,36,0.12); color: var(--app-warning); border: 1px solid rgba(251,191,36,0.25); }
.kw-chip:hover { opacity: 0.7; }

/* ── Karma badge ────────────────────────────── */
.karma-badge {
  padding: 4px 12px; border-radius: 999px;
  background: linear-gradient(135deg, rgba(230, 230, 230,0.15), rgba(230, 230, 230,0.15));
  border: 1px solid rgba(230, 230, 230,0.25);
  color: var(--app-accent); font-weight: 700; font-size: 13px;
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
.key-val.danger { color: var(--app-danger); }

/* ── Alert boxes ────────────────────────────── */
.alert-box {
  display: flex; align-items: flex-start; gap: 10px;
  padding: 12px 14px; border-radius: 12px;
  font-size: 13px; line-height: 1.5;
}
.alert-box ion-icon { font-size: 16px; flex-shrink: 0; margin-top: 1px; }
.alert-box.info {
  background: rgba(230, 230, 230,0.08);
  border: 1px solid rgba(230, 230, 230,0.2);
  color: var(--app-accent);
}
.alert-box.warning {
  background: rgba(251,191,36,0.08);
  border: 1px solid rgba(251,191,36,0.2);
  color: var(--app-warning);
}
.link { color: var(--app-accent); text-decoration: none; }
.link:hover { text-decoration: underline; }

/* ── Status pills / chips ───────────────────── */
.status-pill {
  padding: 4px 10px; border-radius: 999px;
  font-size: 10.5px; font-weight: 700;
  text-transform: uppercase; letter-spacing: 0.06em;
  align-self: flex-start; flex-shrink: 0;
}
.pill-ok { background: rgba(52,211,153,0.12); color: var(--app-success); border: 1px solid rgba(52,211,153,0.25); }
.pill-off { background: rgba(255,255,255,0.06); color: var(--app-text-muted); border: 1px solid rgba(255,255,255,0.09); }
.pill-warn { background: rgba(251,191,36,0.12); color: var(--app-warning); border: 1px solid rgba(251,191,36,0.2); }

.count-badge {
  padding: 4px 10px; border-radius: 999px;
  background: rgba(230, 230, 230,0.12);
  border: 1px solid rgba(230, 230, 230,0.2);
  color: var(--app-accent); font-size: 12px; font-weight: 700;
  align-self: flex-start; flex-shrink: 0;
}

.status-chip {
  padding: 3px 8px; border-radius: 999px;
  font-size: 11px; font-weight: 700;
}
.chip-ok { background: rgba(52,211,153,0.12); color: var(--app-success); }
.chip-off { background: rgba(255,255,255,0.06); color: var(--app-text-muted); }

.status-row {
  display: flex; align-items: flex-start; gap: 8px;
  padding: 10px 12px; border-radius: 10px; font-size: 13px; line-height: 1.5;
}
.row-ok { background: rgba(52,211,153,0.08); color: var(--app-success); border: 1px solid rgba(52,211,153,0.2); }
.row-warn { background: rgba(251,191,36,0.08); color: var(--app-warning); border: 1px solid rgba(251,191,36,0.2); }
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
.bmetric.ok span { color: var(--app-success); }
.bmetric.danger span { color: var(--app-danger); }

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
  background: linear-gradient(135deg, rgba(230, 230, 230,0.2), rgba(230, 230, 230,0.2));
  border: 1px solid rgba(230, 230, 230,0.3);
  color: var(--app-accent); font-size: 9.5px; font-weight: 800;
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
.relay-difficulty.easy { background: rgba(52,211,153,0.12); color: var(--app-success); border: 1px solid rgba(52,211,153,0.25); }
.relay-difficulty.medium { background: rgba(251,191,36,0.12); color: var(--app-warning); border: 1px solid rgba(251,191,36,0.25); }
.relay-difficulty.advanced { background: rgba(239,68,68,0.12); color: #f87171; border: 1px solid rgba(239,68,68,0.25); }
.relay-option-name { font-size: 14px; font-weight: 700; color: var(--app-text); }
.relay-option-desc { font-size: 13px; color: var(--app-text-muted); line-height: 1.55; margin: 0 0 12px; }
.code-block {
  font-family: monospace; font-size: 12px;
  background: var(--app-item-surface); border: 1px solid var(--app-border-strong);
  padding: 10px 14px; border-radius: 10px; color: var(--app-accent);
  word-break: break-all;
}

/* OS tab selector for relay commands */
.os-tabs {
  display: flex; gap: 4px; margin-bottom: 8px; margin-top: 10px;
}
.os-tab {
  padding: 4px 12px; border-radius: 999px; font-size: 11.5px; font-weight: 600;
  border: 1px solid var(--app-border-strong); background: rgba(255,255,255,0.03);
  color: rgba(255,255,255,0.45); cursor: pointer; transition: all 130ms;
  font-family: inherit;
}
.os-tab:hover { color: var(--app-text); background: rgba(255,255,255,0.07); }
.os-tab.active { background: rgba(230, 230, 230,0.15); border-color: rgba(230, 230, 230,0.4); color: var(--app-accent); }

.code-block-copy {
  display: flex; align-items: center; gap: 8px;
  background: var(--app-item-surface); border: 1px solid var(--app-border-strong);
  padding: 10px 14px; border-radius: 10px;
}
.code-text {
  flex: 1; font-family: monospace; font-size: 12px;
  color: var(--app-accent); word-break: break-all;
}
.copy-btn {
  flex-shrink: 0; background: rgba(255,255,255,0.06);
  border: 1px solid var(--app-border-strong); border-radius: 6px;
  color: var(--app-text-muted); font-size: 14px; cursor: pointer;
  padding: 3px 8px; transition: all 120ms; font-family: inherit;
}
.copy-btn:hover { background: rgba(230, 230, 230,0.15); color: var(--app-accent); }

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
  padding: 5px 10px; border-radius: 999px; border: 1px solid var(--app-border-strong);
  background: rgba(255,255,255,0.05); color: var(--app-text-muted);
  font-size: 12px; font-weight: 600; cursor: pointer;
  transition: all 160ms ease;
}
.pref-btn.active { background: rgba(230, 230, 230,0.15); color: var(--app-accent); border-color: rgba(230, 230, 230,0.3); }
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
import { formatUi, ui } from "../i18n";
import LanguagePicker from '../components/LanguagePicker.vue';
import { uncache } from '../utils/uncache';
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import { useNavStore } from '../stores/navStore';
import { useBitStore } from '../stores/bitStore';
import RestoreKeyForm from '../components/RestoreKeyForm.vue';
import RecoveryPhrasePanel from '../components/RecoveryPhrasePanel.vue';
import DeviceVaultPanel from '../components/DeviceVaultPanel.vue';
import NameRecoveryCard from '../components/NameRecoveryCard.vue';
import {
  isPushEnabled, setPushEnabled, initPushNotifications, unregisterPushNotifications,
} from '../native/pushNotifications';
import {
  getEmailNotificationAddress, registerEmailNotifications, unregisterEmailNotifications,
} from '../native/emailNotifications';
import DesktopPageShell from '../components/DesktopPageShell.vue';
import { IonPage, IonHeader, IonToolbar, IonTitle, IonContent, IonButtons, IonIcon, IonRange, alertController, toastController, onIonViewWillEnter } from '@ionic/vue';
import { peopleOutline, refreshOutline, downloadOutline, cloudUploadOutline, trashOutline, warningOutline, personCircleOutline, globeOutline, swapHorizontalOutline, serverOutline, copyOutline, eyeOutline, lockClosedOutline, shieldCheckmarkOutline, rocketOutline, keyOutline, colorPaletteOutline, analyticsOutline, layersOutline, cloudOutline, constructOutline, fingerPrintOutline, addCircleOutline, removeCircleOutline, arrowDownOutline, optionsOutline, informationCircleOutline, chatbubbleOutline, personOutline, notificationsOutline } from 'ionicons/icons';
import { PinningService } from '../services/pinningService';
import { StorageManager } from '../services/storageManager';
import { UserService } from '../services/userService';
import { VoteTrackerService } from '../services/voteTrackerService';
import { WebSocketService, type KnownServer } from '../services/websocketService';
import { GunService } from '../services/gunService';
import { BrowserRelayService, type BrowserRelayState } from '../services/browserRelayService';
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
import { ModerationService, MODERATION_API_DEFAULT_BASE_URL, type ModerationSettings } from '../services/moderationService';
import { getEnabledVersions, setEnabledVersions, probeForVersions, availableVersions, type DataVersion } from '../utils/dataVersionSettings';
import { GUN_NAMESPACE } from '../services/gunService';
import { useFeedPreferences } from '../composables/useFeedPreferences';
import type { FeedMode, FeedRankingWeights } from '../services/feedPreferencesService';
import { BUILD_HASH, BUILD_TIME } from '../utils/buildHash';
import UserIdentityBadge from '../components/UserIdentityBadge.vue';
import { GUN_RELAY_PRESETS, isValidGunUrl, labelForGunUrl, DEFAULT_GUN_PEERS } from '../services/gunRelayPresets';
import { appTheme, setTheme } from '../services/themeService';

const chainStore = useChainStore();
const communityStore = useCommunityStore();
const router = useRouter();
const bitStore = useBitStore();
const showRestore = ref(false);
// The old identity is gone from storage; reload so no in-memory state keeps using it.
function onIdentityRestored() { window.location.href = "/home"; }
function replayBitTour() { void router.push('/home').then(() => bitStore.replayTour()); }

// ── Bottom nav + notifications ─────────────────────────────────────────────
const navStore    = useNavStore();
const pushEnabled = ref(isPushEnabled());
const navTipMedia = typeof window === 'undefined' ? null : window.matchMedia('(max-width: 767px)');
const isMobileViewport = ref(navTipMedia?.matches ?? false);

function syncNavTipViewport(event?: MediaQueryListEvent) {
  isMobileViewport.value = event?.matches ?? navTipMedia?.matches ?? false;
}

/** Replay just the bottom-bar step of Bit's tour on the home feed. */
function replayNavTip() {
  if (!navStore.enabled || !isMobileViewport.value) return;
  void router.push('/home').then(() => window.setTimeout(() => bitStore.startNavTour(), 400));
}

async function togglePush(on: boolean) {
  setPushEnabled(on);
  pushEnabled.value = on;
  if (on) await initPushNotifications();
  else    await unregisterPushNotifications();
}

// ── Email fallback (Resend, relay-side) ────────────────────────────────────
const emailNotifyAddress    = ref(getEmailNotificationAddress());
const emailNotifyRegistered = ref(Boolean(getEmailNotificationAddress()));
const emailNotifyBusy       = ref(false);
const emailNotifyStatus     = ref('');
const emailNotifyError      = ref(false);

function reportEmailNotify(message: string, isError: boolean) {
  emailNotifyStatus.value = message;
  emailNotifyError.value  = isError;
}

async function saveEmailNotifications() {
  emailNotifyBusy.value = true;
  try {
    const result = await registerEmailNotifications(emailNotifyAddress.value);
    emailNotifyRegistered.value = result.ok;
    reportEmailNotify(
      result.ok ? 'Saved — the relay will email this address.' : result.error || 'Could not save.',
      !result.ok,
    );
  } finally {
    emailNotifyBusy.value = false;
  }
}

async function clearEmailNotifications() {
  emailNotifyBusy.value = true;
  try {
    const result = await unregisterEmailNotifications();
    if (result.ok) {
      emailNotifyAddress.value    = '';
      emailNotifyRegistered.value = false;
    }
    reportEmailNotify(
      result.ok ? 'Turned off — the relay has dropped your address.' : result.error || 'Could not turn off.',
      !result.ok,
    );
  } finally {
    emailNotifyBusy.value = false;
  }
}
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

const isDarkMode = computed(() => appTheme.value === 'dark');
function onThemeChange(event: Event) {
  setTheme((event.target as HTMLInputElement).checked ? 'dark' : 'light');
}
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



function initVersionToggles() {
  const enabled = getEnabledVersions();
  const toggles: Record<string, boolean> = {};
  for (const v of availableVersions.value) {
    toggles[v] = enabled.includes(v);
  }
  versionToggles.value = toggles;
}



// Called by the plain checkbox in the template: flip this version's flag.
function toggleVersion(ver: string) {
  versionToggles.value = { ...versionToggles.value, [ver]: !versionToggles.value[ver] };
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
    message: formatUi("Showing {p0} posts — reload to apply", { p0: actual.join(' + ') }),
    duration: 2000,
    color: 'success',
  });
  await toast.present();
}

function onFeedModeChange(ev: { detail: { value: string } }) {
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

function onFeedPostsToggle(ev: Event) {
  const checked = (ev.target as HTMLInputElement).checked;
  setContentTypeVisibility(checked, feedPreferences.value.showPolls);
}

function onFeedPollsToggle(ev: Event) {
  const checked = (ev.target as HTMLInputElement).checked;
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
    header: ui("Reset feed preferences?"),
    message: ui("This will reset keywords, community preferences, and ranking weights."),
    buttons: [
      { text: ui("Cancel"), role: 'cancel' },
      {
        text: ui("Reset"),
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



const moderationApiKeyInput = ref('');
const moderationAuthMessage = ref('Not authenticated.');
const moderationDefaultApiUrl = MODERATION_API_DEFAULT_BASE_URL;





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











async function resetModerationDefaults() {
  const defaults = ModerationService.getDefaultSettings();
  ModerationService.saveSettings(defaults);
  modSettings.value = ModerationService.getSettings();
  moderationApiKeyInput.value = '';
  moderationAuthMessage.value = 'Not authenticated.';
  const toast = await toastController.create({
    message: ui("Moderation settings reset to defaults"),
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
    message: ui("Moderation API authentication cleared"),
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





const peerList = ref<Array<{ peerId: string; relayUrl: string; gunPeers: string[]; joinedAt: number }>>([]);
const myPeerId = ref('');
const knownServers = ref<KnownServer[]>([]);

const generatedBootstrapInvite = ref('');

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
    const toast = await toastController.create({ message: ui("Invalid Gun relay URL"), duration: 2000, color: 'warning' });
    await toast.present();
    return;
  }
  const current = config.getGunPeers();
  if (current.includes(trimmed)) {
    const toast = await toastController.create({ message: ui("Relay already in list"), duration: 1800, color: 'medium' });
    await toast.present();
    return;
  }
  const updated = [...current, trimmed];
  config.setGunPeers(updated);
  GunService.addPeerDynamic(trimmed);
  refreshGunPeers();
  const toast = await toastController.create({ message: formatUi("Added {p0}", { p0: labelForGunUrl(trimmed) }), duration: 2000, color: 'success' });
  await toast.present();
}

async function removeGunPeer(url: string) {
  const current = config.getGunPeers();
  if (current.length <= 1) {
    const toast = await toastController.create({ message: ui("Cannot remove last Gun relay"), duration: 2000, color: 'warning' });
    await toast.present();
    return;
  }
  const updated = current.filter(u => u !== url);
  config.setGunPeers(updated);
  GunService.reconnect(updated);
  refreshGunPeers();
  const toast = await toastController.create({ message: ui("Relay removed"), duration: 1600, color: 'medium' });
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
  const toast = await toastController.create({ message: ui("Gun peers reset to defaults"), duration: 2000, color: 'success' });
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

// ── Relay setup OS selector ────────────────────────────────────────────────
const homeOs  = ref('Linux / Pi');
const vpsOs   = ref('Linux (bash)');
const copied  = ref<'home' | 'vps' | 'tab' | null>(null);

const HOME_CMDS: Record<string, string> = {
  'Linux / Pi': 'curl -sSL https://interpoll.endless.social/install.sh | bash',
  'macOS':      'curl -sSL https://interpoll.endless.social/install.sh | bash',
  'Windows':    "irm https://interpoll.endless.social/install.ps1 | iex",
};
// vps.sh runs on the (Linux) server either way; the tab only reflects the shell you SSH from.
const VPS_CMDS: Record<string, string> = {
  'Linux (bash)': 'curl -sSL https://interpoll.endless.social/vps.sh | sudo bash -s yourdomain.com',
  'macOS (zsh)':  'curl -sSL https://interpoll.endless.social/vps.sh | sudo bash -s yourdomain.com',
};
const homeCmd = computed(() => HOME_CMDS[homeOs.value] ?? HOME_CMDS['Linux / Pi']);
const vpsCmd  = computed(() => VPS_CMDS[vpsOs.value]  ?? VPS_CMDS['Linux (bash)']);

// ── Browser-tab relay ──────────────────────────────────────────────────────
const browserRelay = ref<BrowserRelayState>(BrowserRelayService.getState());
const browserRelayStarting = ref(false);
const unsubBrowserRelay = BrowserRelayService.onChange((s) => { browserRelay.value = s; });
onUnmounted(unsubBrowserRelay);
void BrowserRelayService.restoreIfNeeded();

async function startBrowserRelay() {
  browserRelayStarting.value = true;
  try { await BrowserRelayService.start(); } catch { /* error shown from state */ }
  finally { browserRelayStarting.value = false; }
}
function stopBrowserRelay() { BrowserRelayService.stop(); }

function copyText(text: string, which: 'home' | 'vps' | 'tab') {
  navigator.clipboard.writeText(text).then(() => {
    copied.value = which;
    setTimeout(() => { copied.value = null; }, 1800);
  }).catch(() => {
    // Fallback for browsers without clipboard API
    const ta = document.createElement('textarea');
    ta.value = text; document.body.appendChild(ta);
    ta.select(); document.execCommand('copy');
    document.body.removeChild(ta);
    copied.value = which;
    setTimeout(() => { copied.value = null; }, 1800);
  });
}

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
      message: ui("Anonymity Mode off — peer mesh re-enabled."),
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
        : 'This browser is NOT on Tor. Open Echo in Tor Browser to be anonymous.',
    };
  } catch {
    // CORS-blocked or offline — cannot read the result. Do not overclaim.
    torStatus.value = {
      checked: true,
      isTor: null,
      note: 'Could not verify automatically. Make sure you opened Echo in Tor Browser.',
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





function shortenUrl(url: string): string {
  try {
    const u = new URL(url);
    return u.host;
  } catch {
    return url;
  }
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
    note: 'Echo relay bootstrap',
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
      message: ui("Bootstrap invite copied"),
      duration: 1600,
      color: 'success',
    });
    await toast.present();
  } catch {
    const toast = await toastController.create({
      message: ui("Clipboard unavailable"),
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



async function discoverBootstrapFromGun() {
  bootstrapDiscovering.value = true;
  try {
    const discovered = await BootstrapInviteService.discoverFromGun();
    if (discovered.length === 0) {
      const toast = await toastController.create({
        message: ui("No Gun bootstrap endpoints discovered"),
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
      message: formatUi("Discovered and seeded {p0} endpoint(s) from Gun", { p0: discovered.length }),
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
        message: ui("Candidate endpoints are offline. Switch aborted."),
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
      message: ui("All relay fields are required"),
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
    message: ui("Relay configuration updated, reconnecting..."),
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
    message: ui("Relay reset to defaults, reconnecting..."),
    duration: 2000,
    color: 'success'
  });
  await toast.present();

  refreshNetwork();
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
      message: ui("Public key copied"),
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
      message: ui("Private key copied — keep it safe!"),
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
  syncNavTipViewport();
  navTipMedia?.addEventListener('change', syncNavTipViewport);
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
  navTipMedia?.removeEventListener('change', syncNavTipViewport);
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
    message: ui("Policy saved"),
    duration: 1500,
    color: 'success'
  });
  await toast.present();
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
      message: ui("Data exported successfully"),
      duration: 2000,
      color: 'success'
    });
    await toast.present();
  } catch (_error) {
    const toast = await toastController.create({
      message: ui("Export failed"),
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
      message: ui("Data imported successfully"),
      duration: 2000,
      color: 'success'
    });
    await toast.present();

    await refreshStorageStats();
  } catch (_error) {
    const toast = await toastController.create({
      message: ui("Import failed"),
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
    header: ui("Clean Up Storage"),
    message: ui("This will remove old cached content. Your posts and important data will be kept."),
    buttons: [
      { text: ui("Cancel"), role: 'cancel' },
      {
        text: ui("Clean Up"),
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
    header: ui("Clear All Data"),
    message: ui("This will delete EVERYTHING from local storage. This cannot be undone!"),
    buttons: [
      { text: ui("Cancel"), role: 'cancel' },
      {
        text: ui("Clear All"),
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
