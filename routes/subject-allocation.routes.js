'use strict';

const express = require('express');
const { protect } = require('../middleware/auth.middleware');
const { requirePermission } = require('../middleware/authorization.middleware');
const {
  getAllocations,
  createAllocation,
  getAllocation,
  updateAllocation,
  deleteAllocation,
} = require('../controllers/subject-allocation.controller');

const router = express.Router();

router.use(protect);

router.get('/', requirePermission('subjects.view'), getAllocations);
router.post('/', requirePermission('subjects.manage'), createAllocation);
router.get('/:id', requirePermission('subjects.view'), getAllocation);
router.put('/:id', requirePermission('subjects.manage'), updateAllocation);
router.delete('/:id', requirePermission('subjects.manage'), deleteAllocation);

module.exports = router;
