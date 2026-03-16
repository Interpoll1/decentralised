# Backend Architecture Investigation — COMPLETE SUMMARY

**Investigation Date**: March 11, 2025
**Scope**: Rate limiting, spam detection, bot detection architecture
**Duration**: Comprehensive deep-dive analysis

---

## 📋 DOCUMENTS CREATED

1. **BACKEND-ARCHITECTURE-ANTI-SPAM.md** (27 KB)
   - Complete architectural analysis
   - All message types, handlers, endpoints
   - Current security gaps
   - Line-by-line recommendations
   - Database schema for persistence

2. **IMPLEMENTATION-QUICK-START.md** (12 KB)
   - Copy-paste code snippets
   - Exact line numbers for modifications
   - Environment variables needed
   - Testing procedures
   - 7-day implementation plan

3. **ARCHITECTURE-DIAGRAMS.md** (20 KB)
   - Visual flow diagrams
   - Before/after architecture
   - Threat models
   - Rate limiting matrices
   - Implementation timeline

4. **This Summary** — High-level overview

---

## 🎯 KEY FINDINGS

### Current State: MINIMAL PROTECTION

The InterPoll backend has **virtually no anti-spam, rate limiting, or bot detection**:

| Security Feature | Status | Risk |
|---|---|---|
| Rate limiting | ❌ None | CRITICAL |
| CAPTCHA | ❌ None | CRITICAL |
| IP tracking | ❌ None | CRITICAL |
| Content filtering | ⚠️ Client-side only | HIGH |
| Spam detection | ❌ None | HIGH |
| Vote validation | ⚠️ Client+In-mem only | HIGH |
| DDoS protection | ❌ None | CRITICAL |
| Connection limits | ❌ None | HIGH |
| Database persistence | ⚠️ Partial (vote registry) | HIGH |

### Three Core Processes

1. **relay-server.js** (Port 8080)
   - WebSocket relay for P2P messaging
   - HTTP endpoints for OAuth, vote auth, receipts
   - Vote registry: **in-memory, lost on restart**
   - Message cache: 500 messages, cached to disk
   - **NO security middleware, NO validation**

2. **gun-relay-server/gun-relay.js** (Port 8765)
   - GunDB peer for data replication
   - Polls, communities, posts stored here
   - **CORS open to all origins**
   - **NO authentication, NO rate limiting**

3. **peer.js** (Optional headless node)
   - Stays online for data availability
   - Stores blocks, events, polls
   - **NO spam filtering on relay**

---

## 🔍 LINE-BY-LINE AUDIT RESULTS

### relay-server.js (658 lines)

**Critical Issues**:
- Lines 20-22: Vote registry `Set<string>` — in-memory only
- Line 38: Message cache limited to 500, no dedup
- Lines 64-65: OAuth sessions in-memory Map
- Lines 420-462: `/api/vote-authorize` endpoint — NO rate limit, NO CAPTCHA, NO IP tracking
- Line 605: WebSocket handler — NO connection limits
- Line 641: `broadcast` handler — NO size limits, NO frequency limits, NO spam checks

**Functions Missing**:
- No rate limiter middleware
- No CAPTCHA verification
- No IP blocking/tracking
- No spam content detection
- No request size validation
- No audit logging

### gun-relay-server/gun-relay.js (161 lines)

**Issues**:
- Line 14: `app.use(cors())` — open to all origins
- Line 17: `app.use(Gun.serve)` — no auth required
- NO input validation
- NO rate limiting middleware
- NO query complexity limits

### Client-Side Services

**voteTrackerService.ts**:
- Device fingerprint: Canvas-based (spoofable)
- Vote tracking: Client-side IndexedDB only
- NO server-side verification

**pollService.ts**:
- No rate limiting on `.vote()`
- Vote array stored plaintext in GunDB
- No anti-fraud checks

**websocketService.ts**:
- No message size limits
- No frequency limits
- Exponential backoff but infinite retries

**moderationService.ts**:
- Word filtering: Client-side only (bypassable)
- Regex-based (leetspeak defeats it)
- NO server enforcement

---

## 🛠️ WHERE TO ADD PROTECTIONS

### Priority 1: CRITICAL (Implement Week 1)

**1. Rate Limiting Middleware**
- **File**: relay-server.js, line ~175
- **Action**: Add `express-rate-limit` to `/api/vote-authorize`, `/api/receipts`, global
- **Effort**: 2 hours

