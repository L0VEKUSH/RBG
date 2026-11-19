'use strict';
/**
 * origin-protection.middleware.js — Request-Origin & CSRF Defense
 *
 * Implements robust server-side origin and Fetch Metadata defense compatible
 * with the HttpOnly, Secure, SameSite=Strict cookie architecture and
 * the Vercel-to-Render same-origin reverse-proxy deployment contract.
 *
 * Security properties:
 * - Safe read-only HTTP methods (GET, HEAD, OPTIONS) are exempt.
 * - For state-changing methods (POST, PUT, PATCH, DELETE):
 *     1. Rejects Fetch Metadata declaring Sec-Fetch-Site: cross-site.
 *     2. Rejects 'null' Origin headers (sandboxed frames / opaque origins).
 *     3. Parses and validates the Origin header against the configured
 *        trusted origins (from CORS_ORIGIN, FRONTEND_URL, and SCHOOL_WEBSITE).
 *     4. Rejects malformed or untrusted Origin headers with 403 Forbidden.
 *     5. Rejects untrusted Referer headers when Origin is absent.
 *     6. Preserves non-browser integrations and test runners where neither
 *        Origin, Referer, nor Sec-Fetch-Site is present.
 *     7. Fails safely in production if no trusted origins are configured.
 */

const ErrorResponse = require('../utils/errorResponse');

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Compile and normalize the set of trusted origins from environment configuration.
 *
 * In production:
 *   - Only explicit HTTPS origins are accepted.
 *   - Wildcards (*) are strictly rejected.
 *   - Origins must be well-formed URL origins without userinfo, path, query, or hash.
 */
function getTrustedOrigins() {
  const origins = new Set();
  const isProduction = process.env.NODE_ENV === 'production';

  // 1. CORS_ORIGIN (comma-separated list of allowed origins)
  const rawCors = (process.env.CORS_ORIGIN || '').trim();
  if (rawCors) {
    for (const item of rawCors.split(',')) {
      const trimmed = item.trim();
      if (!trimmed || trimmed === '*') continue;
      try {
        const parsed = new URL(trimmed);
        if (isProduction && parsed.protocol !== 'https:') continue;
        if (!parsed.username && !parsed.password && (!parsed.pathname || parsed.pathname === '/')) {
          origins.add(parsed.origin);
        }
      } catch (_) {}
    }
  }

  // 2. FRONTEND_URL and SCHOOL_WEBSITE
  for (const envVar of [process.env.FRONTEND_URL, process.env.SCHOOL_WEBSITE]) {
    if (envVar && typeof envVar === 'string' && envVar.trim()) {
      try {
        const parsed = new URL(envVar.trim());
        if (isProduction && parsed.protocol !== 'https:') continue;
        if (!parsed.username && !parsed.password && (!parsed.pathname || parsed.pathname === '/')) {
          origins.add(parsed.origin);
        }
      } catch (_) {}
    }
  }

  // 3. Localhost fallbacks for non-production environments
  if (!isProduction) {
    origins.add('http://localhost:5000');
    origins.add('http://127.0.0.1:5000');
    origins.add('http://localhost:3000');
    origins.add('http://127.0.0.1:3000');
  }

  return origins;
}

/**
 * Validate that an origin string is syntactically a pure origin without path, query, or credentials.
 * @param {string} originStr
 * @returns {string | null} Normalized origin or null if invalid
 */
function parseValidOrigin(originStr) {
  if (!originStr || typeof originStr !== 'string') return null;
  const trimmed = originStr.trim();
  if (trimmed === 'null') return 'null';
  try {
    const parsed = new URL(trimmed);
    if (parsed.username || parsed.password) return null;
    if (parsed.pathname && parsed.pathname !== '/') return null;
    if (parsed.search || parsed.hash) return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

/**
 * Origin protection middleware
 */
function protectOrigin(req, res, next) {
  const method = (req.method || '').toUpperCase();

  // 1. Safe read-only methods are exempt
  if (SAFE_METHODS.has(method)) {
    return next();
  }

  const isProduction = process.env.NODE_ENV === 'production';
  const trustedOrigins = getTrustedOrigins();

  // 2. Production configuration fail-safe check
  if (isProduction && trustedOrigins.size === 0) {
    return next(new ErrorResponse('Server configuration error: trusted origins not configured', 500));
  }

  // 3. Fetch Metadata check (Sec-Fetch-Site)
  const secFetchSite = req.headers['sec-fetch-site'];
  if (secFetchSite && secFetchSite.toLowerCase() === 'cross-site') {
    return next(new ErrorResponse('Cross-site request blocked', 403));
  }

  // 4. Origin header validation
  const originHeader = req.headers['origin'];
  if (originHeader !== undefined) {
    const parsedOrigin = parseValidOrigin(originHeader);
    if (!parsedOrigin || parsedOrigin === 'null') {
      return next(new ErrorResponse('Untrusted or malformed origin header', 403));
    }
    if (!trustedOrigins.has(parsedOrigin)) {
      return next(new ErrorResponse('Cross-origin request blocked', 403));
    }
    // Origin is valid and trusted
    return next();
  }

  // 5. Referer fallback check (when Origin is omitted by browser)
  const refererHeader = req.headers['referer'];
  if (refererHeader) {
    let refererOrigin;
    try {
      refererOrigin = new URL(refererHeader).origin;
    } catch {
      return next(new ErrorResponse('Malformed referer header', 403));
    }
    if (!trustedOrigins.has(refererOrigin)) {
      return next(new ErrorResponse('Cross-origin request blocked', 403));
    }
    // Referer is valid and trusted
    return next();
  }

  // 6. When Origin, Referer, and Sec-Fetch-Site are all absent:
  // Non-browser integrations (curl, test harnesses, internal tools) proceed normally.
  next();
}

module.exports = {
  protectOrigin,
  getTrustedOrigins,
  parseValidOrigin,
  SAFE_METHODS,
};
