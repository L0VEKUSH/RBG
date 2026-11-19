'use strict';
/**
 * upload.routes.js — Authenticated file download routes
 *
 * This replaces the unauthenticated express.static('/uploads', ...) mount
 * in server.js for private files.
 *
 * Route:
 *   GET /api/v1/uploads/:category/:filename
 *
 * Protected by `protect` middleware. Category-level authorization is enforced
 * in the controller.
 */

const express = require('express');
const router  = express.Router();
const { protect } = require('../middleware/auth.middleware');
const { downloadFile } = require('../controllers/upload.controller');

// All downloads require authentication
router.get('/:category/:filename', protect, downloadFile);

module.exports = router;
