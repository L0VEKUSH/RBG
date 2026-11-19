'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const LibraryBook = require('../models/LibraryBook');
const LibraryTransaction = require('../models/LibraryTransaction');
const libraryService = require('../services/library.service');

const bookId = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const librarian = { _id: 'bbbbbbbbbbbbbbbbbbbbbbbb', role: 'librarian' };
const schoolAdmin = { _id: 'cccccccccccccccccccccccc', role: 'school_admin' };

function stub(target, key, replacement) {
  const original = target[key];
  target[key] = replacement;
  return () => { target[key] = original; };
}

function queryResult(value, calls = {}) {
  return {
    select(selection) { calls.selection = selection; return this; },
    session(session) { assert.ok(session, 'database query must use the active session'); return this; },
    then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); },
  };
}

function installTotalUpdateHarness({
  book = { _id: bookId, totalCopies: 5, availableCopies: 3 },
  activeLoanCount = 2,
  conflict = false,
} = {}) {
  const calls = { sessionsStarted: 0, sessionsEnded: 0, bookReads: [], loanCounts: [], querySessions: [], updates: [] };
  let activeSession;
  const originals = {
    startSession: mongoose.startSession,
    bookFindById: LibraryBook.findById,
    countDocuments: LibraryTransaction.countDocuments,
    findOneAndUpdate: LibraryBook.findOneAndUpdate,
  };

  mongoose.startSession = async () => {
    calls.sessionsStarted += 1;
    activeSession = {
      withTransaction: callback => callback(),
      endSession: async () => { calls.sessionsEnded += 1; },
    };
    return activeSession;
  };
  const sessionQuery = value => ({
    select() { return this; },
    session(session) {
      assert.equal(session, activeSession, 'transactional reads must share the active session');
      calls.querySessions.push(session);
      return this;
    },
    then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); },
  });
  LibraryBook.findById = id => {
    calls.bookReads.push(id);
    return sessionQuery(book);
  };
  LibraryTransaction.countDocuments = filter => {
    calls.loanCounts.push(filter);
    return sessionQuery(activeLoanCount);
  };
  LibraryBook.findOneAndUpdate = async (filter, update, options) => {
    calls.updates.push({ filter, update, options });
    assert.equal(options.session, activeSession, 'book count update must use the active session');
    if (conflict) return null;
    return { ...book, ...update.$set };
  };

  return {
    calls,
    restore() {
      mongoose.startSession = originals.startSession;
      LibraryBook.findById = originals.bookFindById;
      LibraryTransaction.countDocuments = originals.countDocuments;
      LibraryBook.findOneAndUpdate = originals.findOneAndUpdate;
    },
  };
}

function installDeleteHarness({ book = { _id: bookId, isActive: true }, activeLoan = false, hasHistory = false } = {}) {
  const calls = { sessionStarts: 0, sessionEnds: 0, transactionQueries: [], hardDeletes: [], softDeletes: [] };
  const originalStartSession = mongoose.startSession;
  const restores = [
    stub(LibraryBook, 'findById', () => queryResult(book)),
    stub(LibraryBook, 'findOneAndDelete', async (filter, options) => {
      assert.ok(options.session);
      calls.hardDeletes.push(filter);
      return book;
    }),
    stub(LibraryBook, 'findOneAndUpdate', async (filter, update, options) => {
      assert.ok(options.session);
      calls.softDeletes.push({ filter, update });
      return { ...book, ...update.$set };
    }),
    stub(LibraryTransaction, 'exists', filter => {
      calls.transactionQueries.push(filter);
      return queryResult(filter.status ? activeLoan : hasHistory);
    }),
  ];

  mongoose.startSession = async () => {
    calls.sessionStarts += 1;
    return {
      withTransaction: async callback => callback(),
      endSession: async () => { calls.sessionEnds += 1; },
    };
  };

  return {
    calls,
    restore() {
      mongoose.startSession = originalStartSession;
      for (const restoreMethod of restores.reverse()) restoreMethod();
    },
  };
}

test('new book copies initialize fully available, including model defaults', async () => {
  const document = new LibraryBook({ title: 'Synthetic title', author: 'Synthetic author', totalCopies: 6 });
  await document.validate();
  assert.equal(document.totalCopies, 6);
  assert.equal(document.availableCopies, 6);

  let created;
  const restore = stub(LibraryBook, 'create', async data => { created = data; return data; });
  try {
    const saved = await libraryService.addBook({ title: 'Synthetic title', author: 'Synthetic author', totalCopies: '6' }, librarian);
    assert.equal(created.totalCopies, 6);
    assert.equal(created.availableCopies, 6);
    assert.equal(saved.availableCopies, 6);
  } finally {
    restore();
  }
});

test('model validation rejects non-whole and out-of-range stored inventory', async t => {
  const invalidBooks = [
    { totalCopies: 2.5, availableCopies: 2 },
    { totalCopies: 2, availableCopies: -1 },
    { totalCopies: 2, availableCopies: 3 },
  ];
  for (const inventory of invalidBooks) {
    await t.test(JSON.stringify(inventory), async () => {
      const document = LibraryBook.hydrate({
        _id: bookId,
        title: 'Synthetic title',
        author: 'Synthetic author',
        ...inventory,
      });
      await assert.rejects(document.validate());
    });
  }
});

