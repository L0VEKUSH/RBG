'use strict';
/**
 * Phase 22.5A — CSRF Edge-Case and Route Coverage Verification Tests
 *
 * Verifies:
 *  1. Trusted frontend Origin with Sec-Fetch-Site: same-origin passes
 *  2. Trusted frontend Origin with Sec-Fetch-Site: same-site passes
 *  3. Untrusted sibling-subdomain Origin with Sec-Fetch-Site: same-site is rejected with 403
 *  4. Untrusted external Origin with Sec-Fetch-Site: cross-site is rejected with 403
 *  5. Conflicting trusted Origin and cross-site Fetch Metadata is rejected with 403
 *  6. Missing Origin with trusted Referer passes
 *  7. Missing Origin with untrusted Referer is rejected with 403
 *  8. Missing Origin, Referer, and Fetch Metadata passes (CLI / API client compatibility)
 *  9. Subdomain suffix spoofing attempt (e.g. school.edu.attacker.com) is rejected with 403
 * 10. Subdomain prefix spoofing attempt (e.g. evil.school.edu) is rejected with 403
 * 11. Port bypass attempt (e.g. school.edu:8443) is rejected with 403
 * 12. Protocol downgrade attempt (http:// vs https://) is rejected with 403
 * 13. Trailing slash in environment configuration is safely normalized
 * 14. Production fail-safe: missing trusted origins yields 500 error
 * 15. Safe methods (GET, HEAD, OPTIONS) remain unaffected by origin headers
 * 16. Express pipeline integration: state-changing requests are blocked before reaching handlers
 * 17. Preflight OPTIONS requests pass without origin rejection
 * 18. Bearer-token requests originating from untrusted browser context are blocked equally
 */

const { test } = require('node:test');
const assert   = require('node:assert/strict');
const path     = require('path');
const express  = require('express');

const REPO = path.resolve(__dirname, '..');
const {
  protectOrigin,
  getTrustedOrigins,
  parseValidOrigin,
  SAFE_METHODS,
} = require(path.join(REPO, 'middleware', 'origin-protection.middleware'));

