'use strict';

const mongoose = require('mongoose');
const {
  validateBaselineData,
} = require('../utils/validate-baseline-data');
const {
  parseArguments,
  parseMongoTarget,
  formatTargetIdentity,
} = require('../utils/production-index-provisioning');
const { configureMongooseForEnvironment } = require('../utils/mongoose-connection-options');

const AcademicYear = require('../models/AcademicYear');
const Class = require('../models/Class');
const Subject = require('../models/Subject');
const Faculty = require('../models/Faculty');
const SubjectAllocation = require('../models/SubjectAllocation');
const SchoolSettings = require('../models/SchoolSettings');

function safeErrorCode(error) {
  const candidate = error && error.safeCode;
  return typeof candidate === 'string' && /^[A-Z0-9_-]{1,64}$/.test(candidate)
    ? candidate
    : 'BASELINE_VALIDATION_FAILED';
}

function printValidationReport(result, target) {
  console.log(`\n======================================================`);
  console.log(`BASELINE DATA VALIDATION REPORT`);
  console.log(`Target: ${formatTargetIdentity(target)}`);
  console.log(`Active Academic Year: ${result.activeAcademicYear || 'NONE'}`);
  console.log(`Status: ${result.valid ? 'VALID (Ready for workflows)' : 'INVALID (Blocking issues detected)'}`);
  console.log(`======================================================`);

  console.log(`\nEntity Counts:`);
  console.log(`  - Academic Years:    ${result.summary.academicYearCount}`);
  console.log(`  - Classes:           ${result.summary.classCount}`);
  console.log(`  - Subjects:          ${result.summary.subjectCount}`);
  console.log(`  - Subject Allocations: ${result.summary.allocationCount}`);
  console.log(`  - School Settings:   ${result.summary.settingsCount}`);
  console.log(`  - Errors:            ${result.summary.errorCount}`);
  console.log(`  - Warnings:          ${result.summary.warningCount}`);

  if (result.errors.length > 0) {
    console.log(`\n❌ ERRORS (${result.errors.length}):`);
    for (const err of result.errors) {
      console.log(`  [${err.entity}] ${err.code}: ${err.message}`);
    }
  }

  if (result.warnings.length > 0) {
    console.log(`\n⚠️  WARNINGS (${result.warnings.length}):`);
    for (const warn of result.warnings) {
      console.log(`  [${warn.entity}] ${warn.code}: ${warn.message}`);
    }
  }

  console.log(`======================================================\n`);
}

async function main() {
  const args = parseArguments(process.argv.slice(2));
  const nodeEnv = process.env.NODE_ENV || 'development';

  if (!process.env.MONGO_URI) {
    const error = new Error('MONGO_URI is required in the environment.');
    error.safeCode = 'MONGO_URI_REQUIRED';
    throw error;
  }

  const target = parseMongoTarget(process.env.MONGO_URI);

  if (args.expectedHost !== target.host ||
      args.expectedPort !== target.port ||
      args.expectedDatabase !== target.databaseName) {
    const error = new Error(`Target identity mismatch: expected ${args.expectedHost}:${args.expectedPort}/${args.expectedDatabase}, but MONGO_URI targets ${target.host}:${target.port}/${target.databaseName}.`);
    error.safeCode = 'TARGET_IDENTITY_MISMATCH';
    throw error;
  }

  const connectionOptions = configureMongooseForEnvironment(mongoose, nodeEnv);
  let connected = false;

  try {
    await mongoose.connect(process.env.MONGO_URI, connectionOptions);
    connected = true;

    const result = await validateBaselineData({
      AcademicYear,
      Class,
      Subject,
      Faculty,
      SubjectAllocation,
      SchoolSettings,
    });

    printValidationReport(result, target);

    if (!result.valid) {
      process.exitCode = 1;
    }
  } finally {
    if (connected) {
      await mongoose.disconnect().catch(() => {});
    }
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`Baseline data validation stopped [${safeErrorCode(error)}]: ${error.message}`);
    process.exit(1);
  });
}

module.exports = { main, printValidationReport };
