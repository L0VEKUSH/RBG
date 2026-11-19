'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const mongoose = require('mongoose');
const Student = require('../models/Student');
const StudentFee = require('../models/StudentFee');
const FeeStructure = require('../models/FeeStructure');
const Payment = require('../models/Payment');
const feeService = require('../services/fee.service');
const studentService = require('../services/student.service');
const studentController = require('../controllers/student.controller');
const studentRoutesSource = fs.readFileSync(path.join(__dirname, '..', 'routes', 'student.routes.js'), 'utf8');

const accountant = { _id: '111111111111111111111111', role: 'accountant' };
const studentId = '222222222222222222222222';
const feeId = '333333333333333333333333';

function stub(target, key, replacement) {
  const original = target[key];
  target[key] = replacement;
  return () => { target[key] = original; };
}

function query(valueFactory, calls = {}) {
  return {
    session(value) { calls.session = value; return this; },
    lean() { calls.lean = true; return this; },
    select(value) { calls.select = value; return this; },
    populate(value) { (calls.populate ||= []).push(value); return this; },
    then(resolve, reject) { return Promise.resolve().then(valueFactory).then(resolve, reject); }
  };
}

function clone(value) {
  return value && JSON.parse(JSON.stringify(value));
}

function setupLedger({
  initialFee = {
    _id: feeId,
    student: studentId,
    academicYear: '2026-2027',
    totalAmount: 100,
    paidAmount: 0,
    discount: 0,
    scholarship: 0,
    fine: 0,
    status: 'Pending'
  },
  failPaymentCreate = false,
  failFeeUpdate = false,
  failCommit = false,
  conflictUpdate = false
} = {}) {
  let fee = clone(initialFee);
  const payments = new Map();
  const calls = { sessions: 0, ended: 0, paymentCreates: [], feeUpdates: [], feeReads: [], indexes: [] };
  const originals = {
    startSession: mongoose.startSession,
    feeFindById: StudentFee.findById,
    feeUpdateOne: StudentFee.updateOne,
    paymentFindOne: Payment.findOne,
    paymentCreate: Payment.create,
    paymentCreateIndex: Payment.collection.createIndex
  };
  let transactionQueue = Promise.resolve();

  mongoose.startSession = async () => {
    calls.sessions += 1;
    return {
      withTransaction: async callback => {
        const operation = transactionQueue.then(async () => {
          const beforeFee = clone(fee);
          const beforePayments = new Map([...payments.entries()].map(([key, value]) => [key, clone(value)]));
          try {
            const result = await callback();
            if (failCommit) throw new Error('synthetic transaction commit failure');
            return result;
          }
          catch (error) {
            fee = beforeFee;
            payments.clear();
            for (const [key, value] of beforePayments) payments.set(key, value);
            throw error;
          }
        });
        transactionQueue = operation.then(() => undefined, () => undefined);
        return operation;
      },
      endSession: async () => { calls.ended += 1; }
    };
  };

  StudentFee.findById = id => {
    const read = {};
    calls.feeReads.push(read);
    return query(() => fee && String(fee._id) === String(id) ? clone(fee) : null, read);
  };
  StudentFee.updateOne = async (filter, update, options) => {
    calls.feeUpdates.push({ filter, update, options });
    assert.ok(options.session, 'balance update must use the active session');
    if (failFeeUpdate) throw new Error('synthetic fee update failure');
    if (conflictUpdate) return { matchedCount: 0 };
    if (!fee || String(filter._id) !== String(fee._id)) return { matchedCount: 0 };
    for (const [field, expected] of Object.entries(filter)) {
      if (field === '_id') continue;
      if (expected && typeof expected === 'object' && expected.$exists === false) {
        if (Object.prototype.hasOwnProperty.call(fee, field)) return { matchedCount: 0 };
      } else if (fee[field] !== expected) return { matchedCount: 0 };
    }
    fee.paidAmount = update.$set.paidAmount;
    fee.status = update.$set.status;
    fee.payments ||= [];
    fee.payments.push(clone(update.$push.payments));
    return { matchedCount: 1 };
  };
  Payment.findOne = filter => query(() => clone(payments.get(filter.idempotencyKey) || null));
  Payment.collection.createIndex = async (keys, options) => {
    calls.indexes.push({ keys, options });
    return 'idempotencyKey_1';
  };
  Payment.create = async (documents, options) => {
    calls.paymentCreates.push({ documents: clone(documents), options });
    assert.ok(options.session, 'payment insert must use the active session');
    if (failPaymentCreate) throw new Error('synthetic receipt creation failure');
    const document = documents[0];
    if (payments.has(document.idempotencyKey)) {
      const error = new Error('duplicate idempotency key');
      error.code = 11000;
      throw error;
    }
    const payment = {
      _id: `payment-${payments.size + 1}`,
      ...clone(document),
      receiptNumber: `REC-SYNTHETIC-${payments.size + 1}`
    };
    payments.set(payment.idempotencyKey, payment);
    return [payment];
  };

  return {
    calls,
    getFee: () => clone(fee),
    getPayments: () => [...payments.values()].map(clone),
    restore() {
      mongoose.startSession = originals.startSession;
      StudentFee.findById = originals.feeFindById;
      StudentFee.updateOne = originals.feeUpdateOne;
      Payment.findOne = originals.paymentFindOne;
      Payment.create = originals.paymentCreate;
      Payment.collection.createIndex = originals.paymentCreateIndex;
    }
  };
}

