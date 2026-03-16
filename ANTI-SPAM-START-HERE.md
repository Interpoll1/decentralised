# 🚀 START HERE: Anti-Spam & Rate Limiting Implementation

**TL;DR**: Read these 4 documents in order, then implement Week 1 checklist.

---

## 📚 DOCUMENTATION READING ORDER

### 1. **THIS FILE** (5 min read) ← You are here
   Overview and navigation guide

### 2. **INVESTIGATION-SUMMARY.md** (15 min read)
   - What was found: NO rate limiting, NO CAPTCHA, in-memory vote registry
   - Current state: MINIMAL protection (CRITICAL risk)
   - Where to make changes: Exact file paths and line numbers
   - Implementation timeline: 40-50 hours comprehensive, 16 hours minimum

### 3. **BACKEND-ARCHITECTURE-ANTI-SPAM.md** (45 min detailed read)
   - ALL 658 lines of relay-server.js analyzed
   - ALL HTTP endpoints documented
   - ALL WebSocket message types explained
   - ALL existing security gaps listed
   - Database schema for persistence
   - Implementation roadmap: Phase 1-5

### 4. **ARCHITECTURE-DIAGRAMS.md** (30 min visual reference)
   - Current architecture (no rate limiting)
   - Proposed architecture (with protections)
   - Vote authorization flow (step-by-step)
   - Message broadcasting flow
   - Threat matrix (before/after)

### 5. **IMPLEMENTATION-QUICK-START.md** (60 min implementation guide)
   - Copy-paste code snippets
   - Exact line numbers for each change
   - Step-by-step instructions
   - Testing procedures with curl commands
   - Environment variables to set
   - Day-by-day checklist

---

## 🎯 EXECUTIVE SUMMARY

### Current State: VULNERABLE ⚠️

| Feature | Status | Risk |
|---------|--------|------|
| Rate limiting | ❌ None | **CRITICAL** |
| CAPTCHA | ❌ None | **CRITICAL** |
| Vote persistence | ❌ In-memory | **CRITICAL** |
| IP tracking | ❌ None | **CRITICAL** |
| Spam filtering | ⚠️ Client-side | HIGH |
| Content validation | ⚠️ Minimal | HIGH |

### System Architecture

```
Browser Client
    ↓ WebSocket (no auth, no rate limit)
relay-server.js:8080 (in-memory vote registry)
    ├─ gun-relay-server:8765 (CORS open)
    ├─ peer.js (optional, no spam filtering)
    └─ vote_registry: Set<string> (lost on restart!)
```

### Attack Surface

1. **Bot Voting**: Create 1000 fake accounts, vote 1000 times/second → NO CAPTCHA
2. **Message Spam**: Send 1MB messages, no size limit → WORKS
3. **Vote Replay**: Restart relay → all votes reset → vote again → WORKS
4. **Connection Flood**: 10000 WebSocket connections → NO CONNECTION LIMIT
5. **OAuth Hijacking**: Sessions in-memory → lost on restart → SESSION FIXATION

---

## ⏱️ IMPLEMENTATION TIMELINE

### Week 1: CRITICAL (16 hours)
- Rate limiting middleware
- CAPTCHA integration
- Vote registry → SQLite persistence
- IP tracking
- **Result**: Blocks most basic attacks

### Week 2: HIGH (12 hours)
- WebSocket connection limits
- Message validation (size, frequency)
- Content filtering service
- Security headers
- **Result**: Blocks spam/DoS

### Week 3-4: MEDIUM (20 hours)
- Device fingerprint server verification
- Bot detection (pattern analysis)
- Redis for distributed rate limiting
- **Result**: Handles coordinated attacks

---

## 🔧 QUICK IMPLEMENTATION STEPS

### For the Impatient (Day 1)