test('model validation rejects a new book initialized with only part of its copies available', async () => {
  const document = new LibraryBook({
    title: 'Synthetic title',
    author: 'Synthetic author',
    totalCopies: 4,
    availableCopies: 3,
  });
  await assert.rejects(document.validate());
});

test('book schema requires an explicit totalCopies value', async () => {
  const document = new LibraryBook({ title: 'Synthetic title', author: 'Synthetic author' });
  await assert.rejects(document.validate());
});

test('validated query updates require paired total and available copy values', async t => {
  for (const operation of ['findOneAndUpdate', 'updateOne']) {
    await t.test(operation, async () => {
      const withoutTotal = LibraryBook[operation](
        { _id: bookId },
        { $set: { availableCopies: 2 } },
        { runValidators: true }
      );
      await assert.rejects(withoutTotal.validate(withoutTotal._update, withoutTotal.options));

      const withoutAvailable = LibraryBook[operation](
        { _id: bookId },
        { $set: { totalCopies: 3 } },
        { runValidators: true }
      );
      await assert.rejects(withoutAvailable.validate(withoutAvailable._update, withoutAvailable.options));

      const validPair = LibraryBook[operation](
        { _id: bookId },
        { $set: { totalCopies: 3, availableCopies: 2 } },
        { runValidators: true }
      );
      await validPair.validate(validPair._update, validPair.options);

      const invalidPair = LibraryBook[operation](
        { _id: bookId },
        { $set: { totalCopies: 1, availableCopies: 2 } },
        { runValidators: true }
      );
      await assert.rejects(invalidPair.validate(invalidPair._update, invalidPair.options));
    });
  }
});

test('archived books are excluded from the active catalog', async () => {
  let filter;
  const restore = stub(LibraryBook, 'find', query => {
    filter = query;
    return queryResult([]);
  });
  try {
    await libraryService.getBooks(librarian);
    assert.deepEqual(filter, { isActive: { $ne: false } });
  } finally {
    restore();
  }
});

test('book creation rejects missing required fields, invalid counts, and client inventory fields', async t => {
  let createCalls = 0;
  const restore = stub(LibraryBook, 'create', async data => { createCalls += 1; return data; });
  const invalidInputs = [
    { author: 'Synthetic author' },
    { title: 'Synthetic title' },
    { title: 'Synthetic title', author: 'Synthetic author' },
    { title: 'Synthetic title', author: 'Synthetic author', totalCopies: 0 },
    { title: 'Synthetic title', author: 'Synthetic author', totalCopies: -1 },
    { title: 'Synthetic title', author: 'Synthetic author', totalCopies: null },
    { title: 'Synthetic title', author: 'Synthetic author', totalCopies: 1.5 },
    { title: 'Synthetic title', author: 'Synthetic author', publicationYear: true },
    { title: 'Synthetic title', author: 'Synthetic author', totalCopies: 2, availableCopies: 2 },
  ];
  try {
    for (const input of invalidInputs) {
      await t.test(JSON.stringify(input), async () => {
        await assert.rejects(libraryService.addBook(input, librarian), error => error.statusCode === 400);
      });
    }
    assert.equal(createCalls, 0);
  } finally {
    restore();
  }
});

test('updates reject direct availableCopies writes and totals below active loan count', async () => {
  const harness = installTotalUpdateHarness();
  try {
    await assert.rejects(
      libraryService.updateBook(bookId, { availableCopies: 99 }, librarian),
      error => error.statusCode === 400
    );
    await assert.rejects(
      libraryService.updateBook(bookId, { totalCopies: 1 }, librarian),
      error => error.statusCode === 409
    );
    await assert.rejects(
      libraryService.updateBook(bookId, { totalCopies: -1 }, librarian),
      error => error.statusCode === 400
    );
    assert.equal(harness.calls.updates.length, 0);
    assert.equal(harness.calls.loanCounts.length, 1);
  } finally {
    harness.restore();
  }
});

test('total-copy update counts active loan records in the same transaction and preserves availability', async () => {
  const harness = installTotalUpdateHarness({
    book: { _id: bookId, totalCopies: 5, availableCopies: 3 },
    activeLoanCount: 2,
  });
  try {
    const updated = await libraryService.updateBook(bookId, { totalCopies: '7' }, librarian);
    const [captured] = harness.calls.updates;
    assert.deepEqual(harness.calls.loanCounts, [{ book: bookId, status: { $in: ['Issued', 'Overdue'] } }]);
    assert.equal(captured.update.$set.totalCopies, 7);
    assert.equal(captured.update.$set.availableCopies, 5);
    assert.equal(captured.filter.totalCopies, 5);
    assert.equal(captured.filter.availableCopies, 3);
    assert.equal(captured.options.runValidators, true);
    assert.equal(captured.options.session, harness.calls.querySessions[0]);
    assert.equal(harness.calls.querySessions.length, 2);
    assert.equal(harness.calls.sessionsStarted, 1);
    assert.equal(harness.calls.sessionsEnded, 1);
    assert.ok(updated.availableCopies <= updated.totalCopies);
  } finally {
    harness.restore();
  }
});

