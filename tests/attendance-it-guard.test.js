'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const guard = require('../scripts/attendance-it-guard');

const RUN_ID = '0123456789abcdef0123456789abcdef';
const DATABASE_NAME = `erp_attendance_it_${RUN_ID}`;

function withNodeEnv(value, callback) {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = value;
  try {
    return callback();
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  }
}

async function withNodeEnvAsync(value, callback) {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = value;
  try {
    return await callback();
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  }
}

function validHello(overrides = {}) {
  return {
    setName: guard.REPLICA_SET,
    isWritablePrimary: true,
    secondary: false,
    hosts: [guard.MEMBER_ADDRESS],
    primary: guard.MEMBER_ADDRESS,
    me: guard.MEMBER_ADDRESS,
    passives: [],
    arbiters: [],
    ...overrides,
  };
}

function createTarget() {
  const context = guard.createRunContext();
  const uri = guard.buildTestUri(context);
  return { context, uri, target: guard.validateTestUri(uri, context) };
}

function validTopologyContext() {
  const { context, target } = createTarget();
  const lease = guard.createOwnershipLease(context);
  const topologyValidation = guard.validateHelloResponseShape(validHello(), target);
  return { context, lease, target, topologyValidation };
}

test('run IDs are cryptographically generated and pure format validation rejects malformed values', () => {
  const first = guard.generateRunId();
  const second = guard.generateRunId();
  assert.match(first, /^[a-f0-9]{32}$/);
  assert.match(second, /^[a-f0-9]{32}$/);
  assert.notEqual(first, second);
  assert.equal(guard.validateRunId(RUN_ID), RUN_ID);
  for (const invalid of ['', 'prefix-only', 'a'.repeat(31), 'g'.repeat(32), RUN_ID.toUpperCase(), null]) {
    assert.throws(() => guard.validateRunId(invalid), /Invalid attendance test run ID/);
  }
});

test('database-name format validation rejects prefix-only and malformed run IDs', () => {
  assert.equal(guard.databaseNameForRunId(RUN_ID), DATABASE_NAME);
  assert.throws(() => guard.databaseNameForRunId('erp_attendance_it_'), /Invalid attendance test run ID/);
  assert.throws(() => guard.databaseNameForRunId('erp_attendance_it_20261106'), /Invalid attendance test run ID/);
});

test('runtime context generates its own run ID and can issue only one target', () => {
  withNodeEnv('test', () => {
    assert.throws(() => guard.createRunContext(RUN_ID), /does not accept a caller-supplied run ID/);
    const context = guard.createRunContext();
    assert.match(context.runId, /^[a-f0-9]{32}$/);
    assert.equal(context.databaseName, guard.databaseNameForRunId(context.runId));

    const uri = guard.buildTestUri(context);
    assert.equal(uri, `mongodb://127.0.0.1:27018/${context.databaseName}?replicaSet=rbgAttendanceIT`);
    assert.throws(() => guard.buildTestUri(context), /already issued/);

    const target = guard.validateTestUri(uri, context);
    assert.equal(target.databaseName, context.databaseName);
    assert.equal(target.runId, context.runId);
    assert.throws(() => guard.validateTestUri(uri, context), /must be validated once/);
    const lease = guard.createOwnershipLease(context);
    assert.equal(lease.databaseName, context.databaseName);
    assert.throws(() => guard.createOwnershipLease(context), /already has an ownership lease/);
  });
});

test('runtime environment gate reads process.env and ignores caller override attempts', () => {
  withNodeEnv('test', () => {
    const { context, uri } = createTarget();
    withNodeEnv('production', () => {
      assert.throws(() => guard.createRunContext(), /process\.env\.NODE_ENV=test/);
      assert.throws(() => guard.buildTestUri(context, { nodeEnv: 'test' }), /process\.env\.NODE_ENV=test/);
      assert.throws(() => guard.validateTestUri(uri, context, { nodeEnv: 'test' }), /process\.env\.NODE_ENV=test/);
      assert.throws(() => guard.requireTestEnvironment('test'), /process\.env\.NODE_ENV=test/);
    });
  });
});

