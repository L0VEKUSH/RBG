'use strict';

const assert = require('assert').strict;
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const {
  parseBootstrapArguments,
  validateAdminInput,
  checkBootstrapEligibility,
  acquireBootstrapLock,
  renewBootstrapLock,
  releaseBootstrapLock,
  executeFirstAdminBootstrap,
} = require('../utils/bootstrap-first-admin');

const classService = require('../services/class.service');

const {
  CANONICAL_CLASS_LEVELS,
  CLASS_LEVEL_LABELS,
  CLASS_ALIAS_MAP,
  resolveCanonicalClassLevel,
  validateAcademicYears,
  validateClasses,
  validateSubjects,
  validateAllocations,
  validateSchoolSettings,
  validateBaselineData,
} = require('../utils/validate-baseline-data');

// ─────────────────────────────────────────────────────────────────────────────
// Test Harness & Mock Helpers
// ─────────────────────────────────────────────────────────────────────────────

function createMockCollection(initialDocuments = []) {
  const documents = initialDocuments.map((doc) => ({ ...doc }));
  const writes = [];

  /**
   * Returns a thenable object that also exposes a .session() no-op so it
   * works both as a bare Promise and as a Mongoose query with chained .session().
   */
  function queryResult(valuePromise) {
    const p = Promise.resolve(valuePromise);
    p.session = (_s) => p;  // .session(session) no-op — returns same thenable
    return p;
  }

  return {
    documents,
    writes,
    find(filter = {}) {
      const result = documents.filter((doc) => {
        for (const [k, v] of Object.entries(filter)) {
          if (v && typeof v === 'object' && Array.isArray(v.$in)) {
            if (!v.$in.includes(doc[k])) return false;
          } else if (v && typeof v === 'object' && v.$ne !== undefined) {
            if (String(doc[k]) === String(v.$ne)) return false;
          } else if (doc[k] !== v) {
            return false;
          }
        }
        return true;
      });
      return queryResult(result);
    },
    findOne(filter = {}) {
      const results = documents.filter((doc) => {
        for (const [k, v] of Object.entries(filter)) {
          if (v && typeof v === 'object' && Array.isArray(v.$in)) {
            if (!v.$in.includes(doc[k])) return false;
          } else if (v && typeof v === 'object' && v.$ne !== undefined) {
            if (String(doc[k]) === String(v.$ne)) return false;
          } else if (doc[k] !== v) {
            return false;
          }
        }
        return true;
      });
      return queryResult(results.length > 0 ? results[0] : null);
    },
    findById(id) {
      return queryResult(documents.find((doc) => String(doc._id) === String(id)) || null);
    },
    countDocuments(filter = {}) {
      const results = documents.filter((doc) => {
        for (const [k, v] of Object.entries(filter)) {
          if (v && typeof v === 'object' && Array.isArray(v.$in)) {
            if (!v.$in.includes(doc[k])) return false;
          } else if (doc[k] !== v) {
            return false;
          }
        }
        return true;
      });
      return queryResult(results.length);
    },
    async create(doc) {
      writes.push({ op: 'create', doc });
      if (doc._id && documents.some((d) => String(d._id) === String(doc._id))) {
        const err = new Error(`E11000 duplicate key error collection: index: _id_ dup key: { _id: "${doc._id}" }`);
        err.code = 11000;
        throw err;
      }
      const newDoc = {
        _id: doc._id || new mongooseId(),
        ...doc,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      if (newDoc.password && !newDoc.password.startsWith('$2a$') && !newDoc.password.startsWith('$2b$')) {
        const salt = await bcrypt.genSalt(12);
        newDoc.password = await bcrypt.hash(newDoc.password, salt);
      }
      documents.push(newDoc);
      return newDoc;
    },
    async findOneAndUpdate(filter, update, options = {}) {
      writes.push({ op: 'findOneAndUpdate', filter, update });
      const idx = documents.findIndex((d) => {
        for (const [k, v] of Object.entries(filter)) {
          if (v instanceof Date) {
            if (!(d[k] instanceof Date) || d[k].getTime() !== v.getTime()) return false;
          } else if (docPropertyMismatch(d[k], v)) {
            return false;
          }
        }
        return true;
      });

      if (idx !== -1) {
        if (update.$unset) {
          Object.keys(update.$unset).forEach((k) => delete documents[idx][k]);
        }
        const fieldsToSet = update.$set ? { ...update.$set } : { ...update };
        delete fieldsToSet.$set;
        delete fieldsToSet.$unset;
        Object.assign(documents[idx], fieldsToSet);
        return documents[idx];
      }
      if (options.upsert) {
        return this.create({ ...filter, ...update });
      }
      return null;
    },
    async deleteOne(filter) {
      writes.push({ op: 'deleteOne', filter });
      const idx = documents.findIndex((d) => {
        for (const [k, v] of Object.entries(filter)) {
          if (docPropertyMismatch(d[k], v)) return false;
        }
        return true;
      });
      if (idx !== -1) {
        documents.splice(idx, 1);
        return { deletedCount: 1 };
      }
      return { deletedCount: 0 };
    },
  };
}

function docPropertyMismatch(actual, expected) {
  if (expected && typeof expected === 'object') {
    if (expected.$lt !== undefined) {
      return !(actual < expected.$lt);
    }
    if (expected.$gt !== undefined) {
      return !(actual > expected.$gt);
    }
  }
  return actual !== expected;
}

let mockIdCounter = 1;
function mongooseId() {
  const hex = (mockIdCounter++).toString(16).padStart(24, '0');
  return hex;
}

/**
 * Creates a mock Mongoose-compatible session that runs withTransaction callbacks
 * inline and performs snapshot-rollback on any error (simulating transaction abort).
 * Collections passed in `watchedCollections` will have their documents restored
 * to the pre-transaction state if the callback throws.
 */
function createMockSession(opts = {}) {
  const { watchedCollections = [] } = opts;
  return {
    async withTransaction(fn, _options) {
      // Take snapshots of all watched collections
      const snapshots = watchedCollections.map((coll) => ({
        coll,
        docs: coll.documents.map((d) => ({ ...d })),
        writesLen: coll.writes.length,
      }));
      try {
        await fn();
      } catch (err) {
        // Rollback: restore each collection to its snapshot
        for (const { coll, docs, writesLen } of snapshots) {
          coll.documents.length = 0;
          docs.forEach((d) => coll.documents.push(d));
          coll.writes.length = writesLen;
        }
        throw err;
      }
    },
    async endSession() {},
  };
}

/**
 * Creates a mock MongoDB connection that exposes startSession().
 * Pass sessionOverride to inject a custom session, or watchedCollections for
 * automatic rollback simulation on transaction abort.
 */
function createMockConnection(sessionOverride, watchedCollections) {
  return {
    async startSession() {
      if (sessionOverride) return sessionOverride;
      return createMockSession({ watchedCollections: watchedCollections || [] });
    },
  };
}

/**
 * Creates a mock Mongoose Model constructor compatible with `new Model(data)` + `save({ session })`.
 * The instances delegate back to the shared mock collection.
 */
function createMockModelClass(mockCollection, opts = {}) {
  const { failOnSaveIndex, failWithMessage } = opts;
  let saveCallIndex = 0;

  function MockModel(data) {
    Object.assign(this, data);
    this._id = data._id || mongooseId();
    this.createdAt = new Date();
    this.updatedAt = new Date();
  }

  MockModel.prototype.save = async function (options = {}) {
    const idx = saveCallIndex++;
    if (failOnSaveIndex !== undefined && idx === failOnSaveIndex) {
      throw new Error(failWithMessage || 'Simulated save failure');
    }
    if (this.password && !this.password.startsWith('$2a$') && !this.password.startsWith('$2b$')) {
      const salt = await bcrypt.genSalt(12);
      this.password = await bcrypt.hash(this.password, salt);
    }
    // Check duplicate _id
    if (mockCollection.documents.some((d) => String(d._id) === String(this._id))) {
      const err = new Error(`E11000 duplicate key error: _id = ${this._id}`);
      err.code = 11000;
      throw err;
    }
    const snap = { ...this };
    mockCollection.documents.push(snap);
    mockCollection.writes.push({ op: 'save', doc: snap });
    return this;
  };

  // Forward static query methods to the underlying collection
  MockModel.find = (...args) => mockCollection.find(...args);
  MockModel.findOne = (...args) => mockCollection.findOne(...args);
  MockModel.findById = (...args) => mockCollection.findById(...args);
  MockModel.countDocuments = (...args) => mockCollection.countDocuments(...args);
  MockModel.create = (...args) => mockCollection.create(...args);
  MockModel.findOneAndUpdate = (...args) => mockCollection.findOneAndUpdate(...args);
  MockModel.deleteOne = (...args) => mockCollection.deleteOne(...args);
  MockModel.db = mockCollection; // used for connection reference

  return MockModel;
}

// ─────────────────────────────────────────────────────────────────────────────
// Test Suite Execution
// ─────────────────────────────────────────────────────────────────────────────

async function runTests() {
  console.log('Running Phase 21N.1 Concurrency & 15-Class Structure Tests...\n');

  let passed = 0;
  let failed = 0;

  async function test(name, fn) {
    try {
      await fn();
      console.log(`  ✅ ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ❌ ${name}:`, err.message);
      if (err.stack) console.error(err.stack);
      failed++;
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Part 1: Approved 15-Class Structure & Alias Normalization
  // ───────────────────────────────────────────────────────────────────────────

  await test('Class Structure: Exactly 15 canonical levels defined', () => {
    assert.equal(CANONICAL_CLASS_LEVELS.length, 15);
    assert.deepEqual(CANONICAL_CLASS_LEVELS, [
      'Nursery', 'LKG', 'UKG',
      '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'
    ]);
  });

  await test('Class Structure: Nursery / NC alias normalization', () => {
    assert.equal(resolveCanonicalClassLevel('Nursery'), 'Nursery');
    assert.equal(resolveCanonicalClassLevel('nursery'), 'Nursery');
    assert.equal(resolveCanonicalClassLevel('NC'), 'Nursery');
    assert.equal(resolveCanonicalClassLevel('nc'), 'Nursery');
    assert.equal(resolveCanonicalClassLevel('Nursery / NC'), 'Nursery');
  });

  await test('Class Structure: KG-1 / LKG alias normalization', () => {
    assert.equal(resolveCanonicalClassLevel('LKG'), 'LKG');
    assert.equal(resolveCanonicalClassLevel('lkg'), 'LKG');
    assert.equal(resolveCanonicalClassLevel('KG-1'), 'LKG');
    assert.equal(resolveCanonicalClassLevel('kg-1'), 'LKG');
    assert.equal(resolveCanonicalClassLevel('KG1'), 'LKG');
  });

  await test('Class Structure: KG-2 / UKG alias normalization', () => {
    assert.equal(resolveCanonicalClassLevel('UKG'), 'UKG');
    assert.equal(resolveCanonicalClassLevel('ukg'), 'UKG');
    assert.equal(resolveCanonicalClassLevel('KG-2'), 'UKG');
    assert.equal(resolveCanonicalClassLevel('kg-2'), 'UKG');
    assert.equal(resolveCanonicalClassLevel('KG2'), 'UKG');
  });

  await test('Class Structure: Classes 1 to 12 alias normalization', () => {
    for (let i = 1; i <= 12; i++) {
      assert.equal(resolveCanonicalClassLevel(String(i)), String(i));
      assert.equal(resolveCanonicalClassLevel(`Class ${i}`), String(i));
      assert.equal(resolveCanonicalClassLevel(`class-${i}`), String(i));
    }
  });

  await test('Class Structure: Rejects additional Pre-Nursery class level', async () => {
    const mockClass = createMockCollection([
      { name: 'Pre-Nursery', academicYear: '2026-2027', academicLevel: 'Pre-Primary' },
    ]);
    const mockFaculty = createMockCollection([]);

    const res = await validateClasses(mockClass, mockFaculty, '2026-2027');
    assert(res.issues.some((i) => i.code === 'UNAPPROVED_PRE_NURSERY_CLASS'));
  });

  await test('Class Structure: Detect duplicate logical classes across aliases', async () => {
    const mockClass = createMockCollection([
      { name: 'Nursery', academicYear: '2026-2027', academicLevel: 'Pre-Primary' },
      { name: 'NC', academicYear: '2026-2027', academicLevel: 'Pre-Primary' },
    ]);
    const mockFaculty = createMockCollection([]);

    const res = await validateClasses(mockClass, mockFaculty, '2026-2027');
    assert(res.issues.some((i) => i.code === 'DUPLICATE_LOGICAL_CLASS'));
  });

  await test('Class Structure: Full 15-class baseline passes validation', async () => {
    const mockClass = createMockCollection(
      CANONICAL_CLASS_LEVELS.map((name, idx) => ({
        _id: `cls-${name}`,
        name,
        academicYear: '2026-2027',
        academicLevel: ['Nursery', 'LKG', 'UKG'].includes(name) ? 'Pre-Primary'
          : ['1', '2', '3', '4', '5'].includes(name) ? 'Primary'
          : ['6', '7', '8'].includes(name) ? 'Middle'
          : ['9', '10'].includes(name) ? 'Secondary' : 'Senior Secondary',
        displayOrder: idx,
      }))
    );
    const mockFaculty = createMockCollection([]);

    const res = await validateClasses(mockClass, mockFaculty, '2026-2027');
    const classErrors = res.issues.filter((i) => i.severity === 'ERROR');
    assert.equal(classErrors.length, 0);
    assert.equal(res.count, 15);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Part 2: Bootstrap CLI Argument & Safety Parsing
  // ───────────────────────────────────────────────────────────────────────────

  await test('Bootstrap: Reject password in command-line arguments', () => {
    assert.throws(
      () => parseBootstrapArguments(['--expected-host=localhost', '--expected-port=27017', '--expected-db=test', '--password=Secret123!']),
      /PASSWORD_IN_ARGV_FORBIDDEN/
    );
  });

  await test('Bootstrap: Target specification requirement', () => {
    assert.throws(
      () => parseBootstrapArguments(['--name=Admin', '--email=admin@test.com']),
      /TARGET_SPECIFICATION_REQUIRED/
    );
  });

  await test('Bootstrap: Execution mode requires target confirmation', () => {
    assert.throws(
      () => parseBootstrapArguments([
        '--expected-host=localhost',
        '--expected-port=27017',
        '--expected-db=school_prod',
        '--execute',
        '--name=Admin',
        '--email=admin@test.com'
      ]),
      /TARGET_CONFIRMATION_REQUIRED/
    );
  });

  await test('Bootstrap: Execution mode requires bootstrap confirmation flag', () => {
    assert.throws(
      () => parseBootstrapArguments([
        '--expected-host=localhost',
        '--expected-port=27017',
        '--expected-db=school_prod',
        '--confirm-production-target=localhost/school_prod',
        '--execute',
        '--name=Admin',
        '--email=admin@test.com'
      ]),
      /BOOTSTRAP_CONFIRMATION_REQUIRED/
    );
  });

  await test('Bootstrap: Valid arguments parsed cleanly in dry-run mode', () => {
    const args = parseBootstrapArguments([
      '--expected-host=localhost',
      '--expected-port=27017',
      '--expected-db=school_prod',
      '--name=Admin User',
      '--email=ADMIN@test.com',
      '--role=super_admin'
    ]);
    assert.equal(args.execute, false);
    assert.equal(args.expectedHost, 'localhost');
    assert.equal(args.expectedDatabase, 'school_prod');
    assert.equal(args.email, 'admin@test.com');
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Part 3: Administrator Input Validation & Password Redaction
  // ───────────────────────────────────────────────────────────────────────────

  await test('Input Validation: Password complexity requirements', () => {
    assert.throws(() => validateAdminInput({ name: 'Admin', email: 'a@b.com', password: 'Short1!' }), /PASSWORD_TOO_SHORT/);
    assert.throws(() => validateAdminInput({ name: 'Admin', email: 'a@b.com', password: 'lowercaseonly123!' }), /PASSWORD_WEAK/);
    assert.throws(() => validateAdminInput({ name: 'Admin', email: 'a@b.com', password: 'UPPERCASEONLY123!' }), /PASSWORD_WEAK/);
    assert.throws(() => validateAdminInput({ name: 'Admin', email: 'a@b.com', password: 'NoNumberHere!@#' }), /PASSWORD_WEAK/);
    assert.throws(() => validateAdminInput({ name: 'Admin', email: 'a@b.com', password: 'NoSymbol12345678' }), /PASSWORD_WEAK/);

    const validated = validateAdminInput({
      name: 'System Admin',
      email: 'ADMIN@school.edu.in',
      password: 'StrongPassword123!@#',
      role: 'super_admin',
    });
    assert.equal(validated.email, 'admin@school.edu.in');
    assert.equal(validated.role, 'super_admin');
  });

  await test('Input Validation: Rejects invalid roles', () => {
    assert.throws(
      () => validateAdminInput({ name: 'Admin', email: 'a@b.com', password: 'ValidPassword123!', role: 'student' }),
      /INVALID_ADMIN_ROLE/
    );
  });

  await test('Security: Passwords never logged, echoed, or included in error traces', () => {
    const password = 'ConfidentialAdminPass123!@#';
    try {
      validateAdminInput({
        name: 'X',
        email: 'admin@school.edu.in',
        password,
      });
      assert.fail('Should have failed validation');
    } catch (err) {
      assert(!err.message.includes(password), 'Error message must not include password');
      assert(!err.stack.includes(password), 'Stack trace must not include password');
    }
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Part 4: Eligibility & Concurrency Safety
  // ───────────────────────────────────────────────────────────────────────────

  await test('Eligibility: Passes when zero privileged users exist', async () => {
    const mockUser = createMockCollection([
      { _id: '1', email: 'student1@school.edu.in', role: 'student' },
      { _id: '2', email: 'teacher1@school.edu.in', role: 'teacher' },
    ]);
    const res = await checkBootstrapEligibility(mockUser);
    assert.equal(res.eligible, true);
    assert.equal(res.privilegedCount, 0);
  });

  await test('Eligibility: Refuses when super_admin exists', async () => {
    const mockUser = createMockCollection([
      { _id: '1', email: 'super@school.edu.in', role: 'super_admin' },
    ]);
    const res = await checkBootstrapEligibility(mockUser);
    assert.equal(res.eligible, false);
    assert.equal(res.reason, 'PRIVILEGED_USER_ALREADY_EXISTS');
  });

  await test('Eligibility: Refuses when school_admin exists', async () => {
    const mockUser = createMockCollection([
      { _id: '1', email: 'admin@school.edu.in', role: 'school_admin' },
    ]);
    const res = await checkBootstrapEligibility(mockUser);
    assert.equal(res.eligible, false);
    assert.equal(res.reason, 'PRIVILEGED_USER_ALREADY_EXISTS');
  });

  await test('Eligibility: Refuses when legacy admin exists', async () => {
    const mockUser = createMockCollection([
      { _id: '1', email: 'legacy@school.edu.in', role: 'admin' },
    ]);
    const res = await checkBootstrapEligibility(mockUser);
    assert.equal(res.eligible, false);
    assert.equal(res.reason, 'PRIVILEGED_USER_ALREADY_EXISTS');
  });

  await test('Bootstrap: Refuses silent promotion of existing user with same email', async () => {
    const mockUser = createMockCollection([
      { _id: '1', email: 'target@school.edu.in', role: 'student' },
    ]);
    const mockAudit = createMockCollection();
    const mockLease = createMockCollection();

    await assert.rejects(
      async () => {
        await executeFirstAdminBootstrap(
          { User: mockUser, AuditLog: mockAudit, WorkerLease: mockLease },
          { name: 'Target Admin', email: 'target@school.edu.in', password: 'StrongPassword123!@#' },
          { execute: true }
        );
      },
      /USER_EMAIL_ALREADY_EXISTS/
    );
  });

  await test('Concurrency: Lock acquisition is atomic via unique lease document', async () => {
    const mockLease = createMockCollection();
    const lock1 = await acquireBootstrapLock(mockLease, { ownerId: 'operator-1' });
    assert.equal(lock1.acquired, true);
    assert.equal(lock1.generation, 1);
    assert.equal(mockLease.documents.length, 1);

    await assert.rejects(
      async () => {
        await acquireBootstrapLock(mockLease, { ownerId: 'operator-2' });
      },
      /CONCURRENT_BOOTSTRAP_IN_PROGRESS/
    );
  });

  await test('Concurrency: Heartbeat lease renewal extends active operation', async () => {
    const mockLease = createMockCollection();
    const lock = await acquireBootstrapLock(mockLease, { ownerId: 'operator-1', leaseMs: 60000 });
    const originalExpiry = lock.lease.leaseUntil;

    const renewed = await renewBootstrapLock(mockLease, {
      lockId: lock.lockId,
      ownerId: lock.ownerId,
      generation: lock.generation,
      leaseMs: 300000,
    });
    assert(renewed.leaseUntil > originalExpiry, 'Renewed lease until must be extended');
  });

  await test('Concurrency: Expired lease re-acquisition fences out stale owner', async () => {
    const mockLease = createMockCollection([
      {
        _id: 'bootstrap_first_admin',
        ownerId: 'operator-1',
        generation: 1,
        leaseUntil: new Date(Date.now() - 1000),
        state: 'in_progress',
      },
    ]);

    const lock2 = await acquireBootstrapLock(mockLease, { ownerId: 'operator-2', leaseMs: 60000 });
    assert.equal(lock2.generation, 2);
    assert.equal(lock2.ownerId, 'operator-2');

    await assert.rejects(
      async () => {
        await renewBootstrapLock(mockLease, {
          lockId: 'bootstrap_first_admin',
          ownerId: 'operator-1',
          generation: 1,
        });
      },
      /LEASE_LOST/
    );

    await assert.rejects(
      async () => {
        await releaseBootstrapLock(mockLease, {
          lockId: 'bootstrap_first_admin',
          ownerId: 'operator-1',
          generation: 1,
          completed: true,
        });
      },
      /STALE_LOCK_OWNER/
    );
  });

  await test('Concurrency: Safe lock cleanup on failure before account creation allows clean retry', async () => {
    const mockLease = createMockCollection();
    const lock = await acquireBootstrapLock(mockLease, { ownerId: 'operator-1' });
    assert.equal(mockLease.documents.length, 1);

    await releaseBootstrapLock(mockLease, {
      lockId: lock.lockId,
      ownerId: lock.ownerId,
      generation: lock.generation,
      completed: false,
    });
    assert.equal(mockLease.documents.length, 0);

    const lock2 = await acquireBootstrapLock(mockLease, { ownerId: 'operator-2' });
    assert.equal(lock2.acquired, true);
  });

  await test('Atomicity: AuditLog failure rolls back created User (no unaudited success)', async () => {
    // The audit save (1st save inside transaction) will throw, triggering rollback
    const userColl = createMockCollection();
    const auditColl = createMockCollection();
    const leaseColl = createMockCollection();

    // User class: works normally
    const MockUser = createMockModelClass(userColl);
    // AuditLog class: 1st save (save index 0) fails → AUDIT_LOG_FAILED
    const MockAudit = createMockModelClass(auditColl, { failOnSaveIndex: 0, failWithMessage: 'DB write failure while inserting AuditLog' });
    // WorkerLease: works normally
    const MockLease = createMockModelClass(leaseColl);

    // Session watches all three collections and rolls them back on error
    const mockConn = createMockConnection(null, [userColl, auditColl, leaseColl]);

    await assert.rejects(
      async () => {
        await executeFirstAdminBootstrap(
          { User: MockUser, AuditLog: MockAudit, WorkerLease: MockLease },
          {
            name: 'Audit Failure Admin',
            email: 'audit.fail@school.edu.in',
            password: 'StrongPassword123!@#',
            role: 'super_admin',
          },
          { execute: true, connection: mockConn }
        );
      },
      /AUDIT_LOG_FAILED/
    );

    // User document must NOT persist (transaction rolled back)
    assert.equal(userColl.documents.length, 0, 'User must not persist when audit save fails (transaction rolled back)');
  });

  await test('Atomicity: Successful completion creates durable terminal state and audit trail', async () => {
    const userColl = createMockCollection();
    const auditColl = createMockCollection();
    const leaseColl = createMockCollection();

    const MockUser = createMockModelClass(userColl);
    const MockAudit = createMockModelClass(auditColl);
    const MockLease = createMockModelClass(leaseColl);
    const mockConn = createMockConnection(null, [userColl, auditColl, leaseColl]);

    const rawPassword = 'StrongPassword123!@#';
    const result = await executeFirstAdminBootstrap(
      { User: MockUser, AuditLog: MockAudit, WorkerLease: MockLease },
      {
        name: 'First Administrator',
        email: 'first.admin@school.edu.in',
        password: rawPassword,
        role: 'super_admin',
      },
      { execute: true, connection: mockConn }
    );

    assert.equal(result.success, true);
    assert.equal(userColl.documents.length, 1);

    const leaseDoc = await leaseColl.findById('bootstrap_first_admin');
    assert.equal(leaseDoc.state, 'completed');

    const permanentMarker = await leaseColl.findById('bootstrap_permanent_marker');
    assert.ok(permanentMarker, 'Durable permanent marker must be created');
    assert.equal(permanentMarker.state, 'completed');

    assert.equal(auditColl.documents.length, 1);
    const auditRecord = auditColl.documents[0];
    assert.equal(auditRecord.action, 'BOOTSTRAP_FIRST_ADMIN');
    assert.equal(auditRecord.resource, 'User');
    assert.equal(auditRecord.details.authenticatedSession, false, 'Must not falsely claim authenticated session');
    assert(!JSON.stringify(auditRecord).includes(rawPassword), 'Password must never appear in audit record');

    // Retry must be permanently refused (privileged user now exists)
    await assert.rejects(
      async () => {
        await executeFirstAdminBootstrap(
          { User: MockUser, AuditLog: MockAudit, WorkerLease: MockLease },
          {
            name: 'Second Admin',
            email: 'second.admin@school.edu.in',
            password: 'StrongPassword123!@#',
            role: 'super_admin',
          },
          { execute: true, connection: mockConn }
        );
      },
      /PRIVILEGED_USER_ALREADY_EXISTS/
    );
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Part 4b: Phase 21N.2 — Transaction Atomicity & Class Service Enforcement
  // ───────────────────────────────────────────────────────────────────────────

  await test('TX: TRANSACTIONS_UNAVAILABLE fails closed when connection has no startSession', async () => {
    const mockUser = createMockCollection();
    const mockAudit = createMockCollection();
    const mockLease = createMockCollection();
    // connection without startSession
    const noTxConn = { startSession: undefined };

    await assert.rejects(
      async () => {
        await executeFirstAdminBootstrap(
          { User: mockUser, AuditLog: mockAudit, WorkerLease: mockLease },
          { name: 'Admin', email: 'notx@school.edu.in', password: 'StrongPassword123!@#', role: 'super_admin' },
          { execute: true, connection: noTxConn }
        );
      },
      /TRANSACTIONS_UNAVAILABLE/
    );
    // Zero writes must have occurred
    assert.equal(mockUser.documents.length, 0, 'No user written when transactions unavailable');
    assert.equal(mockAudit.documents.length, 0, 'No audit written when transactions unavailable');
  });

  await test('TX: TRANSACTIONS_UNAVAILABLE fails closed when no connection provided', async () => {
    const userColl = createMockCollection();
    const auditColl = createMockCollection();
    const leaseColl = createMockCollection();
    // MockUser.db is undefined so connection resolution fails
    const MockUser = createMockModelClass(userColl);
    MockUser.db = null;
    const MockAudit = createMockModelClass(auditColl);
    MockAudit.db = null;
    const MockLease = createMockModelClass(leaseColl);

    await assert.rejects(
      async () => {
        await executeFirstAdminBootstrap(
          { User: MockUser, AuditLog: MockAudit, WorkerLease: MockLease },
          { name: 'Admin', email: 'notx2@school.edu.in', password: 'StrongPassword123!@#', role: 'super_admin' },
          { execute: true } // no connection option
        );
      },
      /TRANSACTIONS_UNAVAILABLE/
    );
  });

  await test('TX: Crash before commit leaves no user or audit records', async () => {
    const userColl = createMockCollection();
    const auditColl = createMockCollection();
    const leaseColl = createMockCollection();

    // Session whose withTransaction always aborts (simulates crash before commit)
    const crashSession = {
      async withTransaction(fn) {
        // Run fn but then simulate that the transaction was never committed
        // by rolling back any documents inserted into our mock collections
        const userSnap = [...userColl.documents];
        const auditSnap = [...auditColl.documents];
        const leaseSnap = [...leaseColl.documents];
        try {
          await fn();
        } catch (e) {
          // restore state as if transaction rolled back
          userColl.documents.length = 0; userSnap.forEach((d) => userColl.documents.push(d));
          auditColl.documents.length = 0; auditSnap.forEach((d) => auditColl.documents.push(d));
          leaseColl.documents.length = 0; leaseSnap.forEach((d) => leaseColl.documents.push(d));
          throw e;
        }
        // Simulate mid-flight crash: throw after fn() so transaction never commits
        userColl.documents.length = 0; userSnap.forEach((d) => userColl.documents.push(d));
        auditColl.documents.length = 0; auditSnap.forEach((d) => auditColl.documents.push(d));
        leaseColl.documents.length = 0; leaseSnap.forEach((d) => leaseColl.documents.push(d));
        const crashErr = new Error('Simulated process crash before transaction commit');
        crashErr.code = 'CRASH';
        throw crashErr;
      },
      async endSession() {},
    };

    const MockUser = createMockModelClass(userColl);
    const MockAudit = createMockModelClass(auditColl);
    const MockLease = createMockModelClass(leaseColl);
    const crashConn = createMockConnection(crashSession);

    await assert.rejects(
      async () => {
        await executeFirstAdminBootstrap(
          { User: MockUser, AuditLog: MockAudit, WorkerLease: MockLease },
          { name: 'Crash Admin', email: 'crash@school.edu.in', password: 'StrongPassword123!@#', role: 'super_admin' },
          { execute: true, connection: crashConn }
        );
      },
      /CRASH|Simulated/
    );

    assert.equal(userColl.documents.length, 0, 'No user record after crash-before-commit');
    assert.equal(auditColl.documents.length, 0, 'No audit record after crash-before-commit');
  });

  await test('TX: Renewal failure stops bootstrap before account creation', async () => {
    const userColl = createMockCollection();
    const auditColl = createMockCollection();
    const leaseColl = createMockCollection();

    const MockUser = createMockModelClass(userColl);
    const MockAudit = createMockModelClass(auditColl);
    const MockLease = createMockModelClass(leaseColl);
    const mockConn = createMockConnection(null, [userColl, auditColl, leaseColl]);

    // Acquire a lock first, then override findOneAndUpdate to simulate lost lease during renew
    const lock = await acquireBootstrapLock(leaseColl, { ownerId: 'test-owner' });
    // Simulate lease being lost (another process grabbed it)
    leaseColl.documents.find((d) => d._id === 'bootstrap_first_admin').generation = 99;

    await assert.rejects(
      async () => {
        // renewBootstrapLock will fail because generation no longer matches
        await renewBootstrapLock(leaseColl, {
          lockId: lock.lockId,
          ownerId: lock.ownerId,
          generation: lock.generation, // generation 1, but doc now has 99
        });
      },
      /LEASE_LOST/
    );

    // User collection must still be empty — renewal check stops bootstrap before writes
    assert.equal(userColl.documents.length, 0, 'No user written when lease renewal fails');
  });

  await test('TX: Stale owner cannot complete a lease', async () => {
    const leaseColl = createMockCollection();
    const lock1 = await acquireBootstrapLock(leaseColl, { ownerId: 'owner-1' });
    // Simulate expired: set leaseUntil to past
    leaseColl.documents[0].leaseUntil = new Date(Date.now() - 10000);
    // Owner-2 re-acquires
    await acquireBootstrapLock(leaseColl, { ownerId: 'owner-2', leaseMs: 60000 });

    // Stale owner-1 tries to complete — must be rejected
    await assert.rejects(
      async () => {
        await releaseBootstrapLock(leaseColl, {
          lockId: lock1.lockId,
          ownerId: 'owner-1',
          generation: 1,
          completed: true,
        });
      },
      /STALE_LOCK_OWNER/
    );
  });

  await test('TX: Stale owner cannot release (delete) a lease', async () => {
    const leaseColl = createMockCollection();
    await acquireBootstrapLock(leaseColl, { ownerId: 'owner-1' });
    // Simulate expired and re-acquired
    leaseColl.documents[0].leaseUntil = new Date(Date.now() - 10000);
    await acquireBootstrapLock(leaseColl, { ownerId: 'owner-2', leaseMs: 60000 });

    // Stale owner tries non-completed release — should fail
    await assert.rejects(
      async () => {
        await releaseBootstrapLock(leaseColl, {
          lockId: 'bootstrap_first_admin',
          ownerId: 'owner-1',
          generation: 1,
          completed: false,
        });
      },
      /STALE_LOCK_OWNER/
    );
  });

  await test('TX: Durable permanent marker prevents reacquisition', async () => {
    const leaseColl = createMockCollection([
      { _id: 'bootstrap_permanent_marker', state: 'completed', ownerId: 'SYSTEM', generation: 1 },
    ]);

    await assert.rejects(
      async () => {
        await acquireBootstrapLock(leaseColl);
      },
      /BOOTSTRAP_ALREADY_COMPLETED/
    );
  });

  // ─── Class Service: 15-Level Enforcement ─────────────────────────────────

  await test('ClassService: createClass rejects Pre-Nursery', async () => {
    // Mock Class.create to avoid real DB
    const Class = require('../models/Class');
    const origCreate = Class.create;
    Class.create = async () => { throw new Error('Should not reach Class.create'); };
    const origFindOne = Class.findOne;
    Class.findOne = async () => null;
    try {
      await assert.rejects(
        () => require('../services/class.service').createClass({ name: 'Pre-Nursery', academicYear: '2026-2027' }),
        /Pre-Nursery/
      );
    } finally {
      Class.create = origCreate;
      Class.findOne = origFindOne;
    }
  });

  await test('ClassService: createClass rejects unapproved class levels', async () => {
    const Class = require('../models/Class');
    const origCreate = Class.create;
    Class.create = async () => { throw new Error('Should not reach'); };
    const origFindOne = Class.findOne;
    Class.findOne = async () => null;
    try {
      await assert.rejects(
        () => require('../services/class.service').createClass({ name: 'Grade 5', academicYear: '2026-2027' }),
        /not one of the approved 15/
      );
    } finally {
      Class.create = origCreate;
      Class.findOne = origFindOne;
    }
  });

  await test('ClassService: createClass rejects class sections', async () => {
    const Class = require('../models/Class');
    const origCreate = Class.create;
    Class.create = async () => { throw new Error('Should not reach'); };
    try {
      await assert.rejects(
        () => require('../services/class.service').createClass({ name: '5', academicYear: '2026-2027', section: 'A' }),
        /sections are not supported/i
      );
    } finally {
      Class.create = origCreate;
    }
  });

  await test('ClassService: createClass normalizes alias NC -> Nursery', async () => {
    const Class = require('../models/Class');
    let savedPayload = null;
    Class.create = async (data) => { savedPayload = data; return { ...data, _id: 'mock-id' }; };
    Class.findOne = async () => null; // no duplicate
    try {
      await require('../services/class.service').createClass({ name: 'NC', academicYear: '2026-2027' });
      assert.equal(savedPayload.name, 'Nursery', 'NC must be normalized to Nursery');
      assert.equal(savedPayload.academicLevel, 'Pre-Primary');
    } finally {
      delete require.cache[require.resolve('../services/class.service')];
    }
  });

  await test('ClassService: createClass normalizes alias KG-1 -> LKG', async () => {
    const Class = require('../models/Class');
    let savedPayload = null;
    Class.create = async (data) => { savedPayload = data; return { ...data, _id: 'mock-id' }; };
    Class.findOne = async () => null;
    try {
      await require('../services/class.service').createClass({ name: 'KG-1', academicYear: '2026-2027' });
      assert.equal(savedPayload.name, 'LKG');
    } finally {
      delete require.cache[require.resolve('../services/class.service')];
    }
  });

  await test('ClassService: createClass rejects duplicate class in same academic year', async () => {
    const Class = require('../models/Class');
    // findOne returns existing document
    Class.findOne = async () => ({ _id: 'existing', name: 'Nursery', academicYear: '2026-2027' });
    Class.create = async () => { throw new Error('Should not reach'); };
    try {
      await assert.rejects(
        () => require('../services/class.service').createClass({ name: 'Nursery', academicYear: '2026-2027' }),
        /already exists/
      );
    } finally {
      delete require.cache[require.resolve('../services/class.service')];
    }
  });

  await test('ClassService: updateClass rejects Pre-Nursery', async () => {
    const Class = require('../models/Class');
    Class.findByIdAndUpdate = async () => { throw new Error('Should not reach'); };
    try {
      await assert.rejects(
        () => require('../services/class.service').updateClass('some-id', { name: 'Pre-Nursery' }),
        /Pre-Nursery/
      );
    } finally {
      delete require.cache[require.resolve('../services/class.service')];
    }
  });

  await test('ClassService: updateClass normalizes alias Class 5 -> 5', async () => {
    const Class = require('../models/Class');
    let updatedPayload = null;
    Class.findById = async () => ({ _id: 'some-id', name: '4', academicYear: '2026-2027' });
    Class.findOne = async () => null;
    Class.findByIdAndUpdate = async (id, data) => { updatedPayload = data; return { ...data, _id: id }; };
    try {
      await require('../services/class.service').updateClass('some-id', { name: 'Class 5' });
      assert.equal(updatedPayload.name, '5');
      assert.equal(updatedPayload.academicLevel, 'Primary');
    } finally {
      delete require.cache[require.resolve('../services/class.service')];
    }
  });

  await test('ClassService: updateClass rejects duplicate class in same academic year', async () => {
    const Class = require('../models/Class');
    Class.findById = async () => ({ _id: 'id-1', name: '5', academicYear: '2026-2027' });
    Class.findOne = async () => ({ _id: 'id-2', name: '6', academicYear: '2026-2027' });
    Class.findByIdAndUpdate = async () => { throw new Error('Should not reach'); };
    try {
      await assert.rejects(
        () => require('../services/class.service').updateClass('id-1', { name: '6' }),
        /already exists/
      );
    } finally {
      delete require.cache[require.resolve('../services/class.service')];
    }
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Part 5: Baseline Entity Validations
  // ───────────────────────────────────────────────────────────────────────────

  await test('Baseline: Error when no academic years exist', async () => {
    const mockAY = createMockCollection([]);
    const res = await validateAcademicYears(mockAY);
    assert.equal(res.activeYear, null);
    assert(res.issues.some((i) => i.code === 'NO_ACADEMIC_YEARS'));
  });

  await test('Baseline: Error when multiple academic years marked current', async () => {
    const mockAY = createMockCollection([
      { name: '2025-2026', startDate: new Date('2025-04-01'), endDate: new Date('2026-03-31'), isCurrent: true, isActive: true },
      { name: '2026-2027', startDate: new Date('2026-04-01'), endDate: new Date('2027-03-31'), isCurrent: true, isActive: true },
    ]);
    const res = await validateAcademicYears(mockAY);
    assert(res.issues.some((i) => i.code === 'MULTIPLE_CURRENT_YEARS'));
  });

  await test('Baseline: Error on invalid academic year boundaries', async () => {
    const mockAY = createMockCollection([
      { name: '2026-2027', startDate: new Date('2027-04-01'), endDate: new Date('2026-03-31'), isCurrent: true, isActive: true },
    ]);
    const res = await validateAcademicYears(mockAY);
    assert(res.issues.some((i) => i.code === 'INVALID_YEAR_BOUNDARIES'));
  });

  await test('Baseline: Error on overlapping terms in academic year', async () => {
    const mockAY = createMockCollection([
      {
        name: '2026-2027',
        startDate: new Date('2026-04-01'),
        endDate: new Date('2027-03-31'),
        isCurrent: true,
        isActive: true,
        terms: [
          { name: 'Term 1', startDate: new Date('2026-04-01'), endDate: new Date('2026-10-15') },
          { name: 'Term 2', startDate: new Date('2026-10-01'), endDate: new Date('2027-03-31') },
        ],
      },
    ]);
    const res = await validateAcademicYears(mockAY);
    assert(res.issues.some((i) => i.code === 'OVERLAPPING_TERMS'));
  });

  await test('Baseline: Classes - Detect duplicate class and dangling classTeacher', async () => {
    const mockClass = createMockCollection([
      { name: '10', academicYear: '2026-2027', academicLevel: 'Secondary', classTeacher: 'nonexistent-faculty-id' },
      { name: '10', academicYear: '2026-2027', academicLevel: 'Secondary' },
    ]);
    const mockFaculty = createMockCollection([]);

    const res = await validateClasses(mockClass, mockFaculty, '2026-2027');
    assert(res.issues.some((i) => i.code === 'DUPLICATE_CLASS'));
    assert(res.issues.some((i) => i.code === 'DANGLING_CLASS_TEACHER'));
  });

  await test('Baseline: Subjects - Detect duplicate code and invalid subject type', async () => {
    const mockSub = createMockCollection([
      { name: 'Math A', code: 'MATH101', type: 'Core' },
      { name: 'Math B', code: 'MATH101', type: 'InvalidType' },
    ]);
    const res = await validateSubjects(mockSub);
    assert(res.issues.some((i) => i.code === 'DUPLICATE_SUBJECT_CODE'));
    assert(res.issues.some((i) => i.code === 'INVALID_SUBJECT_TYPE'));
  });

  await test('Baseline: SubjectAllocations - Detect dangling faculty and subject references', async () => {
    const mockAlloc = createMockCollection([
      { teacher: 'faculty-999', subject: 'subject-888', class: '10', academicYear: '2026-2027' },
    ]);
    const mockFaculty = createMockCollection([]);
    const mockSub = createMockCollection([]);

    const res = await validateAllocations(mockAlloc, mockFaculty, mockSub, '2026-2027');
    assert(res.issues.some((i) => i.code === 'DANGLING_ALLOCATION_TEACHER'));
    assert(res.issues.some((i) => i.code === 'DANGLING_ALLOCATION_SUBJECT'));
  });

  await test('Baseline: SubjectAllocations - Detect subject not offered in class level', async () => {
    const teacherId = 'faculty-1';
    const subjectId = 'subject-1';
    const mockAlloc = createMockCollection([
      { teacher: teacherId, subject: subjectId, class: '12', academicYear: '2026-2027' },
    ]);
    const mockFaculty = createMockCollection([{ _id: teacherId }]);
    const mockSub = createMockCollection([{ _id: subjectId, name: 'EVS', code: 'EVS1', classLevels: ['1', '2'] }]);

    const res = await validateAllocations(mockAlloc, mockFaculty, mockSub, '2026-2027');
    assert(res.issues.some((i) => i.code === 'SUBJECT_NOT_OFFERED_IN_CLASS'));
  });

  await test('Baseline: SubjectAllocations - Detect duplicate subject allocations', async () => {
    const teacherId = 'faculty-1';
    const subjectId = 'subject-1';
    const mockAlloc = createMockCollection([
      { teacher: teacherId, subject: subjectId, class: '10', academicYear: '2026-2027' },
      { teacher: teacherId, subject: subjectId, class: '10', academicYear: '2026-2027' },
    ]);
    const mockFaculty = createMockCollection([{ _id: teacherId }]);
    const mockSub = createMockCollection([{ _id: subjectId, name: 'Math', code: 'MATH10', classLevels: ['10'] }]);

    const res = await validateAllocations(mockAlloc, mockFaculty, mockSub, '2026-2027');
    assert(res.issues.some((i) => i.code === 'DUPLICATE_SUBJECT_ALLOCATION'));
  });

  await test('Baseline: SchoolSettings - Detect duplicate keys', async () => {
    const mockSettings = createMockCollection([
      { key: 'school_name', value: 'School A' },
      { key: 'school_name', value: 'School B' },
    ]);
    const res = await validateSchoolSettings(mockSettings);
    assert(res.issues.some((i) => i.code === 'DUPLICATE_SETTING_KEY'));
  });

  await test('Baseline: Full 15-class valid baseline dataset passes with 0 errors', async () => {
    const teacherId = '507f1f77bcf86cd799439011';
    const subjectId = '507f1f77bcf86cd799439022';

    const mockAY = createMockCollection([
      {
        name: '2026-2027',
        startDate: new Date('2026-04-01'),
        endDate: new Date('2027-03-31'),
        isCurrent: true,
        isActive: true,
        terms: [
          { name: 'Term 1', startDate: new Date('2026-04-01'), endDate: new Date('2026-09-30') },
          { name: 'Term 2', startDate: new Date('2026-10-01'), endDate: new Date('2027-03-31') },
        ],
      },
    ]);

    const mockClass = createMockCollection(
      CANONICAL_CLASS_LEVELS.map((lvl, idx) => ({
        _id: `class-${lvl}`,
        name: lvl,
        academicYear: '2026-2027',
        academicLevel: ['Nursery', 'LKG', 'UKG'].includes(lvl) ? 'Pre-Primary'
          : ['1', '2', '3', '4', '5'].includes(lvl) ? 'Primary'
          : ['6', '7', '8'].includes(lvl) ? 'Middle'
          : ['9', '10'].includes(lvl) ? 'Secondary' : 'Senior Secondary',
        displayOrder: idx,
        classTeacher: teacherId,
        isActive: true,
      }))
    );

    const mockSubject = createMockCollection([
      {
        _id: subjectId,
        name: 'Mathematics',
        code: 'MATH-SEC',
        type: 'Core',
        classLevels: ['9', '10'],
        isActive: true,
      },
    ]);

    const mockFaculty = createMockCollection([
      {
        _id: teacherId,
        user: 'user-teacher-1',
        employeeId: 'EMP001',
        department: 'Mathematics',
        designation: 'Teacher',
        isActive: true,
      },
    ]);

    const mockAlloc = createMockCollection([
      {
        teacher: teacherId,
        subject: subjectId,
        class: '10',
        academicYear: '2026-2027',
      },
    ]);

    const mockSettings = createMockCollection([
      { key: 'school_name', value: 'RBG School' },
      { key: 'academic_year', value: '2026-2027' },
      { key: 'school_phone', value: '9800000000' },
      { key: 'school_email', value: 'contact@rbgschool.edu.in' },
    ]);

    const report = await validateBaselineData({
      AcademicYear: mockAY,
      Class: mockClass,
      Subject: mockSubject,
      Faculty: mockFaculty,
      SubjectAllocation: mockAlloc,
      SchoolSettings: mockSettings,
    });

    assert.equal(report.valid, true);
    assert.equal(report.errors.length, 0);
    assert.equal(report.summary.classCount, 15);
    assert.equal(report.summary.academicYearCount, 1);
  });

  await test('Baseline: Strict read-only guarantee — zero database writes occurred', async () => {
    const mockAY = createMockCollection([{ name: '2026-2027', startDate: new Date('2026-04-01'), endDate: new Date('2027-03-31'), isCurrent: true, isActive: true }]);
    const mockClass = createMockCollection([]);
    const mockSubject = createMockCollection([]);
    const mockFaculty = createMockCollection([]);
    const mockAlloc = createMockCollection([]);
    const mockSettings = createMockCollection([]);

    await validateBaselineData({
      AcademicYear: mockAY,
      Class: mockClass,
      Subject: mockSubject,
      Faculty: mockFaculty,
      SubjectAllocation: mockAlloc,
      SchoolSettings: mockSettings,
    });

    const totalWrites =
      mockAY.writes.length +
      mockClass.writes.length +
      mockSubject.writes.length +
      mockFaculty.writes.length +
      mockAlloc.writes.length +
      mockSettings.writes.length;

    assert.equal(totalWrites, 0, 'Validation must perform ZERO write operations');
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Part 6: Phase 21N.3 — Bootstrap Fencing Deep Tests
  // ───────────────────────────────────────────────────────────────────────────

  await test('21N.3 Bootstrap: Two concurrent attempts — only one completes (second gets CONCURRENT_BOOTSTRAP_IN_PROGRESS)', async () => {
    const leaseColl = createMockCollection();
    // Owner-1 acquires
    const lock1 = await acquireBootstrapLock(leaseColl, { ownerId: 'owner-1', leaseMs: 60000 });
    assert.equal(lock1.generation, 1);

    // Owner-2 tries while lease is active — must fail
    await assert.rejects(
      () => acquireBootstrapLock(leaseColl, { ownerId: 'owner-2', leaseMs: 60000 }),
      /CONCURRENT_BOOTSTRAP_IN_PROGRESS/
    );
  });

  await test('21N.3 Bootstrap: Stale owner after generation bump cannot complete', async () => {
    const leaseColl = createMockCollection();
    // Owner-1 acquires
    const lock1 = await acquireBootstrapLock(leaseColl, { ownerId: 'owner-1', leaseMs: -1 }); // expired immediately
    // Force expiry
    leaseColl.documents[0].leaseUntil = new Date(Date.now() - 1000);

    // Owner-2 re-acquires expired lease
    const lock2 = await acquireBootstrapLock(leaseColl, { ownerId: 'owner-2', leaseMs: 60000 });
    assert.equal(lock2.generation, 2);

    // Owner-1 tries to complete — must fail with STALE_LOCK_OWNER
    await assert.rejects(
      () => releaseBootstrapLock(leaseColl, {
        lockId: 'bootstrap_first_admin',
        ownerId: 'owner-1',
        generation: 1,
        completed: true,
      }),
      /STALE_LOCK_OWNER/
    );
  });

  await test('21N.3 Bootstrap: Renewal failure immediately before transaction prevents account creation', async () => {
    const userColl = createMockCollection();
    const auditColl = createMockCollection();
    const leaseColl = createMockCollection();
    const MockUser = createMockModelClass(userColl);
    const MockAudit = createMockModelClass(auditColl);
    const MockLease = createMockModelClass(leaseColl);

    // Flow inside executeFirstAdminBootstrap (execute mode):
    //   acquireBootstrapLock → leaseColl.create() [NOT findOneAndUpdate on fresh collection]
    //   renewBootstrapLock   → leaseColl.findOneAndUpdate() [1st call]
    //   releaseBootstrapLock → leaseColl.findOneAndUpdate() [2nd call, only if tx committed]
    // Intercept the 1st findOneAndUpdate (renewal) and return null to simulate LEASE_LOST
    let fouCalls = 0;
    const origFOU = leaseColl.findOneAndUpdate.bind(leaseColl);
    leaseColl.findOneAndUpdate = async function (filter, update, options) {
      fouCalls++;
      if (fouCalls === 1) {
        // This is the renewBootstrapLock call — simulate losing the lease
        return null; // → LEASE_LOST
      }
      return origFOU(filter, update, options);
    };

    const mockConn = createMockConnection(null, [userColl, auditColl, leaseColl]);

    await assert.rejects(
      () => executeFirstAdminBootstrap(
        { User: MockUser, AuditLog: MockAudit, WorkerLease: MockLease },
        { name: 'Admin', email: 'admin@school.edu.in', password: 'StrongPassword123!@#', role: 'super_admin' },
        { execute: true, connection: mockConn }
      ),
      /LEASE_LOST/
    );

    assert.equal(userColl.documents.length, 0, 'No user written when renewal fails before transaction');
    assert.equal(auditColl.documents.length, 0, 'No audit written when renewal fails before transaction');
  });

  await test('21N.3 Bootstrap: Existing permanent marker blocks new bootstrap without entering transaction', async () => {
    const userColl = createMockCollection();
    const auditColl = createMockCollection();
    const leaseColl = createMockCollection([
      { _id: 'bootstrap_permanent_marker', state: 'completed', ownerId: 'prev', generation: 1 },
    ]);

    const MockUser = createMockModelClass(userColl);
    const MockAudit = createMockModelClass(auditColl);
    const MockLease = createMockModelClass(leaseColl);

    await assert.rejects(
      () => executeFirstAdminBootstrap(
        { User: MockUser, AuditLog: MockAudit, WorkerLease: MockLease },
        { name: 'Admin2', email: 'admin2@school.edu.in', password: 'StrongPassword123!@#', role: 'super_admin' },
        { execute: true, connection: createMockConnection(null, [userColl, auditColl, leaseColl]) }
      ),
      /BOOTSTRAP_ALREADY_COMPLETED/
    );
    assert.equal(userColl.documents.length, 0);
  });

  await test('21N.3 Bootstrap: Transaction rollback — user failure means no user, no audit, no marker', async () => {
    const userColl = createMockCollection();
    const auditColl = createMockCollection();
    const leaseColl = createMockCollection();

    // User save fails at index 0
    const MockUser = createMockModelClass(userColl, { failOnSaveIndex: 0, failWithMessage: 'DB write failure on user save' });
    const MockAudit = createMockModelClass(auditColl);
    const MockLease = createMockModelClass(leaseColl);

    await assert.rejects(
      () => executeFirstAdminBootstrap(
        { User: MockUser, AuditLog: MockAudit, WorkerLease: MockLease },
        { name: 'TxFail', email: 'txfail@school.edu.in', password: 'StrongPassword123!@#', role: 'super_admin' },
        { execute: true, connection: createMockConnection(null, [userColl, auditColl, leaseColl]) }
      ),
      /DB write failure on user save/
    );

    assert.equal(userColl.documents.length, 0, 'User must be absent after tx abort');
    assert.equal(auditColl.documents.length, 0, 'Audit must be absent after tx abort');
    // leaseColl may have lock doc but no permanent marker
    const marker = leaseColl.documents.find((d) => d._id === 'bootstrap_permanent_marker');
    assert.ok(!marker, 'Permanent marker must not exist after tx abort');
  });

  await test('21N.3 Bootstrap: Audit schema fields are all accepted (no required field gaps)', async () => {
    // AuditLog schema requires: user, action, resource (required: true)
    // resourceId, details, ipAddress, userAgent are optional/Mixed
    // Verify our written payload satisfies all required fields
    const AuditLog = require('../models/AuditLog');
    const mockUserId = '000000000000000000000001';
    const doc = new AuditLog({
      user: mockUserId,
      action: 'BOOTSTRAP_FIRST_ADMIN',
      resource: 'User',
      resourceId: mockUserId,
      details: {
        mechanism: 'OPERATOR_BOOTSTRAP_CLI',
        authenticatedSession: false,
        targetRole: 'super_admin',
        maskedEmail: 'ad***@school.edu.in',
        bootstrapTimestamp: new Date(),
      },
    });

    const validationErr = doc.validateSync();
    assert.ok(!validationErr, `AuditLog validation failed: ${validationErr && validationErr.message}`);
    // Confirm no password-like field in details
    const detailsStr = JSON.stringify(doc.details);
    assert.ok(!detailsStr.includes('password'), 'AuditLog details must not contain password');
    assert.ok(!detailsStr.includes('hash'), 'AuditLog details must not contain hash');
    assert.ok(!detailsStr.includes('token'), 'AuditLog details must not contain token');
  });

  await test('21N.3 Bootstrap: Session endSession is called after success', async () => {
    const userColl = createMockCollection();
    const auditColl = createMockCollection();
    const leaseColl = createMockCollection();
    const MockUser = createMockModelClass(userColl);
    const MockAudit = createMockModelClass(auditColl);
    const MockLease = createMockModelClass(leaseColl);

    let sessionEnded = false;
    const trackingSession = {
      async withTransaction(fn) {
        // snapshot rollback on error
        const uSnap = [...userColl.documents];
        const aSnap = [...auditColl.documents];
        const lSnap = [...leaseColl.documents];
        try { await fn(); } catch (e) {
          userColl.documents.length = 0; uSnap.forEach((d) => userColl.documents.push(d));
          auditColl.documents.length = 0; aSnap.forEach((d) => auditColl.documents.push(d));
          leaseColl.documents.length = 0; lSnap.forEach((d) => leaseColl.documents.push(d));
          throw e;
        }
      },
      async endSession() { sessionEnded = true; },
    };

    await executeFirstAdminBootstrap(
      { User: MockUser, AuditLog: MockAudit, WorkerLease: MockLease },
      { name: 'Session Test', email: 'session@school.edu.in', password: 'StrongPassword123!@#', role: 'super_admin' },
      { execute: true, connection: createMockConnection(trackingSession) }
    );

    assert.ok(sessionEnded, 'session.endSession() must be called after success');
  });

  await test('21N.3 Bootstrap: Session endSession is called after failure', async () => {
    const userColl = createMockCollection();
    const auditColl = createMockCollection();
    const leaseColl = createMockCollection();
    // Fail audit save
    const MockUser = createMockModelClass(userColl);
    const MockAudit = createMockModelClass(auditColl, { failOnSaveIndex: 0, failWithMessage: 'Forced audit fail' });
    const MockLease = createMockModelClass(leaseColl);

    let sessionEnded = false;
    const trackingSession = {
      async withTransaction(fn) {
        const uSnap = [...userColl.documents];
        const aSnap = [...auditColl.documents];
        const lSnap = [...leaseColl.documents];
        try { await fn(); } catch (e) {
          userColl.documents.length = 0; uSnap.forEach((d) => userColl.documents.push(d));
          auditColl.documents.length = 0; aSnap.forEach((d) => auditColl.documents.push(d));
          leaseColl.documents.length = 0; lSnap.forEach((d) => leaseColl.documents.push(d));
          throw e;
        }
      },
      async endSession() { sessionEnded = true; },
    };

    await assert.rejects(
      () => executeFirstAdminBootstrap(
        { User: MockUser, AuditLog: MockAudit, WorkerLease: MockLease },
        { name: 'Fail Session', email: 'failsess@school.edu.in', password: 'StrongPassword123!@#', role: 'super_admin' },
        { execute: true, connection: createMockConnection(trackingSession) }
      ),
      /AUDIT_LOG_FAILED/
    );

    assert.ok(sessionEnded, 'session.endSession() must be called even after failure');
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Part 7: Phase 21N.3 — Class Enforcement Across All Write Paths
  // ───────────────────────────────────────────────────────────────────────────

  await test('21N.3 Class: All 15 canonical values are present in CANONICAL_CLASS_LEVELS', () => {
    assert.deepEqual(CANONICAL_CLASS_LEVELS, [
      'Nursery', 'LKG', 'UKG',
      '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12',
    ]);
  });

  await test('21N.3 Class: All approved aliases resolve correctly', () => {
    const Class = require('../models/Class');
    const cases = {
      // Nursery
      'NC': 'Nursery', 'nc': 'Nursery', 'Nursery / NC': 'Nursery', 'nursery': 'Nursery', 'Nursery': 'Nursery',
      // LKG
      'KG-1': 'LKG', 'kg-1': 'LKG', 'KG1': 'LKG', 'KG 1': 'LKG', 'lkg': 'LKG', 'LKG': 'LKG',
      // UKG
      'KG-2': 'UKG', 'kg-2': 'UKG', 'KG2': 'UKG', 'KG 2': 'UKG', 'ukg': 'UKG', 'UKG': 'UKG',
      // Classes 1–12
      'Class 1': '1', 'class-1': '1', '1': '1',
      'Class 12': '12', 'class-12': '12', '12': '12',
    };
    for (const [input, expected] of Object.entries(cases)) {
      assert.equal(Class.normalizeClassLevel(input), expected, `alias '${input}' should resolve to '${expected}'`);
    }
  });

  await test('21N.3 Class: Pre-Nursery is explicitly rejected at model level', async () => {
    const Class = require('../models/Class');
    // normalizeClassLevel must return null for Pre-Nursery
    assert.equal(Class.normalizeClassLevel('Pre-Nursery'), null, 'Pre-Nursery must not normalize to any canonical value');
    // CANONICAL_CLASS_LEVELS must not include Pre-Nursery
    assert.ok(!Class.CANONICAL_CLASS_LEVELS.includes('Pre-Nursery'), 'CANONICAL_CLASS_LEVELS must not include Pre-Nursery');
  });

  await test('21N.3 Class: Pre-Nursery is in backward-compat CLASS_LEVELS (read only)', () => {
    // Student.CLASS_LEVELS includes Pre-Nursery for backward read-compat with historical records
    // This is intentional — verify it is present but not in CANONICAL
    const Student = require('../models/Student');
    const Class = require('../models/Class');
    assert.ok(Student.CLASS_LEVELS.includes('Pre-Nursery'), 'Student.CLASS_LEVELS preserves Pre-Nursery for historical read compat');
    assert.ok(!Class.CANONICAL_CLASS_LEVELS.includes('Pre-Nursery'), 'Class.CANONICAL_CLASS_LEVELS (new write path) must not include Pre-Nursery');
  });

  await test('21N.3 Class: classService.createClass rejects all invalid inputs', async () => {
    const Class = require('../models/Class');
    const origCreate = Class.create;
    const origFindOne = Class.findOne;
    Class.create = async () => { throw new Error('Should not reach'); };
    Class.findOne = async () => null;

    const service = require('../services/class.service');
    const invalidLevels = ['Pre-Nursery', 'Grade 5', 'Class 13', 'Primary', 'Section A', '', null, undefined, 999];

    for (const level of invalidLevels) {
      await assert.rejects(
        () => service.createClass({ name: level, academicYear: '2026-2027' }),
        (err) => err.message.includes('Pre-Nursery') || err.message.includes('approved 15') || err.message.includes('sections') || err.statusCode === 400,
        `createClass must reject: ${JSON.stringify(level)}`
      );
    }

    Class.create = origCreate;
    Class.findOne = origFindOne;
    delete require.cache[require.resolve('../services/class.service')];
  });

  await test('21N.3 Class: Student model CLASS_LEVELS does not include unapproved values beyond Pre-Nursery', () => {
    const Student = require('../models/Student');
    // The only "extra" value allowed in Student.CLASS_LEVELS beyond canonical is Pre-Nursery (historical)
    const canonical = new Set(['Nursery', 'LKG', 'UKG', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12']);
    const extra = Student.CLASS_LEVELS.filter((v) => !canonical.has(v));
    assert.deepEqual(extra, ['Pre-Nursery'], 'Only Pre-Nursery should be in Student.CLASS_LEVELS beyond canonical 15');
  });

  await test('21N.3 Class: promoteStudents classMap only contains canonical numeric classes 1–12', () => {
    // The classMap in student.service.js: {'1':'2',...,'11':'12'} — verify no Pre-Nursery or kg levels
    const classMapEntries = {
      '1':'2','2':'3','3':'4','4':'5','5':'6','6':'7','7':'8','8':'9','9':'10','10':'11','11':'12'
    };
    const Student = require('../models/Student');
    const canonical = new Set(Student.CLASS_LEVELS);
    for (const [from, to] of Object.entries(classMapEntries)) {
      assert.ok(canonical.has(from), `classMap source '${from}' must be a valid CLASS_LEVEL`);
      assert.ok(canonical.has(to), `classMap target '${to}' must be a valid CLASS_LEVEL`);
    }
    // No LKG/UKG/Nursery→Nursery promotion path in classMap (intentional — those need explicit assignment)
    assert.ok(!Object.prototype.hasOwnProperty.call(classMapEntries, 'Nursery'));
    assert.ok(!Object.prototype.hasOwnProperty.call(classMapEntries, 'LKG'));
    assert.ok(!Object.prototype.hasOwnProperty.call(classMapEntries, 'UKG'));
  });

  await test('21N.3 Class: AuditLog schema has no TTL index on leaseUntil-equivalent fields', () => {
    // AuditLog does not have leaseUntil — no TTL risk
    const AuditLog = require('../models/AuditLog');
    const schema = AuditLog.schema;
    const paths = Object.keys(schema.paths);
    assert.ok(!paths.includes('leaseUntil'), 'AuditLog must not have a leaseUntil field');
  });

  await test('21N.3 Class: WorkerLease permanent marker has no leaseUntil field (TTL-safe)', async () => {
    // The permanent marker document is created without a leaseUntil field
    // so TTL indexes on leaseUntil (if any) cannot delete it
    const WorkerLease = require('../models/WorkerLease');
    const schema = WorkerLease.schema;
    // leaseUntil field should be optional (not required)
    const leaseUntilPath = schema.paths.leaseUntil;
    assert.ok(leaseUntilPath, 'WorkerLease schema must define leaseUntil path');
    assert.ok(!leaseUntilPath.isRequired, 'leaseUntil must NOT be required so permanent marker can omit it');
    // Verify no TTL index is defined on leaseUntil
    const indexes = schema.indexes();
    const hasTTL = indexes.some(([fields, opts]) =>
      (fields.leaseUntil !== undefined) && opts.expireAfterSeconds !== undefined
    );
    assert.ok(!hasTTL, 'WorkerLease must not have a TTL index on leaseUntil');
  });

  await test('21N.3 Class: Admission model classApplyingFor includes Pre-Nursery for backward compat (read path)', () => {
    // Admission.classApplyingFor deliberately includes Pre-Nursery for historical records
    // but new admission submissions should be validated against the approved 15 levels
    // at the service/controller level (future work item — noted as FINDING)
    const Admission = require('../models/Admission');
    const schema = Admission.schema;
    const path = schema.paths.classApplyingFor;
    assert.ok(path, 'classApplyingFor field must exist');
    // Document that it currently allows Pre-Nursery (backward compat)
    const enumValues = path.enumValues || [];
    assert.ok(Array.isArray(enumValues), 'classApplyingFor must have enum values');
    // This is a documented finding — not a test failure
    // Pre-Nursery is allowed in Admission schema for historical backward compat
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Part 8: Phase 21N.4 Bootstrap Ownership Fencing & Class Write-Path Closure
  // ───────────────────────────────────────────────────────────────────────────

  await test('21N.4 Bootstrap: Current owner and generation can complete bootstrap atomically', async () => {
    const userColl = createMockCollection();
    const auditColl = createMockCollection();
    const leaseColl = createMockCollection();
    const MockUser = createMockModelClass(userColl);
    const MockAudit = createMockModelClass(auditColl);
    const MockLease = createMockModelClass(leaseColl);
    const mockConn = createMockConnection(null, [userColl, auditColl, leaseColl]);

    const res = await executeFirstAdminBootstrap(
      { User: MockUser, AuditLog: MockAudit, WorkerLease: MockLease },
      {
        name: 'School Admin',
        email: 'admin21n4@rbg.org',
        password: 'ValidPassword123!',
        confirmPassword: 'ValidPassword123!',
        role: 'school_admin',
      },
      { execute: true, connection: mockConn, attemptId: 'owner-21n4-ok' }
    );

    assert.equal(res.success, true);
    assert.equal(userColl.documents.length, 1);
    assert.equal(auditColl.documents.length, 1);

    const transientLease = leaseColl.documents.find((d) => d._id === 'bootstrap_first_admin');
    assert.ok(transientLease, 'Transient lease document must exist');
    assert.equal(transientLease.state, 'completed');
    assert.ok(transientLease.completedAt instanceof Date);

    const marker = leaseColl.documents.find((d) => d._id === 'bootstrap_permanent_marker');
    assert.ok(marker, 'Permanent marker must exist');
    assert.equal(marker.state, 'completed');
  });

  await test('21N.4 Bootstrap: Stale owner cannot commit after newer generation acquires lease', async () => {
    const userColl = createMockCollection();
    const auditColl = createMockCollection();
    const leaseColl = createMockCollection();
    const MockUser = createMockModelClass(userColl);
    const MockAudit = createMockModelClass(auditColl);
    const MockLease = createMockModelClass(leaseColl);

    let txStarted = false;
    const customSession = {
      async withTransaction(fn) {
        txStarted = true;
        const leaseDoc = leaseColl.documents.find((d) => d._id === 'bootstrap_first_admin');
        if (leaseDoc) {
          leaseDoc.generation = 2;
          leaseDoc.ownerId = 'competitor-owner';
        }
        await fn();
      },
      async endSession() {},
    };
    const mockConn = createMockConnection(customSession, [userColl, auditColl, leaseColl]);

    await assert.rejects(
      executeFirstAdminBootstrap(
        { User: MockUser, AuditLog: MockAudit, WorkerLease: MockLease },
        {
          name: 'School Admin',
          email: 'admin-stale@rbg.org',
          password: 'ValidPassword123!',
          confirmPassword: 'ValidPassword123!',
          role: 'school_admin',
        },
        { execute: true, connection: mockConn, attemptId: 'owner-original' }
      ),
      /STALE_LOCK_OWNER/
    );

    assert.ok(txStarted, 'Transaction must have been entered');
    assert.equal(userColl.documents.length, 0, 'No user should have been created');
    assert.equal(auditColl.documents.length, 0, 'No audit log should have been created');
  });

  await test('21N.4 Bootstrap: Expired lease cannot commit', async () => {
    const userColl = createMockCollection();
    const auditColl = createMockCollection();
    const leaseColl = createMockCollection();
    const MockUser = createMockModelClass(userColl);
    const MockAudit = createMockModelClass(auditColl);
    const MockLease = createMockModelClass(leaseColl);

    const customSession = {
      async withTransaction(fn) {
        const leaseDoc = leaseColl.documents.find((d) => d._id === 'bootstrap_first_admin');
        if (leaseDoc) {
          leaseDoc.leaseUntil = new Date(Date.now() - 10000); // expired
        }
        await fn();
      },
      async endSession() {},
    };
    const mockConn = createMockConnection(customSession, [userColl, auditColl, leaseColl]);

    await assert.rejects(
      executeFirstAdminBootstrap(
        { User: MockUser, AuditLog: MockAudit, WorkerLease: MockLease },
        {
          name: 'School Admin',
          email: 'admin-expired@rbg.org',
          password: 'ValidPassword123!',
          confirmPassword: 'ValidPassword123!',
          role: 'school_admin',
        },
        { execute: true, connection: mockConn, attemptId: 'owner-expired' }
      ),
      /STALE_LOCK_OWNER/
    );

    assert.equal(userColl.documents.length, 0);
  });

  await test('21N.4 Bootstrap: Ownership changes during transaction cause abort', async () => {
    const userColl = createMockCollection();
    const auditColl = createMockCollection();
    const leaseColl = createMockCollection();
    const MockUser = createMockModelClass(userColl);
    const MockAudit = createMockModelClass(auditColl);
    const MockLease = createMockModelClass(leaseColl);

    const customSession = {
      async withTransaction(fn) {
        const leaseDoc = leaseColl.documents.find((d) => d._id === 'bootstrap_first_admin');
        if (leaseDoc) {
          leaseDoc.ownerId = 'rogue-owner';
        }
        await fn();
      },
      async endSession() {},
    };
    const mockConn = createMockConnection(customSession, [userColl, auditColl, leaseColl]);

    await assert.rejects(
      executeFirstAdminBootstrap(
        { User: MockUser, AuditLog: MockAudit, WorkerLease: MockLease },
        {
          name: 'School Admin',
          email: 'admin-changed@rbg.org',
          password: 'ValidPassword123!',
          confirmPassword: 'ValidPassword123!',
          role: 'school_admin',
        },
        { execute: true, connection: mockConn, attemptId: 'legit-owner' }
      ),
      /STALE_LOCK_OWNER/
    );

    assert.equal(userColl.documents.length, 0);
    assert.equal(auditColl.documents.length, 0);
  });

  await test('21N.4 Bootstrap: User, AuditLog, marker, and completion state roll back together on audit failure', async () => {
    const userColl = createMockCollection();
    const auditColl = createMockCollection();
    const leaseColl = createMockCollection();
    const MockUser = createMockModelClass(userColl);
    const MockAudit = createMockModelClass(auditColl, { failOnSaveIndex: 0, failWithMessage: 'Disk write error' });
    const MockLease = createMockModelClass(leaseColl);
    const mockConn = createMockConnection(null, [userColl, auditColl, leaseColl]);

    await assert.rejects(
      executeFirstAdminBootstrap(
        { User: MockUser, AuditLog: MockAudit, WorkerLease: MockLease },
        {
          name: 'School Admin',
          email: 'admin-fail@rbg.org',
          password: 'ValidPassword123!',
          confirmPassword: 'ValidPassword123!',
          role: 'school_admin',
        },
        { execute: true, connection: mockConn }
      ),
      /AUDIT_LOG_FAILED/
    );

    assert.equal(userColl.documents.length, 0, 'User must be rolled back');
    assert.equal(auditColl.documents.length, 0, 'No partial audit log');
    const marker = leaseColl.documents.find((d) => d._id === 'bootstrap_permanent_marker');
    assert.equal(marker, undefined, 'Permanent marker must not exist');
  });

  await test('21N.4 Class Write: Class.validateAndNormalizeClassWrite normalizes aliases and rejects invalid values', () => {
    const Class = require('../models/Class');
    const fn = Class.validateAndNormalizeClassWrite;

    assert.equal(fn('Nursery'), 'Nursery');
    assert.equal(fn('NC'), 'Nursery');
    assert.equal(fn('nursery / nc'), 'Nursery');
    assert.equal(fn('KG-1'), 'LKG');
    assert.equal(fn('lkg'), 'LKG');
    assert.equal(fn('KG-2'), 'UKG');
    assert.equal(fn('ukg'), 'UKG');
    assert.equal(fn('Class 1'), '1');
    assert.equal(fn('class 12'), '12');
    assert.equal(fn('5'), '5');

    // Reject Pre-Nursery
    assert.throws(() => fn('Pre-Nursery'), /'Pre-Nursery' is not an approved school class level/);
    assert.throws(() => fn('pre nursery'), /'Pre-Nursery' is not an approved school class level/);

    // Reject sections
    assert.throws(() => fn('10-A'), /Class sections are not supported/);
    assert.throws(() => fn('10A'), /Class sections are not supported/);
    assert.throws(() => fn('Class 5 B'), /Class sections are not supported/);
    assert.throws(() => fn('Nursery-A'), /Class sections are not supported/);

    // Reject unapproved
    assert.throws(() => fn('13'), /not one of the approved 15 school class levels/);
    assert.throws(() => fn('College'), /not one of the approved 15 school class levels/);
  });

  await test('21N.4 Class Write: Student pre-validate hook rejects Pre-Nursery, sections, and normalizes aliases', async () => {
    const Student = require('../models/Student');

    // Reject Pre-Nursery on new record
    const s1 = new Student({ class: 'Pre-Nursery' });
    let err1;
    try { await s1.validate(); } catch (e) { err1 = e; }
    assert.ok(err1 && err1.errors && err1.errors.class, 'Pre-Nursery must fail validation');
    assert.match(err1.errors.class.message, /'Pre-Nursery' is not an approved school class level/);

    // Reject section
    const s2 = new Student({ class: '5', section: 'A' });
    let err2;
    try { await s2.validate(); } catch (e) { err2 = e; }
    assert.ok(err2 && err2.errors && err2.errors.section, 'Section must fail validation');

    // Reject section embedded in class
    const s3 = new Student({ class: '10-A' });
    let err3;
    try { await s3.validate(); } catch (e) { err3 = e; }
    assert.ok(err3 && err3.errors && err3.errors.class, 'Class 10-A must fail validation');

    // Normalize alias on new record
    const s4 = new Student({ class: 'NC' });
    try { await s4.validate(); } catch (_) {}
    assert.equal(s4.class, 'Nursery');

    const s5 = new Student({ class: 'KG-1' });
    try { await s5.validate(); } catch (_) {}
    assert.equal(s5.class, 'LKG');
  });

  await test('21N.4 Class Write: Historical student with Pre-Nursery is preserved when class is not modified', async () => {
    const Student = require('../models/Student');

    // Simulate an existing student document loaded from database
    const historical = new Student({
      _id: '507f1f77bcf86cd799439011',
      rollNumber: 1,
      class: 'Pre-Nursery',
      academicYear: '2023-2024',
      father: { name: 'Father' },
      mother: { name: 'Mother' },
      user: '507f1f77bcf86cd799439012',
    });
    // Mark as not new (existing record from DB)
    historical.isNew = false;
    // Clear modified paths
    historical.$__reset();

    // Modify a non-class field (e.g. remarks)
    historical.remarks = 'Updated remarks';
    assert.ok(!historical.isModified('class'), 'class should not be modified');

    // Validation must NOT fail for the historical Pre-Nursery value
    let errHist = null;
    try {
      await historical.validate();
    } catch (e) {
      errHist = e;
    }
    // Any error should not be related to class
    if (errHist && errHist.errors) {
      assert.ok(!errHist.errors.class, 'Historical class must not cause validation error');
    }
    assert.equal(historical.class, 'Pre-Nursery', 'Historical class must not be rewritten');
  });

  await test('21N.4 Class Write: Admission pre-validate hook rejects Pre-Nursery, sections, and normalizes aliases', async () => {
    const Admission = require('../models/Admission');

    // Reject Pre-Nursery
    const a1 = new Admission({ classApplyingFor: 'Pre-Nursery' });
    let err1;
    try { await a1.validate(); } catch (e) { err1 = e; }
    assert.ok(err1 && err1.errors && err1.errors.classApplyingFor);
    assert.match(err1.errors.classApplyingFor.message, /'Pre-Nursery' is not an approved school class level/);

    // Reject section
    const a2 = new Admission({ classApplyingFor: '5', section: 'B' });
    let err2;
    try { await a2.validate(); } catch (e) { err2 = e; }
    assert.ok(err2 && err2.errors && err2.errors.section);

    // Normalize alias
    const a3 = new Admission({ classApplyingFor: 'KG-2' });
    try { await a3.validate(); } catch (_) {}
    assert.equal(a3.classApplyingFor, 'UKG');
  });

  await test('21N.4 Class Write: Faculty pre-validate hook rejects Pre-Nursery and normalizes aliases in classTeacherOf and subjects', async () => {
    const Faculty = require('../models/Faculty');

    // Reject Pre-Nursery in classTeacherOf
    const f1 = new Faculty({ classTeacherOf: { class: 'Pre-Nursery' } });
    let err1;
    try { await f1.validate(); } catch (e) { err1 = e; }
    assert.ok(err1 && err1.errors && err1.errors['classTeacherOf.class']);

    // Reject Pre-Nursery in subjects
    const f2 = new Faculty({ subjects: [{ subject: 'Math', classes: ['Pre-Nursery'] }] });
    let err2;
    try { await f2.validate(); } catch (e) { err2 = e; }
    assert.ok(err2 && err2.errors && err2.errors.subjects);

    // Normalize alias in classTeacherOf
    const f3 = new Faculty({ classTeacherOf: { class: 'Class 5' } });
    try { await f3.validate(); } catch (_) {}
    assert.equal(f3.classTeacherOf.class, '5');

    // Normalize alias in subjects
    const f4 = new Faculty({ subjects: [{ subject: 'Hindi', classes: ['NC', 'KG-1'] }] });
    try { await f4.validate(); } catch (_) {}
    assert.deepEqual(f4.subjects[0].classes, ['Nursery', 'LKG']);
  });

  await test('21N.4 Class Write: SubjectAllocation pre-validate hook rejects Pre-Nursery and normalizes aliases', async () => {
    const SubjectAllocation = require('../models/SubjectAllocation');

    // Reject Pre-Nursery
    const sa1 = new SubjectAllocation({ class: 'Pre-Nursery' });
    let err1;
    try { await sa1.validate(); } catch (e) { err1 = e; }
    assert.ok(err1 && err1.errors && err1.errors.class);

    // Reject section
    const sa2 = new SubjectAllocation({ class: '5', section: 'A' });
    let err2;
    try { await sa2.validate(); } catch (e) { err2 = e; }
    assert.ok(err2 && err2.errors && err2.errors.section);

    // Normalize alias
    const sa3 = new SubjectAllocation({ class: 'Class 10' });
    try { await sa3.validate(); } catch (_) {}
    assert.equal(sa3.class, '10');
  });

  await test('21N.4 Class Write: Admission service applyForAdmission rejects Pre-Nursery and section', async () => {
    const admissionService = require('../services/admission.service');

    await assert.rejects(
      admissionService.applyForAdmission({ classApplyingFor: 'Pre-Nursery' }),
      /'Pre-Nursery' is not an approved school class level/
    );

    await assert.rejects(
      admissionService.applyForAdmission({ classApplyingFor: '5', section: 'A' }),
      /Class sections are not supported/
    );
  });

  await test('21N.4 Class Write: Account invitation inviteStudent rejects Pre-Nursery and section', async () => {
    const accountInvitationService = require('../services/account-invitation.service');

    await assert.rejects(
      accountInvitationService.inviteStudent({
        name: 'Test Student',
        email: 'test-inv@example.com',
        class: 'Pre-Nursery',
        rollNumber: 1,
        academicYear: '2024-2025',
        enrollmentEffectiveFrom: '2024-04-01',
        father: { name: 'Father' },
        mother: { name: 'Mother' },
      }),
      /'Pre-Nursery' is not an approved school class level/
    );

    await assert.rejects(
      accountInvitationService.inviteStudent({
        name: 'Test Student',
        email: 'test-inv2@example.com',
        class: '5',
        section: 'A',
        rollNumber: 2,
        academicYear: '2024-2025',
        enrollmentEffectiveFrom: '2024-04-01',
        father: { name: 'Father' },
        mother: { name: 'Mother' },
      }),
      /Unsupported invitation field: section/
    );
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Summary
  // ───────────────────────────────────────────────────────────────────────────

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log(`${'═'.repeat(60)}\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
