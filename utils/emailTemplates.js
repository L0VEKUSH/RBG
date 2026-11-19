'use strict';
/**
 * Email templates for RBG School ERP.
 * All user-controlled values are HTML-escaped before insertion.
 */

/**
 * Escape a string for safe insertion into HTML.
 * Covers the five characters that can break out of text/attribute context.
 * @param {string} str
 * @returns {string}
 */
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

/**
 * Build the password-reset email (HTML + plain-text).
 *
 * @param {object} opts
 * @param {string} opts.name       — Recipient display name (user-controlled, will be escaped)
 * @param {string} opts.resetUrl   — Full password-reset URL (validated before use)
 * @param {string} opts.schoolName — School display name (env-controlled)
 * @returns {{ subject: string, html: string, text: string }}
 */
function buildPasswordResetEmail({ name, resetUrl, schoolName = 'RBG School' }) {
  const safeName = escapeHtml(name);
  const safeSchool = escapeHtml(schoolName);
  // resetUrl comes from server-constructed URL (not user input), but escape it defensively.
  const safeUrl = escapeHtml(resetUrl);

  const subject = `${safeSchool} — Password Reset Request`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Password Reset — ${safeSchool}</title>
  <style>
    body { margin: 0; padding: 0; background: #f4f6f9; font-family: 'Segoe UI', Arial, sans-serif; color: #333; }
    .wrapper { max-width: 600px; margin: 40px auto; background: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
    .header { background: #1a3a5c; padding: 32px 40px; text-align: center; }
    .header h1 { margin: 0; color: #ffffff; font-size: 24px; letter-spacing: 0.5px; }
    .header p  { margin: 6px 0 0; color: #a8c4e0; font-size: 13px; }
    .body { padding: 36px 40px; }
    .body p { line-height: 1.7; margin: 0 0 16px; font-size: 15px; }
    .cta-wrapper { text-align: center; margin: 32px 0; }
    .cta-btn {
      display: inline-block; padding: 14px 36px;
      background: #1a3a5c; color: #ffffff !important;
      text-decoration: none; border-radius: 6px;
      font-size: 15px; font-weight: 600; letter-spacing: 0.3px;
    }
    .expiry-box { background: #fff8e1; border-left: 4px solid #f59e0b; padding: 12px 16px; border-radius: 4px; margin: 20px 0; font-size: 14px; }
    .ignore-box  { background: #f0fdf4; border-left: 4px solid #22c55e; padding: 12px 16px; border-radius: 4px; margin: 20px 0; font-size: 14px; }
    .fallback-url { word-break: break-all; font-size: 13px; color: #555; background: #f1f5f9; padding: 10px 14px; border-radius: 4px; margin: 16px 0; }
    .footer { background: #f4f6f9; padding: 20px 40px; text-align: center; font-size: 12px; color: #888; border-top: 1px solid #e5e7eb; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="header">
      <h1>${safeSchool}</h1>
      <p>School Management System</p>
    </div>
    <div class="body">
      <p>Hello <strong>${safeName}</strong>,</p>
      <p>We received a request to reset the password for your account. Click the button below to set a new password:</p>

      <div class="cta-wrapper">
        <a class="cta-btn" href="${safeUrl}" rel="noopener noreferrer">Reset My Password</a>
      </div>

      <div class="expiry-box">
        ⏱ This link will expire in <strong>10 minutes</strong>. After that, you will need to request a new reset link.
      </div>

      <p>If the button above does not work, copy and paste the following link into your browser:</p>
      <div class="fallback-url">${safeUrl}</div>

      <div class="ignore-box">
        ✅ If you did not request a password reset, you can safely ignore this email. Your password will not change and your account remains secure.
      </div>

      <p>For security reasons, please do not share this link with anyone.</p>
      <p>— The ${safeSchool} Team</p>
    </div>
    <div class="footer">
      <p>This is an automated message. Please do not reply to this email.</p>
      <p>&copy; ${new Date().getFullYear()} ${safeSchool}. All rights reserved.</p>
    </div>
  </div>
</body>
</html>`;

  const text = `${schoolName} — Password Reset Request

Hello ${name},

We received a request to reset the password for your ${schoolName} account.

To reset your password, copy and paste the link below into your browser:
${resetUrl}

IMPORTANT: This link will expire in 10 minutes.

If you did not request a password reset, you can safely ignore this email. Your password will not change.

For security, do not share this link with anyone.

— The ${schoolName} Team

(This is an automated message. Please do not reply.)`;

  return { subject, html, text };
}

function buildActivationEmail({ name, activationUrl, schoolName = 'RBG School' }) {
  const safeName = escapeHtml(name);
  const safeSchool = escapeHtml(schoolName);
  const safeUrl = escapeHtml(activationUrl);
  const subject = `${safeSchool} — Activate your account`;
  const html = `<!DOCTYPE html>
<html lang="en"><body>
  <p>Hello <strong>${safeName}</strong>,</p>
  <p>Your account is ready. Use the link below to activate it and choose a password:</p>
  <p><a href="${safeUrl}" rel="noopener noreferrer">Activate my account</a></p>
  <p>This link expires in 24 hours and can only be used once.</p>
  <p>If you did not expect this message, contact your school administrator.</p>
</body></html>`;
  const text = `${schoolName} — Activate your account

Hello ${name},

Activate your account and choose a password:
${activationUrl}

This link expires in 24 hours and can only be used once.`;
  return { subject, html, text };
}

module.exports = { buildPasswordResetEmail, buildActivationEmail, escapeHtml };
