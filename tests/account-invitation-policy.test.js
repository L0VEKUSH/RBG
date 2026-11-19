'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const Module = require('node:module');
const test = require('node:test');

const AcademicYear = require('../models/AcademicYear');
const Faculty = require('../models/Faculty');
const Student = require('../models/Student');
const User = require('../models/User');
const parentController = require('../controllers/parent.controller');
const parentService = require('../services/parent.service');

function requireWithOverrides(modulePath, overrides) {
  const resolvedPath = require.resolve(modulePath);
  const originalLoad = Module._load;
  Module._load = function loadWithOverrides(request, parent, isMain) {
    if (parent && parent.filename === resolvedPath && Object.prototype.hasOwnProperty.call(overrides, request)) {
      return overrides[request];
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    return require(resolvedPath);
  } finally {
    Module._load = originalLoad;
  }
}

const invitationAuthService = { sendActivationEmail: async () => ({ status: 'sent' }) };
const invitationService = requireWithOverrides('../services/account-invitation.service', {
  './auth.service': invitationAuthService,
});
const invitationController = require('../controllers/invitation.controller');
const authService = requireWithOverrides('../services/auth.service', {
  '../utils/sendEmail': { sendEmail: async () => {} },
  '../utils/logger': { info() {}, warn() {}, error() {} },
  './email-delivery.service': {
    createDelivery: async () => ({ status: 'sent' }),
    invalidateDelivery: async () => {},
    requeueCurrentDelivery: async () => null,
  },
});
const parentRouter = requireWithOverrides('../routes/parent.routes', {
  '../middleware/auth.middleware': {
    protect: (_req, _res, next) => next(),
  },
  '../middleware/authorization.middleware': {
    requireRole: () => (_req, _res, next) => next(),
    requirePermission: () => (_req, _res, next) => next(),
    requireOwnership: () => (_req, _res, next) => next(),
    requireClassAccess: () => (_req, _res, next) => next(),
  },
});
const invitationRouteControllerCalls = [];
const invitationRouter = requireWithOverrides('../routes/invitation.routes', {
  '../middleware/auth.middleware': {
    protect: (_req, _res, next) => next(),
  },
  '../controllers/invitation.controller': {
    inviteStudent(_req, res) {
      invitationRouteControllerCalls.push('student');
      res.status(201).json({ success: true });
    },
    inviteTeacher(_req, res) {
      invitationRouteControllerCalls.push('teacher');
      res.status(201).json({ success: true });
    },
  },
});

function queryResult(value) {
  const query = {
    select() { return query; },
    lean() { return Promise.resolve(value); },
    then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); },
  };
  return query;
}

async function withStubs(stubs, callback) {
  const originals = [];
  for (const [target, key, replacement] of stubs) {
    originals.push([target, key, target[key]]);
    target[key] = replacement;
  }
  try {
    return await callback();
  } finally {
    for (const [target, key, original] of originals.reverse()) target[key] = original;
  }
}

function studentInvitation(overrides = {}) {
  return {
    name: 'Synthetic Student',
    email: 'student.invite@example.invalid',
    gender: 'other',
    dateOfBirth: '2012-02-03',
    rollNumber: '71',
    class: '7',
    academicYear: '2026-2027',
    enrollmentEffectiveFrom: '2026-06-01',
    father: { name: 'Synthetic Father' },
    mother: { name: 'Synthetic Mother' },
    ...overrides,
  };
}

function teacherInvitation(overrides = {}) {
  return {
    name: 'Synthetic Teacher',
    email: 'teacher.invite@example.invalid',
    gender: 'other',
    dateOfBirth: '1990-04-05',
    department: 'Mathematics',
    designation: 'Teacher',
    joiningDate: '2024-06-01',
    ...overrides,
  };
}

function makeState() {
  return {
    currentUser: null,
    userFindCalls: 0,
    userWrites: [],
    studentProfile: null,
    teacherProfile: null,
    studentProfileFindCalls: 0,
    teacherProfileFindCalls: 0,
    studentProfileWrites: [],
    teacherProfileWrites: [],
    academicYearFindCalls: 0,
    activationCalls: [],
  };
}

