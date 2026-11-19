'use strict';

function configurationError(safeCode, missingSettings = []) {
  const error = new Error(safeCode);
  error.name = 'ProductionEmailConfigurationError';
  error.safeCode = safeCode;
  if (missingSettings.length) error.missingSettings = Object.freeze(missingSettings);
  return error;
}

function validateProductionEmailTransport(env = process.env, nodeEnv = env.NODE_ENV) {
  if (nodeEnv !== 'production') return env.EMAIL_TRANSPORT || 'smtp';

  const transport = typeof env.EMAIL_TRANSPORT === 'string'
    ? env.EMAIL_TRANSPORT.trim().toLowerCase()
    : '';
  if (!transport || transport === 'smtp') return 'smtp';
  if (transport === 'json') {
    throw configurationError('EMAIL_JSON_TRANSPORT_FORBIDDEN');
  }
  throw configurationError('EMAIL_TRANSPORT_UNSUPPORTED');
}

function validateProductionEmailKeyConfiguration(env = process.env, nodeEnv = env.NODE_ENV) {
  if (nodeEnv !== 'production') return null;

  try {
    // The validator returns version labels only; key material is never returned
    // or included in any error message.
    const { validateEncryptionConfig } = require('./tokenMaterial');
    const encryption = validateEncryptionConfig(env, true);
    return {
      currentVersion: encryption.currentVersion,
      previousVersion: encryption.previousVersion || '',
    };
  } catch (_) {
    throw configurationError('EMAIL_ENCRYPTION_CONFIGURATION_INVALID');
  }
}

function validateProductionEmailApplicationConfig(env = process.env, nodeEnv = env.NODE_ENV) {
  const transport = validateProductionEmailTransport(env, nodeEnv);
  if (nodeEnv !== 'production') return { transport };
  const encryption = validateProductionEmailKeyConfiguration(env, nodeEnv);
  return { transport, encryption };
}

function validateProductionEmailEnvironment(env = process.env, nodeEnv = env.NODE_ENV) {
  const applicationConfig = validateProductionEmailApplicationConfig(env, nodeEnv);
  if (nodeEnv !== 'production') return applicationConfig;

  const missingSettings = [];
  const smtpHost = typeof env.SMTP_HOST === 'string' ? env.SMTP_HOST.trim() : '';
  const smtpUserValue = env.SMTP_USER || env.SMTP_EMAIL || '';
  const smtpUser = typeof smtpUserValue === 'string' ? smtpUserValue.trim() : '';
  const smtpPassword = env.SMTP_PASS || env.SMTP_PASSWORD || '';
  const sender = typeof env.FROM_EMAIL === 'string' ? env.FROM_EMAIL.trim() : '';
  const portText = typeof env.SMTP_PORT === 'string' ? env.SMTP_PORT.trim() : '';
  const securityText = typeof env.SMTP_SECURE === 'string' ? env.SMTP_SECURE : '';

  if (!smtpHost) missingSettings.push('SMTP_HOST');
  if (!portText) missingSettings.push('SMTP_PORT');
  if (!securityText) missingSettings.push('SMTP_SECURE');
  if (!smtpUser) missingSettings.push('SMTP_USER or SMTP_EMAIL');
  if (!smtpPassword || (typeof smtpPassword === 'string' && !smtpPassword.trim())) {
    missingSettings.push('SMTP_PASS or SMTP_PASSWORD');
  }
  if (!sender) missingSettings.push('FROM_EMAIL');

  if (missingSettings.length) {
    throw configurationError('EMAIL_SMTP_CONFIGURATION_INCOMPLETE', missingSettings);
  }

  if (smtpHost !== env.SMTP_HOST || /[\s/@?#]/.test(smtpHost) || smtpHost.includes('://')) {
    throw configurationError('EMAIL_SMTP_HOST_INVALID');
  }
  if (smtpUser !== smtpUserValue) {
    throw configurationError('EMAIL_SMTP_CREDENTIALS_INVALID');
  }
  if (!/^\d+$/.test(portText)) throw configurationError('EMAIL_SMTP_PORT_INVALID');
  const port = Number(portText);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw configurationError('EMAIL_SMTP_PORT_INVALID');
  }
  if (!['true', 'false'].includes(securityText)) {
    throw configurationError('EMAIL_SMTP_SECURITY_INVALID');
  }
  if (env.FROM_EMAIL !== sender || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(sender)) {
    throw configurationError('EMAIL_SENDER_IDENTITY_INVALID');
  }

  return {
    transport: applicationConfig.transport,
    smtp: { port, secure: securityText === 'true' },
    encryption: {
      currentVersion: applicationConfig.encryption.currentVersion,
      previousVersion: applicationConfig.encryption.previousVersion,
    },
  };
}

module.exports = {
  validateProductionEmailApplicationConfig,
  validateProductionEmailEnvironment,
  validateProductionEmailKeyConfiguration,
  validateProductionEmailTransport,
};