test('Phase 22.5A: CSRF Edge-Case and Route Coverage Suite', async (t) => {

  // ── 1. Same-site sibling-origin verification ──────────────────────────────
  await t.test('1. Trusted frontend Origin with Sec-Fetch-Site: same-origin passes', () => {
    const savedCors = process.env.CORS_ORIGIN;
    process.env.CORS_ORIGIN = 'https://school.vercel.app';

    try {
      let nextCalled = false;
      const fakeReq = {
        method: 'POST',
        headers: {
          origin: 'https://school.vercel.app',
          'sec-fetch-site': 'same-origin',
        },
      };
      protectOrigin(fakeReq, {}, (err) => {
        assert.equal(err, undefined);
        nextCalled = true;
      });
      assert.equal(nextCalled, true, 'Trusted origin with same-origin should pass');
    } finally {
      process.env.CORS_ORIGIN = savedCors;
    }
  });

  await t.test('2. Trusted frontend Origin with Sec-Fetch-Site: same-site passes', () => {
    const savedCors = process.env.CORS_ORIGIN;
    process.env.CORS_ORIGIN = 'https://school.vercel.app';

    try {
      let nextCalled = false;
      const fakeReq = {
        method: 'POST',
        headers: {
          origin: 'https://school.vercel.app',
          'sec-fetch-site': 'same-site',
        },
      };
      protectOrigin(fakeReq, {}, (err) => {
        assert.equal(err, undefined);
        nextCalled = true;
      });
      assert.equal(nextCalled, true, 'Trusted origin with same-site should pass');
    } finally {
      process.env.CORS_ORIGIN = savedCors;
    }
  });

  await t.test('3. Untrusted sibling-subdomain Origin with Sec-Fetch-Site: same-site is rejected with 403', () => {
    const savedCors = process.env.CORS_ORIGIN;
    process.env.CORS_ORIGIN = 'https://school.vercel.app';

    try {
      // Sibling subdomain on same provider eTLD+1 (vercel.app)
      let errorPassed = null;
      const fakeReq = {
        method: 'POST',
        headers: {
          origin: 'https://malicious-tenant.vercel.app',
          'sec-fetch-site': 'same-site',
        },
      };
      protectOrigin(fakeReq, {}, (err) => { errorPassed = err; });

      assert.ok(errorPassed, 'Expected untrusted sibling origin to be rejected');
      assert.equal(errorPassed.statusCode, 403);
      assert.ok(errorPassed.message.includes('Cross-origin'));
    } finally {
      process.env.CORS_ORIGIN = savedCors;
    }
  });

  await t.test('4. Untrusted external Origin with Sec-Fetch-Site: cross-site is rejected with 403', () => {
    const savedCors = process.env.CORS_ORIGIN;
    process.env.CORS_ORIGIN = 'https://school.vercel.app';

    try {
      let errorPassed = null;
      const fakeReq = {
        method: 'POST',
        headers: {
          origin: 'https://evil.attacker.com',
          'sec-fetch-site': 'cross-site',
        },
      };
      protectOrigin(fakeReq, {}, (err) => { errorPassed = err; });

      assert.ok(errorPassed, 'Expected cross-site external origin to be rejected');
      assert.equal(errorPassed.statusCode, 403);
    } finally {
      process.env.CORS_ORIGIN = savedCors;
    }
  });

  await t.test('5. Conflicting trusted Origin and cross-site Fetch Metadata is rejected with 403', () => {
    const savedCors = process.env.CORS_ORIGIN;
    process.env.CORS_ORIGIN = 'https://school.vercel.app';

    try {
      // Origin header matches trusted origin, but Sec-Fetch-Site indicates cross-site context
      let errorPassed = null;
      const fakeReq = {
        method: 'POST',
        headers: {
          origin: 'https://school.vercel.app',
          'sec-fetch-site': 'cross-site',
        },
      };
      protectOrigin(fakeReq, {}, (err) => { errorPassed = err; });

      assert.ok(errorPassed, 'Conflicting cross-site metadata must be rejected');
      assert.equal(errorPassed.statusCode, 403);
      assert.ok(errorPassed.message.includes('Cross-site request blocked'));
    } finally {
      process.env.CORS_ORIGIN = savedCors;
    }
  });

  await t.test('6. Missing Origin with trusted Referer passes', () => {
    const savedCors = process.env.CORS_ORIGIN;
    process.env.CORS_ORIGIN = 'https://school.vercel.app';

    try {
      let nextCalled = false;
      const fakeReq = {
        method: 'POST',
        headers: {
          referer: 'https://school.vercel.app/portal/dashboard',
        },
      };
      protectOrigin(fakeReq, {}, (err) => {
        assert.equal(err, undefined);
        nextCalled = true;
      });
      assert.equal(nextCalled, true, 'Trusted referer without origin should pass');
    } finally {
      process.env.CORS_ORIGIN = savedCors;
    }
  });

  await t.test('7. Missing Origin with untrusted Referer is rejected with 403', () => {
    const savedCors = process.env.CORS_ORIGIN;
    process.env.CORS_ORIGIN = 'https://school.vercel.app';

    try {
      let errorPassed = null;
      const fakeReq = {
        method: 'POST',
        headers: {
          referer: 'https://evil-phishing.com/portal/login',
        },
      };
      protectOrigin(fakeReq, {}, (err) => { errorPassed = err; });

      assert.ok(errorPassed, 'Untrusted referer must be rejected');
      assert.equal(errorPassed.statusCode, 403);
      assert.ok(errorPassed.message.includes('Cross-origin request blocked'));
    } finally {
      process.env.CORS_ORIGIN = savedCors;
    }
  });

  await t.test('8. Missing Origin, Referer, and Fetch Metadata passes (non-browser compatibility)', () => {
    let nextCalled = false;
    const fakeReq = {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
    };
    protectOrigin(fakeReq, {}, (err) => {
      assert.equal(err, undefined);
      nextCalled = true;
    });
    assert.equal(nextCalled, true, 'Absence of all browser metadata should pass for server-to-server/CLI calls');
  });

  // ── 2. Origin exact matching and isolation checks ─────────────────────────
  await t.test('9. Subdomain suffix spoofing attempt is rejected with 403', () => {
    const savedCors = process.env.CORS_ORIGIN;
    process.env.CORS_ORIGIN = 'https://myschool.edu';

    try {
      let errorPassed = null;
      const fakeReq = {
        method: 'PUT',
        headers: {
          origin: 'https://myschool.edu.attacker.org',
        },
      };
      protectOrigin(fakeReq, {}, (err) => { errorPassed = err; });

      assert.ok(errorPassed);
      assert.equal(errorPassed.statusCode, 403);
    } finally {
      process.env.CORS_ORIGIN = savedCors;
    }
  });

  await t.test('10. Subdomain prefix spoofing attempt is rejected with 403', () => {
    const savedCors = process.env.CORS_ORIGIN;
    process.env.CORS_ORIGIN = 'https://myschool.edu';

    try {
      let errorPassed = null;
      const fakeReq = {
        method: 'DELETE',
        headers: {
          origin: 'https://evil.myschool.edu',
        },
      };
      protectOrigin(fakeReq, {}, (err) => { errorPassed = err; });

      assert.ok(errorPassed);
      assert.equal(errorPassed.statusCode, 403);
    } finally {
      process.env.CORS_ORIGIN = savedCors;
    }
  });

  await t.test('11. Port bypass attempt is rejected with 403', () => {
    const savedCors = process.env.CORS_ORIGIN;
    process.env.CORS_ORIGIN = 'https://myschool.edu';

    try {
      let errorPassed = null;
      const fakeReq = {
        method: 'POST',
        headers: {
          origin: 'https://myschool.edu:8443',
        },
      };
      protectOrigin(fakeReq, {}, (err) => { errorPassed = err; });

      assert.ok(errorPassed);
      assert.equal(errorPassed.statusCode, 403);
    } finally {
      process.env.CORS_ORIGIN = savedCors;
    }
  });

  await t.test('12. Protocol downgrade attempt (http:// vs https://) is rejected with 403', () => {
    const savedCors = process.env.CORS_ORIGIN;
    process.env.CORS_ORIGIN = 'https://myschool.edu';

    try {
      let errorPassed = null;
      const fakeReq = {
        method: 'POST',
        headers: {
          origin: 'http://myschool.edu',
        },
      };
      protectOrigin(fakeReq, {}, (err) => { errorPassed = err; });

      assert.ok(errorPassed);
      assert.equal(errorPassed.statusCode, 403);
    } finally {
      process.env.CORS_ORIGIN = savedCors;
    }
  });

  await t.test('13. Trailing slashes in configuration are normalized safely', () => {
    const savedCors = process.env.CORS_ORIGIN;
    process.env.CORS_ORIGIN = 'https://school.edu.in/';

    try {
      const trusted = getTrustedOrigins();
      assert.ok(trusted.has('https://school.edu.in'), 'Origin should be normalized without trailing slash');
      assert.equal(trusted.has('https://school.edu.in/'), false, 'Set should not store trailing slash');

      let nextCalled = false;
      const fakeReq = {
        method: 'POST',
        headers: {
          origin: 'https://school.edu.in',
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

  await t.test('14. Production fail-safe: missing trusted origins yields 500 error', () => {
    const savedEnv = process.env.NODE_ENV;
    const savedCors = process.env.CORS_ORIGIN;
    const savedFe = process.env.FRONTEND_URL;
    const savedSw = process.env.SCHOOL_WEBSITE;

    process.env.NODE_ENV = 'production';
    delete process.env.CORS_ORIGIN;
    delete process.env.FRONTEND_URL;
    delete process.env.SCHOOL_WEBSITE;

    try {
      let errorPassed = null;
      const fakeReq = {
        method: 'POST',
        headers: { origin: 'https://somewhere.com' },
      };
      protectOrigin(fakeReq, {}, (err) => { errorPassed = err; });

      assert.ok(errorPassed, 'Expected production fail-safe error');
      assert.equal(errorPassed.statusCode, 500);
      assert.ok(errorPassed.message.includes('Server configuration error'));
    } finally {
      process.env.NODE_ENV = savedEnv;
      if (savedCors !== undefined) process.env.CORS_ORIGIN = savedCors; else delete process.env.CORS_ORIGIN;
      if (savedFe !== undefined) process.env.FRONTEND_URL = savedFe; else delete process.env.FRONTEND_URL;
      if (savedSw !== undefined) process.env.SCHOOL_WEBSITE = savedSw; else delete process.env.SCHOOL_WEBSITE;
    }
  });

  // ── 3. Method immunity and preflight checks ───────────────────────────────
  await t.test('15. Safe methods (GET, HEAD, OPTIONS) remain unaffected by untrusted origin headers', () => {
    for (const method of ['GET', 'HEAD', 'OPTIONS']) {
      let nextCalled = false;
      const fakeReq = {
        method,
        headers: {
          origin: 'https://untrusted-attacker.com',
          'sec-fetch-site': 'cross-site',
          referer: 'https://untrusted-attacker.com/exploit',
        },
      };
      protectOrigin(fakeReq, {}, (err) => {
        assert.equal(err, undefined);
        nextCalled = true;
      });
      assert.equal(nextCalled, true, `Method ${method} should not be blocked`);
    }
  });

  // ── 4. Express pipeline and handler execution verification ────────────────
  await t.test('16. Express pipeline integration: state-changing handler is NEVER reached on untrusted origin', async () => {
    const savedCors = process.env.CORS_ORIGIN;
    process.env.CORS_ORIGIN = 'https://school.portal.edu';

    const http = require('http');
    const app = express();
    app.use(express.json());
    app.use(protectOrigin);

    let handlerReached = false;
    app.post('/api/v1/test-mutation', (req, res) => {
      handlerReached = true;
      res.status(200).json({ success: true, message: 'mutated' });
    });

    app.use((err, req, res, next) => {
      res.status(err.statusCode || 500).json({ success: false, message: err.message });
    });

    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;

    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/v1/test-mutation`, {
        method: 'POST',
        headers: {
          origin: 'https://attacker.com',
          'sec-fetch-site': 'cross-site',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ name: 'attack' }),
      });

      assert.equal(response.status, 403);
      const data = await response.json();
      assert.equal(data.success, false);
      assert.equal(handlerReached, false, 'Handler should NOT have been reached!');
    } finally {
      process.env.CORS_ORIGIN = savedCors;
      await new Promise((resolve) => server.close(resolve));
    }
  });

  await t.test('17. Express pipeline integration: state-changing handler IS reached on trusted origin', async () => {
    const savedCors = process.env.CORS_ORIGIN;
    process.env.CORS_ORIGIN = 'https://school.portal.edu';

    const http = require('http');
    const app = express();
    app.use(express.json());
    app.use(protectOrigin);

    let handlerReached = false;
    app.post('/api/v1/test-mutation', (req, res) => {
      handlerReached = true;
      res.status(200).json({ success: true, message: 'mutated' });
    });

    app.use((err, req, res, next) => {
      res.status(err.statusCode || 500).json({ success: false, message: err.message });
    });

    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;

    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/v1/test-mutation`, {
        method: 'POST',
        headers: {
          origin: 'https://school.portal.edu',
          'sec-fetch-site': 'same-origin',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ name: 'legitimate' }),
      });

      assert.equal(response.status, 200);
      const data = await response.json();
      assert.equal(data.success, true);
      assert.equal(handlerReached, true, 'Handler should have been reached');
    } finally {
      process.env.CORS_ORIGIN = savedCors;
      await new Promise((resolve) => server.close(resolve));
    }
  });

  await t.test('18. Bearer-token requests from untrusted browser context are blocked equally', () => {
    const savedCors = process.env.CORS_ORIGIN;
    process.env.CORS_ORIGIN = 'https://school.portal.edu';

    try {
      let errorPassed = null;
      const fakeReq = {
        method: 'POST',
        headers: {
          authorization: 'Bearer valid-jwt-token-string',
          origin: 'https://evil-browser-site.com',
          'sec-fetch-site': 'cross-site',
        },
      };
      protectOrigin(fakeReq, {}, (err) => { errorPassed = err; });

      assert.ok(errorPassed, 'Browser requests carrying Bearer headers must still respect origin protection');
      assert.equal(errorPassed.statusCode, 403);
    } finally {
      process.env.CORS_ORIGIN = savedCors;
    }
  });

});
