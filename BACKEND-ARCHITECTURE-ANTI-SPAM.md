# InterPoll Backend Architecture Analysis
## Anti-Spam, Rate Limiting, and Bot Detection Implementation Guide

---

## EXECUTIVE SUMMARY

InterPoll is a **decentralized P2P polling platform** with three core processes:

1. **relay-server.js** (WebSocket relay, port 8080)
2. **gun-relay-server/gun-relay.js** (GunDB relay, port 8765)
3. **peer.js** (Optional headless node)

**Current Status**: The system now has **multi-layered anti-spam protection** across both relay servers. Four dedicated backend modules were implemented and integrated into `relay-server.js`, and a propagation throttle was added to `gun-relay.js`. Client-side proof-of-work is required for all content messages.

### Implemented Anti-Spam Modules

| Module | File | Purpose |
|--------|------|---------|
| `RateLimiter` | `rate-limiter.js` | Progressive rate limiting: per-IP HTTP (30 req/min), per-peer WS (60 msg/min), escalating penalties (2s → 8s → 30s → 2min → 5min ban), automatic violation decay |
| `BotDetector` | `bot-detector.js` | Behavioral bot analysis: 5-signal scoring (interval variance, burst rate, content diversity, session rate, registration timing), 0–100 score, 4 action tiers |
| `SpamScorer` | `spam-scorer.js` | Multi-language content scoring: 25+ languages via `naughty-words`, leetspeak/homoglyph normalization, soft flag only (≥3 matches), does **not** ban |
| `PowChallenge` | `pow-challenge.js` | Server-side PoW challenge manager: hashcash-style, adaptive difficulty (12–24 bits based on bot score + spam penalty + device trust), 60s TTL, single-use tokens, required for all content messages (`broadcast`, `new-poll`, `new-block`) |

**Client-side counterpart**: `PowService` (`src/services/powService.ts`) requests challenges via WebSocket, solves them with async SHA-256 mining (event-loop yielding to avoid UI freeze), and attaches `{ challengeId, nonce }` proofs automatically via `WebSocketService.broadcast()`.

### Legacy protections (still active)
- Device fingerprinting (client-side, IndexedDB)
- Backend vote registry (in-memory `pollId:deviceId` pairs)
- OAuth optional gating
- Client-side word content filtering

---

## 1. RELAY-SERVER.JS — WebSocket Relay (Port 8080)

**File**: `/home/viktor/Documents/interpoll2/decentralised/relay-server.js` (658 lines)

### 1.1 Message Types & WebSocket Handlers

**Lines 600-658**: Main message handling in `wss.on('connection', ...)` → `ws.on('message', ...)`

#### Message Types:

| Type | Handler | Purpose | Rate Limit |
|------|---------|---------|-----------|
| `ping` | Line 611 | Keep-alive heartbeat | None |
| `register` | Line 619 | Peer registration (broadcasts to all) | None |
| `join-room` | Line 634 | Join named room | None |
| `broadcast` | Line 641 | Send message to all other peers, cached | None |
| `direct` | Line 649 | Send to specific peer | None |
| `chatroom-message` | Line 657 | Encrypted relay (opaque blob forward) | None |
| `new-poll`, `new-block`, `request-sync`, `sync-response` | Line 666 | Direct peer-to-peer broadcast | None |

### 1.2 Existing Rate Limiting & Spam Protection

**None at relay level.** Only protections:

1. **Vote Registry** (Lines 20-22, 437-455):
   - In-memory `Set<string>` keyed by `pollId:deviceId`
   - **CRITICAL**: In-memory only — lost on restart
   - **Location**: `/api/vote-authorize` POST handler (lines 420-462)
   - Prevents double-voting from same device on same poll
   - Logs to `storage.txt` for audit

2. **Message Caching** (Lines 27-60):
   - Last 500 messages cached on disk (`message-cache.json`)
   - Replayed to new peers (lines 592-599)
   - No deduplication or spam filtering

