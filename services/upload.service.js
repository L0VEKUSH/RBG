'use strict';
/**
 * upload.service.js — Safe filename generation and storage abstraction
 *
 * Phase 22.4: Local-disk storage only (Render Persistent Disk or development).
 *
 * Storage strategy:
 *   - Files are stored under FILE_UPLOAD_PATH (env-configurable, default ./uploads).
 *   - Sub-directories by category: profiles/, documents/, attachments/.
 *   - Filenames are generated from a UUID + sanitised extension — the original
 *     filename is NEVER used to build a filesystem path.
 *
 * Production note:
 *   Render's default container filesystem is EPHEMERAL. Files written to it are
 *   lost on every deploy or restart. To retain uploads across deploys:
 *     Option A — Render Persistent Disk: attach a persistent disk to the service
 *       and set FILE_UPLOAD_PATH to the mount point (e.g. /var/data/uploads).
 *       This works only for a single-instance deployment.
 *     Option B — Managed object storage (S3-compatible): replace the
 *       _saveToLocalDisk() implementation with an SDK call. Required env vars
 *       are documented at the bottom of this file.
 *
 * Required operator configuration:
 *   FILE_UPLOAD_PATH   - Absolute path of the upload root directory.
 *                        Must be on a Render Persistent Disk mount point.
 *                        Default: ./uploads (ephemeral — only suitable for dev).
 *   MAX_FILE_UPLOAD    - Per-file size limit in bytes. Default: 5242880 (5 MB).
 *
 * Future object-storage configuration (not yet active):
 *   STORAGE_PROVIDER   - Set to 's3' or 'gcs' to enable cloud storage.
 *   STORAGE_BUCKET     - Bucket name.
 *   STORAGE_REGION     - AWS/GCS region.
 *   STORAGE_KEY_ID     - Access key ID (AWS) or service-account path (GCS).
 *   STORAGE_SECRET     - Secret access key.
 *   STORAGE_ENDPOINT   - Optional custom endpoint (for S3-compatible providers).
 *   STORAGE_CDN_BASE   - Optional CDN base URL for returned file URLs.
 */

const path   = require('path');
const fs     = require('fs');
const crypto = require('crypto');
const { FILE_UPLOAD_PATH, MAX_FILE_UPLOAD } = require('../config/env');
const ErrorResponse = require('../utils/errorResponse');

const UPLOAD_CATEGORIES = new Set(['profiles', 'documents', 'attachments']);

// Extension allowlist (mirrors upload middleware but enforced a second time here)
const ALLOWED_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.pdf', '.doc', '.docx']);

/**
 * Generate a cryptographically random filename that is safe for filesystem use.
 * The original filename is discarded; only the extension is retained after
 * validation.
 *
 * @param {string} originalName - Untrusted original filename from the client.
 * @returns {string} Safe filename like `a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4.jpg`
 */
function generateSafeFilename(originalName) {
  const ext = path.extname(originalName).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    throw new ErrorResponse(`File extension "${ext}" is not permitted`, 415);
  }
  // 16 random bytes → 32 hex chars; no path separators, no special chars
  return crypto.randomBytes(16).toString('hex') + ext;
}

/**
 * Ensure a category sub-directory exists under the upload root.
 * Creates the directory tree synchronously only on first use.
 *
 * @param {string} category - One of UPLOAD_CATEGORIES.
 * @returns {string} Absolute path to the category directory.
 */
