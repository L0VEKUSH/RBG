'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const LibraryBook = require('../models/LibraryBook');
const LibraryTransaction = require('../models/LibraryTransaction');
const libraryService = require('../services/library.service');
const dashboardService = require('../services/dashboard.service');
const librarian = { _id: '666666666666666666666666', role: 'librarian' };

function stub(target, key, replacement) {
  const original = target[key];
  target[key] = replacement;
  return () => { target[key] = original; };
}

test('issued statistics count only schema-valid Issued loans', async () => {
  const transactions = [
    { status: 'Issued' },
    { status: 'Returned' },
    { status: 'Lost' },
  ];
  let capturedFilter;
  let capturedBookFilter;
  const restoreBooks = stub(LibraryBook, 'countDocuments', async filter => { capturedBookFilter = filter; return 12; });
  const restoreTransactions = stub(LibraryTransaction, 'countDocuments', async filter => {
    capturedFilter = filter;
    return transactions.filter(transaction => transaction.status === filter.status).length;
  });

  try {
    const stats = await libraryService.getStats(librarian);
    assert.deepEqual(capturedBookFilter, { isActive: { $ne: false } });
    assert.deepEqual(capturedFilter, { status: 'Issued' });
    assert.deepEqual(stats, { totalBooks: 12, issuedBooks: 1 });
  } finally {
    restoreTransactions();
    restoreBooks();
  }
});

test('librarian dashboard uses schema-valid Issued status for counts and overdue loans', async () => {
  const transactions = [
    { status: 'Issued', dueDate: new Date(Date.now() - 60_000) },
    { status: 'Returned', dueDate: new Date(Date.now() - 60_000) },
    { status: 'Issued', dueDate: new Date(Date.now() + 60_000) },
  ];
  const capturedFilters = [];
  let capturedBookFilter;
  const restoreBooks = stub(LibraryBook, 'countDocuments', async filter => { capturedBookFilter = filter; return 12; });
  const restoreTransactions = stub(LibraryTransaction, 'countDocuments', async filter => {
    capturedFilters.push(filter);
    return transactions.filter(transaction =>
      transaction.status === filter.status && (!filter.dueDate || transaction.dueDate < filter.dueDate.$lt)
    ).length;
  });

  try {
    const dashboard = await dashboardService.getLibrarianDashboard();
    assert.deepEqual(capturedBookFilter, { isActive: { $ne: false } });
    assert.equal(capturedFilters[0].status, 'Issued');
    assert.deepEqual(capturedFilters[1].status, 'Issued');
    assert.ok(capturedFilters[1].dueDate.$lt instanceof Date);
    assert.deepEqual(dashboard, { totalBooks: 12, issuedBooks: 2, overdueBooks: 1 });
  } finally {
    restoreTransactions();
    restoreBooks();
  }
});

test('overdue lookup includes past-due Issued loans, excluding returned and future-due loans', async () => {
  const now = Date.now();
  const transactions = [
    { _id: 'issued-past', status: 'Issued', dueDate: new Date(now - 60_000) },
    { _id: 'returned-past', status: 'Returned', dueDate: new Date(now - 60_000) },
    { _id: 'issued-future', status: 'Issued', dueDate: new Date(now + 60_000) },
  ];
  let capturedFilter;
  const populated = [];
  const restore = stub(LibraryTransaction, 'find', filter => {
    capturedFilter = filter;
    const matching = transactions.filter(transaction =>
      transaction.status === filter.status && transaction.dueDate < filter.dueDate.$lt
    );
    const query = {
      populate(path) { populated.push(path); return this; },
      then(resolve, reject) { return Promise.resolve(matching).then(resolve, reject); },
    };
    return query;
  });

  try {
    const overdue = await libraryService.getOverdueBooks(librarian);
    assert.equal(capturedFilter.status, 'Issued');
    assert.ok(capturedFilter.dueDate.$lt instanceof Date);
    assert.deepEqual(overdue.map(transaction => transaction._id), ['issued-past']);
    assert.equal(populated[0], 'book');
    assert.deepEqual(populated[1], {
      path: 'student',
      select: 'admissionNumber rollNumber class academicYear user',
      populate: { path: 'user', select: 'name' },
    });
  } finally {
    restore();
  }
});