function invitationStubs(state) {
  return [
    [User, 'findOne', () => {
      state.userFindCalls += 1;
      return queryResult(state.currentUser);
    }],
    [User, 'create', async data => {
      state.userWrites.push(data);
      return data;
    }],
    [Student, 'findOne', () => {
      state.studentProfileFindCalls += 1;
      return queryResult(state.studentProfile);
    }],
    [Student, 'create', async data => {
      state.studentProfileWrites.push(data);
      return { ...data, admissionNumber: 'SYNTHETIC-ADM-71' };
    }],
    [Faculty, 'findOne', () => {
      state.teacherProfileFindCalls += 1;
      return queryResult(state.teacherProfile);
    }],
    [Faculty, 'create', async data => {
      state.teacherProfileWrites.push(data);
      return { ...data, employeeId: 'SYNTHETIC-EMP-71' };
    }],
    [AcademicYear, 'find', () => {
      state.academicYearFindCalls += 1;
      return queryResult([{
        name: '2026-2027',
        startDate: new Date('2026-04-01T00:00:00.000Z'),
        endDate: new Date('2027-03-31T12:00:00.000Z'),
      }]);
    }],
    [invitationAuthService, 'sendActivationEmail', async user => {
      state.activationCalls.push(user);
      return { status: 'sent', token: 'synthetic-activation-secret' };
    }],
  ];
}

function responseRecorder() {
  return {
    statusCode: null,
    body: null,
    ended: false,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; this.ended = true; return this; },
  };
}

function makeSyntheticActivationState(plainToken, expiresAt) {
  const tokenHash = crypto.createHash('sha256').update(plainToken).digest('hex');
  const user = {
    _id: 'synthetic-user',
    activationToken: tokenHash,
    activationTokenExpire: new Date(expiresAt),
    isActive: false,
    isEmailVerified: false,
    activationTokenSagaId: 'synthetic-activation-saga',
    activationTokenSagaGeneration: 4,
    accountInvitationType: 'teacher',
    accountInvitationFingerprint: 'a'.repeat(64),
  };

  // This models the production query's state conditions and update operators;
  // it does not prove MongoDB atomicity or concurrent single-use behavior.
  async function findOneAndUpdate(filter, update) {
    const tokenMatches = user.activationToken === filter.activationToken;
    const expiresAfterQueryTime = user.activationTokenExpire instanceof Date
      && Number.isFinite(filter.activationTokenExpire?.$gt)
      && user.activationTokenExpire.getTime() > filter.activationTokenExpire.$gt;
    const inactiveMatches = filter.isActive?.$ne === true && user.isActive !== true;
    if (!tokenMatches || !expiresAfterQueryTime || !inactiveMatches) return null;

    Object.assign(user, update.$set);
    for (const field of Object.keys(update.$unset || {})) delete user[field];
    return { ...user };
  }

  return { user, findOneAndUpdate };
}

async function runRouteMiddleware(handler, req, res) {
  let nextCalled = false;
  let nextError = null;
  const next = error => {
    nextCalled = true;
    nextError = error || null;
  };
  const result = handler(req, res, next);
  if (result && typeof result.then === 'function') await result;
  return { nextCalled, error: nextError };
}

async function invokeInvitationRoute(path, actor, body) {
  const routeLayer = invitationRouter.stack.find(layer =>
    layer.route && layer.route.path === path && layer.route.methods.post
  );
  assert.ok(routeLayer, `POST ${path} route exists`);

  const req = { body, user: actor, params: {}, query: {}, headers: {} };
  const res = responseRecorder();
  const routeHandlers = routeLayer.route.stack.map(layer => layer.handle);
  const controller = routeHandlers.pop();
  const middleware = [
    ...invitationRouter.stack.filter(layer => !layer.route).map(layer => layer.handle),
    ...routeHandlers,
  ];

  let error = null;
  for (const handler of middleware) {
    const outcome = await runRouteMiddleware(handler, req, res);
    if (outcome.error) {
      error = outcome.error;
      break;
    }
    if (!outcome.nextCalled || res.ended) break;
  }

  if (!error && !res.ended) {
    const outcome = await runRouteMiddleware(controller, req, res);
    error = outcome.error;
  }
  return { error, res };
}

test('Student and Teacher invites assign fixed inactive account roles', async () => {
  const state = makeState();
  await withStubs(invitationStubs(state), async () => {
    await invitationService.inviteStudent(studentInvitation());
    await invitationService.inviteTeacher(teacherInvitation());

    assert.equal(state.userWrites[0].role, 'student');
    assert.equal(state.userWrites[1].role, 'faculty', 'Teacher invitations use the existing legacy Faculty role');
    for (const user of state.userWrites) {
      assert.equal(user.isActive, false);
      assert.equal(user.isEmailVerified, false);
      assert.match(user.password, /^[a-f0-9]{96}$/);
    }
    assert.equal(state.studentProfileWrites.length, 1);
    assert.equal(state.teacherProfileWrites.length, 1);
    assert.equal(state.activationCalls.length, 2);
    assert.equal(state.academicYearFindCalls, 1);
  });
});