**2. CAPTCHA Integration**
- **File**: relay-server.js, line ~420 (vote-authorize handler)
- **Action**: Add hCaptcha verification before vote auth
- **Effort**: 4 hours

**3. Vote Registry Persistence**
- **File**: relay-server.js, line ~22 (voteRegistry)
- **Action**: Migrate in-memory Set to SQLite
- **Effort**: 4 hours

**4. IP Tracking**
- **File**: relay-server.js, line ~605 (WebSocket handler)
- **Action**: Extract `req.socket.remoteAddress`, track per IP
- **Effort**: 2 hours

**Total Week 1**: 12 hours

### Priority 2: HIGH (Implement Week 2)

**5. WebSocket Connection Limits**
- **File**: relay-server.js, line ~605
- **Action**: Add per-IP connection counter, reject > N connections
- **Effort**: 2 hours

**6. Message Size/Frequency Limits**
- **File**: relay-server.js, line ~641 (broadcast handler)
- **Action**: Check message size, rate limit per peer/type
- **Effort**: 3 hours

**7. Content Filtering Service**
- **File**: NEW `src/services/spamDetectionService.ts`
- **Action**: Pattern detection (URLs, keywords, punctuation)
- **Effort**: 6 hours

**8. Security Headers**
- **File**: relay-server.js, line ~175
- **Action**: Add helmet middleware, hardened CORS
- **Effort**: 1 hour

**Total Week 2**: 12 hours

### Priority 3: MEDIUM (Implement Week 3-4)

**9. Device Fingerprint Server Validation**
- **File**: relay-server.js + voteTrackerService.ts
- **Action**: Send fingerprint to server, verify match
- **Effort**: 6 hours

**10. Bot Detection**
- **File**: NEW `src/services/botDetectionService.ts`
- **Action**: Analyze voting patterns, score users
- **Effort**: 8 hours

**11. Distributed Rate Limiting (Redis)**
- **File**: relay-server.js
- **Action**: Optional for multi-relay deployments
- **Effort**: 6 hours

**Total Week 3-4**: 20 hours

---

## 📊 IMPLEMENTATION CHECKLIST

### Week 1 (Rate Limiting Foundation)
- [ ] npm install express-rate-limit helmet
- [ ] Add rate limiter import + helmet middleware
- [ ] Create global, vote-auth, captcha limiters
- [ ] Add IP extraction to WebSocket handler
- [ ] Set up SQLite database + schema
- [ ] Migrate vote registry to database
- [ ] Add audit logging functions
- [ ] Test: curl rate limiting test (see docs)
- [ ] Deploy to staging

### Week 2 (CAPTCHA + Content Validation)
- [ ] npm install hcaptcha-verify
- [ ] Add hCaptcha API verification function
- [ ] Create SpamDetectionService with pattern detection
- [ ] Add spam check to broadcast handler
- [ ] Add message size validation
- [ ] Add broadcast rate limiter (per peer/type)
- [ ] Add helmet security headers
- [ ] Test: CAPTCHA flow test
- [ ] Deploy to staging

### Week 3 (Advanced)
- [ ] Add device fingerprint server verification
- [ ] Create BotDetectionService
- [ ] Analyze voting patterns (time-based, IP-based)
- [ ] Add user reputation scoring
- [ ] Create admin dashboard for metrics
- [ ] Test: Bot attack simulation
- [ ] Deploy to staging

### Week 4+ (Optional)
- [ ] Redis distributed rate limiting
- [ ] ML-based spam detection
- [ ] Geographic IP blocking
- [ ] Shadow-ban system
- [ ] Rate limit metrics export (Prometheus)

---

## 🔐 SECURITY PRINCIPLES

1. **Fail Secure**: Block by default, allow on auth
   - Don't: `return { allowed: true }` on error (line 459)
   - Do: `return { allowed: false, reason: 'verification failed' }`

2. **Defense in Depth**: Multiple checks at each level
   - Client (TypeScript types, client-side filters)
   - API (rate limit, CAPTCHA, validation)
   - Database (constraints, logging)

3. **Least Privilege**: Restrict what's needed
   - No CORS wildcard — specify origins
   - No open WebSocket — add auth
   - No full data access — add query limits

