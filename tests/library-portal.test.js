'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const portalSource = fs.readFileSync(path.join(__dirname, '../public/js/library-portal.js'), 'utf8');

function createElement(id = '') {
  return {
    id,
    className: '',
    textContent: '',
    innerHTML: '',
    value: '',
    disabled: false,
    children: [],
    replaceChildren(...children) { this.children = children; },
    append(...children) { this.children.push(...children); },
    appendChild(child) { this.children.push(child); return child; },
  };
}

function createPortal(apiFetch) {
  const elements = new Map();
  const getElementById = id => {
    if (!elements.has(id)) elements.set(id, createElement(id));
    return elements.get(id);
  };
  const chart = getElementById('dashInventoryChart');
  chart.parentElement = getElementById('inventoryChartContainer');

  const context = {
    window: {},
    document: {
      getElementById,
      createElement: tag => createElement(tag),
    },
    apiFetch,
    initPortal() {},
    loadNoticesFull() {},
    setButtonLoading() {},
    toast: { warning() {}, error() {}, success() {} },
    closeModal() {},
    cspSetVisibility() {},
    Intl,
    Date,
    Number,
    String,
    JSON,
    Array,
  };
  vm.runInNewContext(portalSource, context, { filename: 'library-portal.js' });
  return { context, elements, getElementById };
}

function textContent(element) {
  return [element.textContent, ...element.children.map(textContent)].join(' ');
}

test('return selector posts only the selected transaction ID and refreshes after server confirmation', async () => {
  const calls = [];
  let transactionReads = 0;
  const portal = createPortal(async (url, options = {}) => {
    calls.push({ url, options });
    if (url === '/library/transactions') {
      transactionReads += 1;
      return transactionReads === 1
        ? { success: true, data: [
          { _id: 'loan-synthetic-01', status: 'Issued', dueDate: '2026-11-10', book: { title: 'Synthetic book' }, student: { user: { name: 'Synthetic borrower' } } },
          { _id: 'loan-synthetic-02', status: 'Returned', book: { title: 'Already returned' } },
        ] }
        : { success: true, data: [] };
    }
    if (url === '/library/return') {
      return { success: true, data: { _id: 'loan-synthetic-01', status: 'Returned' } };
    }
    throw new Error(`Unexpected endpoint: ${url}`);
  });

  await portal.context.window.loadReturnLoans();
  const select = portal.getElementById('returnTransactionId');
  assert.equal(select.children.length, 2, 'only placeholder and currently Issued loan are listed');
  assert.equal(select.children[1].value, 'loan-synthetic-01');
  assert.match(select.children[1].textContent, /Synthetic book.*Synthetic borrower/);

  select.value = 'loan-synthetic-01';
  await portal.context.window.processReturn();

  const returnCall = calls.find(call => call.url === '/library/return');
  assert.equal(returnCall.options.method, 'POST');
  assert.deepEqual(JSON.parse(returnCall.options.body), { transactionId: 'loan-synthetic-01' });
  assert.equal(Object.hasOwn(JSON.parse(returnCall.options.body), 'bookId'), false);
  assert.equal(portal.getElementById('returnStatus').textContent, 'Return recorded successfully.');
  assert.equal(transactionReads, 2, 'the issued-loan list is refreshed after a confirmed return');
});

test('return API failure is shown without a success state', async () => {
  const portal = createPortal(async url => {
    if (url === '/library/transactions') {
      return { success: true, data: [{ _id: 'loan-synthetic-03', status: 'Issued' }] };
    }
    if (url === '/library/return') throw { status: 409, message: 'Loan is no longer issued.' };
    throw new Error(`Unexpected endpoint: ${url}`);
  });

  await portal.context.window.loadReturnLoans();
  portal.getElementById('returnTransactionId').value = 'loan-synthetic-03';
  await portal.context.window.processReturn();

  assert.equal(portal.getElementById('returnStatus').textContent, 'Loan is no longer issued.');
  assert.equal(portal.getElementById('returnStatus').className, 'error-state');
});

test('dashboard reads actual Library stats and overdue endpoints and displays explicit zero values', async () => {
  const calls = [];
  const portal = createPortal(async url => {
    calls.push(url);
    if (url === '/library/stats') return { success: true, data: { totalBooks: 4, issuedBooks: 0 } };
    if (url === '/library/overdue') return { success: true, data: [] };
    throw new Error(`Unexpected endpoint: ${url}`);
  });

  await vm.runInNewContext('loadLibraryDashboard()', portal.context);

  assert.deepEqual(calls, ['/library/stats', '/library/overdue']);
  assert.match(textContent(portal.getElementById('libStats')), /4.*Active titles/);
  assert.match(textContent(portal.getElementById('libStats')), /0.*Issued loans/);
  assert.match(textContent(portal.getElementById('dashOverdue')), /No overdue loans\./);
  assert.doesNotMatch(calls.join(' '), /library\/report/);
});

test('dashboard reports malformed stats as unavailable instead of rendering fake zeroes', async () => {
  const portal = createPortal(async url => {
    if (url === '/library/stats') return { success: true, data: { totalBooks: null, issuedBooks: '0' } };
    if (url === '/library/overdue') return { success: true, data: [] };
    throw new Error(`Unexpected endpoint: ${url}`);
  });

  await vm.runInNewContext('loadLibraryDashboard()', portal.context);

  assert.match(textContent(portal.getElementById('libStats')), /statistics response is unavailable/i);
  assert.doesNotMatch(textContent(portal.getElementById('libStats')), /\b0\b/);
});
