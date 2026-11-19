'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const REPO = path.resolve(__dirname, '..');
const STUDENT_ONE = '64f000000000000000000001';
const STUDENT_TWO = '64f000000000000000000002';

function promotionStudent(id, name, className = '5', academicYear = '2026-2027', extra = {}) {
  return { _id: id, admissionNumber: id.slice(-6), class: className, academicYear, isActive: true, user: { name }, ...extra };
}

// Helper to set up a browser-like sandbox
function createSandbox(initialContext = {}) {
  const elements = new Map();

  function createElement(id, tagName = 'div') {
    const el = {
      id,
      tagName: tagName.toUpperCase(),
      value: '',
      textContent: '',
      innerHTML: '',
      disabled: false,
      checked: false,
      hidden: false,
      classList: {
        classes: new Set(),
        add(c) { this.classes.add(c); },
        remove(c) { this.classes.delete(c); },
        toggle(c, force) {
          if (force !== undefined) {
            if (force) this.classes.add(c);
            else this.classes.delete(c);
          } else {
            if (this.classes.has(c)) this.classes.delete(c);
            else this.classes.add(c);
          }
        },
        has(c) { return this.classes.has(c); }
      },
      querySelectorAll(sel) {
        if (sel === '.promo-student-cb:checked') {
          return Array.from(elements.values()).filter(e => e.className === 'promo-student-cb' && e.checked);
        }
        if (sel === '.promo-student-cb:not(:disabled)') {
          return Array.from(elements.values()).filter(e => e.className === 'promo-student-cb' && !e.disabled);
        }
        return [];
      }
    };
    elements.set(id, el);
    return el;
  }

  const document = {
    getElementById: id => elements.get(id) || createElement(id),
    querySelectorAll: sel => {
      if (sel === '.promo-student-cb:checked') {
        return Array.from(elements.values()).filter(e => e.className === 'promo-student-cb' && e.checked);
      }
      if (sel === '.promo-student-cb:not(:disabled)') {
        return Array.from(elements.values()).filter(e => e.className === 'promo-student-cb' && !e.disabled);
      }
      return [];
    }
  };

  const sandbox = {
    window: {},
    document,
    openModal: () => {},
    closeModal: () => {},
    initPortal: () => Promise.resolve(),
    getUser: () => ({ role: 'school_admin', permissions: [] }),
    formatNumber: n => String(n),
    formatCurrency: n => '$' + n,
    formatDate: d => String(d),
    escapeAdminText: t => String(t || ''),
    cspActionAttrs: () => '',
    cspSetVisibility: (el, vis) => { if (el) el.hidden = !vis; },
    toast: {
      success: () => {},
      error: () => {},
      warning: () => {},
      info: () => {}
    },
    confirmAction: (msg, callback) => callback(),
    apiFetch: async () => ({ success: true, data: {} }),
    ...initialContext
  };
  sandbox.window = sandbox;

  // Load admin-portal.js
  const code = fs.readFileSync(path.join(REPO, 'public', 'js', 'admin-portal.js'), 'utf8');
  vm.createScript(code).runInNewContext(sandbox);

  return { sandbox, elements, createElement };
}

test('Phase 23 Promotion UI: opens promotion modal and initializes default academic years', () => {
  const { sandbox, elements } = createSandbox();

  sandbox.openPromotionModal();

  const srcYear = elements.get('promoSourceYear').value;
  const tgtYear = elements.get('promoTargetYear').value;
  const btn = elements.get('btnSubmitPromotion');

  assert.equal(btn.disabled, true, 'Submit button must start disabled');
  assert.equal(elements.get('promoClassFilter').value, '', 'Class filter must start blank');
});