function paymentRequest(overrides = {}) {
  return {
    studentFee: feeId,
    amount: 40,
    method: 'Cash',
    remarks: 'Counter 1',
    idempotencyKey: 'payment-attempt-key-0001',
    ...overrides
  };
}

test('payment is bound to the fee row, derives collector from actor, and commits receipt and balance together', async () => {
  const ledger = setupLedger();
  try {
    await assert.rejects(
      feeService.makePayment(paymentRequest({ receivedBy: 'aaaaaaaaaaaaaaaaaaaaaaaa' }), accountant),
      error => error.statusCode === 400
    );
    assert.equal(ledger.calls.paymentCreates.length, 0);
    assert.equal(ledger.calls.feeUpdates.length, 0);

    const recorded = await feeService.makePayment(paymentRequest(), accountant);
    assert.equal(recorded.receivedBy, accountant._id);
    assert.equal(recorded.student, studentId);
    assert.equal(ledger.getFee().paidAmount, 40);
    assert.equal(ledger.getFee().status, 'Partial');
    assert.equal(ledger.getFee().payments.length, 1);
    assert.equal(ledger.getPayments().length, 1);
    assert.equal(ledger.calls.paymentCreates[0].options.session, ledger.calls.feeUpdates[0].options.session);
    assert.equal(ledger.calls.sessions, 1);
    assert.equal(ledger.calls.ended, 1);
    assert.deepEqual(ledger.calls.indexes[0], { keys: { idempotencyKey: 1 }, options: { unique: true, sparse: true } });
  } finally { ledger.restore(); }
});

test('URL student ID remains authoritative and forbidden assignment ledger fields are rejected', async () => {
  const originals = { studentFindOne: Student.findOne, feeCreate: StudentFee.create };
  let created;
  Student.findOne = filter => {
    assert.deepEqual(filter, { _id: studentId, isActive: true });
    return query(() => ({ _id: studentId, class: '8', academicYear: '2026-2027' }));
  };
  StudentFee.create = async data => { created = data; return data; };
  try {
    for (const override of [
      { student: 'aaaaaaaaaaaaaaaaaaaaaaaa' },
      { studentId: 'aaaaaaaaaaaaaaaaaaaaaaaa' }
    ]) {
      await assert.rejects(feeService.assignFee(studentId, { totalAmount: 500, ...override }, accountant), error => error.statusCode === 400);
    }
    for (const field of ['paidAmount', 'status', 'payments', 'receivedBy', 'receiptNumber']) {
      await assert.rejects(feeService.assignFee(studentId, { totalAmount: 500, [field]: 'forged' }, accountant), error => error.statusCode === 400);
    }
    await feeService.assignFee(studentId, { totalAmount: 500, academicYear: '2026-2027', class: '8' }, accountant);
    assert.equal(created.student, studentId);
    assert.equal(created.paidAmount, 0);
    assert.equal(created.status, 'Pending');
    assert.deepEqual(created.payments, []);
  } finally {
    Student.findOne = originals.studentFindOne;
    StudentFee.create = originals.feeCreate;
  }
});

test('fee assignment rejects invalid amounts and class/year mismatches', async () => {
  const original = Student.findOne;
  Student.findOne = () => query(() => ({ _id: studentId, class: '8', academicYear: '2026-2027' }));
  try {
    for (const amount of [undefined, null, 0, -1, 1.001, Infinity, NaN, '12']) {
      await assert.rejects(feeService.assignFee(studentId, { totalAmount: amount }, accountant), error => error.statusCode === 400);
    }
    await assert.rejects(feeService.assignFee(studentId, { totalAmount: 100, class: '9' }, accountant), error => error.statusCode === 400);
    await assert.rejects(feeService.assignFee(studentId, { totalAmount: 100, academicYear: '2025-2026' }, accountant), error => error.statusCode === 400);
  } finally { Student.findOne = original; }
});

