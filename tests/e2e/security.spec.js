const { test, expect } = require('@playwright/test');
const crypto = require('crypto');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const User = require('../../models/User');
const Student = require('../../models/Student');
const Parent = require('../../models/Parent');
const Faculty = require('../../models/Faculty');
const Subject = require('../../models/Subject');
const SubjectAllocation = require('../../models/SubjectAllocation');
const Attendance = require('../../models/Attendance');

const mongoUri = process.env.MONGO_TEST_URI;
const parsedUri = new URL(mongoUri);
const database = parsedUri.pathname.replace(/^\/+/, '');
const password = 'Synthetic-E2E-Password-2026!';
const academicYear = '2026-2027';
const fixtures = {};

function randomEmail(label) {
  return `e2e-${label}-${crypto.randomBytes(4).toString('hex')}@example.com`;
}

async function createUser(label, role, permissions = [], isActive = true) {
  return User.create({
    name: `Synthetic E2E ${label}`,
    email: randomEmail(label.toLowerCase().replace(/\s+/g, '-')),
    password,
    role,
    permissions,
    isActive,
    isEmailVerified: true,
  });
}

async function seedFixtures() {
  await mongoose.connect(mongoUri);

  const subjectA = await Subject.create({
    name: 'Synthetic E2E Mathematics',
    code: `E2E-${crypto.randomBytes(4).toString('hex')}`,
    type: 'Core',
    classLevels: ['5'],
    isActive: true,
  });
  const subjectB = await Subject.create({
    name: 'Synthetic E2E Science',
    code: `E2E-${crypto.randomBytes(4).toString('hex')}`,
    type: 'Core',
    classLevels: ['6'],
    isActive: true,
  });
  const teacher = await createUser('Teacher', 'teacher', [
    'attendance.mark',
    'attendance.edit-authorized',
    'attendance.view-assigned',
  ]);
  const otherTeacher = await createUser('Other Teacher', 'teacher', [
    'attendance.mark',
    'attendance.edit-authorized',
  ]);
  const student = await createUser('Student A', 'student', ['attendance.view-own']);
  const otherStudent = await createUser('Student B', 'student', ['attendance.view-own']);
  const inactive = await createUser('Inactive', 'student', [], false);
  const activationUser = await createUser('Activation', 'student', [], false);
  const activationToken = activationUser.getActivationToken();
  await activationUser.save({ validateBeforeSave: false });
  const activationRaceUser = await createUser('Activation Race', 'student', [], false);
  const activationRaceToken = activationRaceUser.getActivationToken();
  await activationRaceUser.save({ validateBeforeSave: false });
  const resetUser = await createUser('Reset', 'student');
  const resetToken = resetUser.getResetPasswordToken();
  await resetUser.save({ validateBeforeSave: false });
  const parent = await createUser('Parent A', 'parent', ['attendance.view-linked']);
  const unrelatedParent = await createUser('Parent B', 'parent', ['attendance.view-linked']);

  const teacherFaculty = await Faculty.create({
    user: teacher._id,
    department: 'Mathematics',
    designation: 'Teacher',
    joiningDate: new Date(),
  });
  const otherFaculty = await Faculty.create({
    user: otherTeacher._id,
    department: 'Science',
    designation: 'Teacher',
    joiningDate: new Date(),
  });
  const studentRecord = await Student.create({
    user: student._id,
    rollNumber: 1,
    class: '5',
    academicYear,
    father: { name: 'Synthetic Parent A' },
    mother: { name: 'Synthetic Guardian A' },
  });
  const otherStudentRecord = await Student.create({
    user: otherStudent._id,
    rollNumber: 2,
    class: '6',
    academicYear,
    father: { name: 'Synthetic Parent B' },
    mother: { name: 'Synthetic Guardian B' },
  });
  await Parent.create({ user: parent._id, relationship: 'Father', children: [studentRecord._id] });
  await Parent.create({ user: unrelatedParent._id, relationship: 'Father', children: [] });
  await SubjectAllocation.create({
    teacher: teacherFaculty._id,
    subject: subjectA._id,
    class: '5',
    academicYear,
  });
  await SubjectAllocation.create({
    teacher: otherFaculty._id,
    subject: subjectB._id,
    class: '6',
    academicYear,
  });
  const protectedRecord = await Attendance.create({
    student: otherStudentRecord._id,
    class: '6',
    date: new Date('2026-11-03T00:00:00.000Z'),
    status: 'Present',
    subject: subjectB._id,
    academicYear,
    markedBy: otherTeacher._id,
  });

  Object.assign(fixtures, {
    teacher,
    otherTeacher,
    student,
    otherStudent,
    inactive,
    activationUser,
    activationToken,
    activationRaceToken,
    resetUser,
    resetToken,
    parent,
    unrelatedParent,
    studentRecord,
    otherStudentRecord,
    subjectA,
    subjectB,
    protectedRecord,
  });
}