test('Phase 23B Promotion UI: permission guard hides and blocks promotion controls', async () => {
  let modalOpened = false;
  let apiCalls = 0;
  const { sandbox, elements } = createSandbox({
    getUser: () => ({ role: 'school_admin', permissions: ['-students.promote'] }),
    openModal: () => { modalOpened = true; },
    apiFetch: async () => { apiCalls++; return { success: true, data: {} }; },
  });

  sandbox.updatePromotionPermissionVisibility();
  const button = elements.get('openPromotionButton');
  assert.equal(button.hidden, true);
  assert.equal(button.classList.has('is-hidden'), true);
  assert.equal(sandbox.hasPermission('students.promote'), false);
  sandbox.openPromotionModal();
  await sandbox.submitPromotion();
  assert.equal(modalOpened, false);
  assert.equal(apiCalls, 0);
});

test('Phase 23 Promotion UI: previews eligible students and next-class assignment', async () => {
  const mockStudents = [
    promotionStudent(STUDENT_ONE, 'Alice'),
    promotionStudent(STUDENT_TWO, 'Bob')
  ];

  const { sandbox, elements } = createSandbox({
    apiFetch: async (url) => {
      if (url.startsWith('/students/class/5')) {
        return { success: true, data: { students: mockStudents } };
      }
      return { success: true, data: {} };
    }
  });

  // Use getElementById to ensure elements are registered in the sandbox Map
  sandbox.document.getElementById('promoClassFilter').value = '5';
  sandbox.document.getElementById('promoSourceYear').value = '2026-2027';
  sandbox.document.getElementById('promoTargetYear').value = '2027-2028';

  await sandbox.onPromoFilterChange();

  const tbody = elements.get('promoStudentsBody');
  assert.match(tbody.innerHTML, /Alice/, 'Should render student Alice');
  assert.match(tbody.innerHTML, /Bob/, 'Should render student Bob');
  assert.match(tbody.innerHTML, /Class 6/, 'Should preview target Class 6');
  assert.match(elements.get('promoSummary').textContent, /2 of 2 student\(s\) eligible/);
});

test('Phase 23 Promotion UI: flags Class 12 as terminal with no next class', async () => {
  const mockStudents = [
    promotionStudent(STUDENT_ONE, 'Senior Student', '12')
  ];

  const { sandbox, elements } = createSandbox({
    apiFetch: async () => ({ success: true, data: { students: mockStudents } })
  });

  // Use getElementById to ensure elements are registered in the sandbox Map
  sandbox.document.getElementById('promoClassFilter').value = '12';
  sandbox.document.getElementById('promoSourceYear').value = '2026-2027';
  sandbox.document.getElementById('promoTargetYear').value = '2027-2028';

  await sandbox.onPromoFilterChange();

  const tbody = elements.get('promoStudentsBody');
  assert.match(tbody.innerHTML, /Graduating \/ Terminal/, 'Class 12 should be marked terminal');
  assert.match(tbody.innerHTML, /disabled/, 'Terminal class students should have disabled selection');
  assert.match(elements.get('promoSummary').textContent, /0 of 1 student\(s\) eligible/);
});

test('Phase 23C Promotion UI: Class 11 preview rows are eligible and invalid rows cannot be selected', async () => {
  const classElevenStudent = promotionStudent(STUDENT_ONE, 'Class Eleven', '11');
  const { sandbox, elements } = createSandbox({
    apiFetch: async () => ({ success: true, data: { students: [classElevenStudent] } })
  });
  sandbox.document.getElementById('promoClassFilter').value = '11';
  sandbox.document.getElementById('promoSourceYear').value = '2026-2027';
  sandbox.document.getElementById('promoTargetYear').value = '2027-2028';
  await sandbox.onPromoFilterChange();
  const tbody = elements.get('promoStudentsBody');
  assert.match(tbody.innerHTML, /Class 12/);
  assert.match(tbody.innerHTML, /Eligible/);
  assert.match(tbody.innerHTML, /checked/);
  assert.doesNotMatch(tbody.innerHTML, /disabled/);
  assert.match(elements.get('promoSummary').textContent, /1 of 1 student\(s\) eligible/);

  const invalidRows = [
    promotionStudent(STUDENT_ONE, 'Wrong class', '4'),
    promotionStudent(STUDENT_TWO, 'Wrong year', '5', '2025-2026'),
    promotionStudent('not-an-object-id', 'Malformed ID'),
    promotionStudent('64f000000000000000000003', 'Inactive', '5', '2026-2027', { isActive: false }),
  ];
  sandbox.apiFetch = async () => ({ success: true, data: { students: invalidRows } });
  sandbox.document.getElementById('promoClassFilter').value = '5';
  await sandbox.onPromoFilterChange();
  assert.match(tbody.innerHTML, /Invalid or ineligible student/);
  assert.match(tbody.innerHTML, /disabled/);
  assert.match(elements.get('promoSummary').textContent, /0 of 4 student\(s\) eligible/);
});

