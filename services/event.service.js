'use strict';

const mongoose = require('mongoose');
const Event = require('../models/Event');
const ErrorResponse = require('../utils/errorResponse');
const { getActorClasses, hasAnyPermission, targetClassesFilter } = require('./audience-scope.service');

const EVENT_MANAGEMENT_PERMISSIONS = ['events.create', 'events.update', 'events.delete'];
const STAFF_ROLES = new Set([
  'staff', 'accountant', 'librarian', 'driver', 'receptionist', 'hr', 'nurse',
  'transport_admin', 'admission_officer', 'exam_coordinator', 'academic_coordinator',
]);

function canManageEvents(actor) {
  return hasAnyPermission(actor, ...EVENT_MANAGEMENT_PERMISSIONS);
}

function audiencesFor(actor) {
  if (!actor) return ['All'];
  if (actor.role === 'student') return ['Students', 'All'];
  if (actor.role === 'parent') return ['Parents', 'All'];
  if (['teacher', 'class_teacher', 'faculty'].includes(actor.role)) return ['Teachers', 'All'];
  if (STAFF_ROLES.has(actor.role)) return ['Staff', 'All'];
  return ['All'];
}

async function recipientFilter(actor) {
  const classes = actor ? await getActorClasses(actor) : [];
  return {
    isPublic: true,
    isActive: true,
    targetAudience: { $in: audiencesFor(actor) },
    ...targetClassesFilter(classes),
  };
}

function assertCanReadProtectedEvents(actor) {
  if (!actor || !actor._id) throw new ErrorResponse('Not authenticated', 401);
  if (!canManageEvents(actor) && !hasAnyPermission(actor, 'events.view')) {
    throw new ErrorResponse('Not authorized to view events', 403);
  }
}

function assertCanManage(permission, actor) {
  if (!hasAnyPermission(actor, permission)) throw new ErrorResponse('Not authorized to manage events', 403);
}

exports.getPublicEvents = async (actor) => {
  const filter = await recipientFilter(actor);
  filter.startDate = { $gte: new Date() };
  return Event.find(filter).sort({ startDate: 1 });
};

exports.getUpcomingEvents = async (actor) => {
  assertCanReadProtectedEvents(actor);
  const filter = canManageEvents(actor)
    ? { isActive: true, startDate: { $gte: new Date() } }
    : { ...(await recipientFilter(actor)), startDate: { $gte: new Date() } };
  return Event.find(filter).sort({ startDate: 1 });
};

exports.getAllEvents = async (actor) => {
  assertCanReadProtectedEvents(actor);
  const filter = canManageEvents(actor) ? {} : await recipientFilter(actor);
  return Event.find(filter).sort({ startDate: -1 });
};

exports.createEvent = async (data, actor) => {
  assertCanManage('events.create', actor);
  return Event.create({ ...data, createdBy: actor._id });
};

exports.getEventById = async (id, actor) => {
  assertCanReadProtectedEvents(actor);
  if (!mongoose.isValidObjectId(id)) throw new ErrorResponse('Event not found', 404);
  const filter = canManageEvents(actor)
    ? { _id: id }
    : { $and: [await recipientFilter(actor), { _id: id }] };
  const event = await Event.findOne(filter);
  if (!event) throw new ErrorResponse('Event not found', 404);
  return event;
};

exports.updateEvent = async (id, data, actor) => {
  assertCanManage('events.update', actor);
  if (!mongoose.isValidObjectId(id)) throw new ErrorResponse('Event not found', 404);
  const event = await Event.findByIdAndUpdate(id, data, { new: true, runValidators: true });
  if (!event) throw new ErrorResponse('Event not found', 404);
  return event;
};

exports.deleteEvent = async (id, actor) => {
  assertCanManage('events.delete', actor);
  if (!mongoose.isValidObjectId(id)) throw new ErrorResponse('Event not found', 404);
  const event = await Event.findByIdAndDelete(id);
  if (!event) throw new ErrorResponse('Event not found', 404);
  return event;
};