```bash
# 1. Install packages
npm install express-rate-limit helmet

# 2. Read IMPLEMENTATION-QUICK-START.md sections 1-2 (30 min)

# 3. Copy code from section 3 into relay-server.js:
#    - Lines 1-50: Add imports
#    - Lines 170-190: Add middleware
#    - Lines 420-462: Enhance vote-authorize endpoint

# 4. Test on localhost
curl -X POST http://localhost:8080/api/vote-authorize \
  -H "Content-Type: application/json" \
  -d '{"pollId":"test","deviceId":"dev1"}'

# 5. Repeat 15 times in 1 minute
# Should get: "429 Too Many Requests" after limit hit
```

### For the Thorough (Week 1)

See **IMPLEMENTATION-QUICK-START.md** — 7-day step-by-step plan with testing

---

## 📊 BEFORE & AFTER

### Before (Current)
```javascript
const voteRegistry = new Set(); // ← Lost on restart
// No rate limit
// No CAPTCHA
// No IP tracking
// No size validation
```

### After (Week 1)
```javascript
const voteAuthLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  keyGenerator: (req) => req.socket.remoteAddress
});

// In endpoint:
const captchaValid = await verifyCaptcha(captchaToken);
if (!captchaValid) return 403;

// Persist to SQLite
await persistVoteAuthorization(pollId, deviceId, clientIp, true);
```

---

## 🔍 KEY FILES

| What | File | Lines | Change |
|------|------|-------|--------|
| Vote auth endpoint | relay-server.js | 420-462 | Add CAPTCHA + rate limit |
| WebSocket handler | relay-server.js | 605-658 | Add connection limits |
| Message broadcast | relay-server.js | 641-655 | Add spam checks |
| GUN relay | gun-relay-server/gun-relay.js | 1-40 | Add helmet + auth |
| Vote tracking | src/services/voteTrackerService.ts | 60-77 | Add server sync |
| Poll service | src/services/pollService.ts | 398-425 | Add rate limit |

---

## ✅ VERIFICATION CHECKLIST

After implementing Week 1, verify:

- [ ] Rate limit 429 error on `/api/vote-authorize` after 10 attempts/min
- [ ] CAPTCHA required on first vote attempt
- [ ] hCaptcha verification working
- [ ] Vote registry persists after relay restart
- [ ] WebSocket rejects >50 connections from same IP
- [ ] Message size limit enforced (test with 10MB payload)
- [ ] Audit log records all attempts
- [ ] CORS headers restricted to allowed origins
- [ ] Security headers present (X-Frame-Options, etc.)

---

## 🚨 CRITICAL CHANGES EXPLAINED

### #1: Rate Limiting (2 hours)

**What**: Limit requests per IP per time window
**Why**: Prevents bots from overwhelming the server
**Where**: relay-server.js, import + middleware
**How**: `express-rate-limit` package

```javascript
// Before: Anyone can send unlimited requests
POST /api/vote-authorize

// After: 10 requests per minute per IP
POST /api/vote-authorize
// Error 429 on 11th request in 1 minute
```

### #2: CAPTCHA (4 hours)

**What**: Human verification (hCaptcha)
**Why**: Proves it's a real person, not a bot
**Where**: relay-server.js `/api/vote-authorize` handler
**How**: hCaptcha API verification

```javascript
// Before: No proof user is human
POST /api/vote-authorize { pollId, deviceId }

// After: Must include CAPTCHA token
POST /api/vote-authorize { pollId, deviceId, captchaToken }
// Verified server-side via hCaptcha API
```

### #3: Vote Persistence (4 hours)

**What**: Store vote authorizations in database
**Why**: Survive relay restart (current system loses votes!)
**Where**: relay-server.js + SQLite
**How**: CREATE TABLE + INSERT on authorization

```javascript
// Before: Set<string> lost on restart
const voteRegistry = new Set();
// Restart server = empty Set = vote again!

// After: SQLite database persisted to disk
CREATE TABLE vote_authorizations (
  poll_id, device_id, UNIQUE(poll_id, device_id)
);
// Restart server = data still there
```

