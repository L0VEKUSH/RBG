'use strict';
/**
 * Nodemailer v10 upgrade smoke test.
 * Uses only built-in transports — no SMTP, no real email, no network.
 * Safe to run without SMTP credentials.
 */

let passed = 0;
let failed = 0;

function check(name, condition, detail = '') {
  if (condition) {
    console.log(`  ✅  ${name}`);
    passed++;
  } else {
    console.error(`  ❌  ${name}${detail ? `\n       ↳  ${detail}` : ''}`);
    failed++;
  }
}

async function run() {
  console.log('\nRunning Nodemailer v10 Regression Tests...\n');

  // 1. Module loads with require()
  let nm;
  try {
    nm = require('nodemailer');
    check('1. require("nodemailer") succeeds', true);
  } catch (e) {
    check('1. require("nodemailer") succeeds', false, e.message);
    process.exit(1);
  }

  // 2. Core API exports present
  check('2a. createTransport is a function', typeof nm.createTransport === 'function');
  check('2b. createTestAccount is a function', typeof nm.createTestAccount === 'function');
  check('2c. getTestMessageUrl is a function', typeof nm.getTestMessageUrl === 'function');

  // 3. JSON transport (no network, no SMTP)
  let transporter;
  try {
    transporter = nm.createTransport({ jsonTransport: true });
    check('3. createTransport({ jsonTransport: true }) succeeds', !!transporter);
  } catch (e) {
    check('3. createTransport({ jsonTransport: true }) succeeds', false, e.message);
    process.exit(1);
  }

  // 4. sendMail round-trip via JSON transport
  try {
    const info = await transporter.sendMail({
      from: '"Test Sender" <test@example.com>',
      to: 'recipient@example.com',
      subject: 'Nodemailer v10 Regression Test',
      text: 'This is a local regression test — no email was sent.',
    });
    check('4a. sendMail() resolves without error', !!info);
    check('4b. response contains envelope', !!info.envelope);
    check('4c. envelope.from is set', !!(info.envelope && info.envelope.from));
    check('4d. envelope.to is an array', Array.isArray(info.envelope && info.envelope.to));
    check('4e. envelope.to contains recipient', !!(info.envelope && info.envelope.to && info.envelope.to.includes('recipient@example.com')));
  } catch (e) {
    check('4a. sendMail() resolves without error', false, e.message);
    ['4b','4c','4d','4e'].forEach(n => { check(`${n}. (skipped due to 4a failure)`, false, 'sendMail threw'); });
  }

  // 5. Version sanity
  let pkg;
  try {
    pkg = require('nodemailer/package.json');
  } catch {
    pkg = { version: 'unknown' };
  }
  const [major] = (pkg.version || '0').split('.').map(Number);
  check(`5. Installed version is v10.x (got ${pkg.version})`, major === 10);

  // Summary
  console.log(`\n${'═'.repeat(52)}`);
  if (failed === 0) {
    console.log(`✅  All ${passed} Nodemailer Regression Tests Passed!`);
  } else {
    console.log(`❌  ${failed} of ${passed + failed} tests FAILED`);
  }
  console.log('═'.repeat(52));
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((e) => { console.error('Unexpected error:', e); process.exit(1); });