### 1.3 HTTP API Endpoints

| Method | Path | Purpose | Lines |
|--------|------|---------|-------|
| GET | `/auth/google/start` | Initiate Google OAuth | 206-229 |
| GET | `/auth/google/callback` | Google OAuth callback | 232-309 |
| GET | `/auth/microsoft/start` | Microsoft OAuth start | 316-340 |
| GET | `/auth/microsoft/callback` | Microsoft OAuth callback | 344-392 |
| GET | `/api/me` | Get current user session | 395-400 |
| POST | `/auth/logout` | Logout, clear session | 403-417 |
| POST | `/api/vote-authorize` | Check if device can vote | **420-462** |
| POST | `/api/receipts` | Log receipt/audit event | **465-490** |

### 1.4 Authentication Mechanisms

**OAuth Integration** (Lines 206-392):
- Google OAuth 2.0 (client_id, client_secret from env vars)
- Microsoft OAuth (tenant from env vars)
- Session stored in memory via `sessions.set(sessionId, user)`
- Cookie: `sessionId=<hex>; HttpOnly; Path=/; SameSite=Lax`
- **CRITICAL**: Sessions lost on restart

**Device Fingerprint** (client-side only, see voteTrackerService.ts)

### 1.5 Vote Authorization Flow

```
Client POST /api/vote-authorize {pollId, deviceId}
  ↓
Server checks voteRegistry for "pollId:deviceId"
  ↓
If NOT found: Add to voteRegistry, return {allowed: true}
If found: Return {allowed: false, reason: 'already voted'}
  ↓
Log entry appended to storage.txt
```

**Problems for spam/rate limiting**:
- No IP-based rate limiting
- No CAPTCHA before authorization
- In-memory registry = no persistence across restarts
- No tracking of "authorization attempts" vs "successful votes"

---

## 2. GUN-RELAY-SERVER DIRECTORY

**Files**:
- `/home/viktor/Documents/interpoll2/decentralised/gun-relay-server/gun-relay.js` (161 lines)
- `/home/viktor/Documents/interpoll2/decentralised/gun-relay-server/copilot-gun-relay-server.md`
- `/home/viktor/Documents/interpoll2/decentralised/gun-relay-server/package.json`

### 2.1 GunDB Relay Implementation

**gun-relay.js** (Lines 1-161):

```javascript
// Express + Gun.js
const app = express();
app.use(cors());         // Allow all origins
app.use(Gun.serve);      // Serve Gun.js library
const gun = Gun({
  web: server,
  radisk: true,          // Persist to disk
  localStorage: false,
  multicast: false       // No automatic peer discovery
});
```

**Endpoints**:
- `GET /` — Health page (lines 40-130)
- `GET /health` — JSON health check (lines 30-37)
- WebSocket endpoint (implicit via Gun.serve)

**No endpoints for rate limiting, authentication, or CAPTCHA.**

### 2.2 Data Persistence & Namespace

- All data under namespace `v2` (see gunService.ts)
- Persisted to `gun-relay-server/radata/` (gitignored)
- Collections: `polls`, `communities`, `posts`, `comments`, `users`, `events`, `chatrooms`
- **No spam filtering at GUN relay level**

### 2.3 No Existing Spam/Rate Limiting

- Gun.js automatically replicates data from all peers
- No validation of content
- No CAPTCHA requirement
- No rate limiting on `.put()` or `.on()` operations

---

## 3. PEER.JS — Headless Peer Node (Opt-in)

**File**: `/home/viktor/Documents/interpoll2/decentralised/peer.js` (418 lines)

### 3.1 Purpose & Architecture

- Stays online 24/7 to ensure data availability
- Connects to relay-server (WebSocket) and gun-relay-server (GunDB)
- Stores all blocks, events, polls, posts, communities it sees
- Serves as "seeding" node for new clients

### 3.2 Data Storage