test('both invitation services reject caller-controlled credentials, roles, permissions, activation, and token fields', async () => {
  const state = makeState();
  const forbidden = [
    ['password', 'caller-password'],
    ['role', 'super_admin'],
    ['permissions', ['*']],
    ['isActive', true],
    ['isEmailVerified', true],
    ['activationToken', 'caller-token'],
    ['activationTokenExpire', new Date()],
    ['activationTokenSagaId', 'caller-saga'],
    ['resetPasswordToken', 'caller-reset-token'],
    ['accountInvitationFingerprint', 'caller-fingerprint'],
  ];

  await withStubs(invitationStubs(state), async () => {
    for (const [field, value] of forbidden) {
      await assert.rejects(
        invitationService.inviteStudent(studentInvitation({ [field]: value })),
        error => error.statusCode === 400,
        `Student invitation must reject ${field}`
      );
      await assert.rejects(
        invitationService.inviteTeacher(teacherInvitation({ [field]: value })),
        error => error.statusCode === 400,
        `Teacher invitation must reject ${field}`
      );
    }
    assert.equal(state.userFindCalls, 0);
    assert.equal(state.userWrites.length, 0);
    assert.equal(state.academicYearFindCalls, 0);
  });
});

test('inactive invited accounts cannot authenticate before activation', async () => {
  let updateLastLoginCalls = 0;
  const inactiveUser = {
    isLocked: false,
    isActive: false,
    matchPassword: async () => true,
    incrementLoginAttempts: async () => {},
    updateLastLogin: async () => { updateLastLoginCalls += 1; },
  };

  await withStubs([
    [User, 'findOne', () => queryResult(inactiveUser)],
  ], async () => {
    await assert.rejects(
      authService.login('student.invite@example.invalid', 'synthetic-password', '127.0.0.1'),
      error => error.statusCode === 403
    );
    assert.equal(updateLastLoginCalls, 0);
  });
});

test('activation accepts the correct token before its fixed future expiry', async () => {
  const plainToken = 'synthetic-activation-token';
  const state = makeSyntheticActivationState(plainToken, '2099-01-01T00:00:00.000Z');
  await withStubs([
    [User, 'findOneAndUpdate', state.findOneAndUpdate],
  ], async () => {
    const activated = await authService.activateAccount(plainToken, 'Synthetic-User-Password-2026!');
    assert.equal(activated.isActive, true);
    assert.equal(state.user.isEmailVerified, true);
    assert.equal(state.user.isActive, true);
  });
});

test('activation rejects a wrong token without changing synthetic account state', async () => {
  const state = makeSyntheticActivationState('expected-synthetic-token', '2099-01-01T00:00:00.000Z');
  await withStubs([
    [User, 'findOneAndUpdate', state.findOneAndUpdate],
  ], async () => {
    await assert.rejects(
      authService.activateAccount('wrong-synthetic-token', 'Synthetic-User-Password-2026!'),
      error => error.statusCode === 400
    );
    assert.equal(state.user.isActive, false);
    assert.equal(state.user.activationToken, crypto.createHash('sha256').update('expected-synthetic-token').digest('hex'));
  });
});

test('activation rejects a token with a fixed past expiry without changing account state', async () => {
  const state = makeSyntheticActivationState('expired-synthetic-token', '2000-01-01T00:00:00.000Z');
  await withStubs([
    [User, 'findOneAndUpdate', state.findOneAndUpdate],
  ], async () => {
    await assert.rejects(
      authService.activateAccount('expired-synthetic-token', 'Synthetic-User-Password-2026!'),
      error => error.statusCode === 400
    );
    assert.equal(state.user.isActive, false);
    assert.ok(state.user.activationTokenExpire.getTime() < Date.now());
  });
});

test('activation replay fails after successful activation consumed the stored token', async () => {
  const plainToken = 'single-use-synthetic-token';
  const state = makeSyntheticActivationState(plainToken, '2099-01-01T00:00:00.000Z');
  await withStubs([
    [User, 'findOneAndUpdate', state.findOneAndUpdate],
  ], async () => {
    await authService.activateAccount(plainToken, 'Synthetic-User-Password-2026!');
    await assert.rejects(
      authService.activateAccount(plainToken, 'Synthetic-User-Password-2026!'),
      error => error.statusCode === 400
    );
    assert.equal(state.user.isActive, true);
    assert.equal(Object.hasOwn(state.user, 'activationToken'), false);
  });
});

