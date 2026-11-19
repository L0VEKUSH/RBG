'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const mongoose = require('mongoose');
const LibraryBook = require('../models/LibraryBook');
const LibraryTransaction = require('../models/LibraryTransaction');
const Student = require('../models/Student');
const User = require('../models/User');
const libraryService = require('../services/library.service');
const libraryController = require('../controllers/library.controller');
const libraryRoutes = require('../routes/library.routes');

const studentId = '111111111111111111111111';
const studentUserId = '222222222222222222222222';
const issuerId = '333333333333333333333333';
const bookId = '444444444444444444444444';
const spoofedIssuerId = '555555555555555555555555';
const librarian = { _id: issuerId, role: 'librarian' };
const dueDate = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);

function queryResult(value, calls, model) {
  return {
    session(session) {
      assert.ok(session, `${model} query must use the transaction session`);
      calls.sessionQueries.push(model);
      return this;
    },
    select() { return this; },
    then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); },
  };
}

function setupCheckoutHarness({
  student = { _id: studentId, user: studentUserId, isActive: true, tcIssued: false },
  studentAccount = { _id: studentUserId, role: 'student', isActive: true },
  book = { _id: bookId, isActive: true, totalCopies: 2, availableCopies: 2 },
  failCreate = false,
  failTransaction = false,
} = {}) {
  let state = { student, studentAccount, book, transactions: [] };
  const calls = {
    studentReads: [], userReads: [], bookReads: [], inventoryUpdates: [],
    creates: [], sessionQueries: [], sessionsCreated: 0, sessionsEnded: 0,
  };
  const originals = {
    startSession: mongoose.startSession,
    studentFindById: Student.findById,
    userFindById: User.findById,
    bookFindById: LibraryBook.findById,
    bookUpdateOne: LibraryBook.updateOne,
    transactionCreate: LibraryTransaction.create,
  };
  let transactionQueue = Promise.resolve();

  mongoose.startSession = async () => {
    calls.sessionsCreated += 1;
    return {
      withTransaction: async callback => {
        if (failTransaction) throw new Error('synthetic transaction unsupported');
        const run = transactionQueue.then(async () => {
          const previousState = {
            ...state,
            book: state.book && { ...state.book },
            transactions: state.transactions.slice(),
          };
          try {
            return await callback();
          } catch (error) {
            state = previousState;
            throw error;
          }
        });
        transactionQueue = run.then(() => undefined, () => undefined);
        return run;
      },
      endSession: async () => { calls.sessionsEnded += 1; },
    };
  };

  Student.findById = id => {
    calls.studentReads.push(id);
    return queryResult(state.student && String(state.student._id) === String(id) ? { ...state.student } : null, calls, 'Student');
  };
  User.findById = id => {
    calls.userReads.push(id);
    return queryResult(state.studentAccount && String(state.studentAccount._id) === String(id) ? { ...state.studentAccount } : null, calls, 'User');
  };
  LibraryBook.findById = id => {
    calls.bookReads.push(id);
    return queryResult(state.book && String(state.book._id) === String(id) ? { ...state.book } : null, calls, 'LibraryBook');
  };
  LibraryBook.updateOne = async (filter, update, options) => {
    calls.inventoryUpdates.push({ filter, update, options });
    assert.ok(options.session, 'inventory reservation must use the transaction session');
    assert.equal(filter.isActive, true);
    assert.equal(filter.totalCopies, state.book && state.book.totalCopies);
    assert.deepEqual(filter.availableCopies, { $gt: 0, $eq: state.book && state.book.availableCopies });
    if (!state.book || String(state.book._id) !== String(filter._id) || !state.book.isActive ||
        state.book.totalCopies !== filter.totalCopies || state.book.availableCopies !== filter.availableCopies.$eq ||
        state.book.availableCopies <= 0) {
      return { matchedCount: 0 };
    }
    state.book = { ...state.book, availableCopies: state.book.availableCopies + update.$inc.availableCopies };
    return { matchedCount: 1 };
  };
  LibraryTransaction.create = async (documents, options) => {
    calls.creates.push({ documents, options });
    assert.ok(options.session, 'transaction creation must use the transaction session');
    if (failCreate) throw new Error('synthetic transaction create failure');
    const created = documents.map(document => ({ ...document, _id: new mongoose.Types.ObjectId() }));
    state.transactions.push(...created);
    return created;
  };

  return {
    calls,
    getState: () => ({ ...state, book: state.book && { ...state.book }, transactions: state.transactions.slice() }),
    restore() {
      mongoose.startSession = originals.startSession;
      Student.findById = originals.studentFindById;
      User.findById = originals.userFindById;
      LibraryBook.findById = originals.bookFindById;
      LibraryBook.updateOne = originals.bookUpdateOne;
      LibraryTransaction.create = originals.transactionCreate;
    },
  };
}