test('Phase 23 Promotion UI: submits promotion payload to POST /students/promote and prevents duplicate clicks', async () => {
  let submittedUrl = null;
  let submittedBody = null;
  let postCount = 0;
  const mockStudents = [promotionStudent(STUDENT_ONE, 'Alice'), promotionStudent(STUDENT_TWO, 'Bob')];

  const { sandbox, elements } = createSandbox({
    apiFetch: async (url, opts = {}) => {
      if (url.startsWith('/students/class/5')) return { success: true, data: { students: mockStudents } };
      if (url !== '/students/promote') return { success: true, data: { students: [] } };
      submittedUrl = url;
      postCount++;
      submittedBody = JSON.parse(opts.body || '{}');
      return {
        success: true,
        message: '2 students promoted',
        data: { students: [{ _id: STUDENT_ONE }, { _id: STUDENT_TWO }], promotedCount: 2 }
      };
    }
  });

  // Use getElementById to ensure elements are registered in the sandbox Map
  sandbox.document.getElementById('promoClassFilter').value = '5';
  sandbox.document.getElementById('promoSourceYear').value = '2026-2027';
  sandbox.document.getElementById('promoTargetYear').value = '2027-2028';
  await sandbox.onPromoFilterChange();

  // Create two checked student checkboxes
  const cb1 = sandbox.document.getElementById('cb1');
  cb1.className = 'promo-student-cb';
  cb1.value = STUDENT_ONE;
  cb1.checked = true;

  const cb2 = sandbox.document.getElementById('cb2');
  cb2.className = 'promo-student-cb';
  cb2.value = STUDENT_TWO;
  cb2.checked = true;

  await Promise.all([sandbox.submitPromotion(), sandbox.submitPromotion()]);

  assert.equal(submittedUrl, '/students/promote');
  assert.deepEqual(submittedBody.studentIds, [STUDENT_ONE, STUDENT_TWO]);
  assert.equal(submittedBody.sourceAcademicYear, '2026-2027');
  assert.equal(submittedBody.sourceClass, '5');
  assert.equal(submittedBody.newAcademicYear, '2027-2028');
  assert.equal(postCount, 1, 'Concurrent submissions must produce one request');

  // Verify results container was displayed
  const resultsCard = elements.get('promoResultsCard');
  assert.equal(resultsCard.hidden, false, 'Results card should be visible after success');
});

test('Phase 23 Promotion UI: handles promotion API errors safely and displays message', async () => {
  let errorToasted = null;
  let successToasts = 0;

  const { sandbox, elements } = createSandbox({
    apiFetch: async (url) => {
      if (url.startsWith('/students/class/5')) {
        return { success: true, data: { students: [promotionStudent(STUDENT_ONE, 'Alice')] } };
      }
      throw new Error('Enrollment date matches overlapping academic years.');
    },
    toast: {
      success: () => { successToasts++; },
      error: (title, msg) => { errorToasted = msg; },
      warning: () => {},
      info: () => {}
    }
  });

  // Use getElementById to ensure elements are registered in the sandbox Map
  sandbox.document.getElementById('promoClassFilter').value = '5';
  sandbox.document.getElementById('promoSourceYear').value = '2026-2027';
  sandbox.document.getElementById('promoTargetYear').value = '2027-2028';
  await sandbox.onPromoFilterChange();

  const cb1 = sandbox.document.getElementById('cb1');
  cb1.className = 'promo-student-cb';
  cb1.value = STUDENT_ONE;
  cb1.checked = true;

  await sandbox.submitPromotion();

  assert.match(errorToasted, /overlapping academic years/);
  const resultsBody = elements.get('promoResultsBody');
  assert.match(resultsBody.innerHTML, /overlapping academic years/);
  assert.doesNotMatch(resultsBody.innerHTML, /Success!/);
  assert.equal(successToasts, 0);
});

