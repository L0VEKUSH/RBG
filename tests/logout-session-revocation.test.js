'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const express = require('express');
const cookieParser = require('cookie-parser');

const User = require('../models/User');
const authService = require('../services/auth.service');
const authController = require('../controllers/auth.controller');
const authRoutes = require('../routes/auth.routes');
const { protect } = require('../middleware/auth.middleware');
const { errorHandler } = require('../middleware/error.middleware');
const { generateToken, sendTokenResponse } = require('../utils/generateToken');
const { JWT_SECRET } = require('../config/env');

function createMockResponse() {
  const res = {
    statusCode: 200,
    cookies: {},
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    cookie(name, value, options) {
      this.cookies[name] = { value, options };
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
  return res;
}

test('Phase 22.2: Server-Side Logout and Session Revocation Suite', async (t) => {
  const originalFindById = User.findById;
  const originalFindByIdAndUpdate = User.findByIdAndUpdate;

  const usersStore = new Map();

  function registerUser(userData) {
    const id = new mongoose.Types.ObjectId().toString();
    const user = {
      _id: id,
      id,
      name: userData.name || 'Test User',
      email: userData.email || `test-${id}@school.org`,
      role: userData.role || 'student',
      isActive: userData.isActive !== undefined ? userData.isActive : true,
      tokenVersion: userData.tokenVersion || 0,
      password: 'hashed-password',
      select(fields) {
        return this;
      },
      matchPassword: async (pwd) => pwd === 'CorrectPassword123!',
      save: async function () {
        usersStore.set(this._id, this);
        return this;
      },
    };
    usersStore.set(id, user);
    return user;
  }

  User.findById = (id) => {
    const idStr = id ? (id._id ? id._id.toString() : id.toString()) : null;
    const user = usersStore.get(idStr) || null;
    return {
      select: () => Promise.resolve(user),
      then: (resolve, reject) => Promise.resolve(user).then(resolve, reject),
    };
  };

  User.findByIdAndUpdate = async (id, update, options = {}) => {
    const idStr = id ? (id._id ? id._id.toString() : id.toString()) : null;
    const user = usersStore.get(idStr);
    if (!user) return null;

    if (update.$inc && update.$inc.tokenVersion) {
      user.tokenVersion = (user.tokenVersion || 0) + update.$inc.tokenVersion;
    }
    if (update.$set) {
      Object.assign(user, update.$set);
    }
    usersStore.set(idStr, user);
    return user;
  };

  t.after(() => {
    User.findById = originalFindById;
    User.findByIdAndUpdate = originalFindByIdAndUpdate;
  });

  await t.test('1. Login and normal authenticated request still work', async () => {
    const userA = registerUser({ name: 'User A', email: 'userA@school.org' });
    const res = createMockResponse();

    sendTokenResponse(userA, 200, res, 'Login successful');
    assert.equal(res.statusCode, 200);
    assert.ok(res.cookies.token);
    assert.equal(res.cookies.token.options.httpOnly, true);
    assert.equal(res.cookies.token.options.sameSite, 'strict');

    const token = res.cookies.token.value;
    const req = { cookies: { token } };
    let nextCalled = false;
    let nextError = null;

    await protect(req, createMockResponse(), (err) => {
      nextCalled = true;
      nextError = err;
    });

    assert.equal(nextCalled, true);
    assert.equal(nextError, undefined);
    assert.ok(req.user);
    assert.equal(req.user._id, userA._id);
  });

  await t.test('2. Logout clears the cookie and revokes the current session server-side', async () => {
    const userA = registerUser({ name: 'User A Logout', tokenVersion: 0 });
    const token = generateToken({ id: userA._id, role: userA.role, tokenVersion: userA.tokenVersion });

    const req = {
      user: userA,
      cookies: { token },
    };
    const res = createMockResponse();

    await authController.logout(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.message, 'Logged out successfully');

    assert.ok(res.cookies.token);
    assert.equal(res.cookies.token.value, 'none');
    assert.equal(res.cookies.token.options.httpOnly, true);
    assert.equal(res.cookies.token.options.sameSite, 'strict');

    const updatedUser = usersStore.get(userA._id);
    assert.equal(updatedUser.tokenVersion, 1, 'tokenVersion must be incremented in database on logout');
  });

  await t.test('3. A captured pre-logout token is rejected after logout', async () => {
    const userA = registerUser({ name: 'User A Captured', tokenVersion: 0 });
    const preLogoutToken = generateToken({ id: userA._id, role: userA.role, tokenVersion: 0 });

    const reqLogout = { user: userA, cookies: { token: preLogoutToken } };
    const resLogout = createMockResponse();
    await authController.logout(reqLogout, resLogout);

    const reqProtected = { cookies: { token: preLogoutToken } };
    let nextError = null;

    await protect(reqProtected, createMockResponse(), (err) => {
      nextError = err;
    });

    assert.ok(nextError, 'Captured token must be rejected after logout');
    assert.equal(nextError.statusCode, 401);
    assert.equal(nextError.message, 'Invalid token.');
  });

  await t.test("4. Another user's session remains valid", async () => {
    const userA = registerUser({ name: 'User A Multi', tokenVersion: 0 });
    const userB = registerUser({ name: 'User B Multi', tokenVersion: 0 });

    const tokenA = generateToken({ id: userA._id, role: userA.role, tokenVersion: 0 });
    const tokenB = generateToken({ id: userB._id, role: userB.role, tokenVersion: 0 });

    const reqLogoutA = { user: userA, cookies: { token: tokenA } };
    await authController.logout(reqLogoutA, createMockResponse());

    assert.equal(usersStore.get(userA._id).tokenVersion, 1);
    assert.equal(usersStore.get(userB._id).tokenVersion, 0, "User B's tokenVersion must remain untouched");

    const reqB = { cookies: { token: tokenB } };
    let nextCalledB = false;
    let nextErrorB = null;

    await protect(reqB, createMockResponse(), (err) => {
      nextCalledB = true;
      nextErrorB = err;
    });

    assert.equal(nextCalledB, true);
    assert.equal(nextErrorB, undefined, "User B's session must remain valid");
    assert.equal(reqB.user._id, userB._id);
  });

  await t.test('5. Password change still invalidates the intended sessions', async () => {
    const user = registerUser({ name: 'User Password', tokenVersion: 2 });
    const oldToken = generateToken({ id: user._id, role: user.role, tokenVersion: 2 });

    await authService.changePassword(user._id, 'CorrectPassword123!', 'NewPassword456!');
    assert.equal(usersStore.get(user._id).tokenVersion, 3);

    const req = { cookies: { token: oldToken } };
    let nextError = null;
    await protect(req, createMockResponse(), (err) => {
      nextError = err;
    });

    assert.ok(nextError);
    assert.equal(nextError.statusCode, 401);
    assert.equal(nextError.message, 'Invalid token.');
  });

  await t.test('6. Inactive accounts remain rejected', async () => {
    const inactiveUser = registerUser({ name: 'Inactive User', isActive: false, tokenVersion: 0 });
    const token = generateToken({ id: inactiveUser._id, role: inactiveUser.role, tokenVersion: 0 });

    const req = { cookies: { token } };
    let nextError = null;
    await protect(req, createMockResponse(), (err) => {
      nextError = err;
    });

    assert.ok(nextError);
    assert.equal(nextError.statusCode, 403);
    assert.match(nextError.message, /deactivated/i);
  });

  await t.test('7. Repeated logout is safe', async () => {
    const user = registerUser({ name: 'User Repeat', tokenVersion: 0 });

    // First logout
    const req1 = { user, cookies: { token: 'valid-token' } };
    const res1 = createMockResponse();
    await authController.logout(req1, res1);
    assert.equal(res1.statusCode, 200);
    assert.equal(usersStore.get(user._id).tokenVersion, 1);

    // Repeated logout with the same user object (e.g. concurrent or sequential request)
    const req2 = { user, cookies: { token: 'none' } };
    const res2 = createMockResponse();
    await authController.logout(req2, res2);
    assert.equal(res2.statusCode, 200);
    assert.equal(usersStore.get(user._id).tokenVersion, 2, 'Safe atomic increment on repeated logout');

    // Repeated logout without user context (unauthenticated / already cleared session)
    const reqUnauth = { cookies: { token: 'none' } };
    const resUnauth = createMockResponse();
    await authController.logout(reqUnauth, resUnauth);
    assert.equal(resUnauth.statusCode, 200);
    assert.equal(resUnauth.cookies.token.value, 'none', 'Unauthenticated repeated logout clears cookie safely');
  });

  await t.test('8. Revocation-store failure follows an explicit fail-closed policy', async () => {
    const user = registerUser({ name: 'User Failure', tokenVersion: 0 });
    const token = generateToken({ id: user._id, role: user.role, tokenVersion: 0 });

    // Simulate database failure during logout
    User.findByIdAndUpdate = async () => {
      throw new Error('DATABASE_CONNECTION_LOST');
    };

    const reqLogout = { user, cookies: { token } };
    const mockRes = createMockResponse();

    // 1. Controller throws and rejects when DB update fails
    await assert.rejects(
      async () => authController.logout(reqLogout, mockRes),
      /DATABASE_CONNECTION_LOST/,
      'Logout must not pretend to succeed if the revocation write fails'
    );

    // 2. Cookie was NOT cleared because execution threw before res.cookie was reached
    assert.equal(mockRes.cookies.token, undefined, 'Cookie must not be cleared when revocation update fails');

    // 3. Response body was NOT set to success: true
    assert.equal(mockRes.body, null, 'Failed revocation cannot return success body');

    // Restore findByIdAndUpdate for subsequent tests
    User.findByIdAndUpdate = async (id, update) => {
      const idStr = id ? (id._id ? id._id.toString() : id.toString()) : null;
      const u = usersStore.get(idStr);
      if (!u) return null;
      if (update.$inc && update.$inc.tokenVersion) {
        u.tokenVersion = (u.tokenVersion || 0) + update.$inc.tokenVersion;
      }
      return u;
    };

    // Simulate database failure during protect
    const savedFindById = User.findById;
    User.findById = () => ({
      select: () => Promise.reject(new Error('DATABASE_UNAVAILABLE')),
      then: (_resolve, reject) => Promise.reject(new Error('DATABASE_UNAVAILABLE')),
    });

    let protectError = null;
    await protect({ cookies: { token } }, createMockResponse(), (err) => {
      protectError = err;
    });

    // Restore findById
    User.findById = savedFindById;

    assert.ok(protectError);
    assert.equal(protectError.statusCode, 401);
    assert.equal(protectError.message, 'Token verification failed.', 'Middleware must fail closed on DB errors');
  });

  await t.test('9. Login after logout receives the incremented token version and succeeds', async () => {
    const user = registerUser({ name: 'Re-login User', tokenVersion: 0 });
    const oldToken = generateToken({ id: user._id, role: user.role, tokenVersion: 0 });

    // Logout
    await authController.logout({ user, cookies: { token: oldToken } }, createMockResponse());
    assert.equal(usersStore.get(user._id).tokenVersion, 1);

    // Re-login: sendTokenResponse issues token with new tokenVersion
    const loginRes = createMockResponse();
    sendTokenResponse(usersStore.get(user._id), 200, loginRes, 'Login successful');
    assert.equal(loginRes.statusCode, 200);

    const newToken = loginRes.cookies.token.value;
    const decodedNew = jwt.verify(newToken, JWT_SECRET);
    assert.equal(decodedNew.tokenVersion, 1, 'New token must contain incremented tokenVersion');

    // Verify new token passes protect middleware
    let nextCalled = false;
    let nextError = null;
    const req = { cookies: { token: newToken } };
    await protect(req, createMockResponse(), (err) => {
      nextCalled = true;
      nextError = err;
    });

    assert.equal(nextCalled, true);
    assert.equal(nextError, undefined);
    assert.equal(req.user._id, user._id);
  });

  await t.test('10. Route middleware ordering blocks unauthenticated requests before controller', async () => {
    const app = express();
    app.use(cookieParser());
    app.use('/api/v1/auth', authRoutes);
    app.use(errorHandler);

    const server = await new Promise((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });

    try {
      const port = server.address().port;

      // 1. Request with no cookie -> blocked by protect with 401
      const resNoCookie = await fetch(`http://127.0.0.1:${port}/api/v1/auth/logout`, { method: 'POST' });
      assert.equal(resNoCookie.status, 401);
      const bodyNoCookie = await resNoCookie.json();
      assert.equal(bodyNoCookie.success, false);
      assert.match(bodyNoCookie.message, /Access denied/);

      // 2. Request with invalid/revoked cookie -> blocked by protect with 401
      const resInvalid = await fetch(`http://127.0.0.1:${port}/api/v1/auth/logout`, {
        method: 'POST',
        headers: { Cookie: 'token=invalid.jwt.token' },
      });
      assert.equal(resInvalid.status, 401);
      const bodyInvalid = await resInvalid.json();
      assert.equal(bodyInvalid.success, false);
      assert.match(bodyInvalid.message, /Invalid token/);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
