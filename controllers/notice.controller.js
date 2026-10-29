const Notice = require('../models/Notice');
const ErrorResponse = require('../utils/errorResponse');
const APIFeatures = require('../utils/apiFeatures');

/**
 * @desc    Create notice
 * @route   POST /api/v1/notices
 * @access  Private (Admin, Faculty)
 */
exports.createNotice = async (req, res) => {
  const notice = await Notice.create({ ...req.body, createdBy: req.user.id });
  res.status(201).json({ success: true, message: 'Notice created', data: { notice } });
};

/**
 * @desc    Get all notices
 * @route   GET /api/v1/notices
 * @access  Public / Private
 */
exports.getAllNotices = async (req, res) => {
  const baseQuery = Notice.find({ isPublished: true })
    .populate('createdBy', 'name role');

  const features = new APIFeatures(baseQuery, req.query)
    .filter().sort().limitFields().paginate();

  const notices = await features.query;
  const total = await Notice.countDocuments({ isPublished: true });

  res.status(200).json({
    success: true,
    count: notices.length,
    total,
    page: features.page,
    data: { notices },
  });
};

/**
 * @desc    Get pinned notices
 * @route   GET /api/v1/notices/pinned
 * @access  Public
 */
exports.getPinnedNotices = async (req, res) => {
  const notices = await Notice.find({ isPublished: true, isPinned: true })
    .populate('createdBy', 'name')
    .sort('-publishDate')
    .limit(5);
  res.status(200).json({ success: true, count: notices.length, data: { notices } });
};

/**
 * @desc    Get single notice
 * @route   GET /api/v1/notices/:id
 * @access  Public
 */
exports.getNoticeById = async (req, res) => {
  const notice = await Notice.findById(req.params.id)
    .populate('createdBy', 'name role');
  if (!notice) throw new ErrorResponse('Notice not found', 404);

  // Increment view count
  await Notice.findByIdAndUpdate(req.params.id, {
    $inc: { views: 1 },
    ...(req.user && {
      $addToSet: { viewedBy: { user: req.user.id } },
    }),
  });

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
  const notices = await Notice.find({ type: req.params.type, isPublished: true })
    .populate('createdBy', 'name')
    .sort('-publishDate');
  res.status(200).json({ success: true, count: notices.length, data: { notices } });
};
