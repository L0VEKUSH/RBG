'use strict';

const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const HOST_PATTERN = /^[a-z0-9.-]{1,253}$/i;
const DATABASE_PATTERN = /^[A-Za-z0-9_-]{1,63}$/;
const PORT_PATTERN = /^(?:srv|[0-9]{1,5})$/;
const EMAIL_PATTERN = /^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/;
const PHONE_PATTERN = /^[6-9]\d{9}$/;

const PRIVILEGED_ROLES = ['super_admin', 'school_admin', 'admin'];

function fail(code, message) {
  const msg = message ? `[${code}] ${message}` : code;
  const error = new Error(msg);
  error.safeCode = code;
  throw error;
}

/**
 * Parse CLI arguments for first-admin bootstrap.
 * Strictly forbids passing passwords on the command line.
 */
function parseBootstrapArguments(argv) {
  const values = Object.create(null);
  let execute = false;

  for (const argument of argv) {
    if (argument === '--execute') {
      if (execute) fail('DUPLICATE_ARGUMENT', 'Duplicate --execute argument');
      execute = true;
      continue;
    }

    if (argument.startsWith('--password=') || argument === '--password') {
      fail(
        'PASSWORD_IN_ARGV_FORBIDDEN',
        'Passwords must not be passed in command-line arguments. Set BOOTSTRAP_ADMIN_PASSWORD in environment or stdin.'
      );
    }

    const match = /^(--expected-host|--expected-port|--expected-db|--confirm-production-target|--confirm-bootstrap-first-admin|--name|--email|--role|--phone)=(.*)$/.exec(argument);
    if (match) {
      if (Object.prototype.hasOwnProperty.call(values, match[1])) {
        fail('DUPLICATE_ARGUMENT', `Duplicate argument: ${match[1]}`);
      }
      values[match[1]] = match[2];
      continue;
    }

    if (argument === '--confirm-bootstrap-first-admin') {
      values['--confirm-bootstrap-first-admin'] = 'true';
      continue;
    }

    fail('INVALID_ARGUMENTS', `Unrecognized argument: ${argument}`);
  }

  const expectedHost = values['--expected-host'];
  const expectedPort = values['--expected-port'];
  const expectedDatabase = values['--expected-db'];
  const confirmation = values['--confirm-production-target'];
  const bootstrapConfirm = values['--confirm-bootstrap-first-admin'];

  if (!expectedHost || !HOST_PATTERN.test(expectedHost) ||
      !expectedPort || !PORT_PATTERN.test(expectedPort) ||
      !expectedDatabase || !DATABASE_PATTERN.test(expectedDatabase) ||
      (expectedPort !== 'srv' && (Number(expectedPort) < 1 || Number(expectedPort) > 65535))) {
    fail('TARGET_SPECIFICATION_REQUIRED', 'Missing or invalid target specifications (--expected-host, --expected-port, --expected-db).');
  }

  if (execute) {
    if (!confirmation || confirmation !== `${expectedHost}/${expectedDatabase}`) {
      fail('TARGET_CONFIRMATION_REQUIRED', 'Execution requires explicit --confirm-production-target matching <expectedHost>/<expectedDatabase>.');
    }
    if (!bootstrapConfirm) {
      fail('BOOTSTRAP_CONFIRMATION_REQUIRED', 'Execution requires explicit --confirm-bootstrap-first-admin flag.');
    }
  }

  const name = values['--name'];
  const email = values['--email'];
  const role = values['--role'] || 'super_admin';
  const phone = values['--phone'];

  return {
    execute,
    expectedHost: expectedHost.toLowerCase(),
    expectedPort,
    expectedDatabase,
    confirmation,
    bootstrapConfirm: Boolean(bootstrapConfirm),
    name,
    email: email ? email.toLowerCase().trim() : undefined,
    role,
    phone,
  };
}

/**
 * Validate administrator input credentials and profile according to User schema rules.
 */