function ensureCategoryDir(category) {
  if (!UPLOAD_CATEGORIES.has(category)) {
    throw new ErrorResponse(`Unknown upload category "${category}"`, 400);
  }
  const uploadRoot = path.resolve(FILE_UPLOAD_PATH);
  const dir = path.join(uploadRoot, category);

  // Guard against path traversal: the resolved dir must still be under the root
  if (!dir.startsWith(uploadRoot + path.sep) && dir !== uploadRoot) {
    throw new ErrorResponse('Upload path traversal detected', 400);
  }
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/**
 * Save a multer MemoryStorage file buffer to the local filesystem.
 *
 * @param {object} file     - `req.file` from multer (memoryStorage).
 * @param {string} category - Upload category sub-directory.
 * @returns {{ filename: string, url: string, size: number }} Stored file metadata.
 */
async function saveFile(file, category = 'attachments') {
  if (!file || !file.buffer || !file.originalname) {
    throw new ErrorResponse('No valid file provided', 400);
  }
  if (file.size > MAX_FILE_UPLOAD) {
    throw new ErrorResponse(
      `File size ${file.size} exceeds limit of ${MAX_FILE_UPLOAD} bytes`, 413
    );
  }

  const safeFilename = generateSafeFilename(file.originalname);
  const dir          = ensureCategoryDir(category);
  const destPath     = path.join(dir, safeFilename);

  // Final traversal guard: resolved destination must be inside the category dir
  if (!path.resolve(destPath).startsWith(path.resolve(dir))) {
    throw new ErrorResponse('Upload path traversal detected', 400);
  }

  await fs.promises.writeFile(destPath, file.buffer);

  // Relative URL that maps to the authenticated download route
  const url = `/api/v1/uploads/${category}/${safeFilename}`;

  return { filename: safeFilename, url, size: file.size };
}

/**
 * Delete a stored file by its category and safe filename.
 * Validates that the filename contains no path separators before resolving.
 *
 * @param {string} filename - Safe filename only (no path, no subdirectory).
 * @param {string} category - Upload category.
 */
async function deleteFile(filename, category) {
  if (!filename || typeof filename !== 'string' || filename.includes('/') || filename.includes('\\') || filename.includes('..')) {
    throw new ErrorResponse('Invalid filename', 400);
  }
  const dir      = ensureCategoryDir(category);
  const filePath = path.join(dir, filename);

  // Traversal guard
  if (!path.resolve(filePath).startsWith(path.resolve(dir))) {
    throw new ErrorResponse('File path traversal detected', 400);
  }
  try {
    await fs.promises.unlink(filePath);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err; // ENOENT = already gone, not an error
  }
}

/**
 * Resolve a category/filename pair to an absolute filesystem path, performing
 * traversal checks. Used by the authenticated download route.
 *
 * @param {string} category
 * @param {string} filename
 * @returns {string} Absolute path.
 */
function resolveFilePath(category, filename) {
  if (!UPLOAD_CATEGORIES.has(category)) {
    throw new ErrorResponse('Unknown upload category', 404);
  }
  // Reject any path component that is not a simple filename
  if (
    !filename ||
    typeof filename !== 'string' ||
    filename.includes('/') ||
    filename.includes('\\') ||
    filename.includes('..') ||
    path.basename(filename) !== filename
  ) {
    throw new ErrorResponse('Invalid file path', 400);
  }
  const dir      = path.resolve(FILE_UPLOAD_PATH, category);
  const filePath = path.resolve(dir, filename);

  if (!filePath.startsWith(dir + path.sep) && filePath !== dir) {
    throw new ErrorResponse('File path traversal detected', 400);
  }
  return filePath;
}

/**
 * Extract storage category and filename from a stored application URL.
 *
 * Matches both full API paths (`/api/v1/uploads/profiles/...`) and legacy paths (`/uploads/profiles/...`).
 * Returns null if the URL is an external link (http://, https://), a static asset (default-avatar.png),
 * or not a managed uploaded file.
 *
 * @param {string} url - Stored document/photo reference.
 * @returns {{ category: string, filename: string } | null}
 */
function extractStorageKey(url) {
  if (!url || typeof url !== 'string') return null;
  const match = url.match(/(?:\/api\/v1)?\/uploads\/([a-zA-Z0-9_-]+)\/([a-f0-9]{32}\.[a-z0-9]+)(?:$|\?)/i);
  if (!match) return null;
  const [, category, filename] = match;
  if (!UPLOAD_CATEGORIES.has(category.toLowerCase())) return null;
  return { category: category.toLowerCase(), filename };
}

/**
 * Safely delete an old upload reference if it was a managed file.
 * External links, default assets, and non-managed paths are safely ignored.
 *
 * @param {string} oldUrl - Previous URL stored in database.
 * @returns {Promise<boolean>} True if a file was deleted; false otherwise.
 */
async function safeDeleteOldUpload(oldUrl) {
  const key = extractStorageKey(oldUrl);
  if (!key) return false;
  try {
    await deleteFile(key.filename, key.category);
    return true;
  } catch (err) {
    // If already missing on disk (ENOENT), return false gracefully
    return false;
  }
}

module.exports = {
  generateSafeFilename,
  saveFile,
  deleteFile,
  resolveFilePath,
  extractStorageKey,
  safeDeleteOldUpload,
  UPLOAD_CATEGORIES,
  ALLOWED_EXTENSIONS,
};
