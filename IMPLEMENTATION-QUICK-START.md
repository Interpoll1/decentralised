# Anti-Spam & Rate Limiting — Quick Start Implementation

## KEY FILES TO MODIFY

### 1. **relay-server.js** (Lines 1-50: Add imports)

```javascript
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import RedisStore from 'rate-limit-redis';
import redis from 'redis';

// Initialize Redis client (optional, for distributed rate limiting)
const redisClient = redis.createClient({ host: 'localhost', port: 6379 });

// Rate limiters
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 minutes
  max: 1000,                  // 1000 requests per 15 min
  keyGenerator: (req) => req.socket.remoteAddress,
  standardHeaders: true,
  legacyHeaders: false,
});

const voteAuthLimiter = rateLimit({
  windowMs: 60 * 1000,        // 1 minute
  max: 10,                    // 10 votes per minute per IP
  keyGenerator: (req) => req.socket.remoteAddress,
  skip: (req) => req.socket.remoteAddress === '127.0.0.1',
});

const captchaLimiter = rateLimit({
  windowMs: 24 * 60 * 60 * 1000, // 24 hours
  max: 1000,                      // 1000 CAPTCHA attempts/day
  keyGenerator: (req) => req.socket.remoteAddress,
});
```

### 2. **relay-server.js** (Lines 170-190: Add middleware + security)

```javascript
const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  // Security headers (before CORS)
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');

  // CORS (HARDENED - restrict origins)
  const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:5173').split(',');
  if (allowedOrigins.includes(req.headers.origin)) {
    res.setHeader('Access-Control-Allow-Origin', req.headers.origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }
  
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  // Global rate limit
  globalLimiter(req, res, () => {
    // Route handlers follow...
```

### 3. **relay-server.js** (Lines 420-462: Enhanced vote-authorize)

```javascript
if (req.method === 'POST' && url.pathname === '/api/vote-authorize') {
  voteAuthLimiter(req, res, async () => {
    let body = '';
    req.on('data', (chunk) => {
      if (body.length > 10000) { // Size limit
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ allowed: false, reason: 'payload too large' }));
        return;
      }
      body += chunk.toString();
    });
    req.on('end', async () => {
      try {
        const data = JSON.parse(body || '{}');
        const pollId = String(data.pollId || '');
        const deviceId = String(data.deviceId || '');
        const captchaToken = String(data.captchaToken || '');
        const clientIp = req.socket.remoteAddress;

        // Input validation
        if (!pollId || !deviceId) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ 
            allowed: false, 
            reason: 'missing pollId or deviceId' 
          }));
          return;
        }

        // 1. Check if CAPTCHA required (first attempt on device)
        const device_first_vote = !voteRegistry.has(`${pollId}:${deviceId}`);
        if (device_first_vote || data.attemptCount > 3) {
          if (!captchaToken) {
            res.writeHead(403, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ 
              allowed: false, 
              reason: 'captcha required',
              requiresCaptcha: true 
            }));
            return;
          }

          // 2. Verify CAPTCHA
          const captchaValid = await verifyCaptcha(captchaToken);
          if (!captchaValid) {
            auditLog('captcha-failed', { clientIp, pollId, deviceId });
            res.writeHead(403, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ 
              allowed: false, 
              reason: 'captcha verification failed' 
            }));
            return;
          }
        }

        // 3. Check vote registry
        const key = `${pollId}:${deviceId}`;
        const alreadyVoted = voteRegistry.has(key);

        if (!alreadyVoted) {
          voteRegistry.add(key);
          // Also persist to database for durability
          persistVoteAuthorization(pollId, deviceId, clientIp, true);
        }

        // 4. Log authorization
        const logEntry = {
          type: 'vote-authorize',
          pollId,
          deviceId,
          clientIp,
          allowed: !alreadyVoted,
          captchaRequired: device_first_vote,
          timestamp: Date.now(),
        };
        auditLog('vote-authorize', logEntry);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
          allowed: !alreadyVoted, 
          reason: alreadyVoted ? 'already voted' : undefined 
        }));
      } catch (error) {
        console.error('Error in /api/vote-authorize:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ allowed: true })); // Fail open
      }
    });
  });
  return;
}
```

### 4. **relay-server.js** (Lines 605-620: WebSocket connection limits)

```javascript
const connectionsByIp = new Map(); // IP -> { count, lastReset }
const MAX_CONNECTIONS_PER_IP = 50;
const CONNECTION_WINDOW = 60000; // 1 minute

wss.on('connection', (ws, req) => {
  const clientIp = req.socket.remoteAddress;
  let peerId = null;

  // Rate limit connections
  const now = Date.now();
  if (!connectionsByIp.has(clientIp)) {
    connectionsByIp.set(clientIp, { count: 1, lastReset: now });
  } else {
    const record = connectionsByIp.get(clientIp);
    if (now - record.lastReset > CONNECTION_WINDOW) {
      record.count = 1;
      record.lastReset = now;
    } else {
      record.count++;
      if (record.count > MAX_CONNECTIONS_PER_IP) {
        ws.close(1008, 'Connection rate limit exceeded');
        auditLog('connection-limit', { clientIp, count: record.count });
        return;
      }
    }
  }

  console.log(`🔌 New connection from ${clientIp}`);

  // ... rest of handler
});
```

### 5. **relay-server.js** (Lines 641-655: Message spam filtering)

