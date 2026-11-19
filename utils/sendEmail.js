'use strict';
/**
 * sendEmail — reusable Nodemailer-based email utility for RBG School ERP.
 *
 * Security contract:
 *  - SMTP credentials are read exclusively from environment variables.
 *  - Credentials and tokens are NEVER logged.
 *  - Internal SMTP errors are wrapped before propagation so raw server
 *    messages (which may contain auth details) never reach API responses.
 *  - Caller is responsible for escaping HTML before calling this utility.
 */

const nodemailer = require('nodemailer');
const logger = require('./logger');
const { validateProductionEmailTransport } = require('./email-production-config');

/**
 * Build and return a Nodemailer transporter from environment variables.
 * Throws a descriptive (non-credential-exposing) Error if required config
 * is missing.
 *
 * Expected env vars (all optional with safe defaults except SMTP_HOST/USER/PASS):
 *   SMTP_HOST     — SMTP server hostname  (required)
 *   SMTP_PORT     — SMTP port (default 587)
 *   SMTP_SECURE   — 'true' for TLS on port 465, 'false' otherwise (default false)
 *   SMTP_USER     — SMTP username / email (required)
 *   SMTP_PASS     — SMTP password / app password (required)
 *   FROM_EMAIL    — Envelope From address (required)
 *   FROM_NAME     — Display name (default 'RBG School')
 */
function buildTransporter() {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER || process.env.SMTP_EMAIL; // support both naming conventions
  const pass = process.env.SMTP_PASS || process.env.SMTP_PASSWORD;
  const fromEmail = process.env.FROM_EMAIL;

  const missing = [];
  if (!host) missing.push('SMTP_HOST');
  if (!user) missing.push('SMTP_USER (or SMTP_EMAIL)');
  if (!pass) missing.push('SMTP_PASS (or SMTP_PASSWORD)');
  if (!fromEmail) missing.push('FROM_EMAIL');

  if (missing.length > 0) {
    const error = new Error('Email configuration is incomplete.');
    error.code = 'EMAIL_CONFIGURATION';
    error.retryable = false;
    throw error;
  }

  const port = parseInt(process.env.SMTP_PORT, 10) || 587;
  const secure = process.env.SMTP_SECURE === 'true'; // true = TLS (port 465); false = STARTTLS (587)

  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
    connectionTimeout: 10_000, // 10 s — fail fast rather than hanging
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
  });
}

const TRANSIENT_NETWORK_CODES = new Set([
  'ECONNECTION', 'ETIMEDOUT', 'ESOCKET', 'ECONNRESET', 'EHOSTUNREACH',
  'ENETUNREACH', 'EAI_AGAIN', 'ECONNREFUSED', 'EPIPE',
]);

function classifySmtpError(error) {
  const responseCode = Number(error && error.responseCode);
  if (responseCode >= 400 && responseCode < 500) return true;
  if (responseCode >= 500) return false;
  return Boolean(error && TRANSIENT_NETWORK_CODES.has(error.code));
}

/**
 * Send a single email.
 *
 * @param {object} options
 * @param {string}  options.to       — Recipient email address
 * @param {string}  options.subject  — Email subject line
 * @param {string}  options.html     — HTML body (caller must escape user values)
 * @param {string}  options.text     — Plain-text body (fallback for non-HTML clients)
 *
 * @returns {Promise<void>}
 * @throws  {Error} on configuration error or delivery failure (credentials stripped)
 */
async function sendEmail({ to, subject, html, text }) {
  // Validate arguments
  if (!to || !subject || (!html && !text)) {
    throw new Error('sendEmail: to, subject, and at least one of html/text are required.');
  }

  const transport = validateProductionEmailTransport(process.env, process.env.NODE_ENV);
  if (transport === 'json') {
    logger.info('Email sent through configured test sink [redacted]');
    return { messageId: 'synthetic-test-sink' };
  }

  let transporter;
  try {
    transporter = buildTransporter();
  } catch (err) {
    logger.error(`Email delivery configuration failed [${err.code || 'EMAIL_CONFIGURATION'}]`);
    const safeError = new Error('Email delivery configuration is invalid.');
    safeError.code = err.code || 'EMAIL_CONFIGURATION';
    safeError.deliveryCode = safeError.code;
    safeError.retryable = false;
    throw safeError;
  }

  const fromName = process.env.FROM_NAME || 'RBG School';
  const fromEmail = process.env.FROM_EMAIL;

  const mailOptions = {
    from: `"${fromName}" <${fromEmail}>`,
    to,
    subject,
    ...(html && { html }),
    ...(text && { text }),
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    // Log only non-sensitive delivery metadata
    logger.info('Email sent to [redacted]');
    return { messageId: info.messageId };
  } catch (err) {
    const code = typeof err.code === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(err.code)
      ? err.code
      : 'SMTP_ERROR';
    logger.error(`Email delivery failed [${code}]`);
    const safeError = new Error('Email delivery failed.');
    safeError.code = code;
    safeError.deliveryCode = code;
    safeError.responseCode = Number.isInteger(Number(err.responseCode)) ? Number(err.responseCode) : undefined;
    safeError.retryable = classifySmtpError(err);
    throw safeError;
  }
}

module.exports = { classifySmtpError, sendEmail, buildTransporter };
