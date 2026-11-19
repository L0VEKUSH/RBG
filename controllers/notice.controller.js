const Notice = require('../models/Notice');
const ErrorResponse = require('../utils/errorResponse');
const noticeService = require('../services/notice.service');
const { hasAnyPermission } = require('../services/audience-scope.service');

/**
 * @desc    Create notice
 * @route   POST /api/v1/notices
 * @access  Private (Admin, Faculty)
 */
exports.createNotice = async (req, res) => {
  const notice = await noticeService.createNotice(req.body, req.user);
  res.status(201).json({ success: true, message: 'Notice created', data: { notice } });
};

/**
 * @desc    Get all notices
 * @route   GET /api/v1/notices
 * @access  Public / Private
 */
exports.getAllNotices = async (req, res) => {
  const { notices, total, page, limit } = await noticeService.getAllNotices(req.user, req.query);

  res.status(200).json({
    success: true,
    count: notices.length,
    total,
    page,
    data: { notices },
    limit,
  });
};

/**
 * @desc    Get pinned notices
 * @route   GET /api/v1/notices/pinned
 * @access  Public
 */
exports.getPinnedNotices = async (req, res) => {
  const notices = await noticeService.getPinnedNotices(req.user);
  res.status(200).json({ success: true, count: notices.length, data: { notices } });
};

/**
 * @desc    Get single notice
 * @route   GET /api/v1/notices/:id
 * @access  Public
 */
exports.getNoticeById = async (req, res) => {
  const notice = await noticeService.getNoticeById(req.params.id, req.user);

  res.status(200).json({ success: true, data: { notice } });
};

/**
 * @desc    Update notice
 * @route   PUT /api/v1/notices/:id
 * @access  Private (Admin, Faculty — own)
 */
exports.updateNotice = async (req, res) => {
  let notice = await Notice.findById(req.params.id);
  if (!notice) throw new ErrorResponse('Notice not found', 404);

  if (notice.createdBy.toString() !== req.user.id && req.user.role !== 'admin') {
    throw new ErrorResponse('Not authorized to update this notice', 403);
  }

  notice = await Notice.findByIdAndUpdate(req.params.id, req.body, {
    new: true, runValidators: true,
  });
  res.status(200).json({ success: true, message: 'Notice updated', data: { notice } });
};

/**
 * @desc    Delete notice
 * @route   DELETE /api/v1/notices/:id
 * @access  Private (Admin)
 */
exports.deleteNotice = async (req, res) => {
  const notice = await Notice.findByIdAndDelete(req.params.id);
  if (!notice) throw new ErrorResponse('Notice not found', 404);
  res.status(200).json({ success: true, message: 'Notice deleted' });
};

/**
 * @desc    Toggle pin status
 * @route   PUT /api/v1/notices/:id/pin
 * @access  Private (Admin)
 */
exports.togglePin = async (req, res) => {
  if (!hasAnyPermission(req.user, 'notices.update') ||
      !hasAnyPermission(req.user, 'notices.view-management')) {
    throw new ErrorResponse('Not authorized to manage notice pins', 403);
  }

  const notice = await Notice.findById(req.params.id);
  if (!notice) throw new ErrorResponse('Notice not found', 404);
  notice.isPinned = !notice.isPinned;
  await notice.save();
  res.status(200).json({
    success: true,
    message: `Notice ${notice.isPinned ? 'pinned' : 'unpinned'}`,
    data: { notice },
  });
};

/**
 * @desc    Get notices by type
 * @route   GET /api/v1/notices/type/:type
 * @access  Public
 */
exports.getNoticesByType = async (req, res) => {
  const notices = await noticeService.getNoticesByType(req.params.type, req.user);
  res.status(200).json({ success: true, count: notices.length, data: { notices } });
};
