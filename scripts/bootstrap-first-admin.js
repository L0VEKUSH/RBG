'use strict';

const mongoose = require('mongoose');
const readline = require('readline');
const {
  parseBootstrapArguments,
  executeFirstAdminBootstrap,
} = require('../utils/bootstrap-first-admin');
const {
  parseMongoTarget,
  formatTargetIdentity,
} = require('../utils/production-index-provisioning');
const { configureMongooseForEnvironment } = require('../utils/mongoose-connection-options');

const User = require('../models/User');
const AuditLog = require('../models/AuditLog');
const WorkerLease = require('../models/WorkerLease');

function safeErrorCode(error) {
  const candidate = error && error.safeCode;
  return typeof candidate === 'string' && /^[A-Z0-9_-]{1,64}$/.test(candidate)
    ? candidate
    : 'FIRST_ADMIN_BOOTSTRAP_FAILED';
}

async function promptHiddenPassword(promptText = 'Enter First Administrator Password: ') {
  if (process.env.BOOTSTRAP_ADMIN_PASSWORD) {
    return process.env.BOOTSTRAP_ADMIN_PASSWORD;
  }

  if (!process.stdin.isTTY) {
    const error = new Error('BOOTSTRAP_ADMIN_PASSWORD environment variable is required in non-interactive sessions.');
    error.safeCode = 'PASSWORD_REQUIRED';
    throw error;
  }

  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    process.stdout.write(promptText);

    // Turn off terminal echoing
    if (process.stdin.setRawMode) {
      process.stdin.setRawMode(true);
    }

    let password = '';
    process.stdin.on('data', function onData(chunk) {
      const char = chunk.toString('utf8');
      if (char === '\n' || char === '\r' || char === '\u0004') {
        if (process.stdin.setRawMode) process.stdin.setRawMode(false);
        process.stdout.write('\n');
        process.stdin.removeListener('data', onData);
        rl.close();
        resolve(password);
      } else if (char === '\u0003') {
        // Ctrl+C
        process.exit(1);
      } else if (char === '\b' || char === '\x7f') {
        // Backspace
        if (password.length > 0) {
          password = password.slice(0, -1);
        }
      } else {
        password += char;
      }
    });
  });
}

async function main() {
  const args = parseBootstrapArguments(process.argv.slice(2));
  const nodeEnv = process.env.NODE_ENV || 'development';

  // Read the secret only from the invoking process environment. Do not load
  // dotenv files or accept a URI on the command line.
  if (!process.env.MONGO_URI) {
    const error = new Error('MONGO_URI is required in the environment.');
    error.safeCode = 'MONGO_URI_REQUIRED';
    throw error;
  }

  const target = parseMongoTarget(process.env.MONGO_URI);

  // Validate expected target against parsed MONGO_URI
  if (args.expectedHost !== target.host ||
      args.expectedPort !== target.port ||
      args.expectedDatabase !== target.databaseName) {
    const error = new Error(`Target identity mismatch: expected ${args.expectedHost}:${args.expectedPort}/${args.expectedDatabase}, but MONGO_URI targets ${target.host}:${target.port}/${target.databaseName}.`);
    error.safeCode = 'TARGET_IDENTITY_MISMATCH';
    throw error;
  }

  if (!args.name || !args.email) {
    const error = new Error('Missing required arguments: --name=<name> and --email=<email> are required.');
    error.safeCode = 'MISSING_ADMIN_CREDENTIALS';
    throw error;
  }

  let password;
  if (args.execute) {
    password = await promptHiddenPassword();
  } else {
    // In dry-run mode, dummy password satisfying length & complexity is used for dry validation
    password = process.env.BOOTSTRAP_ADMIN_PASSWORD || 'DryRunValid123!@#';
  }

  // Scrub password from process.env immediately after retrieval
  if (process.env.BOOTSTRAP_ADMIN_PASSWORD) {
    delete process.env.BOOTSTRAP_ADMIN_PASSWORD;
  }

  const input = {
    name: args.name,
    email: args.email,
    password,
    role: args.role,
    phone: args.phone,
  };

  const connectionOptions = configureMongooseForEnvironment(mongoose, nodeEnv);
  let connected = false;

  try {
    await mongoose.connect(process.env.MONGO_URI, connectionOptions);
    connected = true;

    console.log(`[BOOTSTRAP] Target: ${formatTargetIdentity(target)} | Mode: ${args.execute ? 'EXECUTE' : 'DRY-RUN'}`);

    const result = await executeFirstAdminBootstrap(
      { User, AuditLog, WorkerLease },
      input,
      { execute: args.execute, connection: mongoose.connection }
    );

    if (result.mode === 'dry-run') {
      console.log('✅ [DRY-RUN] Target database is eligible for first-admin bootstrap.');
      console.log(`   Proposed Administrator: ${result.admin.name} <${result.admin.email}> [role: ${result.admin.role}]`);
      console.log('   Zero records were modified. Pass --execute, --confirm-production-target, and --confirm-bootstrap-first-admin to create.');
    } else {
      console.log('🎉 [SUCCESS] First privileged administrator created successfully.');
      console.log(`   ID: ${result.admin.id}`);
      console.log(`   Name: ${result.admin.name}`);
      console.log(`   Email: ${result.admin.email}`);
      console.log(`   Role: ${result.admin.role}`);
      console.log('   AuditLog entry recorded.');
    }
  } finally {
    if (connected) {
      await mongoose.disconnect().catch(() => {});
    }
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`First administrator bootstrap stopped [${safeErrorCode(error)}]: ${error.message}`);
    process.exit(1);
  });
}

module.exports = { main, promptHiddenPassword };