async function login(page, email, expectedPath) {
  await page.goto('/portal/login.html');
  await page.getByLabel('Email Address').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page).toHaveURL(new RegExp(`${expectedPath.replace('.', '\\.')}$`));
}

async function browserFetch(page, path, options = {}) {
  return page.evaluate(async ({ path, options }) => {
    const response = await fetch(path, {
      credentials: 'include',
      ...options,
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    });
    return { status: response.status, body: await response.json() };
  }, { path, options });
}

test.beforeAll(async () => {
  await seedFixtures();
});

test.afterAll(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

test('active login uses an HttpOnly cookie and does not expose a JWT to browser storage', async ({ page }) => {
  await page.goto('/portal/login.html');
  await page.getByLabel('Email Address').fill(fixtures.student.email);
  await page.getByLabel('Password').fill(password);
  const loginBody = await page.evaluate(async ({ email, password }) => {
    const response = await fetch('/api/v1/auth/login', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    return JSON.stringify(await response.json());
  }, { email: fixtures.student.email, password });
  await page.goto('/portal/student.html');
  await expect(page).toHaveURL(/\/portal\/student\.html$/);
  const storage = await page.evaluate(() => ({
    local: localStorage.getItem('user'),
    session: sessionStorage.getItem('token'),
  }));
  const cookies = await page.context().cookies();

  expect(storage.local).toContain(fixtures.student.email);
  expect(storage.local).not.toMatch(/"token"\s*:/);
  expect(storage.local).not.toMatch(/eyJ[A-Za-z0-9_-]+\./);
  expect(storage.session).toBeNull();
  expect(cookies.find((cookie) => cookie.name === 'token')).toMatchObject({
    httpOnly: true,
    sameSite: 'Strict',
    secure: false,
  });
  expect(loginBody).not.toMatch(/eyJ[A-Za-z0-9_-]+\./);
  expect((await browserFetch(page, '/api/v1/auth/me')).status).toBe(200);
});

test('inactive login is rejected and logout invalidates the cookie', async ({ page }) => {
  await page.goto('/portal/login.html');
  await page.getByLabel('Email Address').fill(fixtures.inactive.email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page.locator('#loginError')).toBeVisible();
  await expect(page.locator('#loginErrorMsg')).toContainText('deactivated');

  await login(page, fixtures.student.email, '/portal/student.html');
  expect((await browserFetch(page, '/api/v1/auth/logout', { method: 'POST' })).status).toBe(200);
  expect((await browserFetch(page, '/api/v1/auth/me')).status).toBe(401);
});

test('cookie-only authentication rejects bearer-only requests and isolates student and parent data', async ({ page }) => {
  await login(page, fixtures.student.email, '/portal/student.html');
  await page.context().clearCookies();
  const bearerOnly = await page.evaluate(async () => {
    const response = await fetch('/api/v1/auth/me', {
      headers: { Authorization: 'Bearer invalid-test-token' },
    });
    return response.status;
  });
  expect(bearerOnly).toBe(401);
  expect((await browserFetch(
    page,
    `/api/v1/attendance/student/${fixtures.otherStudentRecord._id}/summary?academicYear=${academicYear}`
  )).status).toBe(401);

  await page.evaluate(() => document.cookie = 'token=; Max-Age=0; path=/');
  await login(page, fixtures.parent.email, '/portal/parent.html');
  expect((await browserFetch(
    page,
    `/api/v1/attendance/student/${fixtures.otherStudentRecord._id}/summary?academicYear=${academicYear}`
  )).status).toBe(403);
});

test('browser attendance mutations enforce assignment and persisted-record ownership', async ({ page }) => {
  await login(page, fixtures.teacher.email, '/portal/teacher.html');
  const base = {
    date: '2026-11-04',
    academicYear,
    subject: fixtures.subjectA._id.toString(),
  };
  const authorized = await browserFetch(page, '/api/v1/attendance/mark', {
    method: 'POST',
    body: JSON.stringify({
      ...base,
      class: '5',
      attendanceData: [{ student: fixtures.studentRecord._id.toString(), status: 'Present' }],
    }),
  });
  expect(authorized.status).toBe(201);

  const wrongClass = await browserFetch(page, '/api/v1/attendance/mark', {
    method: 'POST',
    body: JSON.stringify({
      ...base,
      class: '6',
      attendanceData: [{ student: fixtures.otherStudentRecord._id.toString(), status: 'Present' }],
    }),
  });
  expect(wrongClass.status).toBe(403);

  const crossClassStudent = await browserFetch(page, '/api/v1/attendance/mark', {
    method: 'POST',
    body: JSON.stringify({
      ...base,
      class: '5',
      attendanceData: [{ student: fixtures.otherStudentRecord._id.toString(), status: 'Present' }],
    }),
  });
  expect(crossClassStudent.status).toBe(403);

  const forbiddenUpdate = await browserFetch(
    page,
    `/api/v1/attendance/${fixtures.protectedRecord._id}`,
    { method: 'PUT', body: JSON.stringify({ status: 'Absent' }) }
  );
  expect(forbiddenUpdate.status).toBe(403);
});

test('activation is single-use, removes URL tokens, and recovery requests are rate limited', async ({ page }) => {
  await page.goto(`/portal/activate.html?token=${fixtures.activationToken}`);
  await expect(page).toHaveURL(/\/portal\/activate\.html$/);
  await page.getByLabel('New password').fill('Activated-Synthetic-Password-2026!');
  await page.getByRole('button', { name: /activate account/i }).click();
  await expect(page.locator('#accountMessage')).toContainText('Account activated successfully');
  const activationReuse = await browserFetch(page, '/api/v1/auth/activate', {
    method: 'PUT',
    body: JSON.stringify({ token: fixtures.activationToken, password: 'Activated-Synthetic-Password-2026!' }),
  });
  expect(activationReuse.status).toBe(400);

  const statuses = [];
  for (let attempt = 0; attempt < 6; attempt += 1) {
    statuses.push((await browserFetch(page, '/api/v1/auth/forgot-password', {
      method: 'POST',
      headers: { 'X-Forwarded-For': '198.51.100.42' },
      body: JSON.stringify({ email: `unknown-${attempt}@example.com` }),
    })).status);
  }
  expect(statuses.slice(0, 5)).toEqual([200, 200, 200, 200, 200]);
  expect(statuses[5]).toBe(429);
});

test('concurrent reset and activation requests consume each token once', async ({ page }) => {
  const resetPassword = 'Concurrent-Reset-Synthetic-2026!';
  const resetRequests = await Promise.all([1, 2].map(() => browserFetch(page, '/api/v1/auth/reset-password', {
    method: 'PUT',
    body: JSON.stringify({ token: fixtures.resetToken, password: resetPassword }),
  })));
  expect(resetRequests.map(({ status }) => status).sort()).toEqual([200, 400]);
  expect((await browserFetch(page, '/api/v1/auth/reset-password', {
    method: 'PUT',
    body: JSON.stringify({ token: fixtures.resetToken, password: resetPassword }),
  })).status).toBe(400);

  const activationPassword = 'Concurrent-Activate-Synthetic-2026!';
  const activationRequests = await Promise.all([1, 2].map(() => browserFetch(page, '/api/v1/auth/activate', {
    method: 'PUT',
    body: JSON.stringify({ token: fixtures.activationRaceToken, password: activationPassword }),
  })));
  expect(activationRequests.map(({ status }) => status).sort()).toEqual([200, 400]);
  expect((await browserFetch(page, '/api/v1/auth/activate', {
    method: 'PUT',
    body: JSON.stringify({ token: fixtures.activationRaceToken, password: activationPassword }),
  })).status).toBe(400);
});