4. **Audit Trail**: Log everything
   - Vote attempts, CAPTCHA results, rate limit hits
   - IP addresses, timestamps, reasons
   - Query them later for pattern analysis

5. **Graceful Degradation**: Work offline
   - Client-side validation when offline
   - Queue requests, sync when online
   - Don't block users due to backend being down

---

## 🚀 QUICK START

1. **Read First**: `BACKEND-ARCHITECTURE-ANTI-SPAM.md` (sections 1-3)
2. **Code Changes**: `IMPLEMENTATION-QUICK-START.md` (follow Week 1 exactly)
3. **Visualize**: `ARCHITECTURE-DIAGRAMS.md` (understand data flows)
4. **Test**: Run `curl` tests provided in quick-start doc
5. **Deploy**: Staging first, then production

**Estimated Total Time**: 40-50 hours for comprehensive implementation
**Minimum Viable**: 16 hours (Week 1 only)

---

## 📁 FILE REFERENCES

### Backend Components

| File | Lines | Purpose | Issues |
|------|-------|---------|--------|
| relay-server.js | 1-658 | WebSocket relay, HTTP API | ALL critical endpoints need hardening |
| gun-relay-server/gun-relay.js | 1-161 | GunDB relay | CORS open, no auth |
| peer.js | 1-418 | Headless peer node | No spam filtering |

### Client Services

| File | Lines | Purpose | Issues |
|------|-------|---------|--------|
| src/services/websocketService.ts | 1-441 | WebSocket client | No upload limits |
| src/services/voteTrackerService.ts | 1-95 | Device fingerprinting | Spoofable, no server check |
| src/services/pollService.ts | 194-329 | Poll creation/voting | No rate limit on .vote() |
| src/services/moderationService.ts | 1-280 | Content filtering | Client-side only |
| src/services/chainService.ts | 1-220 | Blockchain ops | No rate limit on addAction() |
| src/types/chain.ts | 1-40 | Block types | Can extend ActionType enum |

### Documentation Created

| File | Size | Purpose |
|------|------|---------|
| BACKEND-ARCHITECTURE-ANTI-SPAM.md | 27 KB | Complete analysis, line-by-line |
| IMPLEMENTATION-QUICK-START.md | 12 KB | Code snippets, copy-paste ready |
| ARCHITECTURE-DIAGRAMS.md | 20 KB | Flows, threat models, timelines |
| INVESTIGATION-SUMMARY.md | This file | High-level overview |

---

## ⚠️ RISKS IF NOT IMPLEMENTED

### Without Rate Limiting
- Bot can vote 1000s times per second
- Vote registry lost on restart = vote replay attacks
- No resource limits = server DoS

### Without CAPTCHA
- Fully automated bot attacks
- No human verification layer
- Zero friction for attackers

### Without Content Filtering
- Spam messages relayed to all peers
- Network clogged with garbage
- Bad reputation for platform

### Without IP Tracking
- Can't correlate attacks to source
- No way to block malicious IPs
- Can't detect coordinated attacks

---

## 🎓 LEARNING OUTCOMES

After completing this investigation, you now understand:

1. **Architecture**: Three-process P2P system (relay, gun-relay, peer)
2. **Message Flow**: WebSocket → vote registry → database
3. **Current Gaps**: No rate limiting, no CAPTCHA, no persistence
4. **Implementation**: Exactly which files to modify, which lines
5. **Testing**: How to verify each protection works
6. **Threats**: What attacks are currently possible
7. **Timeline**: 40-50 hours to full protection, 16 hours minimum

---

## 📞 NEXT STEPS

1. **Immediate** (Today)
   - Read all three documentation files
   - Share with team, get consensus on approach

2. **This Week** (Week 1)
   - Install dependencies: `npm install express-rate-limit helmet`
   - Implement Week 1 changes from IMPLEMENTATION-QUICK-START.md
   - Test on localhost
   - Deploy to staging

3. **Next Week** (Week 2)
   - Implement CAPTCHA integration
   - Deploy to production after staging tests
   - Monitor metrics in production

4. **Ongoing**
   - Tune rate limits based on real traffic
   - Monitor audit logs for attack patterns
   - Add advanced features (Redis, ML) as needed

---

**Investigation Complete** ✓

All code locations, exact line numbers, and implementation details provided.
Ready for development team to implement anti-spam/rate limiting features.

