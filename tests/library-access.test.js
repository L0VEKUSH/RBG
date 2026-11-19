'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const LibraryBook = require('../models/LibraryBook');
const LibraryTransaction = require('../models/LibraryTransaction');
const Parent = require('../models/Parent');
const Student = require('../models/Student');
const libraryService = require('../services/library.service');

const parentUserId = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const parentProfileId = 'bbbbbbbbbbbbbbbbbbbbbbbb';
const studentUserId = 'cccccccccccccccccccccccc';
const studentId = 'dddddddddddddddddddddddd';
const unrelatedStudentId = 'eeeeeeeeeeeeeeeeeeeeeeee';
const librarianId = 'ffffffffffffffffffffffff';

function stub(target, key, replacement) {
  const original = target[key];
  target[key] = replacement;
  return () => { target[key] = original; };
}

function queryResult(value, calls = {}) {
  return {
    select(selection) { calls.selection = selection; return this; },
    populate(population) {
      calls.populations = calls.populations || [];
      calls.populations.push(population);
      return this;
    },
    then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); },
  };
}

function matchesLinkedStudent(filter, student) {
  if (filter.parentUser) return String(student.parentUser) === String(filter.parentUser);
  return (filter.$or || []).some(branch => {
    if (branch._id && branch._id.$in) return branch._id.$in.some(id => String(id) === String(student._id));
    if (branch.parentUser) return String(student.parentUser) === String(branch.parentUser);
    return false;
  });
}

function projectStudent(transaction, population) {
  const student = transaction.student;
  if (!student || !population || population.path !== 'student') return transaction;
  const allowedStudentFields = new Set(['_id', ...population.select.split(/\s+/).filter(Boolean)]);
  const safeStudent = Object.fromEntries(Object.entries(student).filter(([key]) => allowedStudentFields.has(key)));
  const userPopulation = population.populate;
  if (student.user && userPopulation && userPopulation.path === 'user') {
    safeStudent.user = Object.fromEntries(
      Object.entries(student.user).filter(([key]) => key === '_id' || userPopulation.select.split(/\s+/).includes(key))
    );
  }
  return { ...transaction, student: safeStudent };
}

test('student self-loan lookup derives the Student record from the authenticated actor', async () => {
  const calls = {};
  const restoreStudent = stub(Student, 'findOne', filter => {
    calls.studentFilter = filter;
    return queryResult({ _id: studentId }, calls);
  });
  const restoreTransactions = stub(LibraryTransaction, 'find', filter => {
    calls.transactionFilter = filter;
    return queryResult([{ _id: 'loan-self' }]);
  });

  try {
    const rows = await libraryService.getMyBooks({ _id: studentUserId, role: 'student' });
    assert.deepEqual(calls.studentFilter, { user: studentUserId });
    assert.deepEqual(calls.transactionFilter, { student: studentId });
    assert.deepEqual(rows, [{ _id: 'loan-self' }]);
    await assert.rejects(libraryService.getMyBooks(studentId), error => error.statusCode === 401);
  } finally {
    restoreTransactions();
    restoreStudent();
  }
});

test('parent can read only a child linked through Parent.children', async () => {
  const calls = { transactionReads: [] };
  const restoreParent = stub(Parent, 'findOne', filter => {
    calls.parentFilter = filter;
    return queryResult({ _id: parentProfileId, children: [studentId], isActive: true }, calls);
  });
  const restoreStudent = stub(Student, 'find', filter => {
    calls.studentFilter = filter;
    return queryResult([{ _id: studentId }], calls);
  });
  const restoreTransactions = stub(LibraryTransaction, 'find', filter => {
    calls.transactionReads.push(filter);
    return queryResult([{ _id: 'loan-child' }]);
  });
  const parent = { _id: parentUserId, role: 'parent' };

  try {
    const rows = await libraryService.getStudentTransactions(studentId, parent);
    assert.deepEqual(calls.parentFilter, { user: parentUserId });
    assert.deepEqual(calls.studentFilter.$or[0]._id.$in, [studentId]);
    assert.deepEqual(calls.transactionReads, [{ student: studentId }]);
    assert.deepEqual(rows, [{ _id: 'loan-child' }]);

    await assert.rejects(
      libraryService.getStudentTransactions(unrelatedStudentId, parent),
      error => error.statusCode === 404
    );
    assert.equal(calls.transactionReads.length, 1, 'unlinked child is rejected before reading transactions');
  } finally {
    restoreTransactions();
    restoreStudent();
    restoreParent();
  }
});

