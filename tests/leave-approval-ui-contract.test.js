'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const assert = require('node:assert/strict');
const Leave = require('../models/LeaveRequest');
const leaveService = require('../services/leave.service');

const portalSource = fs.readFileSync(path.join(__dirname, '../public/js/principal-portal.js'), 'utf8');
const leaveUiStart = portalSource.indexOf('async function loadPendingLeaves()');
const leaveUiEnd = portalSource.indexOf('window.submitNotice = async function()', leaveUiStart);
assert.notEqual(leaveUiStart, -1, 'leave list and actions must exist in the principal portal');
assert.notEqual(leaveUiEnd, -1, 'leave UI extraction boundary must exist');
const leaveUiSource = portalSource.slice(leaveUiStart, leaveUiEnd);

function createUiHarness(apiFetch, user = { role: 'principal' }) {
  const calls = { requests: [], confirmations: [], successes: [], errors: [] };
  const tbody = { innerHTML: '' };
  const sandbox = {
    window: {},
    document: { getElementById: () => tbody },
    getUser: () => user,
    apiFetch: async (url, options) => {
      calls.requests.push({ url, options });
      return apiFetch(url, options);
    },
    formatDate: value => String(value).slice(0, 10),
    cspActionAttrs: () => '',
    confirmAction: (message, callback, confirmText, danger) => {
      calls.confirmations.push({ message, callback, confirmText, danger });
    },
    toast: {
      success: (...args) => calls.successes.push(args),
      error: (...args) => calls.errors.push(args),
    },
    encodeURIComponent,
  };
  vm.createContext(sandbox);
  vm.runInContext(leaveUiSource, sandbox, { filename: 'principal-leave-ui.js' });
  return { sandbox, calls, tbody };
}

function stub(target, key, replacement) {
  const original = target[key];
  target[key] = replacement;
  return () => { target[key] = original; };
}

test('principal leave list renders populated user and canonical leave date fields', async () => {
  const harness = createUiHarness(async () => ({ data: [{
    _id: 'leave-1',
    user: { name: 'Synthetic Teacher', role: 'teacher' },
    startDate: '2026-11-10T00:00:00.000Z',
    endDate: '2026-11-12T00:00:00.000Z',
    leaveType: 'Sick',
    reason: 'Synthetic test reason',
  }] }));

  await harness.sandbox.loadPendingLeaves();

  assert.match(harness.tbody.innerHTML, /Synthetic Teacher/);
  assert.match(harness.tbody.innerHTML, /teacher/);
  assert.match(harness.tbody.innerHTML, /2026-11-10 to 2026-11-12/);
  assert.doesNotMatch(harness.tbody.innerHTML, /Unknown/);
  assert.match(harness.tbody.innerHTML, /aria-label="Approve leave request"/);
  assert.doesNotMatch(harness.tbody.innerHTML, /aria-label="Reject leave request"/);
});

test('users with another role retain the Reject control', async () => {
  const harness = createUiHarness(async () => ({ data: [{ _id: 'leave-1', user: { name: 'Synthetic Staff' } }] }), { role: 'hr' });
  await harness.sandbox.loadPendingLeaves();
  assert.match(harness.tbody.innerHTML, /aria-label="Reject leave request"/);
});

test('principal reject handler gives a clear local denial without replacing backend enforcement', async () => {
  const harness = createUiHarness(async () => ({ success: true }));
  await harness.sandbox.window.rejectLeave('leave-1');
  assert.equal(harness.calls.errors.length, 1);
  assert.equal(harness.calls.errors[0][0], 'Not authorized');
  assert.equal(harness.calls.confirmations.length, 0);
  assert.equal(harness.calls.requests.length, 0);
});

test('approve and reject actions use the canonical PUT status endpoint and payload', async () => {
  const harness = createUiHarness(async url => url === '/leaves/pending' ? { data: [] } : { success: true }, { role: 'hr' });

  await harness.sandbox.window.approveLeave('leave-approve');
  await harness.calls.confirmations[0].callback();
  await harness.sandbox.window.rejectLeave('leave-reject');
  await harness.calls.confirmations[1].callback();

  assert.equal(harness.calls.requests[0].url, '/leaves/leave-approve/status');
  assert.equal(harness.calls.requests[0].options.method, 'PUT');
  assert.equal(harness.calls.requests[0].options.body, JSON.stringify({ status: 'Approved' }));
  assert.equal(harness.calls.requests[2].url, '/leaves/leave-reject/status');
  assert.equal(harness.calls.requests[2].options.method, 'PUT');
  assert.equal(harness.calls.requests[2].options.body, JSON.stringify({ status: 'Rejected' }));
  assert.equal(harness.calls.successes.length, 2);
});

test('API rejection displays an error and never reports approval or rejection success', async () => {
  const harness = createUiHarness(async () => { throw new Error('Permission denied'); }, { role: 'hr' });

  await harness.sandbox.window.approveLeave('leave-1');
  await harness.calls.confirmations[0].callback();
  await harness.sandbox.window.rejectLeave('leave-2');
  await harness.calls.confirmations[1].callback();

  assert.equal(harness.calls.successes.length, 0);
  assert.equal(harness.calls.errors.length, 2);
  assert.equal(harness.calls.errors[0][1], 'Permission denied');
});

test('backend permission checks and pending-only transition remain in force', async () => {
  const calls = [];
  const restore = stub(Leave, 'findOneAndUpdate', async (filter, update, options) => {
    calls.push({ filter, update, options });
    return { _id: 'leave-1', ...update };
  });
  try {
    await assert.rejects(
      leaveService.updateLeaveStatus('leave-1', 'Approved', { _id: 'teacher-1', role: 'teacher' }),
      error => error.statusCode === 403
    );
    await assert.rejects(
      leaveService.updateLeaveStatus('leave-1', 'Rejected', { _id: 'principal-1', role: 'principal' }),
      error => error.statusCode === 403
    );
    assert.equal(calls.length, 0);

    await leaveService.updateLeaveStatus('leave-1', 'Approved', { _id: 'principal-1', role: 'principal' });
    await leaveService.updateLeaveStatus('leave-2', 'Rejected', { _id: 'hr-1', role: 'hr' });

    assert.deepEqual(calls[0].filter, { _id: 'leave-1', status: 'Pending' });
    assert.deepEqual(calls[0].update, { status: 'Approved', approvedBy: 'principal-1' });
    assert.deepEqual(calls[1].filter, { _id: 'leave-2', status: 'Pending' });
    assert.deepEqual(calls[1].update, { status: 'Rejected', approvedBy: 'hr-1' });
    assert.equal(calls.every(call => call.options.runValidators === true), true);
  } finally { restore(); }
});