test('portal sends the exact student checkout contract and does not offer unsupported teacher borrowing', () => {
  const portalScript = fs.readFileSync(path.join(__dirname, '../public/js/library-portal.js'), 'utf8');
  const portalMarkup = fs.readFileSync(path.join(__dirname, '../public/portal/library.html'), 'utf8');
  assert.match(portalScript, /JSON\.stringify\(\{ bookId: bk, studentId, dueDate: due \}\)/);
  assert.doesNotMatch(portalScript, /issueRole|memberId/);
  assert.doesNotMatch(portalMarkup, /id="issueRole"|issueMemberId|value="teacher"/);
  assert.match(portalMarkup, /Student record ID/);
  assert.match(portalMarkup, /Book record ID/);
});

test('valid checkout creates an Issued transaction with authenticated issuedBy', async () => {
  const harness = setupCheckoutHarness();
  try {
    const req = {
      body: { bookId, studentId, dueDate, issuedBy: spoofedIssuerId, role: 'teacher' },
      user: { _id: issuerId, role: 'librarian' },
    };
    let responseStatus;
    let responseBody;
    let forwardedError;
    await libraryController.issueBook(req, {
      status(code) { responseStatus = code; return this; },
      json(body) { responseBody = body; return this; },
    }, error => { forwardedError = error; });

    assert.equal(forwardedError, undefined);
    assert.equal(responseStatus, 201);
    assert.equal(responseBody.data.status, 'Issued');
    assert.equal(String(responseBody.data.issuedBy), issuerId);
    assert.notEqual(String(responseBody.data.issuedBy), spoofedIssuerId);
    assert.equal(harness.getState().book.availableCopies, 1);
    assert.equal(harness.calls.sessionsEnded, 1);
    assert.equal(new LibraryTransaction(responseBody.data).validateSync(), undefined);
  } finally {
    harness.restore();
  }
});

test('missing student borrower is rejected without reserving inventory', async () => {
  const harness = setupCheckoutHarness({ student: null });
  try {
    await assert.rejects(libraryService.issueBook(bookId, studentId, dueDate, librarian), error => error.statusCode === 404);
    assert.equal(harness.getState().book.availableCopies, 2);
    assert.equal(harness.calls.inventoryUpdates.length, 0);
    assert.equal(harness.getState().transactions.length, 0);
  } finally {
    harness.restore();
  }
});

test('inactive student borrower is rejected without reserving inventory', async () => {
  const harness = setupCheckoutHarness({ student: { _id: studentId, user: studentUserId, isActive: false, tcIssued: false } });
  try {
    await assert.rejects(libraryService.issueBook(bookId, studentId, dueDate, librarian), error => error.statusCode === 409);
    assert.equal(harness.getState().book.availableCopies, 2);
    assert.equal(harness.calls.inventoryUpdates.length, 0);
  } finally {
    harness.restore();
  }
});

test('inactive or non-student linked account is not an eligible borrower', async t => {
  for (const studentAccount of [
    { _id: studentUserId, role: 'student', isActive: false },
    { _id: studentUserId, role: 'parent', isActive: true },
  ]) {
    await t.test(`${studentAccount.role} account (active=${studentAccount.isActive})`, async () => {
      const harness = setupCheckoutHarness({ studentAccount });
      try {
        await assert.rejects(libraryService.issueBook(bookId, studentId, dueDate, librarian), error => error.statusCode === 409);
        assert.equal(harness.getState().book.availableCopies, 2);
        assert.equal(harness.calls.inventoryUpdates.length, 0);
      } finally {
        harness.restore();
      }
    });
  }
});

test('missing or inactive book is rejected without creating a loan', async t => {
  for (const book of [null, { _id: bookId, isActive: false, totalCopies: 2, availableCopies: 2 }]) {
    await t.test(book ? 'inactive book' : 'missing book', async () => {
      const harness = setupCheckoutHarness({ book });
      try {
        await assert.rejects(libraryService.issueBook(bookId, studentId, dueDate, librarian));
        assert.equal(harness.getState().transactions.length, 0);
        assert.equal(harness.calls.inventoryUpdates.length, 0);
      } finally {
        harness.restore();
      }
    });
  }
});

test('zero available copies are rejected without creating a loan', async () => {
  const harness = setupCheckoutHarness({ book: { _id: bookId, isActive: true, totalCopies: 2, availableCopies: 0 } });
  try {
    await assert.rejects(libraryService.issueBook(bookId, studentId, dueDate, librarian), error => error.statusCode === 409);
    assert.equal(harness.getState().book.availableCopies, 0);
    assert.equal(harness.getState().transactions.length, 0);
  } finally {
    harness.restore();
  }
});

