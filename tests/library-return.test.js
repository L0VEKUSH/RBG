'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const LibraryBook = require('../models/LibraryBook');
const LibraryTransaction = require('../models/LibraryTransaction');
const libraryService = require('../services/library.service');
const libraryController = require('../controllers/library.controller');
const libraryRoutes = require('../routes/library.routes');

const transactionId = 'transaction-1';
const bookId = 'book-1';
const librarian = { _id: '666666666666666666666666', role: 'librarian' };

function setupReturnHarness({
  status = 'Issued',
  transactionExists = true,
  bookExists = true,
  bookInventory = { totalCopies: 3, availableCopies: 2 },
  failBookUpdate = false,
  failTransaction = false,
} = {}) {
  let transaction = transactionExists
    ? { _id: transactionId, book: bookId, status, returnDate: null }
    : null;
  let book = bookExists ? { _id: bookId, ...bookInventory } : null;
  const calls = { transactionUpdates: [], bookReads: [], bookUpdates: [], sessionsCreated: 0, sessionsEnded: 0 };
  const originals = {
    startSession: mongoose.startSession,
    findOneAndUpdate: LibraryTransaction.findOneAndUpdate,
    bookFindById: LibraryBook.findById,
    bookUpdateOne: LibraryBook.updateOne,
  };
  let transactionQueue = Promise.resolve();

  mongoose.startSession = async () => {
    calls.sessionsCreated += 1;
    return {
      withTransaction: async (callback) => {
        if (failTransaction) throw new Error('synthetic transaction unsupported');
        const run = transactionQueue.then(async () => {
          const previousTransaction = transaction && { ...transaction };
          const previousBook = book && { ...book };
          try {
            return await callback();
          } catch (error) {
            transaction = previousTransaction;
            book = previousBook;
            throw error;
          }
        });
        transactionQueue = run.then(() => undefined, () => undefined);
        return run;
      },
      endSession: async () => { calls.sessionsEnded += 1; },
    };
  };

  LibraryTransaction.findOneAndUpdate = async (filter, update, options) => {
    calls.transactionUpdates.push({ filter, update, options });
    assert.ok(options.session, 'transaction transition must use the active session');
    if (!transaction || String(transaction._id) !== String(filter._id) || transaction.status !== filter.status) return null;
    transaction = { ...transaction, ...update.$set };
    return { ...transaction };
  };

  LibraryBook.findById = id => {
    calls.bookReads.push(id);
    return {
      session(session) { assert.ok(session, 'book inventory read must use the active session'); return this; },
      select() { return this; },
      then(resolve, reject) {
        const result = book && String(book._id) === String(id) ? { ...book } : null;
        return Promise.resolve(result).then(resolve, reject);
      },
    };
  };

  LibraryBook.updateOne = async (filter, update, options) => {
    calls.bookUpdates.push({ filter, update, options });
    assert.ok(options.session, 'inventory update must use the active session');
    if (failBookUpdate) throw new Error('synthetic inventory write failure');
    if (!book || String(book._id) !== String(filter._id)) return { matchedCount: 0 };
    if (filter.totalCopies !== book.totalCopies ||
        filter.availableCopies.$eq !== book.availableCopies ||
        filter.availableCopies.$lt !== book.totalCopies ||
        book.availableCopies >= book.totalCopies) return { matchedCount: 0 };
    book = { ...book, availableCopies: book.availableCopies + update.$inc.availableCopies };
    return { matchedCount: 1 };
  };

  return {
    calls,
    getTransaction: () => transaction && { ...transaction },
    getBook: () => book && { ...book },
    restore() {
      mongoose.startSession = originals.startSession;
      LibraryTransaction.findOneAndUpdate = originals.findOneAndUpdate;
      LibraryBook.findById = originals.bookFindById;
      LibraryBook.updateOne = originals.bookUpdateOne;
    },
  };
}

