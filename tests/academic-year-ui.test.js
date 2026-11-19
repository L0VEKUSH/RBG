'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'public', 'js', 'admin-portal.js'), 'utf8'
);
const start = source.indexOf('let _academicYears = [];');
const end = source.indexOf('const SCHOOL_CLASS_LEVELS', start);
assert.notEqual(start, -1);
assert.notEqual(end, -1);
const academicYearUiSource = source.slice(start, end);

function createHarness({ apiFetch = async () => ({ success: true, data: { academicYears: [] } }), user = { role: 'school_admin' } } = {}) {
  const elements = new Map();
  const requests = [];
  const notifications = { success: [], error: [], warning: [] };
  const confirmations = [];

  function element(id) {
    if (!elements.has(id)) {
      elements.set(id, {
        id, value: '', innerHTML: '', textContent: '', hidden: false, disabled: false,
        classList: { toggle() {}, add() {}, remove() {} },
      });
    }
    return elements.get(id);
  }

  const sandbox = {
    document: {
      getElementById: element,
      querySelector: () => null,
    },
    window: {},
    apiFetch: async (url, options) => {
      requests.push({ url, options });
      return apiFetch(url, options);
    },
    hasPermission: permission => user.role === 'super_admin' ||
      (user.permissions || []).includes(permission) ||
      (user.role === 'school_admin' && ['academic-years.view', 'academic-years.manage'].includes(permission)),
    toast: {
      success: (...args) => notifications.success.push(args),
      error: (...args) => notifications.error.push(args),
      warning: (...args) => notifications.warning.push(args),
    },
    confirmAction: (message, callback) => confirmations.push({ message, callback }),
    cspActionAttrs: () => 'data-csp-action-click="test"',
    openModal: () => {},
    closeModal: () => {},
    setButtonLoading: (button, loading) => { button.disabled = loading; },
    escapeAdminText: value => String(value).replace(/[&<>"']/g, ''),
    schoolDateInputValue: value => String(value || '').slice(0, 10),
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(academicYearUiSource, sandbox, { filename: 'admin-academic-year-ui.js' });
  return { sandbox, elements, requests, notifications, confirmations };
}

function yearRecord(overrides = {}) {
  return {
    _id: '64f000000000000000000001',
    name: '2026-2027',
    startDate: '2026-04-01T00:00:00.000Z',
    endDate: '2027-03-31T00:00:00.000Z',
    isActive: true,
    isCurrent: false,
    ...overrides,
  };
}

test('academic years load and render status fields', async () => {
  const harness = createHarness({ apiFetch: async () => ({ success: true, data: { academicYears: [yearRecord()] } }) });
  await harness.sandbox.loadAcademicYears();
  const html = harness.elements.get('academicYearsTableBody').innerHTML;
  assert.match(html, /2026-2027/);
  assert.match(html, /2026-04-01/);
  assert.match(html, /Active/);
  assert.match(html, /Current|No/);
});

test('empty academic year lists show an empty state', async () => {
  const harness = createHarness();
  await harness.sandbox.loadAcademicYears();
  assert.match(harness.elements.get('academicYearsTableBody').innerHTML, /No academic years configured/);
});

test('academic year loading shows a useful API error', async () => {
  const harness = createHarness({ apiFetch: async () => { throw new Error('Permission denied'); } });
  await harness.sandbox.loadAcademicYears();
  assert.match(harness.elements.get('academicYearsTableBody').innerHTML, /Permission denied/);
});

test('valid creation sends only the permitted API fields', async () => {
  const harness = createHarness({ apiFetch: async () => ({ success: true, message: 'Academic year created', data: { academicYear: yearRecord() } }) });
  harness.sandbox.openAcademicYearModal();
  harness.elements.get('academicYearName').value = '2026-2027';
  harness.elements.get('academicYearStartDate').value = '2026-04-01';
  harness.elements.get('academicYearEndDate').value = '2027-03-31';
  await harness.sandbox.saveAcademicYear({ preventDefault() {} });
  assert.equal(harness.requests[0].url, '/academic-years');
  assert.equal(harness.requests[0].options.method, 'POST');
  assert.deepEqual(JSON.parse(harness.requests[0].options.body), {
    name: '2026-2027', startDate: '2026-04-01', endDate: '2027-03-31',
  });
});

test('invalid form input is rejected before the API request', async () => {
  const harness = createHarness();
  harness.sandbox.openAcademicYearModal();
  harness.elements.get('academicYearName').value = '2026-2028';
  harness.elements.get('academicYearStartDate').value = '2026-04-01';
  harness.elements.get('academicYearEndDate').value = '2027-03-31';
  await harness.sandbox.saveAcademicYear({ preventDefault() {} });
  assert.equal(harness.requests.length, 0);
  assert.match(harness.elements.get('academicYearFormError').textContent, /consecutive/);
});

test('editing sends only permitted fields', async () => {
  const harness = createHarness({
    apiFetch: async (url) => url === '/academic-years'
      ? { success: true, data: { academicYears: [yearRecord({ isCurrent: true })] } }
      : { success: true, message: 'Academic year updated', data: { academicYear: yearRecord() } },
  });
  await harness.sandbox.loadAcademicYears();
  harness.sandbox.editAcademicYear('64f000000000000000000001');
  harness.elements.get('academicYearName').value = '2027-2028';
  harness.elements.get('academicYearStartDate').value = '2027-04-01';
  harness.elements.get('academicYearEndDate').value = '2028-03-31';
  await harness.sandbox.saveAcademicYear({ preventDefault() {} });
  assert.equal(harness.requests[1].url, '/academic-years/64f000000000000000000001');
  assert.equal(harness.requests[1].options.method, 'PUT');
  assert.deepEqual(JSON.parse(harness.requests[1].options.body), {
    name: '2027-2028', startDate: '2027-04-01', endDate: '2028-03-31',
  });
});

test('activation refreshes the list after confirmation', async () => {
  let listCalls = 0;
  const harness = createHarness({
    apiFetch: async url => {
      if (url === '/academic-years') {
        listCalls += 1;
        return { success: true, data: { academicYears: [yearRecord({ isActive: false })] } };
      }
      return { success: true, message: 'Academic year activated' };
    },
  });
  await harness.sandbox.loadAcademicYears();
  harness.sandbox.activateAcademicYear('64f000000000000000000001');
  await harness.confirmations[0].callback();
  assert.equal(harness.requests[1].url, '/academic-years/64f000000000000000000001/activate');
  assert.equal(harness.requests[1].options.method, 'PATCH');
  assert.equal(listCalls, 2);
});

test('deactivation refreshes the list and displays current-year errors', async () => {
  const harness = createHarness({ apiFetch: async url => {
    if (url === '/academic-years') return { success: true, data: { academicYears: [yearRecord()] } };
    throw new Error('The current academic year cannot be deactivated');
  } });
  await harness.sandbox.loadAcademicYears();
  harness.sandbox.deactivateAcademicYear('64f000000000000000000001');
  await harness.confirmations[0].callback();
  assert.match(harness.notifications.error[0][1], /current academic year/);
});

test('users without view or manage permission receive no academic-year controls', async () => {
  const harness = createHarness({ user: { role: 'teacher' } });
  await harness.sandbox.loadAcademicYears();
  assert.equal(harness.requests.length, 0);
  harness.sandbox.openAcademicYearModal();
  assert.match(harness.notifications.error[0][1], /permission/);
});

test('rollover UI creates a draft and refuses unresolved execution', async () => {
  const harness = createHarness({
    apiFetch: async () => ({
      success: true,
      data: {
        rollover: {
          _id: '74f000000000000000000001',
          decisions: [{
            student: '64f000000000000000000001',
            action: 'pending',
            currentClass: '5',
            currentAcademicYear: '2026-2027',
            currentIsActive: true,
            currentTcIssued: false,
          }],
        },
      },
    }),
  });
  harness.sandbox.document.getElementById('rolloverSourceYear').value = '2026-2027';
  harness.sandbox.document.getElementById('rolloverDestinationYear').value = '2027-2028';
  await harness.sandbox.startAcademicYearRollover();
  assert.equal(harness.requests[0].url, '/academic-years/rollover');
  assert.deepEqual(JSON.parse(harness.requests[0].options.body), {
    sourceAcademicYear: '2026-2027',
    destinationAcademicYear: '2027-2028',
  });
  harness.sandbox.executeAcademicYearRollover();
  assert.match(harness.notifications.warning[0][1], /every student/i);
});

test('rollover UI exposes leave_unchanged for TC-issued student and disables mutation options', async () => {
  const harness = createHarness({
    apiFetch: async () => ({
      success: true,
      data: {
        rollover: {
          _id: '74f000000000000000000001',
          revision: 1,
          decisions: [{
            student: '64f000000000000000000002',
            action: 'pending',
            currentClass: '5',
            currentAcademicYear: '2026-2027',
            currentIsActive: false,
            currentTcIssued: true,
          }],
        },
      },
    }),
  });
  harness.sandbox.document.getElementById('rolloverSourceYear').value = '2026-2027';
  harness.sandbox.document.getElementById('rolloverDestinationYear').value = '2027-2028';
  await harness.sandbox.startAcademicYearRollover();
  const html = harness.elements.get('rolloverDecisionsBody').innerHTML;
  assert.match(html, /TC issued/);
  assert.match(html, /Leave unchanged/);
  assert.match(html, /value="promote"\s+disabled/);
  assert.match(html, /value="continue"\s+disabled/);
});

test('rollover UI saves decisions with expectedRevision and handles 409 conflict', async () => {
  let callCount = 0;
  const harness = createHarness({
    apiFetch: async (url, options) => {
      callCount += 1;
      if (url === '/academic-years/rollover' && options.method === 'POST') {
        return {
          success: true,
          data: {
            rollover: {
              _id: '74f000000000000000000001',
              revision: 2,
              decisions: [{
                student: '64f000000000000000000001',
                action: 'leave_unchanged',
                currentClass: '5',
                currentAcademicYear: '2026-2027',
                currentIsActive: false,
                currentTcIssued: true,
              }],
            },
          },
        };
      }
      if (url.includes('/decisions')) {
        const error = new Error('Draft conflict');
        error.statusCode = 409;
        throw error;
      }
      return { success: true, data: { rollovers: [] } };
    },
  });
  harness.sandbox.document.getElementById('rolloverSourceYear').value = '2026-2027';
  harness.sandbox.document.getElementById('rolloverDestinationYear').value = '2027-2028';
  await harness.sandbox.startAcademicYearRollover();
  await harness.sandbox.saveRolloverDecisions();
  // Ensure the PUT request sent expectedRevision
  const saveRequest = harness.requests.find(r => r.url.includes('/decisions'));
  assert.ok(saveRequest);
  assert.equal(saveRequest.options.method, 'PUT');
  const payload = JSON.parse(saveRequest.options.body);
  assert.equal(payload.expectedRevision, 2);
  // Ensure warning was shown for 409
  assert.match(harness.notifications.warning[0][1], /modified or executed concurrently/i);
});
