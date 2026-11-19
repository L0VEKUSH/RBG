'use strict';

const mongoose = require('mongoose');
const Faculty = require('../models/Faculty');
const ErrorResponse = require('../utils/errorResponse');
const { getRolePermissions } = require('../config/permissions');

const LEAVE_TYPES = new Set(['Sick', 'Casual', 'Earned', 'Maternity', 'Paternity', 'Other']);
const CREATE_FIELDS = new Set(['type', 'from', 'to', 'reason']);

function hasPermission(user, permission) {
  if (!user || !user._id) return false;
  const role = user.role === 'faculty' ? 'teacher' : user.role;
  const permissions = new Set(getRolePermissions(role));
  for (const override of user.permissions || []) {
    if (typeof override !== 'string') continue;
    if (override.startsWith('-')) permissions.delete(override.slice(1));
    else permissions.add(override);
  }
  return permissions.has('*') || permissions.has(permission);
}

function validDate(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) ? date : null;
}

function canApplyFacultyLeave(user) {
  if (!user || ['student', 'parent'].includes(user.role)) return false;
  return hasPermission(user, 'leave.apply');
}

exports.canApplyFacultyLeave = canApplyFacultyLeave;

exports.applyFacultyLeave = async (facultyId, actor, data) => {
  if (!canApplyFacultyLeave(actor)) {
    throw new ErrorResponse('Not authorized to apply for leave', 403);
  }
  if (!mongoose.isValidObjectId(facultyId) || !data || typeof data !== 'object' || Array.isArray(data)) {
    throw new ErrorResponse('A valid faculty leave request is required', 400);
  }
  const unsupported = Object.keys(data).find(key => !CREATE_FIELDS.has(key));
  if (unsupported) throw new ErrorResponse(`Unsupported leave field: ${unsupported}`, 400);

  const from = validDate(data.from);
  const to = validDate(data.to);
  if (!LEAVE_TYPES.has(data.type) || !from || !to || from > to ||
      typeof data.reason !== 'string' || !data.reason.trim()) {
    throw new ErrorResponse('Provide a valid leave type, date range, and reason', 400);
  }

  const faculty = await Faculty.findOneAndUpdate(
    { _id: facultyId, user: actor._id, isActive: true },
    { $push: { leaves: { type: data.type, from, to, reason: data.reason.trim(), status: 'Pending' } } },
    { new: true, runValidators: true }
  );
  if (!faculty) throw new ErrorResponse('Faculty profile not found', 404);
  const leave = faculty.leaves[faculty.leaves.length - 1];
  return leave;
};

exports.updateFacultyLeaveStatus = async (facultyId, leaveId, status, actor) => {
  const permission = status === 'Approved' ? 'leave.approve' : status === 'Rejected' ? 'leave.reject' : null;
  if (!permission || !hasPermission(actor, permission)) {
    throw new ErrorResponse('Not authorized to set this leave status', 403);
  }
  if (!mongoose.isValidObjectId(facultyId) || !mongoose.isValidObjectId(leaveId)) {
    throw new ErrorResponse('Pending leave request not found', 404);
  }

  const faculty = await Faculty.findOneAndUpdate(
    { _id: facultyId, leaves: { $elemMatch: { _id: leaveId, status: 'Pending' } } },
    { $set: { 'leaves.$.status': status, 'leaves.$.approvedBy': actor._id } },
    { new: true, runValidators: true }
  );
  if (!faculty) throw new ErrorResponse('Pending leave request not found', 404);
  const leave = faculty.leaves.id(leaveId);
  return leave;
};