### #4: IP Tracking (1 hour)

**What**: Know which IP made each request
**Why**: Detect attacks from same source
**Where**: All endpoints, `req.socket.remoteAddress`
**How**: Extract + log IP address

```javascript
// Before: No IP tracking
{ type: 'vote-authorize', pollId, deviceId }

// After: Includes IP
{ type: 'vote-authorize', pollId, deviceId, clientIp: '192.168.1.1' }
```

---

## 🎓 UNDERSTANDING THE CURRENT VULNERABILITY

### The Vote Replay Attack

```
Attacker with bot:
  1. First run: Vote 1000 times on poll ✓
  2. Relay server restarts (crash/deploy)
  3. voteRegistry = new Set() ← EMPTY!
  4. Vote 1000 more times ✓
  
Total: 2000 fraudulent votes in 2 runs!

Fix: Persist to SQLite
  → Vote registry survives restart
  → Second attempt blocked (already voted)
```

### The DDoS Attack

```
Attacker with bot:
  1. Send 10,000 WebSocket connections
  2. Each sends 1MB message/second
  3. Server bandwidth = 10,000 MB/sec = OFFLINE
  
Fix: Rate limiting
  → Max 10 requests/minute per IP
  → Max 1MB message size
  → Max 50 connections per IP
  → Attacker can max out 500 MB/sec (survivable)
```

### The Bot Attack

```
Attacker with bot farm:
  1. Bot creates 1000 accounts automatically
  2. Each votes once → 1000 votes
  3. No CAPTCHA = takes 10 seconds
  
Fix: CAPTCHA requirement
  → Each account creation requires human solve
  → +2 seconds per account
  → 1000 accounts = 33 minutes (impractical)
```

---

## 📞 SUPPORT

### If you get stuck:

1. **"express-rate-limit not working"** 
   → Check middleware is added BEFORE routes (lines 170-190)

2. **"CAPTCHA always fails"**
   → Verify HCAPTCHA_SECRET env var is set
   → Check hCaptcha.com account is active

3. **"Database table doesn't exist"**
   → Run SQL schema from BACKEND-ARCHITECTURE-ANTI-SPAM.md section 11.2

4. **"Rate limit too strict/loose"**
   → Adjust windowMs and max values in config

5. **"Tests fail with different results"**
   → Verify relay-server.js changes saved correctly
   → Restart relay-server.js process

---

## 🎯 YOUR NEXT ACTION

**RIGHT NOW**:
1. Open `INVESTIGATION-SUMMARY.md` (this is your roadmap)
2. Read section "🎯 KEY FINDINGS" (5 min)
3. Open `IMPLEMENTATION-QUICK-START.md`
4. Follow Week 1 Day 1-2 (2 hours)
5. Test with curl commands
6. Celebrate! ✅

**Timeline to Production**:
- Week 1: Implement + test on staging
- Week 2: Deploy to production
- Week 3-4: Monitor + tune

---

## 📋 CHECKLIST TO START

- [ ] Read INVESTIGATION-SUMMARY.md (15 min)
- [ ] Read BACKEND-ARCHITECTURE-ANTI-SPAM.md sections 1-3 (45 min)
- [ ] Read ARCHITECTURE-DIAGRAMS.md vote flow (10 min)
- [ ] Open IMPLEMENTATION-QUICK-START.md in IDE
- [ ] npm install express-rate-limit helmet
- [ ] Create .env file with HCAPTCHA_SECRET
- [ ] Implement relay-server.js changes (Week 1 Day 1-2)
- [ ] Test locally
- [ ] Create SQL schema + SQLite database
- [ ] Test persistence (restart relay server)
- [ ] Deploy to staging
- [ ] Run load tests
- [ ] Deploy to production

---

**Status**: ✅ INVESTIGATION COMPLETE
**Documents**: 4 comprehensive guides created
**Ready**: For development team to implement

**Next**: See INVESTIGATION-SUMMARY.md for "Next Steps"