Persistent JSON files in `peer-data/` directory:
- `blocks.json` — All blockchain blocks (limit: 10K)
- `events.json` — Nostr-style events (limit: 5K)
- `known-servers.json` — Server list
- `gun-data/` — GUN radisk folder

### 3.3 Message Handling (Lines 239-300+)

```javascript
switch (type) {
  case 'new-poll':
  case 'new-block':
  case 'request-sync':
  case 'sync-response':
  case 'chatroom-message':
    // Store or relay
}
```

**No spam filtering, rate limiting, or bot detection.**

### 3.4 Stats Tracked

```javascript
const stats = {
  blocksStored: 0,
  eventsStored: 0,
  pollsSeen: 0,
  syncRequests: 0,
  messagesIn: 0,
  chatroomMessages: 0,
  gunUpdates: 0,
  connected: false,
  startedAt: Date.now()
};
```

---

## 4. CLIENT-SIDE SERVICES ARCHITECTURE

### 4.1 WebSocketService (`src/services/websocketService.ts`, 441 lines)

**Purpose**: Client ↔ relay-server WebSocket connection

**Key Methods**:
- `initialize()` — Connect to relay, load known servers
- `connect(wsUrl?)` — Establish/reconnect with exponential backoff
- `broadcast(type, data)` — Send message to all peers
- `subscribe(type, callback)` — Listen for message type
- `broadcastChatRoomMessage(roomId, data)` — Send encrypted chat
- `subscribeToChatRoom(roomId, callback)` — Listen to chat room

**Message Queue** (Line 29):
- Messages queued if disconnected
- Flushed on reconnect

**Reconnection** (Lines 179-186):
- Exponential backoff: delay = min(baseReconnectDelay × 2^attempts, 30s)
- Infinite retry attempts

**No rate limiting on sending.**

### 4.2 GunService (`src/services/gunService.ts`, 143 lines)

**Purpose**: Client GunDB wrapper with v2 namespace proxy

**Key Points**:
- Initializes Gun with relay: `Gun({ peers: [gunURL] })`
- All roots (posts, polls, communities, users, comments, events, chatrooms) transparently under `v2` namespace
- Throttled map operations (lines 121-139) to prevent "1K+ records/sec" DOM warning
- **No rate limiting on read/write operations**

### 4.3 VoteTrackerService (`src/services/voteTrackerService.ts`, ~95 lines)

**Purpose**: Device fingerprint + vote deduplication

**Device Fingerprint** (Lines 14-45):
```javascript
const fingerprint = {
  userAgent: navigator.userAgent,
  language: navigator.language,
  platform: navigator.platform,
  screenResolution: `${screen.width}x${screen.height}`,
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  canvasFingerprint: canvas.toDataURL(),  // Canvas fingerprinting
  timestamp: Date.now()
};
```
- Hashed with SHA-256
- Stored in IndexedDB `metadata` store as `'device-id'`

**Vote Tracking** (Lines 60-77):
- Stores vote records in IndexedDB metadata store
- `hasVoted(pollId)` checks if device voted
- `recordVote(pollId, blockIndex)` logs vote

**PROBLEMS**:
- Canvas fingerprinting can be spoofed/cleared
- No backend verification
- No rate limiting on vote attempts

### 4.4 PollService (`src/services/pollService.ts`, 487 lines)

**Vote Flow** (Lines 398-425):

```typescript
async vote(pollId, optionIds, voterId) {
  const poll = await this.loadPoll(pollId);
  // Check expiry, validity
  for (const option of selectedOptions) {
    if (!option.voters.includes(voterId)) {
      // Increment votes
      await this.putPromise(..., { votes: newVotes, voters: [...voters, voterId] });
    }
  }
}
```

**ISSUES**:
- No check if voterId is unique/verified
- No rate limiting per user
- No spam detection
- `voters` array stored in plaintext in GunDB

### 4.5 ModerationService (`src/services/moderationService.ts`, 280 lines)

**Purpose**: Client-side content word filtering