test('URI validation is exact and rejects aliases, credentials, encodings, and extra parameters', () => {
  withNodeEnv('test', () => {
    const context = guard.createRunContext();
    const uri = guard.buildTestUri(context);
    const invalidUris = [
      uri.replace('127.0.0.1', 'localhost'),
      uri.replace('27018', '27019'),
      uri.replace(guard.REPLICA_SET, 'otherReplicaSet'),
      uri.replace('mongodb://', 'mongodb://user:password@'),
      uri.replace('127.0.0.1', '[::1]'),
      uri.replace(`?replicaSet=${guard.REPLICA_SET}`, `?replicaSet=${guard.REPLICA_SET}&directConnection=true`),
      uri.replace('mongodb://', 'mongodb+srv://'),
      uri.replace('127.0.0.1', 'db.example.invalid'),
      uri.replace('erp_', '%65rp_'),
      `${uri}#fragment`,
    ];

    for (const invalidUri of invalidUris) {
      assert.throws(
        () => guard.validateTestUri(invalidUri, context),
        /Attendance test MongoDB target/,
        'invalid target must fail without echoing its URI'
      );
    }
    const target = guard.validateTestUri(uri, context);
    assert.equal(target.host, '127.0.0.1');
    assert.equal(target.port, 27018);
    assert.equal(Object.hasOwn(target, 'uri'), false);
  });
});

test('hello preflight accepts only exact, internally consistent single-member primary topology', () => {
  withNodeEnv('test', () => {
    const { target } = createTarget();
    const validation = guard.validateHelloResponseShape(validHello(), target);
    assert.deepEqual(validation, {
      replicaSet: guard.REPLICA_SET,
      member: guard.MEMBER_ADDRESS,
      primary: guard.MEMBER_ADDRESS,
      writablePrimary: true,
    });
      assert.doesNotThrow(() => guard.validateHelloResponseShape(validHello({
      arbiterOnly: false,
      hidden: false,
      isreplicaset: false,
      topologyVersion: { processId: 'synthetic', counter: 1 },
      maxWireVersion: 99,
    }), target));
  });
});

test('hello preflight rejects missing, malformed, contradictory, standalone, sharded, and multi-member fields', () => {
  withNodeEnv('test', () => {
    const { target } = createTarget();
    const rejected = [
      {},
      validHello({ setName: 'wrongReplicaSet' }),
      validHello({ msg: 'isdbgrid' }),
      validHello({ msg: 'unexpected' }),
      validHello({ hosts: [guard.MEMBER_ADDRESS, '127.0.0.1:27019'] }),
      validHello({ hosts: '127.0.0.1:27018' }),
      validHello({ passives: ['127.0.0.1:27019'] }),
      validHello({ arbiters: ['127.0.0.1:27019'] }),
      validHello({ passives: undefined }),
      validHello({ arbiters: undefined }),
      validHello({ secondary: undefined }),
      validHello({ secondary: 'false' }),
      validHello({ secondary: 0 }),
      validHello({ secondary: true }),
      validHello({ arbiterOnly: true }),
      validHello({ arbiterOnly: 'false' }),
      validHello({ arbiterOnly: 0 }),
      validHello({ hidden: true }),
      validHello({ hidden: 'false' }),
      validHello({ isreplicaset: true }),
      validHello({ isreplicaset: 'false' }),
      validHello({ isWritablePrimary: undefined }),
      validHello({ isWritablePrimary: 'true' }),
      validHello({ isWritablePrimary: false, secondary: true }),
      validHello({ primary: '127.0.0.1:27019' }),
      validHello({ me: '127.0.0.1:27019' }),
      validHello({ hosts: ['127.0.0.1:27019'] }),
      validHello({ primary: undefined }),
      validHello({ me: undefined }),
    ];

    for (const hello of rejected) {
      assert.throws(() => guard.validateHelloResponseShape(hello, target), /not the required single-member/);
    }
    assert.throws(() => guard.validateHelloResponseShape(validHello(), { ...target }), /not the required single-member/);
  });
});