function validateAdminInput({ name, email, password, role = 'super_admin', phone }) {
  if (!name || typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 100) {
    fail('INVALID_ADMIN_NAME', 'Administrator name must be between 2 and 100 characters.');
  }

  if (!email || typeof email !== 'string' || !EMAIL_PATTERN.test(email.trim().toLowerCase())) {
    fail('INVALID_ADMIN_EMAIL', 'A valid administrator email address is required.');
  }

  if (!password || typeof password !== 'string') {
    fail('PASSWORD_REQUIRED', 'Administrator password is required via BOOTSTRAP_ADMIN_PASSWORD.');
  }

  // Strong password requirements: minimum 12 chars, upper, lower, number, special char
  if (password.length < 12) {
    fail('PASSWORD_TOO_SHORT', 'Administrator password must be at least 12 characters.');
  }
  if (!/[A-Z]/.test(password)) {
    fail('PASSWORD_WEAK', 'Administrator password must include at least one uppercase letter.');
  }
  if (!/[a-z]/.test(password)) {
    fail('PASSWORD_WEAK', 'Administrator password must include at least one lowercase letter.');
  }
  if (!/[0-9]/.test(password)) {
    fail('PASSWORD_WEAK', 'Administrator password must include at least one number.');
  }
  if (!/[!@#$%^&*(),.?":{}|<>]/.test(password)) {
    fail('PASSWORD_WEAK', 'Administrator password must include at least one special character.');
  }

  if (!['super_admin', 'school_admin'].includes(role)) {
    fail('INVALID_ADMIN_ROLE', "Administrator role must be either 'super_admin' or 'school_admin'.");
  }

  if (phone && !PHONE_PATTERN.test(phone)) {
    fail('INVALID_ADMIN_PHONE', 'Phone number must be a valid 10-digit Indian mobile number.');
  }

  return {
    name: name.trim(),
    email: email.trim().toLowerCase(),
    password,
    role,
    phone: phone || undefined,
  };
}

/**
 * Check if the database is eligible for first-admin bootstrap.
 * Must refuse if any privileged user (super_admin, school_admin, admin) exists.
 */
async function checkBootstrapEligibility(UserModel) {
  const privilegedCount = await UserModel.countDocuments({
    role: { $in: PRIVILEGED_ROLES },
  });

  if (privilegedCount > 0) {
    return {
      eligible: false,
      reason: 'PRIVILEGED_USER_ALREADY_EXISTS',
      privilegedCount,
    };
  }

  return {
    eligible: true,
    privilegedCount: 0,
  };
}

function isTransactionUnavailable(error) {
  return Boolean(error && (
    error.code === 20 ||
    /transaction numbers are only allowed|transactions are not supported|does not support transactions/i.test(String(error.message || ''))
  ));
}

/**
 * Acquire concurrency lock to prevent simultaneous first-admin creation.
 * Uses atomic CAS on WorkerLease with generation fencing.
 */
async function acquireBootstrapLock(WorkerLeaseModel, {
  lockId = 'bootstrap_first_admin',
  ownerId = crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex'),
  leaseMs = 5 * 60 * 1000,
} = {}) {
  // Check durable permanent marker first
  const permanent = await WorkerLeaseModel.findById('bootstrap_permanent_marker');
  if (permanent && permanent.state === 'completed') {
    fail('BOOTSTRAP_ALREADY_COMPLETED', 'First-admin bootstrap has already been completed in this database.');
  }

  const leaseUntil = new Date(Date.now() + leaseMs);

  try {
    const lease = await WorkerLeaseModel.create({
      _id: lockId,
      ownerId,
      generation: 1,
      leaseUntil,
      state: 'in_progress',
    });
    return { acquired: true, lockId, ownerId, generation: 1, lease };
  } catch (error) {
    if (error && error.code === 11000) {
      const existing = await WorkerLeaseModel.findById(lockId);
      if (!existing) {
        fail('LOCK_ACQUISITION_FAILED', 'Failed to inspect existing bootstrap lease.');
      }

      if (existing.state === 'completed') {
        fail('BOOTSTRAP_ALREADY_COMPLETED', 'First-admin bootstrap has already been completed in this database.');
      }

      const now = new Date();
      if (existing.leaseUntil && existing.leaseUntil > now) {
        fail('CONCURRENT_BOOTSTRAP_IN_PROGRESS', 'Another first-admin bootstrap attempt is currently active.');
      }

      // Re-acquire expired lease atomically using CAS on generation and leaseUntil
      const currentGen = existing.generation || 1;
      const nextGen = currentGen + 1;
      const updated = await WorkerLeaseModel.findOneAndUpdate(
        {
          _id: lockId,
          generation: currentGen,
          leaseUntil: existing.leaseUntil,
          state: 'in_progress',
        },
        {
          ownerId,
          generation: nextGen,
          leaseUntil,
          state: 'in_progress',
        },
        { new: true }
      );

      if (!updated) {
        fail('CONCURRENT_BOOTSTRAP_IN_PROGRESS', 'Concurrent bootstrap attempt won the lease renewal race.');
      }

      return { acquired: true, lockId, ownerId, generation: nextGen, lease: updated };
    }
    throw error;
  }
}

/**
 * Renew an active lease to prevent expiration during long operations.
 * Fails closed if the lease was lost or overtaken by a newer generation.
 */
async function renewBootstrapLock(WorkerLeaseModel, {
  lockId = 'bootstrap_first_admin',
  ownerId,
  generation,
  leaseMs = 5 * 60 * 1000,
}) {
  if (!WorkerLeaseModel || !ownerId) return;

  const renewed = await WorkerLeaseModel.findOneAndUpdate(
    {
      _id: lockId,
      ownerId,
      generation,
      state: 'in_progress',
    },
    {
      leaseUntil: new Date(Date.now() + leaseMs),
    },
    { new: true }
  );

  if (!renewed) {
    fail('LEASE_LOST', 'Bootstrap lock lease was lost or overtaken by another generation.');
  }

  return renewed;
}

/**
 * Release or finalize concurrency lock.
 * Fenced by ownerId and generation so a stale process cannot overwrite newer state.
 */
async function releaseBootstrapLock(WorkerLeaseModel, {
  lockId = 'bootstrap_first_admin',
  ownerId,
  generation,
  completed = false,
} = {}) {
  if (!WorkerLeaseModel) return;

  if (completed) {
    // Transition to durable terminal 'completed' state
    const finalized = await WorkerLeaseModel.findOneAndUpdate(
      {
        _id: lockId,
        ownerId,
        generation,
        state: 'in_progress',
      },
      {
        state: 'completed',
        completedAt: new Date(),
        $unset: { leaseUntil: 1 },
      },
      { new: true }
    );

    if (!finalized) {
      fail('STALE_LOCK_OWNER', 'Stale lock owner attempted to complete an unowned or superseded bootstrap lock.');
    }
  } else {
    // On failure/rollback, delete the lease ONLY IF ownerId and generation match
    const deleted = await WorkerLeaseModel.deleteOne({
      _id: lockId,
      ownerId,
      generation,
      state: 'in_progress',
    });
    if (deleted && deleted.deletedCount === 0) {
      fail('STALE_LOCK_OWNER', 'Stale lock owner attempted to release an unowned or superseded bootstrap lock.');
    }
  }
}

/**
 * Execute or dry-run the first-admin bootstrap.
 * Guarantees that account creation and audit logging are strictly atomic.
 */
async function executeFirstAdminBootstrap(models, input, options = {}) {
  const { User, AuditLog, WorkerLease } = models;
  const validated = validateAdminInput(input);
  const execute = Boolean(options.execute);

  // 1. Initial eligibility check
  const eligibility = await checkBootstrapEligibility(User);
  if (!eligibility.eligible) {
    fail('PRIVILEGED_USER_ALREADY_EXISTS', 'Cannot bootstrap first admin: a privileged user already exists in the database.');
  }

  // 2. Check if the proposed email already belongs to an existing user (prevent silent promotion)
  const existingUser = await User.findOne({ email: validated.email });
  if (existingUser) {
    fail('USER_EMAIL_ALREADY_EXISTS', 'Cannot bootstrap first admin: an account with this email address already exists. Silent role promotion is forbidden.');
  }

  // Check if WorkerLease already marks bootstrap as completed
  if (WorkerLease) {
    const permanentMarker = await WorkerLease.findById('bootstrap_permanent_marker');
    if (permanentMarker && permanentMarker.state === 'completed') {
      fail('BOOTSTRAP_ALREADY_COMPLETED', 'First-admin bootstrap has already been completed in this database.');
    }
    const existingLock = await WorkerLease.findById('bootstrap_first_admin');
    if (existingLock && existingLock.state === 'completed') {
      fail('BOOTSTRAP_ALREADY_COMPLETED', 'First-admin bootstrap has already been completed in this database.');
    }
  }

  if (!execute) {
    return {
      mode: 'dry-run',
      eligible: true,
      privilegedCount: 0,
      admin: {
        name: validated.name,
        email: validated.email,
        role: validated.role,
        hasPhone: Boolean(validated.phone),
      },
    };
  }

  // 3. Execution mode: verify transaction capability upfront (fail-closed, no fallback)
  const connection = options.connection || (User && User.db) || (AuditLog && AuditLog.db);
  if (!connection || typeof connection.startSession !== 'function') {
    fail('TRANSACTIONS_UNAVAILABLE', 'MongoDB multi-document transactions are required for first-admin bootstrap. Transactions are unavailable on this connection.');
  }

  // 4. Acquire concurrency lock with generation fencing
  let lock;
  if (WorkerLease) {
    lock = await acquireBootstrapLock(WorkerLease, {
      ownerId: options.attemptId || (crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex')),
    });
  }

  let session;
  let createdUser = null;
  let transactionCommitted = false;

  try {
    // Re-verify eligibility under lock
    const lockedEligibility = await checkBootstrapEligibility(User);
    if (!lockedEligibility.eligible) {
      fail('PRIVILEGED_USER_ALREADY_EXISTS', 'Cannot bootstrap first admin: a privileged user already exists.');
    }

    const lockedExisting = await User.findOne({ email: validated.email });
    if (lockedExisting) {
      fail('USER_EMAIL_ALREADY_EXISTS', 'Cannot bootstrap first admin: email already exists.');
    }

    // Heartbeat / renew lock prior to entering transaction.
    // If renewal fails, abort immediately before account creation!
    if (WorkerLease && lock) {
      await renewBootstrapLock(WorkerLease, {
        lockId: lock.lockId,
        ownerId: lock.ownerId,
        generation: lock.generation,
      });
    }

    // Start MongoDB session and transaction
    try {
      session = await connection.startSession();
    } catch (sessErr) {
      fail('TRANSACTIONS_UNAVAILABLE', `Failed to start MongoDB session: ${sessErr.message}`);
    }

    try {
      await session.withTransaction(async () => {
        // Eligibility check within transaction snapshot
        const txPrivileged = await User.countDocuments({ role: { $in: PRIVILEGED_ROLES } }).session(session);
        if (txPrivileged > 0) {
          fail('PRIVILEGED_USER_ALREADY_EXISTS', 'Privileged user exists inside transaction.');
        }

        const txExisting = await User.findOne({ email: validated.email }).session(session);
        if (txExisting) {
          fail('USER_EMAIL_ALREADY_EXISTS', 'Email already exists inside transaction.');
        }

        if (WorkerLease) {
          const txMarker = await WorkerLease.findById('bootstrap_permanent_marker').session(session);
          if (txMarker && txMarker.state === 'completed') {
            fail('BOOTSTRAP_ALREADY_COMPLETED', 'Permanent bootstrap marker exists inside transaction.');
          }
        }

        // 1. Transaction fencing write: conditionally update transient WorkerLease document.
        // Matches exact _id, ownerId, generation, state: 'in_progress', and leaseUntil > now.
        // Executes within the transaction session, acquiring a write lock on the lease document
        // and participating in MongoDB transaction conflict detection.
        // If ownership changed, the lease expired, or generation was bumped, 0 documents match -> abort.
        if (WorkerLease && lock) {
          const now = new Date();
          const fencedLease = await WorkerLease.findOneAndUpdate(
            {
              _id: lock.lockId,
              ownerId: lock.ownerId,
              generation: lock.generation,
              state: 'in_progress',
              leaseUntil: { $gt: now },
            },
            {
              state: 'completed',
              completedAt: new Date(),
              $unset: { leaseUntil: 1 },
            },
            { session, new: true }
          );

          if (!fencedLease) {
            fail('STALE_LOCK_OWNER', 'Bootstrap lock lease ownership check failed inside transaction. Lease expired, stolen, or superseded.');
          }
        }

        // 2. Create User inside transaction session
        let userDoc;
        const userPayload = {
          name: validated.name,
          email: validated.email,
          password: validated.password,
          role: validated.role,
          phone: validated.phone,
          isActive: true,
          isEmailVerified: true,
        };
        if (typeof User === 'function') {
          userDoc = new User(userPayload);
          if (typeof userDoc.save === 'function') {
            await userDoc.save({ session });
          } else {
            const created = await User.create([userPayload], { session });
            userDoc = Array.isArray(created) ? created[0] : created;
          }
        } else if (User && typeof User.create === 'function') {
          const created = await User.create(userPayload, { session });
          userDoc = Array.isArray(created) ? created[0] : created;
        }
        createdUser = userDoc;

        // 2. Create AuditLog inside transaction session
        if (AuditLog) {
          try {
            const emailParts = validated.email.split('@');
            const maskedEmail = `${emailParts[0].slice(0, 2)}***@${emailParts[1]}`;
            const auditData = {
              user: userDoc._id,
              action: 'BOOTSTRAP_FIRST_ADMIN',
              resource: 'User',
              resourceId: userDoc._id,
              details: {
                mechanism: 'OPERATOR_BOOTSTRAP_CLI',
                authenticatedSession: false,
                targetRole: userDoc.role,
                maskedEmail,
                bootstrapTimestamp: new Date(),
              },
            };
            if (typeof AuditLog === 'function') {
              const auditDoc = new AuditLog(auditData);
              if (typeof auditDoc.save === 'function') {
                await auditDoc.save({ session });
              } else {
                await AuditLog.create(auditData, { session });
              }
            } else if (typeof AuditLog.create === 'function') {
              await AuditLog.create(auditData, { session });
            }
          } catch (auditErr) {
            fail('AUDIT_LOG_FAILED', `Audit log persistence failed (${auditErr.message}). First-admin creation was aborted to ensure audit integrity.`);
          }
        }

        // 3. Create durable permanent marker inside transaction session
        // Note: strictly no leaseUntil field so TTL indexes cannot remove it
        if (WorkerLease) {
          const markerData = {
            _id: 'bootstrap_permanent_marker',
            ownerId: lock ? lock.ownerId : 'SYSTEM',
            generation: lock ? lock.generation : 1,
            state: 'completed',
            completedAt: new Date(),
          };
          if (typeof WorkerLease === 'function') {
            const markerDoc = new WorkerLease(markerData);
            if (typeof markerDoc.save === 'function') {
              await markerDoc.save({ session });
            } else {
              await WorkerLease.create(markerData, { session });
            }
          } else if (typeof WorkerLease.create === 'function') {
            await WorkerLease.create(markerData, { session });
          }
        }
      }, {
        readConcern: { level: 'snapshot' },
        writeConcern: { w: 'majority' },
        readPreference: 'primary',
      });
      transactionCommitted = true;
    } catch (txErr) {
      if (isTransactionUnavailable(txErr)) {
        fail('TRANSACTIONS_UNAVAILABLE', 'MongoDB multi-document transactions are not supported by the database deployment. First-admin bootstrap requires transactions.');
      }
      throw txErr;
    }

    // Transient lock document was transitioned to completed state inside the transaction session
    // and committed atomically with User, AuditLog, and permanent marker.

    return {
      mode: 'execute',
      success: true,
      admin: {
        id: createdUser._id,
        name: createdUser.name,
        email: createdUser.email,
        role: createdUser.role,
        createdAt: createdUser.createdAt,
      },
    };
  } catch (err) {
    if (WorkerLease && lock && !transactionCommitted) {
      try {
        await releaseBootstrapLock(WorkerLease, {
          lockId: lock.lockId,
          ownerId: lock.ownerId,
          generation: lock.generation,
          completed: false,
        });
      } catch (cleanupErr) {
        err.cleanupError = cleanupErr;
      }
    }
    throw err;
  } finally {
    if (session) {
      try {
        await session.endSession();
      } catch (_) {}
    }
  }
}

module.exports = {
  PRIVILEGED_ROLES,
  parseBootstrapArguments,
  validateAdminInput,
  checkBootstrapEligibility,
  acquireBootstrapLock,
  renewBootstrapLock,
  releaseBootstrapLock,
  executeFirstAdminBootstrap,
};