test('legacy Student.parentUser linkage works even without a Parent document', async () => {
  const calls = {};
  const restoreParent = stub(Parent, 'findOne', () => queryResult(null, calls));
  const restoreStudent = stub(Student, 'find', filter => {
    calls.studentFilter = filter;
    return queryResult([{ _id: studentId, parentUser: parentUserId }], calls);
  });
  const restoreTransactions = stub(LibraryTransaction, 'find', filter => {
    calls.transactionFilter = filter;
    return queryResult([{ _id: 'legacy-loan' }]);
  });

  try {
    const rows = await libraryService.getStudentTransactions(studentId, { _id: parentUserId, role: 'parent' });
    assert.deepEqual(calls.studentFilter, { parentUser: parentUserId });
    assert.deepEqual(calls.transactionFilter, { student: studentId });
    assert.deepEqual(rows, [{ _id: 'legacy-loan' }]);
  } finally {
    restoreTransactions();
    restoreStudent();
    restoreParent();
  }
});

test('inactive parent profile is denied even when it contains a child link', async () => {
  const restoreParent = stub(Parent, 'findOne', () => queryResult({ children: [studentId], isActive: false }));
  let studentQueryCalled = false;
  const restoreStudent = stub(Student, 'find', () => { studentQueryCalled = true; return queryResult([{ _id: studentId }]); });
  let transactionQueryCalled = false;
  const restoreTransactions = stub(LibraryTransaction, 'find', () => { transactionQueryCalled = true; return queryResult([]); });
  try {
    await assert.rejects(
      libraryService.getStudentTransactions(studentId, { _id: parentUserId, role: 'parent' }),
      error => error.statusCode === 403
    );
    assert.equal(studentQueryCalled, false);
    assert.equal(transactionQueryCalled, false);
  } finally {
    restoreTransactions();
    restoreStudent();
    restoreParent();
  }
});

test('transaction and overdue responses project Student and User to library-safe fields', async () => {
  const sensitiveStudent = {
    _id: studentId,
    admissionNumber: 'ADM-SYNTHETIC',
    rollNumber: 8,
    class: '8',
    academicYear: '2026-2027',
    father: { phone: 'synthetic-private' },
    address: { city: 'private' },
    bloodGroup: 'O+',
    medicalConditions: ['private'],
    user: {
      _id: studentUserId,
      name: 'Synthetic Student',
      email: 'private@example.test',
      phone: 'synthetic-private',
      address: { city: 'private' },
    },
  };
  const transaction = { _id: 'loan-privacy', student: sensitiveStudent, book: { title: 'Synthetic Book' } };
  const calls = { queries: [] };
  const librarian = { _id: librarianId, role: 'librarian' };
  const restore = stub(LibraryTransaction, 'find', filter => {
    const queryCalls = { filter, populations: [] };
    calls.queries.push(queryCalls);
    return {
      populate(population) {
        queryCalls.populations.push(population);
        return this;
      },
      then(resolve, reject) {
        const studentPopulation = queryCalls.populations.find(item => item && item.path === 'student');
        return Promise.resolve([projectStudent(transaction, studentPopulation)]).then(resolve, reject);
      },
    };
  });

  try {
    const allTransactions = await libraryService.getTransactions(librarian);
    const overdueTransactions = await libraryService.getOverdueBooks(librarian);
    assert.equal(calls.queries.length, 2);

    for (const result of [...allTransactions, ...overdueTransactions]) {
      assert.equal(result.student.user.name, 'Synthetic Student');
      assert.equal(result.student.admissionNumber, 'ADM-SYNTHETIC');
      assert.equal(result.student.father, undefined);
      assert.equal(result.student.address, undefined);
      assert.equal(result.student.bloodGroup, undefined);
      assert.equal(result.student.medicalConditions, undefined);
      assert.equal(result.student.user.email, undefined);
      assert.equal(result.student.user.phone, undefined);
      assert.equal(result.student.user.address, undefined);
    }

    for (const query of calls.queries) {
      const studentPopulation = query.populations.find(item => item && item.path === 'student');
      assert.ok(studentPopulation, 'student population uses an explicit projection');
      assert.equal(studentPopulation.select, 'admissionNumber rollNumber class academicYear user');
      assert.deepEqual(studentPopulation.populate, { path: 'user', select: 'name' });
    }
  } finally {
    restore();
  }
});

