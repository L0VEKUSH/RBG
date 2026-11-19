'use strict';

const mongoose = require('mongoose');
const Notice = require('../models/Notice');
const ErrorResponse = require('../utils/errorResponse');
const APIFeatures = require('../utils/apiFeatures');
const { getActorClasses, hasAnyPermission, targetClassesFilter } = require('./audience-scope.service');

const NOTICE_AUDIENCES = new Set(['All', 'Students', 'Faculty', 'Parents', 'Admin']);
const CREATE_FIELDS = new Set([
  'title', 'content', 'type', 'priority', 'targetAudience', 'targetClasses',
  'publishDate', 'expiryDate', 'attachments', 'isPinned',
]);
const RECIPIENT_FIELDS = 'title content type priority publishDate expiryDate isPinned createdAt';
const MANAGER_FIELDS = 'title content type priority targetAudience targetClasses createdBy publishDate expiryDate attachments isPublished isPinned views createdAt updatedAt';

function canManageNotices(user) {
  return hasAnyPermission(user, 'notices.view-management');
}

function recipientPublicationWindow(now) {
  const instant = new Date(now.getTime());
  return {
    isPublished: true,
    $and: [
      {
        $or: [
          { publishDate: { $exists: false } },
          { publishDate: null },
          { publishDate: { $lte: instant } },
        ],
      },
      {
        $or: [
          { expiryDate: { $exists: false } },
          { expiryDate: null },
          { expiryDate: { $gte: instant } },
        ],
      },
    ],
  };
}

async function getNoticeReadPolicy(user, now = new Date()) {
  if (canManageNotices(user)) return { manager: true, filter: {} };

  let audiences = ['All'];
  if (user) {
    if (user.role === 'student') audiences = ['Students', 'All'];
    else if (user.role === 'parent') audiences = ['Parents', 'All'];
    else if (['teacher', 'class_teacher', 'faculty', 'staff'].includes(user.role)) audiences = ['Faculty', 'All'];
  }
  const classes = user ? await getActorClasses(user) : [];
  return {
    manager: false,
    filter: {
      ...recipientPublicationWindow(now),
      targetAudience: { $in: audiences },
      ...targetClassesFilter(classes),
    },
  };
}

function selectedQuery(query, manager, user) {
  query = query.select(manager ? MANAGER_FIELDS : RECIPIENT_FIELDS);
  if (manager) query = query.populate('createdBy', 'name role');
  return query;
}

function safeListQuery(query) {
  const result = {};
  for (const field of ['page', 'limit', 'sort', 'keyword']) {
    if (query && query[field] !== undefined) result[field] = query[field];
  }
  return result;
}

async function listNotices(user, query, extraFilter = {}) {
  const policy = await getNoticeReadPolicy(user);
  const filter = { $and: [policy.filter, extraFilter] };
  let baseQuery = selectedQuery(Notice.find(filter), policy.manager, user);
  const features = new APIFeatures(baseQuery, safeListQuery(query))
    .search(['title', 'content'])
    .sort()
    .paginate();
  const notices = await features.query;
  const total = await Notice.countDocuments(filter);
  return { notices, total, page: features.page, limit: features.limit };
}

exports.getAllNotices = (user, query) => listNotices(user, query);
// Exposed for deterministic policy tests; production callers use the default clock.
exports.getNoticeReadPolicy = getNoticeReadPolicy;

exports.getPinnedNotices = async (user) => {
  const policy = await getNoticeReadPolicy(user);
  const filter = { $and: [policy.filter, { isPinned: true }] };
  let query = selectedQuery(Notice.find(filter), policy.manager, user).sort('-publishDate').limit(5);
  return query;
};

exports.getNoticesByType = async (type, user) => {
  const policy = await getNoticeReadPolicy(user);
  const filter = { $and: [policy.filter, { type }] };
  return selectedQuery(Notice.find(filter), policy.manager, user).sort('-publishDate');
};

exports.getNoticeById = async (id, user) => {
  if (!mongoose.isValidObjectId(id)) throw new ErrorResponse('Notice not found', 404);
  const policy = await getNoticeReadPolicy(user);
  const filter = policy.manager
    ? { _id: id }
    : { $and: [policy.filter, { _id: id }] };
  const update = { $inc: { views: 1 } };
  if (user && user._id) update.$addToSet = { viewedBy: { user: user._id } };
  let query = selectedQuery(
    Notice.findOneAndUpdate(filter, update, { new: true }),
    policy.manager,
    user
  );
  const notice = await query;
  if (!notice) throw new ErrorResponse('Notice not found', 404);
  return notice;
};

exports.createNotice = async (data, actor) => {
  if (!hasAnyPermission(actor, 'notices.create')) throw new ErrorResponse('Not authorized to create notices', 403);
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new ErrorResponse('A valid notice is required', 400);
  const unknown = Object.keys(data).find(field => !CREATE_FIELDS.has(field));
  if (unknown) throw new ErrorResponse(`Unsupported notice field: ${unknown}`, 400);
  if (!Array.isArray(data.targetAudience) || data.targetAudience.length === 0 ||
      data.targetAudience.some(audience => !NOTICE_AUDIENCES.has(audience))) {
    throw new ErrorResponse('Choose at least one valid notice audience before publishing', 400);
  }
  if (data.targetClasses !== undefined && !Array.isArray(data.targetClasses)) {
    throw new ErrorResponse('targetClasses must be an array', 400);
  }
  if (data.attachments !== undefined && !Array.isArray(data.attachments)) {
    throw new ErrorResponse('attachments must be an array', 400);
  }

  return Notice.create({
    title: data.title,
    content: data.content,
    ...(data.type !== undefined && { type: data.type }),
    ...(data.priority !== undefined && { priority: data.priority }),
    targetAudience: data.targetAudience,
    targetClasses: data.targetClasses === undefined ? ['All'] : data.targetClasses,
    ...(data.publishDate !== undefined && { publishDate: data.publishDate }),
    ...(data.expiryDate !== undefined && { expiryDate: data.expiryDate }),
    ...(data.attachments !== undefined && { attachments: data.attachments }),
    ...(data.isPinned !== undefined && { isPinned: data.isPinned }),
    isPublished: true,
    createdBy: actor._id,
  });
};