**Features**:
- Default word list (profanity, slurs, sexual, threats, spam, drugs)
- Custom blocked/allowed words
- Settings in localStorage `moderation_settings`
- Filter actions: `blur`, `hide`, `flag`

**Word Filter Logic** (Lines 175-209):
```typescript
static checkContent(text: string): FilterResult {
  if (!this.getSettings().wordFilterEnabled) return { flagged: false, ... };
  
  const regex = this.getRegex();
  const matches = findMatches(text, regex);
  
  return { flagged: matches.length > 0, matches, severity: maxSeverity };
}
```

**CRITICAL LIMITATIONS**:
- Client-side only (easily bypassed)
- No backend enforcement
- Regex-based (word boundaries) — easily circumvented with leetspeak/spaces
- No spam scoring
- No rate limiting

### 4.6 ChainService (`src/services/chainService.ts`, 220 lines)

**Purpose**: Blockchain block creation, signing, validation

**Block Structure** (Lines 11-31):
```typescript
interface ChainBlock {
  index: number;
  timestamp: number;
  previousHash: string;
  voteHash: string;
  signature: string;        // Schnorr signature
  currentHash: string;
  nonce: number;
  pubkey?: string;          // Signer's public key (hex)
  eventId?: string;
  actionType?: ActionType;  // 'vote' | 'community-create' | 'post-create'
  actionLabel?: string;
}
```

**No rate limiting on block creation.**

---

## 5. ActionType Enum (`src/types/chain.ts`)

```typescript
export type ActionType = 'vote' | 'community-create' | 'post-create';
```

**Can add more types** by extending this enum.

---

## 6. PACKAGE.JSON DEPENDENCIES

**Main dependencies** (`/home/viktor/Documents/interpoll2/decentralised/package.json`):

```json
{
  "dependencies": {
    "gun": "^0.2020.1241",
    "ws": "^8.19.0",
    "@noble/curves": "^2.0.1",
    "@noble/hashes": "^1.3.3",
    "@tensorflow/tfjs": "^4.22.0",
    "bip39": "^3.1.0",
    "idb": "^8.0.0",
    "pinia": "^2.1.7",
    "vue": "^3.4.0"
  }
}
```

**Gun-relay dependencies** (`gun-relay-server/package.json`):
```json
{
  "dependencies": {
    "gun": "^0.2020.1240",
    "express": "^4.18.2",
    "cors": "^2.8.5"
  }
}
```

**MISSING packages** for rate limiting / anti-spam:
- `express-rate-limit`
- `helmet` (security headers)
- `express-slow-down`
- `redis` (distributed rate limiting)
- `hcaptcha` or `recaptcha` (bot detection)

---

## 7. RECOMMENDED INTEGRATION POINTS FOR ANTI-SPAM/RATE LIMITING

### 7.1 Relay-Server (Priority: HIGH)

| Endpoint | Current Status | Action |
|----------|---|---|
| `/api/vote-authorize` | In-memory registry, no IP limits | Add: Express rate-limit, IP tracking, CAPTCHA requirement |
| `/api/receipts` | No validation | Add: Rate-limit per IP, size limits |
| WebSocket connect | No limits | Add: Connection rate limit per IP |
| `broadcast` message | No spam checks | Add: Message size limits, content filtering, frequency limits |

### 7.2 GUN Relay (Priority: MEDIUM)

| Operation | Current Status | Action |
|-----------|---|---|
| `.put()` | No validation | Add: Middleware to check: content size, rate limit, CAPTCHA |
| `.on()` | No limits | Add: Connection limits per IP |
| GUN routes | No auth | Add: Optional authentication for trusted peers |

### 7.3 Peer.js (Priority: MEDIUM)

| Operation | Current Status | Action |
|-----------|---|---|
| WebSocket connect | No IP limits | Add: IP-based connection rate limiting |
| Message relay | No validation | Add: Content validation, size limits |
| Block storage | Unlimited | Add: Storage quotas, validation |

