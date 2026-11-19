'use strict';
/**
 * health.routes.js — Health and Readiness Probes
 *
 * Endpoints:
 *   GET /health           — Backward-compatible unified health & readiness
 *   GET /health/ready     — Kubernetes / orchestrator readiness probe
 *   GET /health/live      — Kubernetes / orchestrator liveness probe
 */

const express = require('express');
const router = express.Router();
const {
  getHealth,
  getReadiness,
  getLiveness,
} = require('../controllers/health.controller');

router.get('/', getHealth);
router.get('/ready', getReadiness);
router.get('/live', getLiveness);

module.exports = router;