test('returning an issued transaction changes status and increments its persisted book once', async () => {
  const harness = setupReturnHarness();
  try {
    const result = await libraryService.returnBook(transactionId, librarian);
    assert.equal(result.status, 'Returned');
    assert.ok(result.returnDate instanceof Date);
    assert.equal(harness.getTransaction().status, 'Returned');
    assert.equal(harness.getBook().availableCopies, 3);
    assert.deepEqual(harness.calls.transactionUpdates[0].filter, { _id: transactionId, status: 'Issued' });
    assert.deepEqual(harness.calls.bookUpdates[0].filter, {
      _id: bookId,
      totalCopies: 3,
      availableCopies: { $eq: 2, $lt: 3 },
    });
    assert.equal(harness.calls.sessionsCreated, 1);
    assert.equal(harness.calls.sessionsEnded, 1);
  } finally {
    harness.restore();
  }
});

test('repeated return is rejected without a second inventory increment', async () => {
  const harness = setupReturnHarness();
  try {
    await libraryService.returnBook(transactionId, librarian);
    await assert.rejects(libraryService.returnBook(transactionId, librarian), error => error.statusCode === 404);
    assert.equal(harness.getBook().availableCopies, 3);
    assert.equal(harness.getTransaction().status, 'Returned');
    assert.equal(harness.calls.sessionsEnded, 2);
  } finally {
    harness.restore();
  }
});

test('concurrent duplicate returns allow exactly one transition and one inventory increment', async () => {
  const harness = setupReturnHarness();
  try {
    const results = await Promise.allSettled([
      libraryService.returnBook(transactionId, librarian),
      libraryService.returnBook(transactionId, librarian),
    ]);
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(results.filter(result => result.status === 'rejected').length, 1);
    assert.equal(harness.getTransaction().status, 'Returned');
    assert.equal(harness.getBook().availableCopies, 3);
    assert.equal(harness.calls.bookUpdates.length, 1);
  } finally {
    harness.restore();
  }
});

test('missing transaction fails without changing inventory', async () => {
  const harness = setupReturnHarness({ transactionExists: false });
  try {
    await assert.rejects(libraryService.returnBook(transactionId, librarian), error => error.statusCode === 404);
    assert.equal(harness.getBook().availableCopies, 2);
    assert.equal(harness.calls.bookUpdates.length, 0);
    assert.equal(harness.calls.sessionsEnded, 1);
  } finally {
    harness.restore();
  }
});

test('missing book rolls back the transaction transition', async () => {
  const harness = setupReturnHarness({ bookExists: false });
  try {
    await assert.rejects(libraryService.returnBook(transactionId, librarian), error => error.statusCode === 404);
    assert.equal(harness.getTransaction().status, 'Issued');
    assert.equal(harness.calls.sessionsEnded, 1);
  } finally {
    harness.restore();
  }
});

test('return rejects inconsistent stored inventory and rolls back the loan transition', async t => {
  const invalidInventories = [
    { totalCopies: 0, availableCopies: 0 },
    { totalCopies: -1, availableCopies: 1 },
    { totalCopies: 2.5, availableCopies: 1 },
    { totalCopies: 2, availableCopies: -1 },
    { totalCopies: 2, availableCopies: 1.5 },
    { totalCopies: 2, availableCopies: 3 },
  ];
  for (const bookInventory of invalidInventories) {
    await t.test(JSON.stringify(bookInventory), async () => {
      const harness = setupReturnHarness({ bookInventory });
      try {
        await assert.rejects(
          libraryService.returnBook(transactionId, librarian),
          error => error.statusCode === 409
        );
        assert.equal(harness.getTransaction().status, 'Issued');
        assert.deepEqual(harness.getBook(), { _id: bookId, ...bookInventory });
        assert.equal(harness.calls.bookUpdates.length, 0);
      } finally {
        harness.restore();
      }
    });
  }
});

