'use strict';
/**
 * Phase 22.5 — CSRF and Request-Origin Protection Tests (Fully Offline)
 *
 * Verifies:
 *  1. Safe read-only methods (GET, HEAD, OPTIONS) are exempt from origin blocking
 *  2. State-changing requests (POST, PUT, PATCH, DELETE) with trusted Origin pass
 *  3. Untrusted cross-origin requests (Origin: https://evil.com) rejected with 403
 *  4. 'Origin: null' (sandboxed iframe / opaque origin) rejected with 403
 *  5. Malformed Origin header (credentials, invalid protocol, path) rejected with 403
 *  6. Fetch Metadata: Sec-Fetch-Site: cross-site rejected with 403
 *  7. Fetch Metadata: Sec-Fetch-Site: same-origin with trusted Origin passes
 *  8. Vercel reverse-proxy compatibility: proxied request with trusted frontend Origin passes
 *  9. Referer fallback: untrusted Referer rejected with 403 when Origin omitted
 * 10. Referer fallback: trusted Referer passes when Origin omitted
 * 11. Malformed Referer rejected with 403
 * 12. Non-browser integration compatibility: absence of Origin, Referer, and Sec-Fetch-Site proceeds
 * 13. Production fail-safe: missing trusted origins in production returns 500 error
 * 14. Wildcard origin (*) is never accepted as a trusted origin
 * 15. Login route compatibility with origin validation
 * 16. Logout route compatibility with origin validation (cross-origin CSRF logout blocked)
 * 17. Password reset route compatibility with origin validation
 * 18. Upload workflow compatibility: POST /profile-photo allows trusted origin, blocks evil.com
 * 19. Download workflow compatibility: GET /api/v1/uploads allows safe read to reach ownership checks
 * 20. Legacy /uploads route remains authenticated and not public static
 * 21. External URL references in extractStorageKey are preserved and not treated as local files
 */

const { test } = require('node:test');
const assert   = require('node:assert/strict');
const path     = require('path');

const REPO = path.resolve(__dirname, '..');
const {
  protectOrigin,
  getTrustedOrigins,
  parseValidOrigin,
  SAFE_METHODS,
} = require(path.join(REPO, 'middleware', 'origin-protection.middleware'));
const uploadService = require(path.join(REPO, 'services', 'upload.service'));