test('fee assignment only accepts an active fee structure for the student class and year', async () => {
  const originals = { studentFindOne: Student.findOne, structureFindOne: FeeStructure.findOne, feeCreate: StudentFee.create };
  let created;
  Student.findOne = () => query(() => ({ _id: studentId, class: '8', academicYear: '2026-2027' }));
  FeeStructure.findOne = filter => {
    assert.deepEqual(filter, {
      _id: '444444444444444444444444',
      class: '8',
      academicYear: '2026-2027',
      isActive: true
    });
    return Promise.resolve({ _id: filter._id, components: [{ amount: 200 }, { amount: 300 }] });
  };
  StudentFee.create = async data => { created = data; return data; };
  try {
    await feeService.assignFee(studentId, { feeStructure: '444444444444444444444444' }, accountant);
    assert.equal(created.totalAmount, 500);
    assert.equal(String(created.feeStructure), '444444444444444444444444');
    const noMatchingStructure = FeeStructure.findOne;
    FeeStructure.findOne = async () => null;
    await assert.rejects(feeService.assignFee(studentId, { feeStructure: '444444444444444444444444' }, accountant), error => error.statusCode === 404);
    FeeStructure.findOne = noMatchingStructure;
  } finally {
    Student.findOne = originals.studentFindOne;
    FeeStructure.findOne = originals.structureFindOne;
    StudentFee.create = originals.feeCreate;
  }
});

test('payment rejects nonpositive, malformed, over-balance, and client-forged financial fields', async () => {
  const ledger = setupLedger();
  try {
    for (const amount of [0, -1, 100.01, NaN, Infinity, '10']) {
      await assert.rejects(feeService.makePayment(paymentRequest({ amount }), accountant));
    }
    await assert.rejects(feeService.makePayment(paymentRequest({ status: 'Paid' }), accountant), error => error.statusCode === 400);
    await assert.rejects(feeService.makePayment(paymentRequest({ studentId }), accountant), error => error.statusCode === 400);
    assert.equal(ledger.calls.paymentCreates.length, 0);
    assert.equal(ledger.calls.feeUpdates.length, 0);
    assert.equal(ledger.getPayments().length, 0);
  } finally { ledger.restore(); }
});

test('receipt, balance, and commit failures roll back both sides of the ledger', async () => {
  for (const configuration of [{ failPaymentCreate: true }, { failFeeUpdate: true }, { failCommit: true }]) {
    const ledger = setupLedger(configuration);
    try {
      await assert.rejects(feeService.makePayment(paymentRequest(), accountant));
      assert.equal(ledger.getFee().paidAmount, 0);
      assert.equal(ledger.getFee().status, 'Pending');
      assert.equal((ledger.getFee().payments || []).length, 0);
      assert.equal(ledger.getPayments().length, 0);
      assert.equal(ledger.calls.ended, 1);
    } finally { ledger.restore(); }
  }
});

test('concurrent collections cannot over-collect or lose accepted payments', async () => {
  const ledger = setupLedger();
  try {
    const outcomes = await Promise.allSettled([
      feeService.makePayment(paymentRequest({ amount: 70, idempotencyKey: 'concurrent-payment-key-01' }), accountant),
      feeService.makePayment(paymentRequest({ amount: 50, idempotencyKey: 'concurrent-payment-key-02' }), accountant)
    ]);
    assert.equal(outcomes.filter(outcome => outcome.status === 'fulfilled').length, 1);
    assert.equal(ledger.getFee().paidAmount, 70);
    assert.equal(ledger.getPayments().length, 1);
    assert.ok(ledger.getFee().paidAmount <= ledger.getFee().totalAmount);
  } finally { ledger.restore(); }

  const splitLedger = setupLedger();
  try {
    const results = await Promise.all([
      feeService.makePayment(paymentRequest({ amount: 30, idempotencyKey: 'split-payment-key-0001' }), accountant),
      feeService.makePayment(paymentRequest({ amount: 40, idempotencyKey: 'split-payment-key-0002' }), accountant)
    ]);
    assert.equal(results.length, 2);
    assert.equal(splitLedger.getFee().paidAmount, 70);
    assert.equal(splitLedger.getFee().payments.length, 2);
    assert.equal(splitLedger.getPayments().length, 2);
  } finally { splitLedger.restore(); }
});

test('retry with the same idempotency key returns the original receipt without another collection', async () => {
  const ledger = setupLedger();
  try {
    const first = await feeService.makePayment(paymentRequest(), accountant);
    const retry = await feeService.makePayment(paymentRequest(), accountant);
    assert.equal(retry.receiptNumber, first.receiptNumber);
    assert.equal(ledger.getFee().paidAmount, 40);
    assert.equal(ledger.getPayments().length, 1);
  } finally { ledger.restore(); }
});