test('unprivileged direct service calls fail before querying or mutating models', async () => {
  const student = { _id: studentUserId, role: 'student' };
  const librarian = { _id: librarianId, role: 'librarian' };
  let modelCallCount = 0;
  const restoreMethods = [
    stub(LibraryBook, 'find', () => { modelCallCount += 1; throw new Error('unexpected model call'); }),
    stub(LibraryBook, 'create', () => { modelCallCount += 1; throw new Error('unexpected model call'); }),
    stub(LibraryBook, 'findByIdAndUpdate', () => { modelCallCount += 1; throw new Error('unexpected model call'); }),
    stub(LibraryBook, 'findByIdAndDelete', () => { modelCallCount += 1; throw new Error('unexpected model call'); }),
    stub(LibraryBook, 'countDocuments', () => { modelCallCount += 1; throw new Error('unexpected model call'); }),
    stub(LibraryTransaction, 'find', () => { modelCallCount += 1; throw new Error('unexpected model call'); }),
    stub(LibraryTransaction, 'countDocuments', () => { modelCallCount += 1; throw new Error('unexpected model call'); }),
  ];
  const originalStartSession = mongoose.startSession;
  mongoose.startSession = async () => { modelCallCount += 1; throw new Error('unexpected session'); };

  try {
    await assert.rejects(libraryService.getBooks(), error => error.statusCode === 401);
    await assert.rejects(libraryService.getTransactions(student), error => error.statusCode === 403);
    await assert.rejects(libraryService.getOverdueBooks(student), error => error.statusCode === 403);
    await assert.rejects(libraryService.getStats(student), error => error.statusCode === 403);
    await assert.rejects(libraryService.addBook({}, student), error => error.statusCode === 403);
    await assert.rejects(libraryService.updateBook('book-id', {}, student), error => error.statusCode === 403);
    await assert.rejects(libraryService.deleteBook('book-id', librarian), error => error.statusCode === 403);
    await assert.rejects(libraryService.issueBook('invalid', 'invalid', new Date(), student), error => error.statusCode === 403);
    await assert.rejects(libraryService.returnBook('transaction-id', student), error => error.statusCode === 403);
    assert.equal(modelCallCount, 0);
  } finally {
    mongoose.startSession = originalStartSession;
    for (const restore of restoreMethods.reverse()) restore();
  }
});

test('a library-view permission cannot widen Student self scope', async () => {
  const calls = {};
  const student = { _id: studentUserId, role: 'student', permissions: ['library.view'] };
  const restoreStudent = stub(Student, 'findOne', filter => {
    calls.studentFilter = filter;
    return queryResult({ _id: studentId });
  });
  const restoreTransactions = stub(LibraryTransaction, 'find', filter => {
    calls.transactionFilter = filter;
    return queryResult([]);
  });
  try {
    await libraryService.getTransactions(student);
    assert.deepEqual(calls.studentFilter, { user: studentUserId });
    assert.deepEqual(calls.transactionFilter.student, { $in: [studentId] });
  } finally {
    restoreTransactions();
    restoreStudent();
  }
});
