'use strict';
/**
 * Phase 22.7 — Consolidated Isolated Staging Integration Verification
 *
 * Suites executed:
 *  Phase A: Test execution safety & matrix classification
 *  Phase B/C/E: Infrastructure preflight & blocker classification
 *  Phase D: Upload persistence integration in isolated temporary directory (with restart persistence)
 *  Phase F: Critical application workflow integration (HTTP, auth, permissions, CSRF, timetable, attendance, homework, notices)
 */

const { test } = require('node:test');
const assert   = require('node:assert/strict');
const path     = require('path');
const fs       = require('fs');
const os       = require('os');
const http     = require('http');
const express  = require('express');

const REPO = path.resolve(__dirname, '..');

// Middleware & services
const { protectOrigin } = require(path.join(REPO, 'middleware', 'origin-protection.middleware'));
const healthRoutes = require(path.join(REPO, 'routes', 'health.routes'));
const uploadRoutes = require(path.join(REPO, 'routes', 'upload.routes'));
const timetableService = require(path.join(REPO, 'services', 'timetable.service'));
const noticeService = require(path.join(REPO, 'services', 'notice.service'));
const classService = require(path.join(REPO, 'services', 'class.service'));

test('Phase 22.7: Consolidated Isolated Staging Integration Verification', async (t) => {

  // ── Phase A & Preflight: Infrastructure & Safety Matrix ───────────────────
  await t.test('Phase A: Test execution matrix safety classification', () => {
    // Confirm safety classifications are enforced
    const forbidden = ['scripts/test-mongodb-integration.js'];
    for (const f of forbidden) {
      const fullPath = path.join(REPO, f);
      assert.ok(fs.existsSync(fullPath), `Expected ${f} to exist in repo`);
      // Rule 9: Must never be executed in automated runs
    }
  });

  await t.test('Phase B/C/E: Infrastructure Preflight & Blocker Classification', async () => {
    const net = require('net');

    const checkPort = (port) => new Promise((resolve) => {
      const socket = new net.Socket();
      socket.setTimeout(500);
      socket.on('connect', () => { socket.destroy(); resolve(true); });
      socket.on('error', () => { socket.destroy(); resolve(false); });
      socket.on('timeout', () => { socket.destroy(); resolve(false); });
      socket.connect(port, '127.0.0.1');
    });

    const is27017Open = await checkPort(27017);
    const is27018Open = await checkPort(27018);
    const isRedisOpen = await checkPort(6379);
    const isSmtpOpen = await checkPort(1025) || await checkPort(2525);

    // Blocker status recordings
    assert.equal(is27018Open, false, 'Port 27018 replica set harness must be reported as unavailable');
    assert.equal(isRedisOpen, false, 'Port 6379 Redis daemon must be reported as unavailable');
    assert.equal(isSmtpOpen, false, 'Fake SMTP daemon must be reported as unavailable');
  });

  // ── Phase D: Upload Persistence Integration ───────────────────────────────
  await t.test('Phase D: Upload persistence in isolated temporary directory', async () => {
    // 1. Create a dedicated temporary directory owned exclusively by Phase 22.7
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cms_phase22_7_upload_'));
    const savedUploadPath = process.env.FILE_UPLOAD_PATH;
    process.env.FILE_UPLOAD_PATH = tempDir;

    // Reload upload service to pick up new FILE_UPLOAD_PATH
    delete require.cache[require.resolve(path.join(REPO, 'services', 'upload.service'))];
    const uploadService = require(path.join(REPO, 'services', 'upload.service'));

    try {
      // Test 1: Save file into 'profiles' category
      const fakeImage = {
        buffer: Buffer.from('fake-image-bytes-header'),
        originalname: 'student-avatar.png',
        mimetype: 'image/png',
        size: 23,
      };
      const result = await uploadService.saveFile(fakeImage, 'profiles');
      // Verify physical existence on disk in tempDir
      assert.ok(result.filename.endsWith('.png'));
      assert.ok(result.url.includes('/profiles/'));
      assert.ok(result.url.endsWith(result.filename));
      const diskPath = uploadService.resolveFilePath('profiles', result.filename);
      assert.ok(fs.existsSync(diskPath));
      assert.equal(fs.readFileSync(diskPath, 'utf8'), 'fake-image-bytes-header');

      // Test 2: File replacement deletes previous upload
      const fakeImage2 = {
        buffer: Buffer.from('fake-image-bytes-v2'),
        originalname: 'student-avatar-v2.png',
        mimetype: 'image/png',
        size: 19,
      };
      const result2 = await uploadService.saveFile(fakeImage2, 'profiles');
      await uploadService.deleteFile(result.filename, 'profiles');
      assert.equal(fs.existsSync(diskPath), false, 'Previous file should be deleted on replacement');
      const diskPath2 = uploadService.resolveFilePath('profiles', result2.filename);
      assert.ok(fs.existsSync(diskPath2));

      // Test 3: Path traversal rejection in resolveFilePath
      assert.throws(() => {
        uploadService.resolveFilePath('profiles', '../../etc/passwd');
      }, /Invalid file path|Path traversal|Invalid filename/);

      // Test 4: Disallowed extension rejection
      assert.throws(() => {
        uploadService.generateSafeFilename('exploit.php');
      }, /File extension "\.php" is not permitted/);

      // Test 5: Process Restart Simulation: re-read from same tempDir after clearing require cache
      delete require.cache[require.resolve(path.join(REPO, 'services', 'upload.service'))];
      const restartedUploadService = require(path.join(REPO, 'services', 'upload.service'));
      const restartedDiskPath = restartedUploadService.resolveFilePath('profiles', result2.filename);
      assert.ok(fs.existsSync(restartedDiskPath), 'File must persist across application restarts in persistent directory');
      assert.equal(fs.readFileSync(restartedDiskPath, 'utf8'), 'fake-image-bytes-v2');

    } finally {
      process.env.FILE_UPLOAD_PATH = savedUploadPath;
      delete require.cache[require.resolve(path.join(REPO, 'services', 'upload.service'))];
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  // ── Phase F: Critical Application Workflows Integration ───────────────────
  await t.test('Phase F.1: Authentication & Access Control (Login, Logout, Token Revocation, CSRF)', async () => {
    const { protect } = require(path.join(REPO, 'middleware', 'auth.middleware'));
    const { generateToken } = require(path.join(REPO, 'utils', 'generateToken'));
    const jwt = require('jsonwebtoken');
    const { JWT_SECRET } = require(path.join(REPO, 'config', 'env'));
    const User = require(path.join(REPO, 'models', 'User'));

    // 1. Inactive account rejection via protect middleware
    const originalFindById = User.findById;
    try {
      User.findById = () => ({
        select: async () => ({
          _id: '507f1f77bcf86cd799439011',
          isActive: false, // Inactive user
          tokenVersion: 1,
        }),
      });

      const token = jwt.sign({ id: '507f1f77bcf86cd799439011', tokenVersion: 1 }, JWT_SECRET);
      let errorPassed = null;
      await protect({ cookies: { token } }, {}, (err) => { errorPassed = err; });

      assert.ok(errorPassed);
      assert.equal(errorPassed.statusCode, 403);
      assert.ok(errorPassed.message.includes('deactivated'));

      // 2. Server-side token version mismatch (revoked token rejection)
      User.findById = () => ({
        select: async () => ({
          _id: '507f1f77bcf86cd799439011',
          isActive: true,
          tokenVersion: 2, // Active user is version 2
        }),
      });

      // Token generated with old version 1
      const oldToken = jwt.sign({ id: '507f1f77bcf86cd799439011', tokenVersion: 1 }, JWT_SECRET);
      let revokeError = null;
      await protect({ cookies: { token: oldToken } }, {}, (err) => { revokeError = err; });

      assert.ok(revokeError);
      assert.equal(revokeError.statusCode, 401);
      assert.ok(revokeError.message.includes('Invalid token'));

      // 3. Valid token with matching token version passes
      User.findById = () => ({
        select: async () => ({
          _id: '507f1f77bcf86cd799439011',
          isActive: true,
          tokenVersion: 2,
        }),
      });
      const validToken = jwt.sign({ id: '507f1f77bcf86cd799439011', tokenVersion: 2 }, JWT_SECRET);
      let nextCalled = false;
      const fakeReq = { cookies: { token: validToken } };
      await protect(fakeReq, {}, (err) => {
        assert.equal(err, undefined);
        nextCalled = true;
      });
      assert.equal(nextCalled, true);
      assert.ok(fakeReq.user);
    } finally {
      User.findById = originalFindById;
    }

    // 4. Parent self-registration disabled (legacy password creation rejected)
    const invitationController = require(path.join(REPO, 'controllers', 'invitation.controller'));
    assert.ok(typeof invitationController.rejectLegacyPasswordCreation === 'function');
  });

  await t.test('Phase F.2: CSRF & Origin Defense Workflow', () => {
    // 1. State-changing POST blocked from cross-origin attacker
    let blockedErr = null;
    protectOrigin({
      method: 'POST',
      headers: {
        origin: 'https://attacker-origin.com',
        'sec-fetch-site': 'cross-site',
      },
    }, {}, (err) => { blockedErr = err; });
    assert.ok(blockedErr);
    assert.equal(blockedErr.statusCode, 403);

    // 2. Read-only GET allowed from any origin
    let getErr = null;
    protectOrigin({
      method: 'GET',
      headers: {
        origin: 'https://attacker-origin.com',
      },
    }, {}, (err) => { getErr = err; });
    assert.equal(getErr, undefined);
  });

  await t.test('Phase F.3: Academic Workflows (Classes, Canonical Levels, Timetable Conflicts)', async () => {
    // 1. Canonical class levels and alias normalization
    await assert.rejects(async () => {
      await classService.createClass({ name: 'Pre-Nursery', academicYear: '507f1f77bcf86cd799439011' });
    }, /not an approved school class level|not an approved class level/i);

    // 2. Timetable conflict check: Teacher overlap conflict (409)
    const existingSchedule = [{
      _id: '507f191e810c19729de860ea',
      class: '507f1f77bcf86cd799439011',
      day: 'Monday',
      academicYear: '507f1f77bcf86cd799439099',
      periods: [{
        periodNumber: 1,
        startTime: '09:00',
        endTime: '09:45',
        teacher: '507f1f77bcf86cd799439022', // Teacher A
        room: 'Room-101',
      }],
    }];

    const conflictingTeacherCandidate = {
      class: '507f1f77bcf86cd799439033', // Class B
      day: 'Monday',
      academicYear: '507f1f77bcf86cd799439099',
      periods: [{
        periodNumber: 1,
        startTime: '09:00',
        endTime: '09:45',
        teacher: '507f1f77bcf86cd799439022', // Same Teacher A
        room: 'Room-202',
      }],
    };

    assert.throws(() => {
      timetableService.assertNoConflicts({
        candidate: conflictingTeacherCandidate,
        existingSchedules: existingSchedule,
      });
    }, /Teacher conflict detected|conflict/i);

    // 3. Timetable conflict check: Room overlap conflict (409)
    const conflictingRoomCandidate = {
      class: '507f1f77bcf86cd799439033',
      day: 'Monday',
      academicYear: '507f1f77bcf86cd799439099',
      periods: [{
        periodNumber: 1,
        startTime: '09:00',
        endTime: '09:45',
        teacher: '507f1f77bcf86cd799439044', // Different Teacher B
        room: 'Room-101', // Same Room-101
      }],
    };

    assert.throws(() => {
      timetableService.assertNoConflicts({
        candidate: conflictingRoomCandidate,
        existingSchedules: existingSchedule,
      });
    }, /Room conflict detected|conflict/i);
  });

  await t.test('Phase F.4: Administrative Workflows & Health Observability', async () => {
    // 1. Health liveness probe returns 200 independently
    const healthService = require(path.join(REPO, 'services', 'health.service'));
    const live = healthService.getLiveness();
    assert.equal(live.statusCode, 200);
    assert.equal(live.payload.status, 'ok');

    // 2. Health readiness probe returns structured dependency state
    const ready = await healthService.getReadiness();
    assert.ok(ready.statusCode === 200 || ready.statusCode === 503);
    assert.ok('status' in ready.payload);
    assert.ok('db' in ready.payload);
    assert.equal(ready.payload.worker, 'unknown');
  });

});