test('transaction failure and stale conditional update fail closed without partial writes', async () => {
  const unsupported = setupLedger();
  const originalStartSession = mongoose.startSession;
  mongoose.startSession = async () => ({
    withTransaction: async () => { throw new Error('Transaction numbers are only allowed on a replica set member'); },
    endSession: async () => {}
  });
  try {
    await assert.rejects(feeService.makePayment(paymentRequest(), accountant), error => error.statusCode === 503);
    assert.equal(unsupported.getFee().paidAmount, 0);
    assert.equal(unsupported.getPayments().length, 0);
  } finally {
    mongoose.startSession = originalStartSession;
    unsupported.restore();
  }

  const stale = setupLedger({ conflictUpdate: true });
  try {
    await assert.rejects(feeService.makePayment(paymentRequest(), accountant), error => error.statusCode === 409);
    assert.equal(stale.getFee().paidAmount, 0);
    assert.equal(stale.getPayments().length, 0);
  } finally { stale.restore(); }
});

test('permission checks do not broaden Accountant access and fee lists use minimized projections', async () => {
  const originalFind = StudentFee.find;
  const calls = {};
  StudentFee.find = filter => {
    calls.filter = filter;
    return {
      select(selection) { calls.selection = selection; return this; },
      populate(population) { (calls.populations ||= []).push(population); return this; },
      find() { return this; }, sort() { return this; }, skip() { return this; }, limit() { return this; },
      then(resolve, reject) { return Promise.resolve([{ totalAmount: 100 }]).then(resolve, reject); }
    };
  };
  try {
    const rows = await feeService.getPendingFees(accountant);
    assert.equal(rows.length, 1);
    assert.match(calls.selection, /totalAmount/);
    assert.doesNotMatch(calls.selection, /payments|remarks|admissionSaga/);
    assert.equal(calls.populations[0].select, 'admissionNumber class rollNumber academicYear user');
    assert.equal(calls.populations[0].populate.select, 'name');
    await assert.rejects(feeService.getPendingFees({ _id: studentId, role: 'staff' }), error => error.statusCode === 403);
  } finally { StudentFee.find = originalFind; }

  const ledger = setupLedger();
  try {
    await assert.rejects(feeService.makePayment(paymentRequest(), { _id: studentId, role: 'staff' }), error => error.statusCode === 403);
    assert.equal(ledger.calls.sessions, 0);
    assert.equal(ledger.calls.paymentCreates.length, 0);
  } finally { ledger.restore(); }
});

test('legacy student-fee controller and service are retired without mutating Student.fees', async () => {
  const original = studentService.updateFeePayment;
  let serviceCalled = false;
  studentService.updateFeePayment = async () => { serviceCalled = true; };
  let forwarded;
  try {
    await studentController.updateFeePayment({ params: { id: studentId }, body: { amount: 10 } }, {}, error => { forwarded = error; });
    assert.equal(forwarded.statusCode, 410);
    assert.equal(serviceCalled, false);
    await assert.rejects(original(studentId, 10), error => error.statusCode === 410);
    assert.match(studentRoutesSource, /router\.put\('\/:id\/fees',\s*requirePermission\('fees\.collect'\),\s*updateFeePayment\)/);
  } finally { studentService.updateFeePayment = original; }
});

test('Payment schema has unique idempotency and receipt indexes; finance UI sends canonical payment contract', () => {
  const indexes = Payment.schema.indexes();
  assert.ok(indexes.some(([keys, options]) => keys.idempotencyKey === 1 && options.unique && options.sparse));
  assert.ok(indexes.some(([keys, options]) => keys.receiptNumber === 1 && options.unique));
  assert.equal(Payment.schema.path('idempotencyKey').options.select, false);
  assert.equal(Payment.schema.path('amount').options.min, 0.01);
  assert.equal(Payment.schema.path('receivedBy').isRequired, true);
  const financeScript = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'finance-portal.js'), 'utf8');
  const financeHtml = fs.readFileSync(path.join(__dirname, '..', 'public', 'portal', 'finance.html'), 'utf8');
  assert.match(financeScript, /studentFee:\s*_fcActiveFee\._id/);
  assert.match(financeScript, /idempotencyKey/);
  assert.doesNotMatch(financeScript, /receivedBy\s*:/);
  assert.match(financeHtml, /value="BankTransfer"/);
  assert.doesNotMatch(financeHtml, /<option>Card<\/option>|<option>UPI<\/option>/);
});