test('return at the inventory upper bound fails without changing status or count', async () => {
  const bookInventory = { totalCopies: 2, availableCopies: 2 };
  const harness = setupReturnHarness({ bookInventory });
  try {
    await assert.rejects(
      libraryService.returnBook(transactionId, librarian),
      error => error.statusCode === 409
    );
    assert.equal(harness.getTransaction().status, 'Issued');
    assert.deepEqual(harness.getBook(), { _id: bookId, ...bookInventory });
    assert.equal(harness.calls.bookUpdates.length, 0);
  } finally {
    harness.restore();
  }
});

for (const status of ['Returned', 'Lost', 'Overdue', 'Invalid']) {
  test(`transaction in ${status} status cannot be returned`, async () => {
    const harness = setupReturnHarness({ status });
    try {
      await assert.rejects(libraryService.returnBook(transactionId, librarian), error => error.statusCode === 404);
      assert.equal(harness.getTransaction().status, status);
      assert.equal(harness.getBook().availableCopies, 2);
      assert.equal(harness.calls.bookUpdates.length, 0);
    } finally {
      harness.restore();
    }
  });
}

test('inventory write failure rolls back the transaction status', async () => {
  const harness = setupReturnHarness({ failBookUpdate: true });
  try {
    await assert.rejects(libraryService.returnBook(transactionId, librarian), /synthetic inventory write failure/);
    assert.equal(harness.getTransaction().status, 'Issued');
    assert.equal(harness.getBook().availableCopies, 2);
    assert.equal(harness.calls.sessionsEnded, 1);
  } finally {
    harness.restore();
  }
});

test('transaction startup failure fails closed without non-transactional writes', async () => {
  const harness = setupReturnHarness({ failTransaction: true });
  try {
    await assert.rejects(libraryService.returnBook(transactionId, librarian), /synthetic transaction unsupported/);
    assert.equal(harness.getTransaction().status, 'Issued');
    assert.equal(harness.getBook().availableCopies, 2);
    assert.equal(harness.calls.transactionUpdates.length, 0);
    assert.equal(harness.calls.bookUpdates.length, 0);
    assert.equal(harness.calls.sessionsEnded, 1);
  } finally {
    harness.restore();
  }
});

test('return permission middleware rejects unauthorized callers before the controller runs', async () => {
  const returnRoute = libraryRoutes.stack.find(layer => layer.route && layer.route.path === '/return');
  assert.ok(returnRoute, 'POST /return route exists');
  assert.equal(returnRoute.route.stack.length, 2, 'permission middleware precedes the controller');
  const permissionMiddleware = returnRoute.route.stack[0].handle;
  const controller = returnRoute.route.stack[1].handle;
  let controllerCalled = false;
  let forwardedError;
  const originalReturnBook = libraryService.returnBook;
  libraryService.returnBook = async () => { controllerCalled = true; };

  try {
    permissionMiddleware(
      { user: { _id: 'student-user', role: 'student' }, body: { transactionId } },
      {},
      error => { forwardedError = error; }
    );
    if (!forwardedError) {
      await controller(
        { user: { _id: 'student-user', role: 'student' }, body: { transactionId } },
        { status() { return this; }, json() { return this; } },
        error => { forwardedError = error; }
      );
    }
    assert.equal(forwardedError.statusCode, 403);
    assert.equal(controllerCalled, false);
  } finally {
    libraryService.returnBook = originalReturnBook;
  }
});

test('controller forwards missing transaction errors instead of returning success', async () => {
  const originalReturnBook = libraryService.returnBook;
  const expectedError = new Error('transaction missing');
  let forwardedError;
  let successResponseSent = false;
  libraryService.returnBook = async () => { throw expectedError; };
  try {
    await libraryController.returnBook(
      { body: { transactionId } },
      { status() { successResponseSent = true; return this; }, json() { return this; } },
      error => { forwardedError = error; }
    );
    assert.equal(forwardedError, expectedError);
    assert.equal(successResponseSent, false);
  } finally {
    libraryService.returnBook = originalReturnBook;
  }
});