### 7.4 Client-Side Services (Priority: HIGH)

| Service | Current Status | Action |
|---------|---|---|
| VoteTrackerService | Canvas fingerprint | Add: Backend verification, server-side device tracking |
| PollService.vote() | No rate limit | Add: Request throttling, backend validation |
| WebSocketService | No upload limits | Add: Message size limits, frequency checks |

---

## 8. WHERE TO ADD RATE LIMITING

### 8.1 Express Middleware (relay-server.js)

**Add at line ~175** (before route handlers):

```javascript
import rateLimit from 'express-rate-limit';

const voteAuthLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,                  // 100 requests per window
  keyGenerator: (req) => req.socket.remoteAddress, // Per IP
  skip: (req) => isInternal(req), // Skip localhost
});

const pollCreateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 50,                   // 50 polls per hour per IP
});

app.post('/api/vote-authorize', voteAuthLimiter, (req, res) => {
  // ... existing code
});
```

### 8.2 Vote Authorization With CAPTCHA

**Modify `/api/vote-authorize` handler** (lines 420-462):

```javascript
if (req.method === 'POST' && url.pathname === '/api/vote-authorize') {
  // 1. Rate limit check (handled by middleware)
  // 2. Extract captcha token
  const captchaToken = data.captchaToken;
  
  // 3. Verify captcha (hCaptcha or reCAPTCHA)
  const captchaValid = await verifyCaptcha(captchaToken);
  if (!captchaValid) {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ allowed: false, reason: 'captcha failed' }));
    return;
  }
  
  // 4. Check vote registry (existing)
  const alreadyVoted = voteRegistry.has(key);
  
  // 5. Log and respond
  ...
}
```

### 8.3 WebSocket Connection Rate Limiting

**Modify `wss.on('connection', ...)` handler** (line 605):

```javascript
wss.on('connection', (ws, req) => {
  const clientIp = req.socket.remoteAddress;
  
  // Check connection rate per IP
  if (!connectionTracker.canConnect(clientIp)) {
    ws.close(1008, 'Too many connections from this IP');
    return;
  }
  
  connectionTracker.recordConnection(clientIp);
  
  // ... rest of handler
});
```

### 8.4 Message Broadcasting Rate Limits

**Modify `broadcast` case** (line 641):

```javascript
case 'broadcast':
  // Rate limit per peer
  if (!messageRateLimiter.allow(peerId, data.data?.type)) {
    console.log(`Rate limit exceeded for peer ${peerId}`);
    break;
  }
  
  // Content filtering
  const filtered = ContentFilterService.filter(data.data);
  if (filtered.flagged) {
    auditService.log('spam-flag', { peerId, data, severity: filtered.severity });
    break;
  }
  
  // Size limit
  if (JSON.stringify(data).length > MAX_MESSAGE_SIZE) {
    break;
  }
  
  broadcastToOthers(peerId, data.data);
  cacheMessage(data.data);
  break;
```

---

## 9. WHERE TO ADD SPAM DETECTION

### 9.1 Content Filtering Service (New)

**Create: `/src/services/spamDetectionService.ts`**

```typescript
export class SpamDetectionService {
  // Check for common spam patterns
  static analyzeContent(text: string): SpamAnalysis {
    return {
      spamScore: 0.0,          // 0-1 confidence
      patterns: [],
      isSpam: false
    };
  }
  
  // Check for rate-based spam (many posts in short time)
  static isUserSpamming(userId: string, recentPostCount: number): boolean {
    return recentPostCount > THRESHOLD_PER_MINUTE;
  }
  
  // Check for duplicate/similar content
  static isDuplicateContent(content: string, recentContent: string[]): boolean {
    // Similarity scoring
  }
  
  // Check for suspicious patterns
  static hasSpamIndicators(content: string): string[] {
    const indicators = [];
    if (/\b(free|click|buy|deposit)\b/i.test(content)) indicators.push('sales-terms');
    if (/https?:\/\/\S+/g.test(content)) indicators.push('url-density');
    if (/(!!!|\?\?\?|\.\.\.|🎉+)/g.test(content)) indicators.push('suspicious-punctuation');
    return indicators;
  }
}
```