test('successful activation clears token, saga, and invitation markers', async () => {
  const plainToken = 'marker-cleanup-synthetic-token';
  const state = makeSyntheticActivationState(plainToken, '2099-01-01T00:00:00.000Z');
  const markerFields = [
    'activationToken', 'activationTokenExpire', 'activationTokenSagaId',
    'activationTokenSagaGeneration', 'accountInvitationType', 'accountInvitationFingerprint',
  ];
  await withStubs([
    [User, 'findOneAndUpdate', state.findOneAndUpdate],
  ], async () => {
    await authService.activateAccount(plainToken, 'Synthetic-User-Password-2026!');
    for (const field of markerFields) {
      assert.equal(Object.hasOwn(state.user, field), false, `${field} is cleared from stored state`);
    }
  });
});

test('invitation routes run the real role and permission middleware before their controllers', async () => {
  const initialCalls = invitationRouteControllerCalls.length;
  for (const role of ['school_admin', 'admin']) {
    for (const [path, permission, controllerName, body] of [
      ['/students', 'students.create', 'student', studentInvitation()],
      ['/teachers', 'teachers.create', 'teacher', teacherInvitation()],
    ]) {
      const result = await invokeInvitationRoute(path, { role, permissions: [permission] }, body);
      assert.equal(result.error, null, `${role} with ${permission} is authorized`);
      assert.equal(result.res.statusCode, 201);
      assert.equal(invitationRouteControllerCalls.at(-1), controllerName);
    }
  }

  const callsBeforeDenied = invitationRouteControllerCalls.length;
  const wrongRole = await invokeInvitationRoute('/students', {
    role: 'teacher',
    permissions: ['students.create'],
  }, studentInvitation());
  assert.equal(wrongRole.error?.statusCode, 403);
  assert.equal(invitationRouteControllerCalls.length, callsBeforeDenied, 'role rejection prevents controller execution');

  for (const [path, permission, body] of [
    ['/students', 'students.create', studentInvitation()],
    ['/teachers', 'teachers.create', teacherInvitation()],
  ]) {
    const denied = await invokeInvitationRoute(path, {
      role: 'school_admin',
      permissions: [`-${permission}`],
    }, body);
    assert.equal(denied.error?.statusCode, 403, `${permission} deny override is enforced`);
    assert.equal(invitationRouteControllerCalls.length, callsBeforeDenied, `${permission} rejection prevents controller execution`);
  }
  assert.equal(invitationRouteControllerCalls.length, initialCalls + 4);
});

test('matching inactive orphan resumes without replacing credentials or exposing activation material', async () => {
  const state = makeState();
  await withStubs(invitationStubs(state), async () => {
    await invitationService.inviteTeacher(teacherInvitation());
    const orphan = state.userWrites[0];
    const bootstrapPassword = orphan.password;
    state.currentUser = orphan;

    const response = responseRecorder();
    await invitationController.inviteTeacher({ body: teacherInvitation() }, response, error => { throw error; });

    assert.equal(response.statusCode, 200);
    assert.equal(state.userWrites.length, 1, 'recovery does not create a replacement User or bootstrap credential');
    assert.equal(state.teacherProfileWrites.length, 2, 'the missing profile is resumed once');
    assert.equal(orphan.password, bootstrapPassword);
    assert.equal(state.activationCalls.length, 2);
    const serialized = JSON.stringify(response.body);
    for (const privateValue of [bootstrapPassword, 'synthetic-activation-secret', orphan.accountInvitationFingerprint]) {
      assert.ok(!serialized.includes(privateValue));
    }
    for (const privateField of ['password', 'activationToken', 'accountInvitationFingerprint']) {
      assert.ok(!Object.prototype.hasOwnProperty.call(response.body.data, privateField));
    }
  });
});

