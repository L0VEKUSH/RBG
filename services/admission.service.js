'use strict';

const Admission = require('../models/Admission');
const Class = require('../models/Class');
const ErrorResponse = require('../utils/errorResponse');
const sagaService = require('./admission-saga.service');
const { resolveEffectiveDate } = require('./enrollment-date.service');
const { schoolDateKey } = require('../utils/attendance-date');

const ALLOWED_STATUS_TRANSITIONS = Object.freeze({
  Draft: ['Submitted'],
  Submitted: ['Under_Review', 'Document_Verification', 'Approved', 'Rejected', 'Waitlisted'],
  Under_Review: ['Document_Verification', 'Approved', 'Rejected', 'Waitlisted'],
  Document_Verification: ['Under_Review', 'Approved', 'Rejected', 'Waitlisted'],
  Waitlisted: ['Under_Review', 'Approved', 'Rejected'],
  Approved: ['Rejected', 'Waitlisted'],
  Rejected: [],
  Admitting: [],
  Admitted: [],
});

const APPLICATION_FIELDS = new Set([
  'studentName', 'dateOfBirth', 'gender', 'classApplyingFor', 'stream',
  'fatherName', 'fatherOccupation', 'fatherPhone', 'fatherEmail',
  'motherName', 'motherOccupation', 'motherPhone', 'motherEmail',
  'guardianName', 'guardianRelation', 'guardianPhone', 'address',
  'previousSchool', 'documents', 'photo', 'transportRequired', 'siblingInfo',
]);

const EDITABLE_ADMISSION_FIELDS = new Set([
  ...APPLICATION_FIELDS,
  'reviewedBy', 'reviewDate', 'remarks', 'interviewDate', 'interviewRemarks',
]);

exports.applyForAdmission = async (data) => {
  const input = data && typeof data === 'object' ? data : {};
  if (input.section !== undefined || input.sections !== undefined) {
    throw new ErrorResponse('Class sections are not supported. RBG School ERP models single undivided classes per level.', 400);
  }
  if (input.classApplyingFor !== undefined) {
    try {
      input.classApplyingFor = Class.validateAndNormalizeClassWrite(input.classApplyingFor, 'classApplyingFor');
    } catch (err) {
      throw new ErrorResponse(err.message, 400);
    }
  }
  const application = {};
  for (const [field, value] of Object.entries(input)) {
    if (APPLICATION_FIELDS.has(field)) application[field] = value;
  }
  application.status = 'Submitted';
  return Admission.create(application);
};

exports.getAllAdmissions = async () => Admission.find();
exports.getAdmissionStats = async () => Admission.aggregate([
  { $group: { _id: '$status', count: { $sum: 1 } } },
]);
exports.getAdmissionById = async (id) => Admission.findById(id);

exports.updateAdmission = async (id, data) => {
  const input = data && typeof data === 'object' ? data : {};
  if (input.section !== undefined || input.sections !== undefined) {
    throw new ErrorResponse('Class sections are not supported. RBG School ERP models single undivided classes per level.', 400);
  }
  const forbidden = [
    'status', 'createdStudent', 'admissionSaga', 'applicationNumber',
    'enrollmentEffectiveFrom', 'enrollmentAcademicYear',
  ];
  if (forbidden.some((field) => Object.prototype.hasOwnProperty.call(input, field))) {
    throw new ErrorResponse('Admission workflow fields cannot be changed through this endpoint.', 400);
  }
  if (input.classApplyingFor !== undefined) {
    try {
      input.classApplyingFor = Class.validateAndNormalizeClassWrite(input.classApplyingFor, 'classApplyingFor');
    } catch (err) {
      throw new ErrorResponse(err.message, 400);
    }
  }
  const update = {};
  for (const [field, value] of Object.entries(input)) {
    if (EDITABLE_ADMISSION_FIELDS.has(field)) update[field] = value;
  }
  if (!Object.keys(update).length) throw new ErrorResponse('No editable admission fields were provided.', 400);
  const admission = await Admission.findOneAndUpdate(
    { _id: id, status: { $nin: ['Admitting', 'Admitted'] } },
    { $set: update },
    { new: true, runValidators: true }
  );
  if (!admission) throw new ErrorResponse('Admission not found or cannot be edited in its current state.', 409);
  return admission;
};

exports.updateAdmissionStatus = async (id, nextStatus, enrollmentEffectiveFrom) => {
  if (typeof nextStatus !== 'string' || !Object.prototype.hasOwnProperty.call(ALLOWED_STATUS_TRANSITIONS, nextStatus)) {
    throw new ErrorResponse('Invalid admission status.', 400);
  }
  if (enrollmentEffectiveFrom !== undefined && nextStatus !== 'Approved') {
    throw new ErrorResponse('Enrollment date can only be set while approving an admission.', 400);
  }
  const current = await Admission.findById(id).select('status enrollmentEffectiveFrom enrollmentAcademicYear');
  if (!current) throw new ErrorResponse('Admission not found.', 404);
  if (current.status === nextStatus && nextStatus !== 'Approved') return current;
  if (!(ALLOWED_STATUS_TRANSITIONS[current.status] || []).includes(nextStatus)) {
    if (!(current.status === 'Approved' && nextStatus === 'Approved')) {
      throw new ErrorResponse('Invalid admission status transition.', 400);
    }
  }

  if (nextStatus === 'Approved') {
    const storedDateKey = current.enrollmentEffectiveFrom
      ? schoolDateKey(current.enrollmentEffectiveFrom)
      : null;
    const requestedDate = enrollmentEffectiveFrom;
    if (!storedDateKey && requestedDate === undefined) {
      throw new ErrorResponse('An explicit school-local enrollment date is required for approval.', 400);
    }
    if (storedDateKey && requestedDate === undefined && current.enrollmentAcademicYear) return current;

    const resolved = await resolveEffectiveDate(requestedDate === undefined ? storedDateKey : requestedDate);
    if (storedDateKey && resolved.dateKey !== storedDateKey) {
      throw new ErrorResponse('The approved enrollment date is already fixed and cannot be changed.', 409);
    }
    if (current.enrollmentAcademicYear && current.enrollmentAcademicYear !== resolved.academicYear) {
      throw new ErrorResponse('The approved academic year is already fixed and cannot be changed.', 409);
    }

    const filter = { _id: id, status: current.status };
    if (storedDateKey) {
      filter.enrollmentEffectiveFrom = current.enrollmentEffectiveFrom;
    } else {
      filter.enrollmentEffectiveFrom = null;
    }
    if (current.enrollmentAcademicYear) filter.enrollmentAcademicYear = current.enrollmentAcademicYear;
    const updated = await Admission.findOneAndUpdate(filter, {
      $set: {
        status: nextStatus,
        enrollmentEffectiveFrom: resolved.effectiveFrom,
        enrollmentAcademicYear: resolved.academicYear,
      },
    }, { new: true, runValidators: true });
    if (!updated) throw new ErrorResponse('Admission changed concurrently; reload and retry.', 409);
    return updated;
  }

  const updated = await Admission.findOneAndUpdate(
    { _id: id, status: current.status },
    { $set: { status: nextStatus } },
    { new: true, runValidators: true }
  );
  if (!updated) throw new ErrorResponse('Admission status changed concurrently; reload and retry.', 409);
  return updated;
};

exports.admitStudent = sagaService.admitStudent;
exports.recoverStaleAdmissionSagas = sagaService.recoverStaleAdmissionSagas;
exports.setSagaTestHook = sagaService.setSagaTestHook;
