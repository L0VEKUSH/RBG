'use strict';
/**
 * health.controller.js — Production Health, Readiness and Dependency Observability
 */

const healthService = require('../services/health.service');

/**
 * @desc    Unified Health & Backward-Compatible Probe
 * @route   GET /health or GET /api/v1/health
 * @access  Public
 */
exports.getHealth = async (req, res) => {
  const { statusCode, payload } = await healthService.getReadiness();
  res.status(statusCode).json(payload);
};

/**
 * @desc    Kubernetes / Cloud Readiness Probe
 * @route   GET /health/ready or GET /api/v1/health/ready
 * @access  Public
 */
exports.getReadiness = async (req, res) => {
  const { statusCode, payload } = await healthService.getReadiness();
  res.status(statusCode).json(payload);
};

/**
 * @desc    Kubernetes / Cloud Liveness Probe
 * @route   GET /health/live or GET /api/v1/health/live
 * @access  Public
 */
exports.getLiveness = (req, res) => {
  const { statusCode, payload } = healthService.getLiveness();
  res.status(statusCode).json(payload);
};