test('recovery rejects mismatched fingerprints, identities, account types, and orphan records without markers', async () => {
  const state = makeState();
  await withStubs(invitationStubs(state), async () => {
    await invitationService.inviteTeacher(teacherInvitation());
    const original = state.userWrites[0];
    const profileLookupsBefore = state.teacherProfileFindCalls;

    for (const candidate of [
      { ...original, accountInvitationFingerprint: '0'.repeat(64) },
      { ...original, name: 'Different Synthetic Person' },
      { ...original, role: 'student' },
    ]) {
      state.currentUser = candidate;
      await assert.rejects(
        invitationService.inviteTeacher(teacherInvitation()),
        error => error.statusCode === 409
      );
      assert.equal(state.teacherProfileFindCalls, profileLookupsBefore, 'identity or fingerprint mismatch fails before profile lookup');
    }

    const orphanWithoutMarker = { ...original };
    delete orphanWithoutMarker.accountInvitationType;
    delete orphanWithoutMarker.accountInvitationFingerprint;
    state.currentUser = orphanWithoutMarker;
    await assert.rejects(
      invitationService.inviteTeacher(teacherInvitation()),
      error => error.statusCode === 409
    );
    assert.equal(state.teacherProfileFindCalls, profileLookupsBefore + 1);
    assert.equal(state.userWrites.length, 1);
    assert.equal(state.teacherProfileWrites.length, 1);
    assert.equal(state.activationCalls.length, 1);
  });
});

test('recovery never overwrites an existing mismatched profile or replaces an active activation token', async () => {
  const state = makeState();
  await withStubs(invitationStubs(state), async () => {
    await invitationService.inviteTeacher(teacherInvitation());
    const original = state.userWrites[0];
    const existingProfile = { ...state.teacherProfileWrites[0], department: 'Science' };
    state.currentUser = original;
    state.teacherProfile = existingProfile;

    await assert.rejects(
      invitationService.inviteTeacher(teacherInvitation()),
      error => error.statusCode === 409
    );
    assert.equal(state.teacherProfileWrites.length, 1);
    assert.equal(existingProfile.department, 'Science');
    assert.equal(state.activationCalls.length, 1);

    state.teacherProfile = null;
    state.currentUser = { ...original, activationToken: 'synthetic-existing-token-hash' };
    await assert.rejects(
      invitationService.inviteTeacher(teacherInvitation()),
      error => error.statusCode === 409
    );
    assert.equal(state.userWrites.length, 1);
    assert.equal(state.teacherProfileWrites.length, 1);
    assert.equal(state.activationCalls.length, 1);
  });
});

test('each admission and activation saga marker independently blocks recovery, including null and malformed values', async () => {
  const state = makeState();
  const markerCases = [
    ['admissionSagaId', 'synthetic-admission-saga'],
    ['admissionSagaGeneration', 7],
    ['admissionSagaOwnership', 'owned'],
    ['activationTokenSagaId', 'synthetic-activation-saga'],
    ['activationTokenSagaGeneration', 3],
    ['admissionSagaId', null],
    ['admissionSagaGeneration', null],
    ['admissionSagaOwnership', null],
    ['activationTokenSagaId', null],
    ['activationTokenSagaGeneration', null],
    ['admissionSagaGeneration', 'malformed-generation'],
    ['admissionSagaOwnership', 'unexpected-owner'],
    ['activationTokenSagaGeneration', 'malformed-generation'],
    ['admissionSagaId', []],
    ['activationTokenSagaId', {}],
  ];

  await withStubs(invitationStubs(state), async () => {
    await invitationService.inviteTeacher(teacherInvitation());
    const original = state.userWrites[0];
    const profileLookupsBefore = state.teacherProfileFindCalls;

    for (const [field, value] of markerCases) {
      state.currentUser = { ...original, [field]: value };
      await assert.rejects(
        invitationService.inviteTeacher(teacherInvitation()),
        error => error.statusCode === 409,
        `${field}=${String(value)} must fail closed`
      );
      assert.equal(state.teacherProfileFindCalls, profileLookupsBefore, `${field} must reject before profile lookup`);
    }
    assert.equal(state.userWrites.length, 1);
    assert.equal(state.teacherProfileWrites.length, 1);
    assert.equal(state.activationCalls.length, 1);
  });
});

test('legacy Parent controller and direct service creation both return the disabled-operation error', async () => {
  const createRoute = parentRouter.stack.find(layer =>
    layer.route && layer.route.path === '/' && layer.route.methods.post
  );
  assert.ok(createRoute);
  assert.equal(createRoute.route.stack[createRoute.route.stack.length - 1].handle, parentController.createParent);

  const response = responseRecorder();
  await parentController.createParent({ body: { userData: { password: 'synthetic-forbidden' } } }, response, error => { throw error; });
  assert.equal(response.statusCode, 410);
  assert.equal(response.body.success, false);
  assert.match(response.body.message, /temporarily unavailable/i);

  await assert.rejects(
    parentService.createParent({ children: ['synthetic-child'] }, { password: 'synthetic-forbidden' }),
    error => error.statusCode === 410
  );
});
