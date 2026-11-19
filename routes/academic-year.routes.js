'use strict';

const express = require('express');
const { protect } = require('../middleware/auth.middleware');
const { requirePermission } = require('../middleware/authorization.middleware');
const { validate } = require('../middleware/validate.middleware');
const {
  getAcademicYears,
  getAcademicYear,
  createAcademicYear,
  updateAcademicYear,
  activateAcademicYear,
  deactivateAcademicYear,
  establishCurrentAcademicYear,
} = require('../controllers/academic-year.controller');
const {
  academicYearIdValidation,
  academicYearCreateValidation,
  academicYearUpdateValidation,
} = require('../validators/academic-year.validator');

const router = express.Router();

router.use(protect);

router.get('/', requirePermission('academic-years.view'), getAcademicYears);
router.post('/', requirePermission('academic-years.manage'), academicYearCreateValidation, validate, createAcademicYear);
router.get('/:id', requirePermission('academic-years.view'), academicYearIdValidation, validate, getAcademicYear);
router.put('/:id', requirePermission('academic-years.manage'), academicYearIdValidation, academicYearUpdateValidation, validate, updateAcademicYear);
router.patch('/:id/activate', requirePermission('academic-years.manage'), academicYearIdValidation, validate, activateAcademicYear);
router.patch('/:id/deactivate', requirePermission('academic-years.manage'), academicYearIdValidation, validate, deactivateAcademicYear);
router.patch('/:id/establish-current', requirePermission('academic-years.manage'), academicYearIdValidation, validate, establishCurrentAcademicYear);
router.post('/:id/establish-current', requirePermission('academic-years.manage'), academicYearIdValidation, validate, establishCurrentAcademicYear);

module.exports = router;
