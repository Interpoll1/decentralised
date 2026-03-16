# Backend Architecture Diagrams

## Current Architecture (No Rate Limiting)

```
┌─────────────────────────────────────────────────────────────────┐
│                    Browser Client (Vue SPA)                      │
├─────────────────────────────────────────────────────────────────┤
│  • VoteTrackerService (device fingerprint)                      │
│  • PollService.vote() [NO rate limit]                           │
│  • WebSocketService (NO upload size limit)                      │
│  • ModerationService (client-side word filter only)             │
└──────────────────────┬──────────────────────────────────────────┘
                       │ WebSocket (NO auth, NO rate limit)
                       │ All message types: no size/frequency checks
                       │
         ┌─────────────▼──────────────┐
         │   relay-server.js:8080      │
         │  ─────────────────────      │
         │  • Message cache (500)      │
         │  • Vote registry (in-mem)   │
         │  • OAuth sessions (in-mem)  │
         │  • WebSocket server         │
         │  • NO rate limiting         │
         │  • NO CAPTCHA               │
         │  • NO IP tracking           │
         │  • NO auth on WS            │
         └──────┬────────┬─────────────┘
                │        │
        ┌───────▼─┐  ┌───▼──────────┐
        │  peer.js │  │ gun-relay.js │
        │(opt)     │  │    :8765     │
        │          │  │              │
        │ NO spam  │  │ NO filtering │
        │ checks   │  │ CORS open    │
        └──────────┘  └──┬───────────┘
                        │
                    GunDB Relay
                    ─────────────
                    • polls
                    • communities
                    • posts
                    • NO validation
                    • NO rate limits
```

## Proposed Architecture (WITH Rate Limiting)

```
┌──────────────────────────────────────────────────────────────────────┐
│                    Browser Client (Vue SPA)                           │
├──────────────────────────────────────────────────────────────────────┤
│  • VoteTrackerService (device fingerprint)                           │
│  • NEW: Device ID sync w/ server                                      │
│  • NEW: hCaptcha integration                                          │
│  • PollService.vote() [WITH request throttling]                      │
│  • WebSocketService [WITH upload limits]                             │
│  • ModerationService [+ server-side checks]                          │
│  • NEW: SpamDetectionService                                         │
└────────────────────────┬────────────────────────────────────────────┘
                         │ WebSocket + hCaptcha token
                         │ Message size limit: 1MB
                         │ Freq limit: 30/min per peer
                         │ Auth required on vote endpoints
                         │
         ┌───────────────▼────────────────────────┐
         │   relay-server.js:8080 (HARDENED)      │
         ├────────────────────────────────────────┤
         │ ✅ Express Rate Limit middleware       │
         │ ✅ Helmet security headers             │
         │ ✅ CORS restricted to origins          │
         │ ✅ IP-based rate limiting              │
         │ ✅ Vote registry (persistent)          │
         │ ✅ hCaptcha verification               │
         │ ✅ SpamDetectionService                │
         │ ✅ Message validation (size/type)      │
         │ ✅ Comprehensive audit logging         │
         │ ✅ Device fingerprint validation       │
         │ ✅ Redis for distributed limits        │
         └──┬────────────────────┬─────────────┬──┘
            │                    │             │
     ┌──────▼─┐        ┌────────▼───┐    ┌────▼────────────┐
     │peer.js │        │gun-relay   │    │Database (SQLite/│
     │(opt)   │        │ :8765      │    │PostgreSQL)      │
     │        │        │(HARDENED)  │    │                 │
     │✅ Spam │        │            │    │✅ vote_auths    │
     │ filter │        │✅ Input    │    │✅ rate_limits   │
     │✅ Size │        │  validation│    │✅ spam_flags    │
     │ limits │        │✅ Content  │    │✅ audit_log     │
     │✅ Log  │        │  filtering │    │                 │
     │        │        │✅ Auth     │    │(Persistent!)    │
     │        │        │            │    │                 │
     └────────┘        └────────────┘    └─────────────────┘
                             │
                         GunDB (v2 namespace)
                         ────────────────────
                         • polls
                         • communities  
                         • posts [validated]
                         • comments [validated]
```

## Vote Authorization Flow (ENHANCED)

