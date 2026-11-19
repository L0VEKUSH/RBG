'use strict';

const express = require('express');
const { protect } = require('../middleware/auth.middleware');
const { requirePermission } = require('../middleware/authorization.middleware');
const { validate } = require('../middleware/validate.middleware');
const {
  createDraft, listDrafts, getDraft, saveDecisions, execute,
} = require('../controllers/rollover.controller');
const {
  rolloverIdValidation, rolloverCreateValidation, rolloverDecisionsValidation,
} = require('../validators/rollover.validator');

const router = express.Router();
router.use(protect, requirePermission('academic-years.manage'));
router.post('/', rolloverCreateValidation, validate, createDraft);
router.get('/', listDrafts);
router.get('/:id', rolloverIdValidation, validate, getDraft);
router.put('/:id/decisions', rolloverIdValidation, rolloverDecisionsValidation, validate, saveDecisions);
router.post('/:id/execute', rolloverIdValidation, validate, execute);

module.exports = router;
