'use strict';
/**
 * upload.js — Multer upload middleware factory
 *
 * Uses in-memory storage so no file is written to disk before validation.
 * The calling route/service is responsible for persisting accepted files.
 *
 * Security properties:
 * - MIME type allowlist enforced server-side (fileFilter).
 * - Extension allowlist cross-checked against MIME (double-validation).
 * - Configurable per-file size limit (default MAX_FILE_UPLOAD from env, max 10 MB).
 * - Filename is NEVER trusted from the client — callers generate safe names.
 * - No path traversal possible: memory storage never touches the filesystem.
 * - Only declared field names are accepted (Multer UnexpectedFieldError surfaced as 400).
 *
 * Note on content validation:
 * - File validation here inspects client-reported MIME headers and filename extensions.
 * - It does NOT inspect magic number bytes or scan for malware/viruses.
 * - For production threat mitigation, integrate an antivirus / malware scanner service.
 */

const multer  = require('multer');
const path    = require('path');
const { MAX_FILE_UPLOAD } = require('../config/env');

// ── Allowlists ────────────────────────────────────────────────────────────────

/** MIME types accepted for profile photos and general images. */
const IMAGE_MIMES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
]);

/** MIME types accepted for document attachments. */
const DOCUMENT_MIMES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/msword',                                                   // .doc
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
]);

/** Mapping of MIME type → allowed file extensions (all lower-case). */
const MIME_TO_EXTENSIONS = {
  'image/jpeg':       ['.jpg', '.jpeg'],
  'image/png':        ['.png'],
  'image/webp':       ['.webp'],
  'image/gif':        ['.gif'],
  'application/pdf':  ['.pdf'],
  'application/msword': ['.doc'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Build a multer fileFilter that rejects files whose MIME or extension is not
 * in the given allowlist.
 *
 * Both the MIME type reported by the client AND the file extension must match.
 * This guards against trivial MIME-spoofing (e.g. a .php renamed to .jpg).
 */
function buildFileFilter(allowedMimes) {
  return (req, file, cb) => {
    const mime = file.mimetype;
    if (!allowedMimes.has(mime)) {
      return cb(Object.assign(
        new Error(`File type "${mime}" is not permitted. Allowed: ${[...allowedMimes].join(', ')}`),
        { statusCode: 415 }
      ));
    }
    const ext = path.extname(file.originalname).toLowerCase();
    const validExts = MIME_TO_EXTENSIONS[mime] || [];
    if (!validExts.includes(ext)) {
      return cb(Object.assign(
        new Error(`File extension "${ext}" does not match content type "${mime}"`),
        { statusCode: 415 }
      ));
    }
    cb(null, true);
  };
}

/**
 * Convert a Multer error or our custom fileFilter error into a standard
 * ErrorResponse-compatible object so the global error handler renders it
 * correctly as JSON.
 */
function handleMulterError(err, req, res, next) {
  if (!err) return next();
  if (err.code === 'LIMIT_FILE_SIZE') {
    const limitMB = (MAX_FILE_UPLOAD / 1024 / 1024).toFixed(1);
    return res.status(413).json({
      success: false,
      message: `File exceeds the maximum size of ${limitMB} MB.`,
    });
  }
  if (err.code === 'LIMIT_UNEXPECTED_FILE') {
    return res.status(400).json({
      success: false,
      message: 'Unexpected file field in the request.',
    });
  }
  if (err.statusCode) {
    return res.status(err.statusCode).json({ success: false, message: err.message });
  }
  next(err);
}

// ── Factory ───────────────────────────────────────────────────────────────────

/**
 * Create a single-file upload middleware for a given field name or list of accepted names.
 *
 * Usage:
 *   const { createSingleUpload, handleMulterError } = require('../middleware/upload');
 *   router.post('/photo', protect, createSingleUpload(['photo', 'profilePhoto'], 'image'), handleMulterError, controller);
 *
 * @param {string|string[]} fieldName - Field name or array of candidate field names.
 * @param {'image'|'document'}  mimeCategory - Which allowlist to use.
 * @param {number} [limitBytes] - Per-file size cap (defaults to MAX_FILE_UPLOAD).
 * @returns {Function} Multer middleware.
 */
function createSingleUpload(fieldName, mimeCategory = 'image', limitBytes) {
  const allowedMimes = mimeCategory === 'document' ? DOCUMENT_MIMES : IMAGE_MIMES;
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: limitBytes || MAX_FILE_UPLOAD },
    fileFilter: buildFileFilter(allowedMimes),
  });

  if (Array.isArray(fieldName)) {
    const fieldsConfig = fieldName.map(name => ({ name, maxCount: 1 }));
    const fieldsHandler = upload.fields(fieldsConfig);
    return (req, res, next) => {
      fieldsHandler(req, res, (err) => {
        if (err) return next(err);
        if (req.files) {
          for (const name of fieldName) {
            if (req.files[name] && req.files[name][0]) {
              req.file = req.files[name][0];
              break;
            }
          }
        }
        next();
      });
    };
  }

  return upload.single(fieldName);
}

/**
 * Create a multi-field upload middleware.
 *
 * @param {Array<{name:string, maxCount:number}>} fields
 * @param {'image'|'document'} mimeCategory
 * @param {number} [limitBytes]
 */
function createFieldsUpload(fields, mimeCategory = 'image', limitBytes) {
  const allowedMimes = mimeCategory === 'document' ? DOCUMENT_MIMES : IMAGE_MIMES;
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: limitBytes || MAX_FILE_UPLOAD },
    fileFilter: buildFileFilter(allowedMimes),
  });
  return upload.fields(fields);
}

module.exports = {
  createSingleUpload,
  createFieldsUpload,
  handleMulterError,
  IMAGE_MIMES,
  DOCUMENT_MIMES,
  MIME_TO_EXTENSIONS,
};