test('checkout rejects inconsistent stored inventory before reservation or loan creation', async t => {
  const invalidInventory = [
    { totalCopies: 0, availableCopies: 0 },
    { totalCopies: -1, availableCopies: 1 },
    { totalCopies: 2.5, availableCopies: 2 },
    { totalCopies: 2, availableCopies: -1 },
    { totalCopies: 2, availableCopies: 2.5 },
    { totalCopies: 2, availableCopies: 3 },
  ];
  for (const inventory of invalidInventory) {
    await t.test(JSON.stringify(inventory), async () => {
      const book = { _id: bookId, isActive: true, ...inventory };
      const harness = setupCheckoutHarness({ book });
      try {
        await assert.rejects(
          libraryService.issueBook(bookId, studentId, dueDate, librarian),
          error => error.statusCode === 409
        );
        assert.equal(harness.calls.inventoryUpdates.length, 0);
        assert.equal(harness.calls.creates.length, 0);
        assert.deepEqual(harness.getState().book, book);
        assert.equal(harness.getState().transactions.length, 0);
      } finally {
        harness.restore();
      }
    });
  }
});

test('concurrent checkout attempts cannot issue more copies than inventory', async () => {
  const harness = setupCheckoutHarness({ book: { _id: bookId, isActive: true, totalCopies: 1, availableCopies: 1 } });
  try {
    const results = await Promise.allSettled([
      libraryService.issueBook(bookId, studentId, dueDate, librarian),
      libraryService.issueBook(bookId, studentId, dueDate, librarian),
    ]);
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(results.filter(result => result.status === 'rejected').length, 1);
    assert.equal(harness.getState().book.availableCopies, 0);
    assert.equal(harness.getState().transactions.length, 1);
  } finally {
    harness.restore();
  }
});

test('transaction creation failure rolls inventory reservation back', async () => {
  const harness = setupCheckoutHarness({ failCreate: true });
  try {
    await assert.rejects(
      libraryService.issueBook(bookId, studentId, dueDate, librarian),
      /synthetic transaction create failure/
    );
    assert.equal(harness.getState().book.availableCopies, 2);
    assert.equal(harness.getState().transactions.length, 0);
    assert.equal(harness.calls.sessionsEnded, 1);
  } finally {
    harness.restore();
  }
});

test('unsupported transaction topology fails closed without standalone writes', async () => {
  const harness = setupCheckoutHarness({ failTransaction: true });
  try {
    await assert.rejects(
      libraryService.issueBook(bookId, studentId, dueDate, librarian),
      /synthetic transaction unsupported/
    );
    assert.equal(harness.getState().book.availableCopies, 2);
    assert.equal(harness.getState().transactions.length, 0);
    assert.equal(harness.calls.studentReads.length, 0);
    assert.equal(harness.calls.sessionsEnded, 1);
  } finally {
    harness.restore();
  }
});

test('invalid identifiers, missing issuer, and invalid due dates are rejected before a session starts', async t => {
  for (const args of [
    ['not-an-id', studentId, dueDate, librarian],
    [bookId, studentId, dueDate, null],
    [bookId, studentId, 'not-a-date', librarian],
    [bookId, studentId, new Date(Date.now() - 1000), librarian],
  ]) {
    await t.test(JSON.stringify(args.slice(0, 3)), async () => {
      const harness = setupCheckoutHarness();
      try {
        await assert.rejects(libraryService.issueBook(...args));
        assert.equal(harness.calls.sessionsCreated, 0);
        assert.equal(harness.calls.inventoryUpdates.length, 0);
      } finally {
        harness.restore();
      }
    });
  }
});

test('library issue permission rejects unauthorized callers before service mutation', async () => {
  const issueRoute = libraryRoutes.stack.find(layer => layer.route && layer.route.path === '/issue');
  assert.ok(issueRoute, 'POST /issue route exists');
  assert.equal(issueRoute.route.stack.length, 2, 'permission middleware precedes the controller');
  const permissionMiddleware = issueRoute.route.stack[0].handle;
  const controller = issueRoute.route.stack[1].handle;
  const originalIssueBook = libraryService.issueBook;
  let serviceCalled = false;
  let forwardedError;
  libraryService.issueBook = async () => { serviceCalled = true; };
  try {
    permissionMiddleware(
      { user: { _id: studentUserId, role: 'student' }, body: { bookId, studentId, dueDate } },
      {},
      error => { forwardedError = error; }
    );
    if (!forwardedError) {
      await controller(
        { user: { _id: studentUserId, role: 'student' }, body: { bookId, studentId, dueDate } },
        { status() { return this; }, json() { return this; } },
        error => { forwardedError = error; }
      );
    }
    assert.equal(forwardedError.statusCode, 403);
    assert.equal(serviceCalled, false);
  } finally {
    libraryService.issueBook = originalIssueBook;
  }
});