### 9.2 Backend Integration Points

**In relay-server.js**, add spam checks:

1. **Before caching messages** (line 48):
   ```javascript
   if (SpamDetectionService.analyzeContent(msg).isSpam) return;
   ```

2. **Before vote authorization** (line 420):
   ```javascript
   if (isSpamming(deviceId)) {
     res.end(JSON.stringify({ allowed: false, reason: 'rate limit exceeded' }));
     return;
   }
   ```

3. **In peer.js message handling** (line 250+):
   ```javascript
   if (SpamDetectionService.analyzeContent(data).isSpam) {
     stats.spamBlocked++;
     return;
   }
   ```

---

## 10. WHERE TO ADD CAPTCHA

### 10.1 hCaptcha Integration (Recommended)

**Why hCaptcha**: Privacy-focused, GDPR-compliant

**Backend verification in relay-server.js**:

```javascript
async function verifyHCaptcha(token) {
  try {
    const response = await fetch('https://hcaptcha.com/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `secret=${HCAPTCHA_SECRET}&response=${token}`
    });
    const result = await response.json();
    return result.success && result.score > 0.5;
  } catch (err) {
    console.error('hCaptcha verification failed:', err);
    return false;
  }
}
```

**Add to environment** (`relay-server.js` top):
```javascript
const HCAPTCHA_SECRET = process.env.HCAPTCHA_SECRET || '';
const HCAPTCHA_SITE_KEY = process.env.HCAPTCHA_SITE_KEY || '';
```

**Client-side** (Vue component):
```vue
<script setup>
import { ref } from 'vue';

const captchaToken = ref('');

async function onCaptchaVerify(token) {
  captchaToken.value = token;
}

async function submitVote() {
  const response = await fetch('/api/vote-authorize', {
    method: 'POST',
    body: JSON.stringify({
      pollId: props.pollId,
      deviceId: await VoteTrackerService.getDeviceId(),
      captchaToken: captchaToken.value
    })
  });
}
</script>

<template>
  <iframe
    src="https://hcaptcha.com/..."
    @load="onCaptchaVerify"
  />
</template>
```

### 10.2 Trigger Points for CAPTCHA

1. **First vote in poll**: Always require
2. **Multiple vote attempts** (>3 in 1 hour): Require
3. **Suspicious user agent/IP**: Require
4. **High spam score content**: Require

---

## 11. DATABASE SCHEMA FOR PERSISTENT RATE LIMITING

### 11.1 IndexedDB Schema (Client-Side)

**New stores** in `StorageService`:

```typescript
// Rate limit tracking
interface RateLimitRecord {
  type: 'vote-attempt' | 'post-create' | 'comment-create';
  timestamp: number;
  deviceId: string;
  pollId?: string;
  resultCode: 'allowed' | 'blocked' | 'captcha-required';
}

// Spam flags
interface SpamFlag {
  contentId: string;
  type: 'poll' | 'post' | 'comment';
  score: number;
  reason: string;
  timestamp: number;
  userReports: number;
}
```

### 11.2 Relay Server Persistence

**Suggested**: Use SQLite or PostgreSQL to store:

```sql
-- Rate limit attempts (persistent across restarts)
CREATE TABLE rate_limits (
  id UUID PRIMARY KEY,
  ip_address VARCHAR(45),
  endpoint VARCHAR(255),
  attempt_count INT,
  window_start TIMESTAMP,
  window_end TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Vote authorizations (audit trail)
CREATE TABLE vote_authorizations (
  id UUID PRIMARY KEY,
  poll_id VARCHAR(255),
  device_id VARCHAR(255),
  ip_address VARCHAR(45),
  authorized BOOLEAN,
  reason VARCHAR(255),
  captcha_required BOOLEAN,
  captcha_score FLOAT,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(poll_id, device_id)
);

-- Spam detections
CREATE TABLE spam_flags (
  id UUID PRIMARY KEY,
  content_id VARCHAR(255),
  content_type ENUM('poll', 'post', 'comment'),
  spam_score FLOAT,
  indicators TEXT,
  flagged_by VARCHAR(255),
  created_at TIMESTAMP DEFAULT NOW()
);
```

