'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const AcademicYear = require('../models/AcademicYear');
const { isValidAcademicYear } = require('../utils/academic-year');

const START = new Date('2026-04-01T00:00:00.000Z');
const END = new Date('2027-03-31T00:00:00.000Z');

function makeAcademicYear(overrides = {}) {
  return new AcademicYear({
    name: '2026-2027',
    startDate: START,
    endDate: END,
    ...overrides,
  });
}

async function withOverlappingYears(overlappingYears, callback) {
  const originalFind = AcademicYear.find;
  const calls = [];
  AcademicYear.find = (filter) => {
    calls.push(filter);
    const excludedId = filter._id && filter._id.$ne ? String(filter._id.$ne) : null;
    return {
      select() { return this; },
      lean: async () => overlappingYears.filter(year => String(year._id) !== excludedId),
    };
  };
  try {
    return await callback(calls);
  } finally {
    AcademicYear.find = originalFind;
  }
}

test('academic-year utility accepts only consecutive YYYY-YYYY names', () => {
  assert.equal(isValidAcademicYear('2026-2027'), true);
  assert.equal(isValidAcademicYear('2026-2028'), false);
  assert.equal(isValidAcademicYear('2026/2027'), false);
});

test('academic year validation rejects invalid, equal, and reversed dates', async () => {
  await assert.rejects(
    makeAcademicYear({ startDate: new Date('not-a-date') }).validate(),
    error => error instanceof mongoose.Error.ValidationError &&
      /valid date/.test(error.errors.startDate.message)
  );
  await assert.rejects(
    makeAcademicYear({ endDate: START }).validate(),
    error => error instanceof mongoose.Error.ValidationError &&
      /earlier than/.test(error.errors.startDate.message)
  );
  await assert.rejects(
    makeAcademicYear({ startDate: END, endDate: START }).validate(),
    error => error instanceof mongoose.Error.ValidationError &&
      /earlier than/.test(error.errors.startDate.message)
  );
});

test('academic year validation rejects overlapping active years', async () => {
  await withOverlappingYears([{
    _id: new mongoose.Types.ObjectId(),
    name: '2025-2026',
    startDate: new Date('2025-04-01T00:00:00.000Z'),
    endDate: new Date('2026-04-15T00:00:00.000Z'),
  }], async () => {
    await assert.rejects(
      makeAcademicYear().validate(),
      error => error instanceof mongoose.Error.ValidationError &&
        /overlap another active academic year/.test(error.errors.startDate.message)
    );
  });
});

test('academic year validation allows non-overlapping active years', async () => {
  await withOverlappingYears([{
    _id: new mongoose.Types.ObjectId(),
    name: '2025-2026',
    startDate: new Date('2025-04-01T00:00:00.000Z'),
    endDate: new Date('2026-03-31T00:00:00.000Z'),
  }], async () => {
    await makeAcademicYear().validate();
  });
});

test('academic year updates exclude their own record from overlap checks', async () => {
  const academicYear = makeAcademicYear();
  academicYear.isNew = false;
  await withOverlappingYears([{
    _id: academicYear._id,
    name: academicYear.name,
    startDate: academicYear.startDate,
    endDate: academicYear.endDate,
  }], async (calls) => {
    await academicYear.validate();
    assert.deepEqual(calls[0]._id, { $ne: academicYear._id });
  });
});

test('inactive academic years do not participate in overlap checks', async () => {
  await withOverlappingYears([{
    _id: new mongoose.Types.ObjectId(),
    name: '2025-2026',
    startDate: new Date('2025-04-01T00:00:00.000Z'),
    endDate: new Date('2026-04-15T00:00:00.000Z'),
  }], async (calls) => {
    await makeAcademicYear({ isActive: false }).validate();
    assert.equal(calls.length, 0);
  });
});