```javascript
case 'broadcast':
  const msgData = data.data || {};
  const msgType = msgData.type || 'unknown';
  const msgSize = JSON.stringify(msgData).length;

  // Size limit
  if (msgSize > 1000000) { // 1MB max
    console.warn(`Message too large from ${peerId}: ${msgSize} bytes`);
    break;
  }

  // Content filtering (basic)
  if (isSpamContent(msgData)) {
    auditLog('spam-detected', { 
      peerId, 
      type: msgType, 
      reason: 'content filter' 
    });
    break;
  }

  // Rate limit broadcasts per peer
  if (!broadcastRateLimiter.allow(peerId, msgType)) {
    console.warn(`Broadcast rate limit exceeded for ${peerId}`);
    break;
  }

  console.log(`📡 Broadcasting ${msgType} from ${peerId}`);
  broadcastToOthers(peerId, data.data);
  cacheMessage(data.data);
  break;
```

## NEW UTILITY FUNCTIONS TO ADD

### Add before `wss.on('connection')` (Line 600):

```javascript
// CAPTCHA verification
async function verifyCaptcha(token) {
  try {
    const secret = process.env.HCAPTCHA_SECRET || '';
    if (!secret) return false; // No secret configured

    const response = await postForm('https://hcaptcha.com/siteverify', {
      secret,
      response: token
    });

    const result = JSON.parse(response);
    return result.success && result.score >= 0.5;
  } catch (err) {
    console.error('CAPTCHA verification error:', err);
    return false;
  }
}

// Spam content detection
function isSpamContent(data) {
  const text = JSON.stringify(data).toLowerCase();
  
  // Check for spam indicators
  const spamPatterns = [
    /\b(free|click|buy|deposit|crypto|bitcoin)\b/,
    /https?:\/\/\S+/g, // URL density check
    /(!!!|\?\?\?|\.\.\.|🎉{3,})/g, // Suspicious punctuation
    /\b(wire transfer|nigerian prince|lottery winner)\b/i,
  ];

  const matches = spamPatterns.filter(p => p.test(text)).length;
  return matches > 2; // Flag if >2 patterns match
}

// Audit logging
function auditLog(type, data) {
  const entry = {
    type,
    ...data,
    timestamp: Date.now(),
  };
  console.log(`[AUDIT] ${JSON.stringify(entry)}`);
  fs.appendFile(RECEIPT_LOG_FILE, JSON.stringify(entry) + '\n', () => {});
}

// Persist vote authorization to database (requires DB setup)
async function persistVoteAuthorization(pollId, deviceId, clientIp, allowed) {
  // TODO: Implement database persistence
  // db.query('INSERT INTO vote_authorizations (...) VALUES (...)')
}

// Broadcast rate limiter
class BroadcastRateLimiter {
  constructor() {
    this.limits = new Map(); // peerId -> { [type]: [...timestamps] }
  }

  allow(peerId, msgType, maxPerMinute = 30) {
    const now = Date.now();
    const key = `${peerId}:${msgType}`;
    
    if (!this.limits.has(key)) {
      this.limits.set(key, []);
    }

    const timestamps = this.limits.get(key);
    // Remove old entries
    while (timestamps.length > 0 && now - timestamps[0] > 60000) {
      timestamps.shift();
    }

    if (timestamps.length >= maxPerMinute) {
      return false;
    }

    timestamps.push(now);
    return true;
  }
}

const broadcastRateLimiter = new BroadcastRateLimiter();
```

## ENVIRONMENT VARIABLES TO SET

```bash
# .env
HCAPTCHA_SECRET=your-secret-key
HCAPTCHA_SITE_KEY=your-site-key
ALLOWED_ORIGINS=http://localhost:5173,https://yourdomain.com
FRONTEND_ORIGIN=http://localhost:5173

# Optional: Redis for distributed rate limiting
REDIS_URL=redis://localhost:6379

# Optional: Database for persistence
DATABASE_URL=postgresql://user:pass@localhost/interpoll
```

## DEPENDENCIES TO INSTALL

```bash
npm install express-rate-limit helmet redis rate-limit-redis

# Optional: Captcha client library
npm install hcaptcha-verify
```

## PRIORITY IMPLEMENTATION ORDER

1. **Day 1-2**: Add helmet security headers + CORS hardening
2. **Day 2-3**: Add basic rate limiting to `/api/vote-authorize`
3. **Day 3-4**: Integrate hCaptcha
4. **Day 4-5**: Add WebSocket connection limits + message spam filtering
5. **Day 5-6**: Add database persistence (SQLite minimum)
6. **Day 6-7**: Add audit logging + admin endpoints

## TESTING

```bash
# Test rate limiting
for i in {1..15}; do
  curl -X POST http://localhost:8080/api/vote-authorize \
    -H "Content-Type: application/json" \
    -d '{"pollId":"test","deviceId":"dev1"}' 2>/dev/null &
done
wait

# Test CAPTCHA requirement (should return 403)
curl -X POST http://localhost:8080/api/vote-authorize \
  -H "Content-Type: application/json" \
  -d '{"pollId":"test","deviceId":"dev2"}'

# Test WebSocket connection limit (should close after N connections)
for i in {1..60}; do
  timeout 5 websocat ws://localhost:8080 &
done
```

---

**NEXT STEPS**: After these modifications, test thoroughly on localhost, then deploy to staging before production.

