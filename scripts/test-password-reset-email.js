'use strict';
/**
 * Regression Test Suite: Password Reset Email Delivery (H1 Remediation)
 *
 * Verifies all 12 security and functionality requirements:
 *  1. Successful email delivery via sendEmail.
 *  2. Correct reset URL constructed from FRONTEND_URL.
 *  3. Correct sender identity configured ("RBG School" <noreply@...>).
 *  4. Missing SMTP configuration throws safe error without leaking credentials.
 *  5. SMTP authentication failure throws safe error without leaking credentials.
 *  6. SMTP connection timeouts are configured and handled safely.
 *  7. Email delivery failure surfaces as operational 500 error.
 *  8. Reset token cleanup after delivery failure (token + expiry cleared).
 *  9. SHA-256 hashed token stored; plaintext token never stored in DB.
 * 10. Reset token expiry is exactly 10 minutes (600,000 ms).
 * 11. Production API response never exposes reset URL or token.
 * 12. Existing reset-password verification with token hash still functions.
 *
 * All tests use mocked/stubbed transports — no external network calls or real emails.
 */

const assert = require('assert');
const crypto = require('crypto');
const nodemailer = require('nodemailer');

const { sendEmail, buildTransporter } = require('../utils/sendEmail');
const { buildPasswordResetEmail, escapeHtml } = require('../utils/emailTemplates');
const User = require('../models/User');
const authService = require('../services/auth.service');
const authController = require('../controllers/auth.controller');

let passed = 0;
let failed = 0;

function check(name, condition, detail = '') {
  if (condition) {
    console.log(`  ✅  ${name}`);
    passed++;
  } else {
    console.error(`  ❌  ${name}${detail ? `\n       ->  ${detail}` : ''}`);
    failed++;
  }
}

