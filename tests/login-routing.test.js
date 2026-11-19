'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ROLE_DESTINATIONS,
  PORTALS,
  PORTAL_MISMATCH_MESSAGE,
  getPortalDestination,
  getSelectedPortalDestination,
  completePortalSignIn,
  redirectUser
} = require('../public/js/login');

const loginMarkup = fs.readFileSync(path.join(__dirname, '../public/portal/login.html'), 'utf8');
const loginScript = fs.readFileSync(path.join(__dirname, '../public/js/login.js'), 'utf8');

test('portal selector exposes each configured entry as a semantic button', () => {
  const ids = [...loginMarkup.matchAll(/data-portal-id="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(ids, Object.keys(PORTALS));
  assert.match(loginMarkup, /<button[^>]+data-portal-id=/);
  assert.match(loginMarkup, /id="backToPortals"[^>]+type="button"/);
  assert.match(loginMarkup, /id="loginError"[^>]+role="alert"[^>]+aria-live="assertive"/);
  assert.doesNotMatch(loginMarkup, /\sonclick\s*=/i);
});

test('primary portals accept only their configured roles and use existing destinations', () => {
  const expected = {
    administrator: [
      ['super_admin', '/portal/admin.html'],
      ['school_admin', '/portal/admin.html']
    ],
    principal: [
      ['principal', '/portal/principal.html'],
      ['super_admin', '/portal/principal.html'],
      ['school_admin', '/portal/principal.html']
    ],
    admission_officer: [
      ['admission_officer', '/portal/admissions.html'],
      ['super_admin', '/portal/admissions.html'],
      ['school_admin', '/portal/admissions.html']
    ],
    teacher: [
      ['teacher', '/portal/teacher.html'],
      ['class_teacher', '/portal/teacher.html']
    ],
    student: [['student', '/portal/student.html']],
    parent: [['parent', '/portal/parent.html']]
  };

  for (const [portalId, roleCases] of Object.entries(expected)) {
    for (const [role, destination] of roleCases) {
      assert.equal(getSelectedPortalDestination(portalId, role), destination, `${portalId}/${role}`);
    }
  }
});

test('student, teacher, and parent roles cannot cross into another portal', () => {
  assert.equal(getSelectedPortalDestination('teacher', 'student'), null);
  assert.equal(getSelectedPortalDestination('student', 'teacher'), null);
  assert.equal(getSelectedPortalDestination('student', 'parent'), null);
  assert.equal(getSelectedPortalDestination('parent', 'student'), null);
});

test('Other Staff retains every existing secondary staff destination', () => {
  for (const role of PORTALS.other_staff.allowedRoles) {
    assert.equal(
      getSelectedPortalDestination('other_staff', role),
      ROLE_DESTINATIONS[role],
      `${role} retains its existing portal`
    );
  }
});

test('unknown and legacy roles are rejected without silent normalization', () => {
  for (const role of ['admin', 'faculty', 'unknown-role', '', null, undefined, '__proto__']) {
    assert.equal(getPortalDestination(role), null, `${String(role)} has no direct destination`);
    assert.equal(getSelectedPortalDestination('administrator', role), null);
    assert.equal(getSelectedPortalDestination('other_staff', role), null);
  }
  assert.equal(getSelectedPortalDestination('not-a-portal', 'student'), null);
});

test('mismatch does not redirect, attempts post-login logout, and gives one generic portal error', async () => {
  let logoutCalls = 0;
  let redirectCalls = 0;
  const result = await completePortalSignIn({
    portalId: 'student',
    user: { role: 'teacher' },
    logout: async () => { logoutCalls += 1; return true; },
    onAuthorized: () => { redirectCalls += 1; }
  });

  assert.equal(result.authorized, false);
  assert.equal(result.logoutSucceeded, true);
  assert.equal(logoutCalls, 1);
  assert.equal(redirectCalls, 0);
  assert.equal(PORTAL_MISMATCH_MESSAGE,
    'These credentials are not authorized for the selected portal. Please choose the correct portal.');
});

test('logout failure or rejection still fails closed and never redirects', async (t) => {
  for (const [name, logout] of [
    ['non-success response', async () => false],
    ['network error', async () => { throw new Error('synthetic logout failure'); }]
  ]) {
    await t.test(name, async () => {
      let redirectCalls = 0;
      const result = await completePortalSignIn({
        portalId: 'teacher',
        user: { role: 'parent' },
        logout,
        onAuthorized: () => { redirectCalls += 1; }
      });
      assert.equal(result.authorized, false);
      assert.equal(result.logoutSucceeded, false);
      assert.equal(redirectCalls, 0);
    });
  }
});

test('browser mismatch adapter uses the existing credentialed POST logout endpoint', () => {
  const logoutAdapter = loginScript.match(/logout: async \(\) => \{([\s\S]*?)\n        \},\n        onAuthorized/);
  assert.ok(logoutAdapter, 'post-login mismatch must provide a logout adapter');
  assert.match(logoutAdapter[1], /auth\/logout/);
  assert.match(logoutAdapter[1], /method:\s*'POST'/);
  assert.match(logoutAdapter[1], /credentials:\s*'include'/);
  assert.match(loginScript, /localStorage\.removeItem\('user'\)/);
  assert.doesNotMatch(loginScript, /localStorage\.setItem\(['"]token['"]/);
  assert.doesNotMatch(loginScript, /sessionStorage/);
});

test('legacy redirect helper still rejects unsupported roles without fallback', () => {
  const previousWindow = global.window;
  global.window = { location: { href: '/portal/login.html' } };
  try {
    assert.throws(() => redirectUser('faculty'), /not supported for portal sign-in/);
    assert.equal(global.window.location.href, '/portal/login.html');
  } finally {
    if (previousWindow === undefined) delete global.window;
    else global.window = previousWindow;
  }
});
