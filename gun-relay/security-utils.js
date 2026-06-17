/**
 * security-utils.js — Shared security utilities for InterPoll backend servers.
 *
 * Provides: input sanitization, body parsing with size limits, CORS validation,
 * security headers, and authentication helpers.
 */

import crypto from 'crypto';

// ─── Configuration ────────────────────────────────────────────────────────────

const DEFAULT_ORIGINS = ['http://localhost:5173', 'https://endless.sbs'];

export const ALLOWED_ORIGINS = (() => {
  const env = process.env.ALLOWED_ORIGINS;
  if (env) return env.split(',').map(o => o.trim()).filter(Boolean);
  return DEFAULT_ORIGINS;
})();

// ─── Input Sanitization ──────────────────────────────────────────────────────

const ID_PATTERN = /^[a-zA-Z0-9_\-:.]{1,128}$/;
const SOUL_PATTERN = /^[a-zA-Z0-9_\-/:.~]{1,1000}$/;
const CONTROL_CHARS = /[\x00-\x1f\x7f]/g;

/**
 * Validate and sanitize an identifier (peerId, roomId, pollId, deviceId, etc.).
 * Returns null if the ID is invalid.
 */
export function sanitizeId(id, maxLen = 128) {
  if (typeof id !== 'string' || id.length === 0 || id.length > maxLen) return null;
  if (!ID_PATTERN.test(id)) return null;
  return id;
}

/**
 * Validate a GunDB soul path. Returns null if invalid.
 */
export function sanitizeSoul(soul) {
  if (typeof soul !== 'string' || soul.length === 0 || soul.length > 1000) return null;
  if (!SOUL_PATTERN.test(soul)) return null;
  // Block path traversal
  if (soul.includes('..') || soul.includes('//')) return null;
  return soul;
}

/**
 * Sanitize a string for safe logging — strip control characters and cap length.
 */
export function sanitizeLogString(str, maxLen = 200) {
  if (typeof str !== 'string') return String(str).slice(0, maxLen);
  return str.replace(CONTROL_CHARS, '').slice(0, maxLen);
}

/**
 * Sanitize a string field from user input — strip control chars, enforce max length.
 */
export function sanitizeString(str, maxLen = 5000) {
  if (typeof str !== 'string') return '';
  return str.replace(CONTROL_CHARS, '').slice(0, maxLen);
}

// ─── Body Parsing ────────────────────────────────────────────────────────────

/**
 * Parse a request body with size enforcement.
 * Rejects bodies exceeding maxBytes with a 413 status.
 * Returns parsed JSON or null on error.
 */
export function parseBodyWithLimit(req, res, maxBytes = 51200) {
  return new Promise((resolve) => {
    let body = '';
    let exceeded = false;

    req.on('data', (chunk) => {
      body += chunk.toString();
      if (body.length > maxBytes) {
        exceeded = true;
        req.destroy();
      }
    });

    req.on('end', () => {
      if (exceeded) {
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Payload too large' }));
        resolve(null);
        return;
      }
      try {
        resolve(JSON.parse(body || '{}'));
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
        resolve(null);
      }
    });

    req.on('error', () => {
      if (!res.headersSent) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Request error' }));
      }
      resolve(null);
    });
  });
}

// ─── CORS ─────────────────────────────────────────────────────────────────────

/**
 * Validate and set CORS headers. Returns false if the origin is not allowed.
 */
export function setCorsHeaders(req, res) {
  const origin = req.headers.origin;

  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  } else if (!origin) {
    // Same-origin requests (no Origin header) — allow
    res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGINS[0]);
  } else {
    // Unknown origin — deny
    res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGINS[0]);
    // Don't set Vary to avoid caching issues; the mismatch will cause the browser to block
  }

  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Cache-Control, X-Requested-With');
  res.setHeader('Vary', 'Origin');
}

/**
 * Check if the request origin is allowed. Returns true if allowed.
 */
export function isOriginAllowed(req) {
  const origin = req.headers.origin;
  if (!origin) return true; // Same-origin or non-browser
  return ALLOWED_ORIGINS.includes(origin);
}

// ─── Security Headers ─────────────────────────────────────────────────────────

/**
 * Set standard security headers on the response.
 */
export function setSecurityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '0');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self' wss: ws: https:");
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
}

// ─── Authentication Helpers ───────────────────────────────────────────────────

/**
 * Verify a shared secret from the Authorization header.
 * Expected format: "Bearer <secret>"
 */
export function verifySharedSecret(req, expectedSecret) {
  if (!expectedSecret) return false; // Secret not configured = reject all
  const authHeader = req.headers['authorization'];
  if (!authHeader) return false;
  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') return false;
  return crypto.timingSafeEqual(
    Buffer.from(parts[1]),
    Buffer.from(expectedSecret)
  );
}

/**
 * Middleware-style auth check. Sends 401 and returns false if unauthorized.
 */
export function requireSecret(req, res, secretEnvVar) {
  const secret = process.env[secretEnvVar];
  if (!secret) {
    console.warn(`⚠️  ${secretEnvVar} not set — endpoint is disabled`);
    res.writeHead(503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Endpoint not configured' }));
    return false;
  }
  if (!verifySharedSecret(req, secret)) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Unauthorized' }));
    return false;
  }
  return true;
}

// ─── HMAC Utilities ───────────────────────────────────────────────────────────

/**
 * Verify an HMAC-SHA256 signature.
 */
export function verifyHmac(message, signature, secret) {
  if (!message || !signature || !secret) return false;
  try {
    const expected = crypto.createHmac('sha256', secret).update(message).digest('hex');
    if (expected.length !== signature.length) return false;
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}

// ─── Rate Limiting (Express middleware compatible) ─────────────────────────────

/**
 * Simple per-IP rate limiter for Express-style middleware.
 */
export function createRateLimitMiddleware(limit = 30, windowMs = 60000) {
  const hits = new Map();

  setInterval(() => {
    const cutoff = Date.now() - windowMs;
    for (const [ip, timestamps] of hits) {
      const filtered = timestamps.filter(t => t > cutoff);
      if (filtered.length === 0) hits.delete(ip);
      else hits.set(ip, filtered);
    }
  }, windowMs);

  return function rateLimitCheck(req, res) {
    const ip = req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const windowStart = now - windowMs;

    let timestamps = hits.get(ip) || [];
    timestamps = timestamps.filter(t => t > windowStart);
    timestamps.push(now);
    hits.set(ip, timestamps);

    if (timestamps.length > limit) {
      res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': String(Math.ceil(windowMs / 1000)) });
      res.end(JSON.stringify({ error: 'Too many requests' }));
      return false;
    }
    return true;
  };
}

// ─── Generic Error Response ───────────────────────────────────────────────────

/**
 * Send a generic error response without leaking internal details.
 * Logs the real error server-side.
 */
export function sendError(res, statusCode, publicMessage, internalError = null, context = '') {
  if (internalError) {
    console.error(`❌ ${context}:`, internalError.message || internalError);
  }
  if (!res.headersSent) {
    res.writeHead(statusCode, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: publicMessage }));
  }
}