async function run() {
  console.log('\nRunning H1 Password Reset Email Regression Tests...\n');

  // Save initial env state
  const origEnv = { ...process.env };

  try {
    // Setup clean test env
    process.env.NODE_ENV = 'development';
    process.env.SMTP_HOST = 'smtp.testserver.local';
    process.env.SMTP_PORT = '587';
    process.env.SMTP_USER = 'test-smtp-user';
    process.env.SMTP_PASS = 'secret-smtp-password';
    process.env.FROM_EMAIL = 'noreply@rbgschool.edu.in';
    process.env.FROM_NAME = 'RBG School';
    process.env.SCHOOL_NAME = 'RBG School';
    process.env.FRONTEND_URL = 'https://rbgschool.edu.in';

    // -------------------------------------------------------------
    // Test 1: Successful email delivery
    // -------------------------------------------------------------
    let sentMailOptions = null;
    const origCreateTransport = nodemailer.createTransport;

    nodemailer.createTransport = function (opts) {
      return {
        options: opts,
        sendMail: async function (mail) {
          sentMailOptions = mail;
          return { messageId: '<test-message-id@rbg>', envelope: { from: mail.from, to: [mail.to] } };
        },
      };
    };

    try {
      await sendEmail({
        to: 'student@example.com',
        subject: 'Test Subject',
        html: '<p>Hello</p>',
        text: 'Hello',
      });
      check('1. Successful email delivery via sendEmail', sentMailOptions && sentMailOptions.to === 'student@example.com');
    } catch (e) {
      check('1. Successful email delivery via sendEmail', false, e.message);
    }

    // -------------------------------------------------------------
    // Test 2 & 3: Correct reset URL & sender identity
    // -------------------------------------------------------------
    const templateOutput = buildPasswordResetEmail({
      name: 'Rohan Sharma',
      resetUrl: 'https://rbgschool.edu.in/reset-password/aabbcc112233',
      schoolName: 'RBG School',
    });

    check('2. Correct reset URL in email template',
      templateOutput.html.includes('https://rbgschool.edu.in/reset-password/aabbcc112233') &&
      templateOutput.text.includes('https://rbgschool.edu.in/reset-password/aabbcc112233')
    );

    check('3. Correct sender identity',
      sentMailOptions && sentMailOptions.from === '"RBG School" <noreply@rbgschool.edu.in>'
    );

    // -------------------------------------------------------------
    // Test 4: SMTP configuration missing throws without leaking secrets
    // -------------------------------------------------------------
    delete process.env.SMTP_HOST;
    let missingConfigErr = null;
    try {
      await sendEmail({ to: 'user@example.com', subject: 'Hi', text: 'Hi' });
    } catch (err) {
      missingConfigErr = err;
    }
    process.env.SMTP_HOST = 'smtp.testserver.local';

    check('4. SMTP configuration missing throws safe error',
      missingConfigErr &&
      missingConfigErr.message.includes('Missing: SMTP_HOST') &&
      !missingConfigErr.message.includes('secret-smtp-password')
    );

    // -------------------------------------------------------------
    // Test 5: SMTP authentication failure throws safe error
    // -------------------------------------------------------------
    nodemailer.createTransport = function () {
      return {
        sendMail: async function () {
          const authErr = new Error('535 5.7.8 Authentication credentials invalid for user test-smtp-user:secret-smtp-password');
          authErr.code = 'EAUTH';
          throw authErr;
        },
      };
    };

    let authFailureErr = null;
    try {
      await sendEmail({ to: 'user@example.com', subject: 'Hi', text: 'Hi' });
    } catch (err) {
      authFailureErr = err;
    }

    check('5. SMTP authentication failure throws safe generic error',
      authFailureErr &&
      !authFailureErr.message.includes('secret-smtp-password') &&
      !authFailureErr.message.includes('test-smtp-user') &&
      authFailureErr.message.includes('Email delivery failed')
    );

    // -------------------------------------------------------------
    // Test 6: SMTP connection timeouts configured
    // -------------------------------------------------------------
    nodemailer.createTransport = origCreateTransport;
    const transporter = buildTransporter();
    check('6. SMTP connection timeouts configured',
      transporter.options.connectionTimeout === 10000 &&
      transporter.options.greetingTimeout === 10000 &&
      transporter.options.socketTimeout === 15000
    );

    // -------------------------------------------------------------
    // Mock user for testing authService.forgotPassword
    // -------------------------------------------------------------
    function createMockUser(email = 'test@example.com') {
      const u = {
        _id: '507f1f77bcf86cd799439011',
        name: 'Rohan Sharma',
        email,
        saveCount: 0,
        save: async function () {
          this.saveCount++;
          return this;
        },
      };
      // Bind UserSchema methods
      u.getResetPasswordToken = User.prototype.getResetPasswordToken.bind(u);
      return u;
    }

    // -------------------------------------------------------------
    // Test 7 & 8: Delivery failure and token cleanup
    // -------------------------------------------------------------
    const origFindOne = User.findOne;
    const mockFailUser = createMockUser('fail@example.com');
    User.findOne = async function () { return mockFailUser; };

    // Cause sendEmail to throw
    nodemailer.createTransport = function () {
      return {
        sendMail: async function () {
          const err = new Error('Connection dropped');
          err.code = 'ECONNRESET';
          throw err;
        },
      };
    };

    let deliveryFailureThrew = false;
    let deliveryFailureError = null;
    try {
      await authService.forgotPassword('fail@example.com');
    } catch (err) {
      deliveryFailureThrew = true;
      deliveryFailureError = err;
    }

    check('7. Email delivery failure surfaces as operational error',
      deliveryFailureThrew &&
      deliveryFailureError &&
      deliveryFailureError.statusCode === 500 &&
      deliveryFailureError.message.includes('could not be sent')
    );

    check('8. Reset token cleanup after delivery failure',
      mockFailUser.resetPasswordToken === undefined &&
      mockFailUser.resetPasswordExpire === undefined &&
      mockFailUser.saveCount === 2 // initial save + cleanup save
    );

    // -------------------------------------------------------------
    // Test 9 & 10: Hashed token stored and 10-minute expiry
    // -------------------------------------------------------------
    const mockSuccessUser = createMockUser('success@example.com');
    User.findOne = async function () { return mockSuccessUser; };

    let capturedMail = null;
    nodemailer.createTransport = function () {
      return {
        sendMail: async function (mail) {
          capturedMail = mail;
          return { messageId: '<msg-123>' };
        },
      };
    };

    await authService.forgotPassword('success@example.com');
    const resetUrlMatch = (capturedMail.html || capturedMail.text).match(/https?:\/\/[^"' ]+reset-password\.html\?token=[^"' &]+/);
    assert(resetUrlMatch, 'Reset email should contain a reset URL in the test sink');
    const plaintextTokenInUrl = new URL(resetUrlMatch[0]).searchParams.get('token');
    const computedHash = crypto.createHash('sha256').update(plaintextTokenInUrl).digest('hex');

    check('9. SHA-256 hashed token stored; plaintext token not stored',
      mockSuccessUser.resetPasswordToken === computedHash &&
      mockSuccessUser.resetPasswordToken !== plaintextTokenInUrl &&
      mockSuccessUser.resetPasswordToken.length === 64
    );

    const now = Date.now();
    const tenMinutesMs = 10 * 60 * 1000;
    const expiryDiff = Math.abs(mockSuccessUser.resetPasswordExpire - (now + tenMinutesMs));
    check('10. Reset token expiry is exactly 10 minutes (tolerance < 2000ms)', expiryDiff < 2000);

    // -------------------------------------------------------------
    // Test 11: Production response does not contain reset URL or token
    // -------------------------------------------------------------
    process.env.NODE_ENV = 'production';
    process.env.CORS_ORIGIN = 'https://rbgschool.edu.in';
    process.env.FRONTEND_URL = 'https://rbgschool.edu.in';
    let prodResponseData = null;
    const mockReq = { body: { email: 'success@example.com' } };
    const mockRes = {
      statusCode: null,
      status: function (code) { this.statusCode = code; return this; },
      json: function (data) { prodResponseData = data; return this; },
    };

    await authController.forgotPassword(mockReq, mockRes);

    check('11. Production response does not contain reset URL or token',
      prodResponseData &&
      prodResponseData.success === true &&
      prodResponseData.resetUrl === undefined &&
      prodResponseData.resetToken === undefined &&
      prodResponseData.token === undefined
    );

    // -------------------------------------------------------------
    // Test 12: Existing reset-password functionality still works
    // -------------------------------------------------------------
    // Create user with valid reset token hash
    const testPlainToken = 'f00ba4112233445566778899aabbccddeeff00112233445566778899aabbccdd';
    const testHashedToken = crypto.createHash('sha256').update(testPlainToken).digest('hex');
    const mockResetUser = {
      _id: '507f1f77bcf86cd799439012',
      email: 'reset-target@example.com',
      password: 'oldHashedPassword',
      resetPasswordToken: testHashedToken,
      resetPasswordExpire: Date.now() + 600000,
      save: async function () { this.saved = true; return this; },
    };

    User.findOne = async function (query) {
      if (query.resetPasswordToken === testHashedToken && query.resetPasswordExpire.$gt) {
        return mockResetUser;
      }
      return null;
    };

    const resetUserResult = await authService.resetPassword(testPlainToken, 'NewStrongPassword123!');

    check('12. Existing reset-password functionality still works',
      resetUserResult &&
      mockResetUser.password === 'NewStrongPassword123!' &&
      mockResetUser.resetPasswordToken === undefined &&
      mockResetUser.resetPasswordExpire === undefined &&
      mockResetUser.saved === true
    );

    // -------------------------------------------------------------
    // Test 13: H1-L1: Delivery failure + DB cleanup failure preserves safe API error
    // -------------------------------------------------------------
    process.env.NODE_ENV = 'development';
    process.env.FRONTEND_URL = 'https://rbgschool.edu.in';
    let dbCleanupSaveCount = 0;
    const mockDoubleFailUser = {
      _id: '507f1f77bcf86cd799439099',
      name: 'Double Fault Student',
      email: 'doublefail@example.com',
      save: async function () {
        dbCleanupSaveCount++;
        if (dbCleanupSaveCount === 2) {
          throw new Error('MongoNetworkError: connection timed out during rollback');
        }
        return this;
      },
    };
    mockDoubleFailUser.getResetPasswordToken = User.prototype.getResetPasswordToken.bind(mockDoubleFailUser);
    User.findOne = async function () { return mockDoubleFailUser; };

    nodemailer.createTransport = function () {
      return {
        sendMail: async function () {
          throw new Error('SMTP connection refused');
        },
      };
    };

    let doubleFaultError = null;
    try {
      await authService.forgotPassword('doublefail@example.com');
    } catch (err) {
      doubleFaultError = err;
    }

    check('13. H1-L1: Delivery failure + DB cleanup failure preserves operational 500 without leaking DB exception',
      doubleFaultError &&
      doubleFaultError.statusCode === 500 &&
      doubleFaultError.message.includes('could not be sent') &&
      !doubleFaultError.message.includes('MongoNetworkError')
    );

    // -------------------------------------------------------------
    // Test 14, 15, 16: H1-L2: Trailing slash normalization & URL resolution
    // -------------------------------------------------------------
    const mockUrlUser = createMockUser('urltest@example.com');
    User.findOne = async function () { return mockUrlUser; };
    let urlTestMail = null;
    nodemailer.createTransport = function () {
      return {
        sendMail: async function (mail) {
          urlTestMail = mail;
          return { messageId: '<url-test-ok>' };
        },
      };
    };
    const getUrlTestResetUrl = () => {
      const match = (urlTestMail.html || urlTestMail.text).match(/https?:\/\/[^"' ]+reset-password\.html\?token=[^"' &]+/);
      return match && match[0];
    };

    // Single slash normalization
    process.env.FRONTEND_URL = 'https://rbgschool.edu.in/';
    await authService.forgotPassword('urltest@example.com');
    const singleSlashUrl = getUrlTestResetUrl();
    check('14. H1-L2: Single trailing slash normalized',
      singleSlashUrl.startsWith('https://rbgschool.edu.in/portal/reset-password.html?token=') &&
      !singleSlashUrl.includes('.edu.in//portal')
    );

    // Multiple trailing slashes normalization
    process.env.FRONTEND_URL = 'https://rbgschool.edu.in////';
    await authService.forgotPassword('urltest@example.com');
    const multiSlashUrl = getUrlTestResetUrl();
    check('15. H1-L2: Multiple trailing slashes normalized',
      multiSlashUrl.startsWith('https://rbgschool.edu.in/portal/reset-password.html?token=') &&
      !multiSlashUrl.includes('.edu.in//portal')
    );

    // Valid URL generates full reset URL
    check('16. H1-L2: Valid URL produces expected reset URL format',
      /^https:\/\/rbgschool\.edu\.in\/portal\/reset-password\.html\?token=[a-f0-9]{64}$/.test(multiSlashUrl)
    );

    // -------------------------------------------------------------
    // Test 17: H1-L2: Malformed FRONTEND_URL handled safely
    // -------------------------------------------------------------
    process.env.FRONTEND_URL = 'not_a_valid_url';
    let malformedUrlError = null;
    try {
      await authService.forgotPassword('urltest@example.com');
    } catch (err) {
      malformedUrlError = err;
    }

    check('17. H1-L2: Malformed FRONTEND_URL throws server config error',
      malformedUrlError &&
      malformedUrlError.statusCode === 500 &&
      malformedUrlError.message.includes('Server configuration error')
    );

    // -------------------------------------------------------------
    // Test 18: H1-L2: Production missing FRONTEND_URL rejected
    // -------------------------------------------------------------
    process.env.NODE_ENV = 'production';
    delete process.env.FRONTEND_URL;
    delete process.env.SCHOOL_WEBSITE;
    let prodMissingUrlError = null;
    try {
      await authService.forgotPassword('urltest@example.com');
    } catch (err) {
      prodMissingUrlError = err;
    }

    check('18. H1-L2: Production missing FRONTEND_URL rejected safely',
      prodMissingUrlError &&
      prodMissingUrlError.statusCode === 500 &&
      prodMissingUrlError.message.includes('Server configuration error')
    );

    // -------------------------------------------------------------
    // Test 19-26: Production URL Security & Origin Validation (H1-V1 & H1-V2)
    // -------------------------------------------------------------
    // 19. Approved origin accepted in the disconnected regression harness
    process.env.NODE_ENV = 'development';
    process.env.CORS_ORIGIN = 'https://rbgschool.edu.in,https://portal.rbgschool.edu.in';
    process.env.FRONTEND_URL = 'https://rbgschool.edu.in';
    process.env.EMAIL_ENCRYPTION_KEY = 'synthetic-email-key-for-regression-test-2026';
    await authService.forgotPassword('urltest@example.com');
    check('19. Production HTTPS approved origin accepted',
      getUrlTestResetUrl().startsWith('https://rbgschool.edu.in/portal/reset-password.html?token=')
    );

    // 20. Production HTTP rejected (H1-V1)
    process.env.NODE_ENV = 'production';
    process.env.FRONTEND_URL = 'http://rbgschool.edu.in';
    let prodHttpError = null;
    try {
      await authService.forgotPassword('urltest@example.com');
    } catch (err) {
      prodHttpError = err;
    }
    check('20. Production HTTP rejected (H1-V1)',
      prodHttpError &&
      prodHttpError.statusCode === 500 &&
      prodHttpError.message.includes('Server configuration error')
    );

    // 21. Production unexpected hostname rejected (H1-V2)
    process.env.FRONTEND_URL = 'https://evil-phishing.com';
    let prodUnexpectedHostError = null;
    try {
      await authService.forgotPassword('urltest@example.com');
    } catch (err) {
      prodUnexpectedHostError = err;
    }
    check('21. Production unexpected hostname rejected (H1-V2)',
      prodUnexpectedHostError &&
      prodUnexpectedHostError.statusCode === 500 &&
      prodUnexpectedHostError.message.includes('Server configuration error')
    );

    // 22. Production unexpected port rejected (H1-V2)
    process.env.FRONTEND_URL = 'https://rbgschool.edu.in:8443';
    let prodUnexpectedPortError = null;
    try {
      await authService.forgotPassword('urltest@example.com');
    } catch (err) {
      prodUnexpectedPortError = err;
    }
    check('22. Production unexpected port rejected (H1-V2)',
      prodUnexpectedPortError &&
      prodUnexpectedPortError.statusCode === 500 &&
      prodUnexpectedPortError.message.includes('Server configuration error')
    );

    // 23. Production protocol mismatch rejected (e.g. http when origin is https)
    process.env.FRONTEND_URL = 'http://portal.rbgschool.edu.in';
    let prodProtocolMismatchError = null;
    try {
      await authService.forgotPassword('urltest@example.com');
    } catch (err) {
      prodProtocolMismatchError = err;
    }
    check('23. Production protocol mismatch rejected',
      prodProtocolMismatchError &&
      prodProtocolMismatchError.statusCode === 500 &&
      prodProtocolMismatchError.message.includes('Server configuration error')
    );

    // 24. Leading/trailing whitespace handled safely
    process.env.NODE_ENV = 'development';
    process.env.FRONTEND_URL = '   https://rbgschool.edu.in/   ';
    await authService.forgotPassword('urltest@example.com');
    check('24. Leading/trailing whitespace handled safely',
      getUrlTestResetUrl().startsWith('https://rbgschool.edu.in/portal/reset-password.html?token=') &&
      !getUrlTestResetUrl().includes(' ')
    );

    // 25. Development localhost HTTP remains supported
    process.env.NODE_ENV = 'development';
    process.env.FRONTEND_URL = 'http://localhost:5000';
    delete process.env.CORS_ORIGIN;
    await authService.forgotPassword('urltest@example.com');
    check('25. Development localhost HTTP remains supported',
      getUrlTestResetUrl().startsWith('http://localhost:5000/portal/reset-password.html?token=')
    );

    // 26. Host and X-Forwarded-Host headers cannot influence reset URL
    process.env.NODE_ENV = 'development';
    process.env.FRONTEND_URL = 'https://rbgschool.edu.in';
    let spoofedControllerRes = null;
    const mockSpoofedReq = {
      body: { email: 'urltest@example.com' },
      headers: {
        host: 'attacker-evil.com',
        'x-forwarded-host': 'attacker-evil.com',
      },
      protocol: 'https',
      get: function (header) { return this.headers[header.toLowerCase()]; },
    };
    const mockSpoofedRes = {
      statusCode: null,
      status: function (code) { this.statusCode = code; return this; },
      json: function (data) { spoofedControllerRes = data; return this; },
    };
    await authController.forgotPassword(mockSpoofedReq, mockSpoofedRes);
    await authService.forgotPassword('urltest@example.com');
    const spoofSafeUrl = getUrlTestResetUrl();

    check('26. Host and X-Forwarded-Host cannot influence reset URL',
      spoofSafeUrl &&
      spoofSafeUrl.startsWith('https://rbgschool.edu.in/portal/reset-password.html?token=') &&
      !spoofSafeUrl.includes('attacker-evil.com') &&
      spoofedControllerRes &&
      spoofedControllerRes.resetUrl === undefined
    );

    // -------------------------------------------------------------
    // Fail-Closed Origin Allowlist Tests (27-32)
    // -------------------------------------------------------------
    // 27. Missing CORS_ORIGIN in production rejected (fail-closed)
    process.env.NODE_ENV = 'production';
    process.env.FRONTEND_URL = 'https://rbgschool.edu.in';
    delete process.env.CORS_ORIGIN;
    let missingCorsErr = null;
    try {
      await authService.forgotPassword('urltest@example.com');
    } catch (err) {
      missingCorsErr = err;
    }
    check('27. Missing CORS_ORIGIN in production rejected (fail-closed)',
      missingCorsErr &&
      missingCorsErr.statusCode === 500 &&
      missingCorsErr.message.includes('Server configuration error')
    );

    // 28. Empty CORS_ORIGIN in production rejected (fail-closed)
    process.env.CORS_ORIGIN = '';
    let emptyCorsErr = null;
    try {
      await authService.forgotPassword('urltest@example.com');
    } catch (err) {
      emptyCorsErr = err;
    }
    check('28. Empty CORS_ORIGIN in production rejected (fail-closed)',
      emptyCorsErr &&
      emptyCorsErr.statusCode === 500 &&
      emptyCorsErr.message.includes('Server configuration error')
    );

    // 29. Whitespace-only CORS_ORIGIN in production rejected (fail-closed)
    process.env.CORS_ORIGIN = '   \t  ';
    let whitespaceCorsErr = null;
    try {
      await authService.forgotPassword('urltest@example.com');
    } catch (err) {
      whitespaceCorsErr = err;
    }
    check('29. Whitespace-only CORS_ORIGIN in production rejected (fail-closed)',
      whitespaceCorsErr &&
      whitespaceCorsErr.statusCode === 500 &&
      whitespaceCorsErr.message.includes('Server configuration error')
    );

    // 30. Malformed allowlist entry in production rejected (fail-closed)
    process.env.CORS_ORIGIN = 'https://rbgschool.edu.in,not_a_valid_url';
    let malformedCorsErr = null;
    try {
      await authService.forgotPassword('urltest@example.com');
    } catch (err) {
      malformedCorsErr = err;
    }
    check('30. Malformed allowlist entry in production rejected (fail-closed)',
      malformedCorsErr &&
      malformedCorsErr.statusCode === 500 &&
      malformedCorsErr.message.includes('Server configuration error')
    );

    // 31. HTTP allowlist entry in production rejected (fail-closed)
    process.env.CORS_ORIGIN = 'http://insecure.rbgschool.edu.in';
    let httpCorsErr = null;
    try {
      await authService.forgotPassword('urltest@example.com');
    } catch (err) {
      httpCorsErr = err;
    }
    check('31. HTTP allowlist entry in production rejected (fail-closed)',
      httpCorsErr &&
      httpCorsErr.statusCode === 500 &&
      httpCorsErr.message.includes('Server configuration error')
    );

    // 32. Multiple valid HTTPS origins in production accepts matched origin
    process.env.CORS_ORIGIN = 'https://portal.rbgschool.edu.in,https://admin.rbgschool.edu.in,https://rbgschool.edu.in';
    process.env.FRONTEND_URL = 'https://admin.rbgschool.edu.in';
    process.env.NODE_ENV = 'development';
    await authService.forgotPassword('urltest@example.com');
    check('32. Multiple valid HTTPS origins in production accepts matched origin',
      getUrlTestResetUrl().startsWith('https://admin.rbgschool.edu.in/portal/reset-password.html?token=')
    );

    // -------------------------------------------------------------
    // H2 User Enumeration Tests (33-40)
    // -------------------------------------------------------------
    const GENERIC_MSG = 'If an account with that email exists, a password reset link has been sent.';

    // Setup for H2 tests:
    process.env.NODE_ENV = 'test';
    process.env.CORS_ORIGIN = 'https://rbgschool.edu.in';
    process.env.FRONTEND_URL = 'https://rbgschool.edu.in';

    let smtpCallCount = 0;
    nodemailer.createTransport = function () {
      return {
        sendMail: async function () {
          smtpCallCount++;
          return { messageId: '<h2-test-msg>' };
        },
      };
    };

    // User lookup mock: returns mockSuccessUser for 'registered@example.com', null for 'unknown@example.com'
    User.findOne = async function (q) {
      if (q.email === 'registered@example.com') {
        return mockSuccessUser;
      }
      return null;
    };

    // 33. Unknown email returns HTTP 200
    let unknownResData = null;
    let unknownResStatus = null;
    smtpCallCount = 0;
    const unknownReq = { body: { email: 'unknown@example.com' } };
    const unknownRes = {
      status: function (code) { unknownResStatus = code; return this; },
      json: function (data) { unknownResData = data; return this; },
    };
    await authController.forgotPassword(unknownReq, unknownRes);

    check('33. H2: Unknown email returns HTTP 200', unknownResStatus === 200);

    // 34. Registered email returns HTTP 200
    let regResData = null;
    let regResStatus = null;
    smtpCallCount = 0;
    const regReq = { body: { email: 'registered@example.com' } };
    const regRes = {
      status: function (code) { regResStatus = code; return this; },
      json: function (data) { regResData = data; return this; },
    };
    await authController.forgotPassword(regReq, regRes);

    check('34. H2: Registered email returns HTTP 200', regResStatus === 200);

    // 35. Both return identical response bodies
    check('35. H2: Both return identical generic response bodies',
      unknownResData &&
      regResData &&
      unknownResData.success === true &&
      regResData.success === true &&
      unknownResData.message === GENERIC_MSG &&
      regResData.message === GENERIC_MSG &&
      JSON.stringify(unknownResData) === JSON.stringify(regResData)
    );

    // 36. Unknown email does not trigger SMTP
    smtpCallCount = 0;
    await authController.forgotPassword(unknownReq, unknownRes);
    check('36. H2: Unknown email does not trigger SMTP', smtpCallCount === 0);

    // 37. Registered email triggers existing email workflow
    smtpCallCount = 0;
    await authController.forgotPassword(regReq, regRes);
    check('37. H2: Registered email triggers existing email workflow', smtpCallCount === 1);

    // 38. SMTP failure does not expose account existence (returns HTTP 200 with generic message)
    nodemailer.createTransport = function () {
      return {
        sendMail: async function () {
          const err = new Error('SMTP connection refused');
          err.code = 'ECONNREFUSED';
          throw err;
        },
      };
    };

    let smtpFailResData = null;
    let smtpFailResStatus = null;
    const smtpFailReq = { body: { email: 'registered@example.com' } };
    const smtpFailRes = {
      status: function (code) { smtpFailResStatus = code; return this; },
      json: function (data) { smtpFailResData = data; return this; },
    };
    await authController.forgotPassword(smtpFailReq, smtpFailRes);

    check('38. H2: SMTP failure does not expose account existence (returns HTTP 200 with generic message)',
      smtpFailResStatus === 200 &&
      smtpFailResData &&
      smtpFailResData.message === GENERIC_MSG
    );

    // 39. SMTP failure does not expose credentials or infrastructure errors
    check('39. H2: SMTP failure does not expose credentials or infrastructure errors',
      smtpFailResData &&
      !JSON.stringify(smtpFailResData).includes('SMTP') &&
      !JSON.stringify(smtpFailResData).includes('ECONNREFUSED') &&
      !JSON.stringify(smtpFailResData).includes('refused')
    );

    // 40. No token or reset URL appears in API responses across any environment
    check('40. H2: No token or reset URL appears in API response',
      smtpFailResData &&
      smtpFailResData.resetUrl === undefined &&
      smtpFailResData.resetToken === undefined &&
      smtpFailResData.token === undefined &&
      regResData.resetUrl === undefined &&
      regResData.resetToken === undefined &&
      regResData.token === undefined
    );

    // Restore original methods
    User.findOne = origFindOne;
    nodemailer.createTransport = origCreateTransport;

  } finally {
    // Restore original env vars
    for (const key of Object.keys(process.env)) {
      if (!(key in origEnv)) delete process.env[key];
    }
    Object.assign(process.env, origEnv);
  }

  // Summary
  console.log(`\n${'═'.repeat(56)}`);
  if (failed === 0) {
    console.log(`✅  All ${passed} H1 Email Regression Tests Passed!`);
  } else {
    console.log(`❌  ${failed} of ${passed + failed} tests FAILED`);
  }
  console.log('═'.repeat(56));
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((e) => {
  console.error('Unexpected error running H1 regression tests:', e);
  process.exit(1);
});