---

## 12. IMPLEMENTATION ROADMAP

### Phase 1: Basic Rate Limiting (Week 1-2)

- [x] Install `express-rate-limit`, `helmet`
- [ ] Add IP-based rate limiting to `/api/vote-authorize`
- [ ] Add request size limits
- [ ] Add connection rate limits to WebSocket

**Files to modify**:
- `relay-server.js`: Import middleware, add limiters

### Phase 2: Vote Protection (Week 2-3)

- [ ] Integrate hCaptcha
- [ ] Require CAPTCHA on first vote
- [ ] Verify device fingerprint server-side
- [ ] Persist vote registry to database

**Files to modify**:
- `relay-server.js`: Add captcha verification
- `src/services/voteTrackerService.ts`: Add backend sync
- Database schema creation

### Phase 3: Content Filtering (Week 3-4)

- [ ] Create `SpamDetectionService`
- [ ] Add pattern detection (URLs, repeated chars, etc.)
- [ ] Integrate client & server-side filtering
- [ ] Add content score to block

**Files to create/modify**:
- `src/services/spamDetectionService.ts` (new)
- `relay-server.js`: Check spam before relay
- `peer.js`: Filter incoming content

### Phase 4: Distributed Rate Limiting (Week 4-5)

- [ ] Set up Redis for distributed state
- [ ] Implement Redis rate limit store
- [ ] Sync rate limit data across peers
- [ ] Add admin dashboard for viewing limits

**Files to create/modify**:
- `relay-server.js`: Redis integration
- New API endpoints for admin

### Phase 5: Advanced Bot Detection (Week 5-6)

- [ ] Implement ML-based bot detection (TensorFlow.js)
- [ ] Analyze voting patterns (too-fast votes, coordinated IPs)
- [ ] Score user reputation
- [ ] Shadow-ban suspicious accounts

**Files to create/modify**:
- `src/services/botDetectionService.ts` (new)
- Blockchain tagging system
- Admin interface

---

## 13. CRITICAL ISSUES & RECOMMENDATIONS

### BLOCKING ISSUES

1. **In-Memory Vote Registry Resets on Restart**
   - **Risk**: High — allows vote replay attacks
   - **Fix**: Persist to SQLite/PostgreSQL
   - **Timeline**: Week 1

2. **No IP Tracking**
   - **Risk**: High — no way to detect mass voting from same IP
   - **Fix**: Extract IP from `req.socket.remoteAddress` in all endpoints
   - **Timeline**: Week 1

3. **No CAPTCHA**
   - **Risk**: Critical — fully bot-accessible
   - **Fix**: Integrate hCaptcha
   - **Timeline**: Week 2

### HIGH PRIORITY

4. **Client-Side Device Fingerprint Only**
   - **Risk**: High — canvas fingerprinting is spoofable
   - **Fix**: Server-side verification + additional factors (HTTP headers, TLS fingerprint)
   - **Timeline**: Week 2-3

5. **Content Filtering Client-Side**
   - **Risk**: High — easily bypassed
   - **Fix**: Server-side validation in relay & peer
   - **Timeline**: Week 3

### MEDIUM PRIORITY

6. **No Logging/Audit Trail**
   - **Risk**: Medium — no way to trace attacks
   - **Fix**: Log all rate limit events, spam flags, vote attempts to database
   - **Timeline**: Week 2

7. **OAuth State Storage In-Memory**
   - **Risk**: Medium — lost on restart
   - **Fix**: Store in database with TTL
   - **Timeline**: Week 1

