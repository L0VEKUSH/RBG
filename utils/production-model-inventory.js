'use strict';

const path = require('node:path');
const { isDeepStrictEqual } = require('node:util');

// Reviewed manifest shared by collection initialization and runtime readiness.
// Any model or collection-name change must be reviewed here.
const EXPECTED_COLLECTION_INVENTORY = Object.freeze([
  ['AcademicYear', 'academicyears'],
  ['Achievement', 'achievements'],
  ['Admission', 'admissions'],
  ['AdmissionSagaAttempt', 'admissionsagaattempts'],
  ['Attendance', 'attendances'],
  ['AuditLog', 'auditlogs'],
  ['Bus', 'buses'],
  ['Class', 'classes'],
  ['Complaint', 'complaints'],
  ['Counter', 'counters'],
  ['EmailDelivery', 'emaildeliveries'],
  ['Event', 'events'],
  ['Exam', 'exams'],
  ['Faculty', 'faculties'],
  ['FeeStructure', 'feestructures'],
  ['Homework', 'homeworks'],
  ['LeaveRequest', 'leaverequests'],
  ['LibraryBook', 'librarybooks'],
  ['LibraryTransaction', 'librarytransactions'],
  ['Marks', 'marks'],
  ['Message', 'messages'],
  ['Notice', 'notices'],
  ['Notification', 'notifications'],
  ['Parent', 'parents'],
  ['Payment', 'payments'],
  ['RolloverExecution', 'rolloverexecutions'],
  ['Route', 'routes'],
  ['SchoolSettings', 'schoolsettings'],
  ['Student', 'students'],
  ['StudentFee', 'studentfees'],
  ['Subject', 'subjects'],
  ['SubjectAllocation', 'subjectallocations'],
  ['Timetable', 'timetables'],
  ['TransportAssignment', 'transportassignments'],
  ['User', 'users'],
  ['WebsiteContent', 'websitecontents'],
  ['WorkerLease', 'workerleases'],
].map(([modelName, collectionName]) => Object.freeze({ modelName, collectionName })));

function fail(code) {
  const error = new Error(code);
  error.name = 'ProductionModelInventoryError';
  error.safeCode = code;
  throw error;
}

function resolveCollectionInventory(models) {
  if (!Array.isArray(models)) {
    fail('MODEL_INVENTORY_UNAVAILABLE');
  }

  const inventory = models.map((model) => {
    const modelName = model?.modelName;
    const collectionName = model?.collection?.collectionName;
    if (typeof modelName !== 'string' || !/^[A-Za-z][A-Za-z0-9_]*$/.test(modelName) ||
        typeof collectionName !== 'string' || !/^[A-Za-z0-9_.-]+$/.test(collectionName)) {
      fail('MODEL_COLLECTION_NAME_INVALID');
    }
    return { modelName, collectionName };
  }).sort((left, right) => left.modelName.localeCompare(right.modelName));

  const modelNames = new Set();
  const collectionNames = new Set();
  for (const item of inventory) {
    if (modelNames.has(item.modelName) || collectionNames.has(item.collectionName)) {
      fail('MODEL_COLLECTION_INVENTORY_DUPLICATE');
    }
    modelNames.add(item.modelName);
    collectionNames.add(item.collectionName);
  }
  return inventory;
}

function assertReviewedCollectionInventory(models) {
  const inventory = resolveCollectionInventory(models);
  if (!isDeepStrictEqual(inventory, EXPECTED_COLLECTION_INVENTORY)) {
    fail('MODEL_INVENTORY_MISMATCH');
  }
  return inventory;
}

function requireModelModule(modelName) {
  return require(path.join(__dirname, '..', 'models', `${modelName}.js`));
}

function loadProductionModels(mongoose, requireModel = requireModelModule) {
  if (!mongoose || !mongoose.models || typeof requireModel !== 'function') {
    fail('MODEL_REGISTRY_UNAVAILABLE');
  }

  const models = EXPECTED_COLLECTION_INVENTORY.map(({ modelName }) => {
    // Reuse an already-registered model. Otherwise, loading the canonical model
    // module registers it once; Node's module cache prevents duplicate compile.
    const registered = mongoose.models[modelName];
    const model = registered || requireModel(modelName);
    if (!model || model.modelName !== modelName || mongoose.models[modelName] !== model) {
      fail('MODEL_REGISTRATION_MISMATCH');
    }
    return model;
  });

  assertReviewedCollectionInventory(models);
  return models;
}

module.exports = {
  EXPECTED_COLLECTION_INVENTORY,
  assertReviewedCollectionInventory,
  loadProductionModels,
  resolveCollectionInventory,
};