```
┌─────────────────────────────────────────────────────────────┐
│ Client: User clicks VOTE on poll                            │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
         ┌─────────────────────────────────┐
         │ Check local IndexedDB           │
         │ hasVoted(pollId)?               │
         └────┬────────────────────────┬───┘
              │ Yes                    │ No
              │                        │
         ┌────▼──────┐         ┌───────▼──────────┐
         │ Show error│         │ Show hCaptcha    │
         │ "Already  │         │ widget           │
         │  voted"   │         └────┬─────────────┘
         └───────────┘              │
                                    ▼
                         ┌────────────────────────┐
                         │ User solves CAPTCHA    │
                         │ Get token              │
                         └────────┬───────────────┘
                                  │
                                  ▼
         ┌────────────────────────────────────────────┐
         │ POST /api/vote-authorize                  │
         │ {                                         │
         │   pollId, deviceId,                       │
         │   captchaToken                            │
         │ }                                         │
         └────┬─────────────────┬────────────────────┘
              │ IP-based rate    │ Captcha rate limit
              │ limit: 10/min    │ limit: 1000/day
              │                  │
         ┌────▼──────┐    ┌──────▼──────────┐
         │ Reject    │    │ Verify token    │
         │ 429 error │    │ with hCaptcha   │
         └───────────┘    │ API             │
                          └────┬───────────┘
                               │
                     ┌─────────┴─────────┐
                     │ Valid             │ Invalid
                     │                   │
         ┌───────────▼──────┐    ┌───────▼───────┐
         │ Check vote reg:  │    │ Reject        │
         │ "${poll}:${dev}"?│    │ 403 error     │
         └────┬────────┬────┘    └───────────────┘
              │Found  │Not found
              │       │
         ┌────▼───┐ ┌─▼──────────────────┐
         │Reject  │ │ Add to registry    │
         │409     │ │ Persist to DB      │
         │dup     │ │ Return {allowed:true}
         └────────┘ └────┬───────────────┘
                         │
                         ▼
         ┌─────────────────────────────────┐
         │ Client: Send actual vote to     │
         │ GunDB (polls.{id}.options...)   │
         │                                 │
         │ VoteTrackerService.recordVote() │
         │ Local IndexedDB vote-records    │
         └─────────────────────────────────┘
```

## Message Broadcasting Flow (ENHANCED)

```
┌────────────────────────────────────────────────┐
│ Peer sends broadcast message via WebSocket     │
│ {type: "broadcast", data: {...}}               │
└──────────────────────────┬──────────────────────┘
                           │
                           ▼
     ┌─────────────────────────────────────┐
     │ relay-server.js wss.on('message')   │
     └────────┬────────────────────────────┘
              │
              ├──► 1. Check message size
              │    MAX: 1MB
              │    ✗ Reject if oversized
              │
              ├──► 2. Rate limit check
              │    globalLimiter (1000 req/15min)
              │    ✗ Reject if exceeded (429)
              │
              ├──► 3. Extract message data
              │    Get: type, payload
              │
              ├──► 4. Spam detection
              │    SpamDetectionService.analyze()
              │    Check: URL density, keywords, patterns
              │    Score: 0.0 - 1.0
              │    ✗ Log & reject if score > threshold
              │
              ├──► 5. Content filtering
              │    ModerationService.checkContent()
              │    Match against word list
              │    ✗ Log violation
              │
              ├──► 6. Broadcast rate limit
              │    broadcastRateLimiter.allow(peer, type)
              │    Limit: 30 messages/min per peer/type
              │    ✗ Reject if exceeded
              │
              ├──► 7. Valid? → Broadcast to others
              │    broadcastToOthers(peerId, data)
              │
              └──► 8. Cache message
                   MESSAGE_CACHE (max 500)
                   Replay on new client connect
```

## Spam Detection Matrix

```
CONTENT ANALYSIS
────────────────

Text Input
    │
    ├─ URL Density Check
    │  └─ Pattern: https?://\S+
    │     FLAG if > 2 URLs in message
    │
    ├─ Spam Keywords
    │  └─ "free", "click", "buy", "deposit"
    │     "crypto", "bitcoin", "wire transfer"
    │     FLAG if > 1 keyword
    │
    ├─ Suspicious Punctuation
    │  └─ "!!!", "???", "...", "🎉🎉🎉"
    │     FLAG if > 1 pattern
    │
    ├─ Leetspeak/Obfuscation
    │  └─ "4dm1n", "p@ssw0rd"
    │     FLAG if > 30% chars are numbers/symbols
    │
    └─ Repetition
       └─ "buybuybuy", "clickclickclick"
          FLAG if same word repeated > 2x

FINAL SCORE
───────────
0.0 = Definitely not spam
0.3 = Possibly spam (warn user)
0.7 = Likely spam (require review)
1.0 = Definitely spam (auto-reject)

ACTION
──────
Score < 0.3: Allow ✓
Score 0.3-0.7: Flag for review, user sees warning
Score > 0.7: Reject, log as spam
```

## Rate Limiting Windows