test('Phase 22.5: CSRF and Request-Origin Protection Suite', async (t) => {

  // ── 1. Safe read-only methods are exempt ──────────────────────────────────
  await t.test('1. Safe read-only methods (GET, HEAD, OPTIONS) bypass origin check', () => {
    for (const method of ['GET', 'HEAD', 'OPTIONS']) {
      let nextCalled = false;
      const fakeReq = {
        method,
        headers: { origin: 'https://evil.com', 'sec-fetch-site': 'cross-site' },
      };
      const fakeRes = {};
      protectOrigin(fakeReq, fakeRes, (err) => {
        assert.equal(err, undefined);
        nextCalled = true;
      });
      assert.equal(nextCalled, true, `Method ${method} should not be blocked`);
    }
  });

  // ── 2. Trusted same-origin requests pass ─────────────────────────────────
  await t.test('2. State-changing requests with trusted Origin pass through', () => {
    const savedCors = process.env.CORS_ORIGIN;
    process.env.CORS_ORIGIN = 'https://school.edu.in,https://admin.school.edu.in';

    try {
      for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
        let nextCalled = false;
        const fakeReq = {
          method,
          headers: {
            origin: 'https://school.edu.in',
            'sec-fetch-site': 'same-origin',
          },
        };
        protectOrigin(fakeReq, {}, (err) => {
          assert.equal(err, undefined);
          nextCalled = true;
        });
        assert.equal(nextCalled, true, `${method} from trusted origin should pass`);
      }
    } finally {
      process.env.CORS_ORIGIN = savedCors;
    }
  });

  // ── 3. Untrusted cross-origin requests rejected (403) ────────────────────
  await t.test('3. Untrusted cross-origin requests (Origin: https://evil.com) rejected with 403', () => {
    const savedCors = process.env.CORS_ORIGIN;
    process.env.CORS_ORIGIN = 'https://trusted-school.edu.in';

    try {
      for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
        let errorPassed = null;
        const fakeReq = {
          method,
          headers: { origin: 'https://evil.com' },
        };
        protectOrigin(fakeReq, {}, (err) => { errorPassed = err; });
        assert.ok(errorPassed, `Expected ${method} from evil.com to be blocked`);
        assert.equal(errorPassed.statusCode, 403);
        assert.ok(errorPassed.message.includes('Cross-origin'));
      }
    } finally {
      process.env.CORS_ORIGIN = savedCors;
    }
  });

  // ── 4. Origin: null rejected (403) ────────────────────────────────────────
  await t.test('4. Origin: null (sandboxed iframe / opaque origin) rejected with 403', () => {
    let errorPassed = null;
    const fakeReq = {
      method: 'POST',
      headers: { origin: 'null' },
    };
    protectOrigin(fakeReq, {}, (err) => { errorPassed = err; });
    assert.ok(errorPassed);
    assert.equal(errorPassed.statusCode, 403);
    assert.ok(errorPassed.message.includes('Untrusted or malformed'));
  });

  // ── 5. Malformed Origin headers rejected (403) ───────────────────────────
  await t.test('5. Malformed Origin header (credentials, paths, query) rejected with 403', () => {
    const malformed = [
      'https://user:pass@evil.com',
      'https://school.edu.in/path/to/page',
      'https://school.edu.in?query=1',
      'not-a-valid-url',
      'javascript:alert(1)',
    ];
    for (const badOrigin of malformed) {
      let errorPassed = null;
      const fakeReq = {
        method: 'POST',
        headers: { origin: badOrigin },
      };
      protectOrigin(fakeReq, {}, (err) => { errorPassed = err; });
      assert.ok(errorPassed, `Expected "${badOrigin}" to be rejected`);
      assert.equal(errorPassed.statusCode, 403);
    }
  });

  // ── 6. Fetch Metadata: Sec-Fetch-Site: cross-site rejected ───────────────
  await t.test('6. Fetch Metadata: Sec-Fetch-Site: cross-site rejected with 403', () => {
    let errorPassed = null;
    const fakeReq = {
      method: 'POST',
      headers: {
        'sec-fetch-site': 'cross-site',
      },
    };
    protectOrigin(fakeReq, {}, (err) => { errorPassed = err; });
    assert.ok(errorPassed);
    assert.equal(errorPassed.statusCode, 403);
    assert.ok(errorPassed.message.includes('Cross-site request blocked'));
  });

  // ── 7. Fetch Metadata: same-origin with trusted Origin passes ─────────────
  await t.test('7. Fetch Metadata: same-origin with trusted Origin passes', () => {
    const savedCors = process.env.CORS_ORIGIN;
    process.env.CORS_ORIGIN = 'https://school.edu.in';

    try {
      let nextCalled = false;
      const fakeReq = {
        method: 'POST',
        headers: {
          origin: 'https://school.edu.in',
          'sec-fetch-site': 'same-origin',
        },
      };
      protectOrigin(fakeReq, {}, (err) => {
        assert.equal(err, undefined);
        nextCalled = true;
      });
      assert.equal(nextCalled, true);
    } finally {
      process.env.CORS_ORIGIN = savedCors;
    }
  });

  // ── 8. Vercel reverse-proxy compatibility ─────────────────────────────────
  await t.test('8. Vercel reverse-proxy compatibility: forwarded trusted Vercel Origin passes', () => {
    const savedCors = process.env.CORS_ORIGIN;
    const savedFrontend = process.env.FRONTEND_URL;
    process.env.CORS_ORIGIN = 'https://my-school.vercel.app';
    process.env.FRONTEND_URL = 'https://my-school.vercel.app';

    try {
      let nextCalled = false;
      // Simulated Vercel external rewrite request arriving at Render:
      const fakeReq = {
        method: 'POST',
        headers: {
          host: 'school-api.onrender.com',
          origin: 'https://my-school.vercel.app',
          'sec-fetch-site': 'same-origin',
          'x-forwarded-host': 'my-school.vercel.app',
          'x-forwarded-proto': 'https',
        },
      };
      protectOrigin(fakeReq, {}, (err) => {
        assert.equal(err, undefined);
        nextCalled = true;
      });
      assert.equal(nextCalled, true, 'Proxied Vercel request with matching Origin must be allowed');
    } finally {
      process.env.CORS_ORIGIN = savedCors;
      process.env.FRONTEND_URL = savedFrontend;
    }
  });

  // ── 9. Referer fallback: untrusted Referer rejected ───────────────────────
  await t.test('9. Referer fallback: untrusted Referer rejected with 403 when Origin omitted', () => {
    const savedCors = process.env.CORS_ORIGIN;
    process.env.CORS_ORIGIN = 'https://school.edu.in';

    try {
      let errorPassed = null;
      const fakeReq = {
        method: 'POST',
        headers: {
          referer: 'https://attacker.org/phishing-form.html',
        },
      };
      protectOrigin(fakeReq, {}, (err) => { errorPassed = err; });
      assert.ok(errorPassed);
      assert.equal(errorPassed.statusCode, 403);
    } finally {
      process.env.CORS_ORIGIN = savedCors;
    }
  });

  // ── 10. Referer fallback: trusted Referer passes ──────────────────────────
  await t.test('10. Referer fallback: trusted Referer passes when Origin omitted', () => {
    const savedCors = process.env.CORS_ORIGIN;
    process.env.CORS_ORIGIN = 'https://school.edu.in';

    try {
      let nextCalled = false;
      const fakeReq = {
        method: 'POST',
        headers: {
          referer: 'https://school.edu.in/portal/login.html',
        },
      };
      protectOrigin(fakeReq, {}, (err) => {
        assert.equal(err, undefined);
        nextCalled = true;
      });
      assert.equal(nextCalled, true);
    } finally {
      process.env.CORS_ORIGIN = savedCors;
    }
  });

  // ── 11. Malformed Referer rejected ────────────────────────────────────────
  await t.test('11. Malformed Referer header rejected with 403', () => {
    let errorPassed = null;
    const fakeReq = {
      method: 'POST',
      headers: { referer: 'not a valid url' },
    };
    protectOrigin(fakeReq, {}, (err) => { errorPassed = err; });
    assert.ok(errorPassed);
    assert.equal(errorPassed.statusCode, 403);
  });

  // ── 12. Non-browser integration compatibility ─────────────────────────────
  await t.test('12. Non-browser integration compatibility: absent Origin, Referer, and Sec-Fetch-Site proceeds', () => {
    let nextCalled = false;
    const fakeReq = {
      method: 'POST',
      headers: {
        'user-agent': 'curl/7.88.1',
        'content-type': 'application/json',
      },
    };
    protectOrigin(fakeReq, {}, (err) => {
      assert.equal(err, undefined);
      nextCalled = true;
    });
    assert.equal(nextCalled, true, 'Non-browser CLI / automated request without browser headers should proceed');
  });

  // ── 13. Production fail-safe: missing configuration returns 500 ───────────
  await t.test('13. Production fail-safe: empty trusted origins in production returns 500 error', () => {
    const savedNodeEnv = process.env.NODE_ENV;
    const savedCors = process.env.CORS_ORIGIN;
    const savedFrontend = process.env.FRONTEND_URL;
    const savedSchool = process.env.SCHOOL_WEBSITE;

    process.env.NODE_ENV = 'production';
    process.env.CORS_ORIGIN = '';
    process.env.FRONTEND_URL = '';
    process.env.SCHOOL_WEBSITE = '';

    try {
      let errorPassed = null;
      const fakeReq = {
        method: 'POST',
        headers: { origin: 'https://some-site.com' },
      };
      protectOrigin(fakeReq, {}, (err) => { errorPassed = err; });
      assert.ok(errorPassed);
      assert.equal(errorPassed.statusCode, 500);
      assert.ok(errorPassed.message.includes('Server configuration error'));
    } finally {
      process.env.NODE_ENV = savedNodeEnv;
      process.env.CORS_ORIGIN = savedCors;
      process.env.FRONTEND_URL = savedFrontend;
      process.env.SCHOOL_WEBSITE = savedSchool;
    }
  });

  // ── 14. Wildcard origin (*) is never accepted ─────────────────────────────
  await t.test('14. Wildcard origin (*) is never accepted as a trusted origin', () => {
    const savedCors = process.env.CORS_ORIGIN;
    process.env.CORS_ORIGIN = '*,https://valid.school.edu.in';

    try {
      const origins = getTrustedOrigins();
      assert.equal(origins.has('*'), false, 'Wildcard must not be in trusted origins');
      assert.equal(origins.has('https://valid.school.edu.in'), true);
    } finally {
      process.env.CORS_ORIGIN = savedCors;
    }
  });

  // ── 15. Login route compatibility with origin validation ──────────────────
  await t.test('15. Login route compatibility: allowed with trusted origin, blocked with evil origin', () => {
    const savedCors = process.env.CORS_ORIGIN;
    process.env.CORS_ORIGIN = 'https://school.edu.in';

    try {
      // Allowed from trusted origin
      let allowed = false;
      protectOrigin({
        method: 'POST',
        originalUrl: '/api/v1/auth/login',
        headers: { origin: 'https://school.edu.in' },
      }, {}, (err) => {
        assert.equal(err, undefined);
        allowed = true;
      });
      assert.equal(allowed, true);

      // Blocked from evil.com
      let blockedErr = null;
      protectOrigin({
        method: 'POST',
        originalUrl: '/api/v1/auth/login',
        headers: { origin: 'https://evil.com' },
      }, {}, (err) => { blockedErr = err; });
      assert.ok(blockedErr);
      assert.equal(blockedErr.statusCode, 403);
    } finally {
      process.env.CORS_ORIGIN = savedCors;
    }
  });

  // ── 16. Logout route compatibility (CSRF logout blocked) ──────────────────
  await t.test('16. Logout route compatibility: cross-origin CSRF logout blocked with 403', () => {
    const savedCors = process.env.CORS_ORIGIN;
    process.env.CORS_ORIGIN = 'https://school.edu.in';

    try {
      let blockedErr = null;
      protectOrigin({
        method: 'POST',
        originalUrl: '/api/v1/auth/logout',
        headers: { origin: 'https://attacker.org' },
      }, {}, (err) => { blockedErr = err; });
      assert.ok(blockedErr);
      assert.equal(blockedErr.statusCode, 403);
    } finally {
      process.env.CORS_ORIGIN = savedCors;
    }
  });

  // ── 17. Password reset compatibility ──────────────────────────────────────
  await t.test('17. Password reset compatibility: trusted origin allowed, cross-origin blocked', () => {
    const savedCors = process.env.CORS_ORIGIN;
    process.env.CORS_ORIGIN = 'https://school.edu.in';

    try {
      let allowed = false;
      protectOrigin({
        method: 'PUT',
        originalUrl: '/api/v1/auth/reset-password',
        headers: { origin: 'https://school.edu.in' },
      }, {}, (err) => {
        assert.equal(err, undefined);
        allowed = true;
      });
      assert.equal(allowed, true);

      let blockedErr = null;
      protectOrigin({
        method: 'PUT',
        originalUrl: '/api/v1/auth/reset-password',
        headers: { origin: 'https://evil.com' },
      }, {}, (err) => { blockedErr = err; });
      assert.ok(blockedErr);
      assert.equal(blockedErr.statusCode, 403);
    } finally {
      process.env.CORS_ORIGIN = savedCors;
    }
  });

  // ── 18. Upload workflow compatibility ─────────────────────────────────────
  await t.test('18. Upload workflow compatibility: POST /profile-photo allows trusted origin, blocks evil.com', () => {
    const savedCors = process.env.CORS_ORIGIN;
    process.env.CORS_ORIGIN = 'https://school.edu.in';

    try {
      let uploadAllowed = false;
      protectOrigin({
        method: 'POST',
        originalUrl: '/api/v1/auth/profile-photo',
        headers: { origin: 'https://school.edu.in' },
      }, {}, (err) => {
        assert.equal(err, undefined);
        uploadAllowed = true;
      });
      assert.equal(uploadAllowed, true);

      let uploadBlocked = null;
      protectOrigin({
        method: 'POST',
        originalUrl: '/api/v1/auth/profile-photo',
        headers: { origin: 'https://evil.com' },
      }, {}, (err) => { uploadBlocked = err; });
      assert.ok(uploadBlocked);
      assert.equal(uploadBlocked.statusCode, 403);
    } finally {
      process.env.CORS_ORIGIN = savedCors;
    }
  });

  // ── 19. Download workflow compatibility ───────────────────────────────────
  await t.test('19. Download workflow compatibility: GET /api/v1/uploads allows safe read to reach ownership checks', () => {
    let downloadAllowed = false;
    protectOrigin({
      method: 'GET',
      originalUrl: '/api/v1/uploads/documents/doc123.pdf',
      headers: { origin: 'https://school.edu.in' },
    }, {}, (err) => {
      assert.equal(err, undefined);
      downloadAllowed = true;
    });
    assert.equal(downloadAllowed, true, 'GET requests must bypass origin-protection to reach controller ownership checks');
  });

  // ── 20. Legacy /uploads route remains authenticated ───────────────────────
  await t.test('20. Legacy /uploads route remains routed through authenticated upload routes', () => {
    const serverSource = require('fs').readFileSync(path.join(REPO, 'server.js'), 'utf8');
    assert.match(serverSource, /app\.use\(['"]\/uploads['"],\s*require\(['"]\.\/routes\/upload\.routes['"]\)\)/);
    assert.doesNotMatch(serverSource, /app\.use\(['"]\/uploads['"],\s*express\.static/);
  });

  // ── 21. External URL references in extractStorageKey are preserved ─────────
  await t.test('21. External URL references in extractStorageKey are preserved and not treated as local files', () => {
    const extUrls = [
      'https://images.unsplash.com/photo-1544005313-94ddf0286df2',
      'http://cdn.school.org/avatars/student.png',
      'default-avatar.png',
      '/images/logo.png',
    ];
    for (const url of extUrls) {
      assert.equal(uploadService.extractStorageKey(url), null, `External URL "${url}" should return null`);
    }

    const localUrl = '/api/v1/uploads/profiles/1234567890abcdef1234567890abcdef.jpg';
    assert.deepEqual(uploadService.extractStorageKey(localUrl), {
      category: 'profiles',
      filename: '1234567890abcdef1234567890abcdef.jpg',
    });
  });

});