---

## 14. SECURITY HEADERS & BEST PRACTICES

### Add to relay-server.js (line ~175):

```javascript
import helmet from 'helmet';

app.use(helmet());
app.use(helmet.contentSecurityPolicy({
  directives: {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'", "'unsafe-inline'"],
    imgSrc: ["'self'", 'data:', 'https:'],
  }
}));
app.use(helmet.hsts({ maxAge: 31536000, includeSubDomains: true }));

// CORS hardening
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:5173'],
  credentials: true,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
```

---

## 15. MONITORING & ALERTING

### Metrics to Track

```javascript
// In relay-server.js
const metrics = {
  rateLimit: {
    votesAuthorized: 0,
    votesRejected: 0,
    captchaRequired: 0,
    captchaPassed: 0,
    captchaFailed: 0,
  },
  spam: {
    messagesScanned: 0,
    messagesBlocked: 0,
    avgSpamScore: 0.0,
  },
  connections: {
    activeConnections: 0,
    connectionsRejected: 0,
    avgLatency: 0,
  }
};

// Export metrics endpoint
app.get('/metrics', (req, res) => {
  if (!isAdmin(req)) return res.status(403).end();
  res.json(metrics);
});
```

---

## 16. FILE LOCATIONS SUMMARY

| Component | File | Lines | Key Changes |
|-----------|------|-------|------------|
| Vote Auth | relay-server.js | 420-462 | Add captcha, rate limit |
| WebSocket | relay-server.js | 605-658 | Add connection limits, spam checks |
| Message Cache | relay-server.js | 27-60 | Add content validation |
| Client Voting | src/services/voteTrackerService.ts | 60-77 | Add backend sync |
| Poll Service | src/services/pollService.ts | 398-425 | Add rate limits |
| Moderation | src/services/moderationService.ts | 175-209 | Enhance word list, add backend check |
| Peer Relay | peer.js | 239-300 | Add spam filtering |
| GUN Relay | gun-relay-server/gun-relay.js | 1-161 | Add CORS limits, auth |

---

## 17. TEST CASES FOR RATE LIMITING

```bash
# Test vote authorization rate limiting
for i in {1..200}; do
  curl -X POST http://localhost:8080/api/vote-authorize \
    -H "Content-Type: application/json" \
    -d '{"pollId":"test","deviceId":"device1"}' &
done

# Test WebSocket connection limit
for i in {1..1000}; do
  websocat ws://localhost:8080 &
done

# Test message size limit
curl -X POST http://localhost:8080/api/vote-authorize \
  -d "$(python -c 'print("x" * 10000000)')"

# Test content spam detection
curl -X POST http://localhost:8080/relay \
  -H "Content-Type: application/json" \
  -d '{"type":"broadcast","data":{"type":"new-poll","data":{
    "question":"FREE MONEY CLICK HERE!!!!!!!!!!!",
    "options":["yes","no"]
  }}}'
```

---

## CONCLUSION

The InterPoll platform now has **multi-layered anti-spam and rate limiting protections**. The following have been implemented:

1. **Progressive rate limiting** — `rate-limiter.js`: per-IP HTTP and per-peer WS sliding windows with escalating cooldowns
2. **Bot detection** — `bot-detector.js`: behavioral scoring with automatic action tiers
3. **Content filtering (server-side)** — `spam-scorer.js`: multi-language profanity detection, soft-flag approach
4. **Proof-of-work** — `pow-challenge.js` (server) + `powService.ts` (client): adaptive-difficulty hashcash for all content messages
5. **GunDB propagation throttle** — `gun-relay.js`: rate limit, size limit, dedup, flood detection, spam scoring on incoming Gun puts

Remaining opportunities for hardening:
- Persistent vote registry (currently in-memory, lost on restart)
- CAPTCHA integration (hCaptcha) as an additional layer
- Database-backed rate limiting for cross-restart persistence