```
ENDPOINT                    LIMIT               WINDOW    KEY
─────────────────────────────────────────────────────────────
/api/vote-authorize         10 attempts         1 minute  IP
/api/vote-authorize (2nd+)  20 attempts         15 min    IP
/api/receipts               100 requests        15 min    IP
/auth/google/callback       50 attempts         1 hour    IP
/auth/logout                100 attempts        1 hour    IP

WebSocket connection        50 connections      1 minute  IP
WebSocket message (all)     1000 messages       15 min    IP
WebSocket message (type)    30 messages         1 minute  Peer+Type

hCaptcha verify             1000 attempts       24 hours  IP
hCaptcha required every:    First vote OR
                           > 3 vote attempts
```

## Database Schema for Rate Limiting

```sql
-- Persistent vote authorizations
CREATE TABLE vote_authorizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  poll_id VARCHAR(255) NOT NULL,
  device_id VARCHAR(255) NOT NULL,
  ip_address VARCHAR(45) NOT NULL,
  authorized BOOLEAN,
  reason VARCHAR(255),
  captcha_required BOOLEAN DEFAULT FALSE,
  captcha_score FLOAT,
  created_at TIMESTAMP DEFAULT NOW(),
  
  UNIQUE(poll_id, device_id)
);

-- Audit trail
CREATE TABLE audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type VARCHAR(50), -- 'vote-authorize', 'rate-limit', 'spam', 'captcha'
  ip_address VARCHAR(45),
  device_id VARCHAR(255),
  poll_id VARCHAR(255),
  details JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Spam detection flags
CREATE TABLE spam_flags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content_id VARCHAR(255),
  content_type VARCHAR(50), -- 'poll', 'post', 'comment'
  spam_score FLOAT,
  indicators TEXT[], -- ['url-dense', 'keywords', 'leetspeak']
  flagged_by VARCHAR(50), -- 'regex', 'ml', 'user'
  user_reports INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Rate limit buckets (for Redis backup)
CREATE TABLE rate_limits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ip_address VARCHAR(45),
  endpoint VARCHAR(255),
  attempt_count INT,
  window_start TIMESTAMP,
  window_end TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);
```

## Threat Model

```
THREAT                           CURRENT    AFTER FIX
──────────────────────────────────────────────────
Bot voting (1000s of votes)      ☠️ OPEN    ✓ Protected
                                              (CAPTCHA + rate limit)

Vote duplication (same device)   ⚠️ Client  ✓ Protected
                                 only       (server + DB)

Mass message spam                ☠️ OPEN    ✓ Protected
                                            (size limit + content filter)

Connection flooding              ☠️ OPEN    ✓ Protected
                                            (connection rate limit)

OAuth session fixation           ☠️ In-mem  ⚠️ Mitigated
                                            (add DB + TTL)

IP spoofing                      ☠️ OPEN    ⚠️ Mitigated
                                            (add header validation)

DDoS (query flooding)            ☠️ OPEN    ✓ Protected
                                            (rate limit + WAF)

Data exfiltration                ⚠️ No auth ✓ Improved
                                            (add CORS + HTTPS)

Replay attacks                   ☠️ OPEN    ✓ Protected
                                            (nonce + signature)

Cache poisoning                  ⚠️ Limited ✓ Protected
                                            (validation)
```

## Implementation Timeline

```
Week 1: Foundation (High Priority)
─────────────────────────────────────
Day 1-2
  ├─ Install dependencies
  ├─ Add helmet + CORS hardening
  ├─ Add express-rate-limit to relay-server.js
  └─ Test basic rate limiting

Day 3-4
  ├─ Add global IP-based rate limiter
  ├─ Add vote authorization rate limiter
  └─ Create audit logging functions

Day 5
  ├─ Add WebSocket connection rate limiting
  ├─ Test with load generator
  └─ Deploy to staging

Week 2: CAPTCHA (High Priority)
────────────────────────────────
Day 1-2
  ├─ Integrate hCaptcha (backend verification)
  ├─ Create hCaptcha client component
  └─ Add to vote flow

Day 3-4
  ├─ Set up SQLite persistence
  ├─ Create vote_authorizations table
  ├─ Migrate in-memory voteRegistry to DB
  └─ Test persistence across restarts

Day 5
  ├─ Test CAPTCHA + rate limit flow
  ├─ Load testing (100 concurrent users)
  └─ Deploy to staging

Week 3: Content Filtering (Medium Priority)
──────────────────────────────────────────────
Day 1-2
  ├─ Create SpamDetectionService
  ├─ Implement pattern detection
  └─ Add to relay message handler

Day 3-4
  ├─ Integrate in peer.js
  ├─ Test with spam corpus
  └─ Tune thresholds

Day 5
  ├─ Full integration testing
  └─ Deploy to staging

Week 4-5: Advanced Features (Medium Priority)
─────────────────────────────────────────────
  ├─ Redis for distributed rate limiting
  ├─ Device fingerprint server-side validation
  ├─ Bot detection (pattern analysis)
  ├─ Admin dashboard for rate limit status
  └─ Comprehensive monitoring/alerting
```

---