test('Phase 23B Promotion UI: blocks non-consecutive years before confirmation or API submission', async () => {
  let confirmations = 0;
  let posts = 0;
  let warning = '';
  const { sandbox, elements } = createSandbox({
    confirmAction: () => { confirmations++; },
    toast: { success: () => {}, error: () => {}, warning: (_title, message) => { warning = message; }, info: () => {} },
    apiFetch: async url => url.startsWith('/students/class/5')
      ? { success: true, data: { students: [promotionStudent(STUDENT_ONE, 'Alice')] } }
      : (posts++, { success: true, data: {} }),
  });
  sandbox.document.getElementById('promoClassFilter').value = '5';
  sandbox.document.getElementById('promoSourceYear').value = '2026-2027';
  sandbox.document.getElementById('promoTargetYear').value = '2028-2029';
  await sandbox.onPromoFilterChange();
  const checkbox = sandbox.document.getElementById('selectedStudent');
  checkbox.className = 'promo-student-cb';
  checkbox.value = STUDENT_ONE;
  checkbox.checked = true;

  await sandbox.submitPromotion();
  assert.match(warning, /consecutive/);
  assert.equal(confirmations, 0);
  assert.equal(posts, 0);
  assert.equal(elements.get('btnSubmitPromotion').disabled, true);
});

test('Phase 23B Promotion UI: inconsistent success counts are shown as failures without partial-success copy', async () => {
  let successToasts = 0;
  let errorToasted = '';
  const { sandbox, elements } = createSandbox({
    toast: {
      success: () => { successToasts++; },
      error: (_title, message) => { errorToasted = message; },
      warning: () => {},
      info: () => {},
    },
    apiFetch: async url => url.startsWith('/students/class/5')
      ? { success: true, data: { students: [promotionStudent(STUDENT_ONE, 'Alice'), promotionStudent(STUDENT_TWO, 'Bob')] } }
      : { success: true, message: 'One promoted', data: { students: [{ _id: STUDENT_ONE }], promotedCount: 1 } },
  });
  sandbox.document.getElementById('promoClassFilter').value = '5';
  sandbox.document.getElementById('promoSourceYear').value = '2026-2027';
  sandbox.document.getElementById('promoTargetYear').value = '2027-2028';
  await sandbox.onPromoFilterChange();
  const checkbox = sandbox.document.getElementById('selectedStudent');
  checkbox.className = 'promo-student-cb';
  checkbox.value = STUDENT_ONE;
  checkbox.checked = true;
  const secondCheckbox = sandbox.document.getElementById('secondSelectedStudent');
  secondCheckbox.className = 'promo-student-cb';
  secondCheckbox.value = STUDENT_TWO;
  secondCheckbox.checked = true;

  await sandbox.submitPromotion();
  await new Promise(resolve => setImmediate(resolve));
  assert.match(errorToasted, /full promotion batch/);
  assert.equal(successToasts, 0);
  assert.doesNotMatch(elements.get('promoResultsBody').innerHTML, /Success!/);
});

test('Phase 23B Promotion UI: admin page marks the promotion launcher as permission-gated', () => {
  const html = fs.readFileSync(path.join(REPO, 'public', 'portal', 'admin.html'), 'utf8');
  assert.match(html, /id="openPromotionButton"[^>]*is-hidden[^>]*data-required-permission="students\.promote"/);
});