test('marker value matching is not a MongoDB read-back or ownership proof', () => {
  withNodeEnv('test', () => {
    const { context, target } = createTarget();
    const lease = guard.createOwnershipLease(context);
    const insertMarker = lease.markerForInsert();
    assert.equal(guard.isOwnershipMarkerShape(insertMarker, context.runId), true);
    assert.equal(lease.matchesLeaseMarkerValues(insertMarker), true);
    assert.equal(lease.matchesLeaseMarkerValues({ ...insertMarker }), true);
    assert.equal(lease.createReadBackEvidence, undefined);
    assert.equal(guard.createReadBackEvidence, undefined);
    assert.equal(lease.cleanupEligible, undefined);
    assert.equal(guard.cleanupEligible, undefined);
    assert.equal(target.databaseName, context.databaseName);

    assert.equal(lease.matchesLeaseMarkerValues({ ...insertMarker, runId: 'f'.repeat(32) }), false);
    assert.equal(lease.matchesLeaseMarkerValues({ ...insertMarker, harnessId: 'other-harness' }), false);
    assert.equal(lease.matchesLeaseMarkerValues({ ...insertMarker, ownershipNonce: 'f'.repeat(64) }), false);
    assert.equal(guard.isOwnershipMarkerShape({ ...insertMarker, extra: 'unexpected' }, context.runId), false);
  });
});

test('terminal topology retirement consumes a valid validation once and retires context and lease', () => {
  withNodeEnv('test', () => {
    const { context, lease, target, topologyValidation } = validTopologyContext();
    assert.equal(lease.retireRunAfterTopologyValidation(topologyValidation), true);
    assert.equal(lease.retireRunAfterTopologyValidation(topologyValidation), false, 'validation is single-use');
    assert.throws(() => lease.markerForInsert(), /retired/);
    assert.throws(() => guard.createOwnershipLease(context), /retired/);
    assert.throws(() => guard.buildTestUri(context), /already issued/);
    assert.throws(() => guard.validateHelloResponseShape(validHello(), target), /not the required single-member/);
  });
});

test('caller-supplied cleanup or certainty values do not authorize terminal retirement', () => {
  withNodeEnv('test', () => {
    const { lease, topologyValidation } = validTopologyContext();
    const callerConstructedObject = {
      ...topologyValidation,
      cleanupPermission: true,
      commitOutcomeUncertain: false,
    };
    assert.equal(lease.retireRunAfterTopologyValidation(callerConstructedObject), false);
    assert.equal(lease.retireRunAfterTopologyValidation(topologyValidation), true, 'failed validation attempt leaves state intact');
  });
});

test('expired topology validation cannot retire a run; failed attempt does not consume state', async () => {
  await withNodeEnvAsync('test', async () => {
    const { lease, target } = validTopologyContext();
    const topologyValidation = guard.validateHelloResponseShape(validHello(), target);
    await new Promise(resolve => setTimeout(resolve, guard.TOPOLOGY_PROOF_MAX_AGE_MS + 25));
    assert.equal(lease.retireRunAfterTopologyValidation(topologyValidation), false);
    const freshValidation = guard.validateHelloResponseShape(validHello(), target);
    assert.equal(lease.retireRunAfterTopologyValidation(freshValidation), true);
  });
});

test('topology validation cannot be replayed across ownership leases', () => {
  withNodeEnv('test', () => {
    const first = validTopologyContext();
    const second = validTopologyContext();
    assert.equal(second.lease.retireRunAfterTopologyValidation(first.topologyValidation), false);
    assert.equal(first.lease.retireRunAfterTopologyValidation(first.topologyValidation), true);
  });
});