test('total-copy update rejects inventory and active-loan ledger mismatch without mutation', async () => {
  const harness = installTotalUpdateHarness({
    book: { _id: bookId, totalCopies: 5, availableCopies: 2 },
    activeLoanCount: 2,
  });
  try {
    await assert.rejects(
      libraryService.updateBook(bookId, { totalCopies: 8 }, librarian),
      error => error.statusCode === 409 && /manual review/i.test(error.message)
    );
    assert.equal(harness.calls.updates.length, 0);
    assert.equal(harness.calls.sessionsEnded, 1);
  } finally {
    harness.restore();
  }
});

test('stale total-copy update is rejected after the conditional inventory write misses', async () => {
  const harness = installTotalUpdateHarness({ conflict: true });
  try {
    await assert.rejects(
      libraryService.updateBook(bookId, { totalCopies: 6 }, librarian),
      error => error.statusCode === 409 && /changed/i.test(error.message)
    );
    assert.equal(harness.calls.updates.length, 1);
    assert.equal(harness.calls.sessionsEnded, 1);
  } finally {
    harness.restore();
  }
});

test('missing book updates return 404 instead of a successful null result', async () => {
  const restores = [
    stub(LibraryBook, 'findByIdAndUpdate', async () => null),
  ];
  try {
    await assert.rejects(
      libraryService.updateBook(bookId, { title: 'Renamed synthetic book' }, librarian),
      error => error.statusCode === 404
    );
  } finally {
    for (const restore of restores.reverse()) restore();
  }
});

test('deletion rejects Issued and Overdue loans before changing the book', async t => {
  for (const status of ['Issued', 'Overdue']) {
    await t.test(status, async () => {
      const harness = installDeleteHarness({ activeLoan: true, hasHistory: true });
      try {
        await assert.rejects(libraryService.deleteBook(bookId, schoolAdmin), error => error.statusCode === 409);
        assert.equal(harness.calls.hardDeletes.length, 0);
        assert.equal(harness.calls.softDeletes.length, 0);
        assert.deepEqual(harness.calls.transactionQueries[0], {
          book: bookId,
          status: { $in: ['Issued', 'Overdue'] },
        });
      } finally {
        harness.restore();
      }
    });
  }
});

test('book with no loans is hard-deleted under the existing policy', async () => {
  const harness = installDeleteHarness({ activeLoan: false, hasHistory: false });
  try {
    const deleted = await libraryService.deleteBook(bookId, schoolAdmin);
    assert.equal(deleted._id, bookId);
    assert.deepEqual(harness.calls.hardDeletes, [{ _id: bookId }]);
    assert.equal(harness.calls.softDeletes.length, 0);
    assert.equal(harness.calls.sessionStarts, 1);
    assert.equal(harness.calls.sessionEnds, 1);
  } finally {
    harness.restore();
  }
});

test('book with historical loans is deactivated to preserve transaction references', async () => {
  const harness = installDeleteHarness({ activeLoan: false, hasHistory: true });
  try {
    const archived = await libraryService.deleteBook(bookId, schoolAdmin);
    assert.equal(archived.isActive, false);
    assert.equal(harness.calls.hardDeletes.length, 0);
    assert.deepEqual(harness.calls.softDeletes, [{ filter: { _id: bookId }, update: { $set: { isActive: false } } }]);
  } finally {
    harness.restore();
  }
});

test('missing book update and deletion return 404', async () => {
  const originalStartSession = mongoose.startSession;
  const restores = [
    stub(LibraryBook, 'findByIdAndUpdate', async () => null),
    stub(LibraryBook, 'findById', () => queryResult(null)),
  ];
  mongoose.startSession = async () => ({
    withTransaction: async callback => callback(),
    endSession: async () => {},
  });
  try {
    await assert.rejects(libraryService.updateBook(bookId, { title: 'New title' }, librarian), error => error.statusCode === 404);
    await assert.rejects(libraryService.deleteBook(bookId, schoolAdmin), error => error.statusCode === 404);
  } finally {
    mongoose.startSession = originalStartSession;
    for (const restore of restores.reverse()) restore();
  }
});

test('delete fails closed if MongoDB transaction support is unavailable', async () => {
  const originalStartSession = mongoose.startSession;
  let modelCalls = 0;
  const restores = [
    stub(LibraryBook, 'findById', () => { modelCalls += 1; throw new Error('must not read without transaction'); }),
  ];
  mongoose.startSession = async () => ({
    withTransaction: async () => { throw new Error('synthetic transaction unsupported'); },
    endSession: async () => {},
  });
  try {
    await assert.rejects(libraryService.deleteBook(bookId, schoolAdmin), /synthetic transaction unsupported/);
    assert.equal(modelCalls, 0);
  } finally {
    mongoose.startSession = originalStartSession;
    for (const restore of restores.reverse()) restore();
  }
});
