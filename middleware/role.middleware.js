const ErrorResponse = require('../utils/errorResponse');

/**
 * Authorize specific roles
 * Usage: authorize('admin', 'teacher', 'principal')
 */
const authorize = (...roles) => {
  // Expand role aliases for backward compatibility
  const expandedRoles = new Set(roles);
  if (expandedRoles.has('admin')) {
    expandedRoles.add('super_admin');
    expandedRoles.add('school_admin');
  }
  if (expandedRoles.has('faculty')) {
    expandedRoles.add('teacher');
    expandedRoles.add('class_teacher');
  }
  // Admin roles always have access
  expandedRoles.add('super_admin');

  return (req, res, next) => {
    if (!req.user || !expandedRoles.has(req.user.role)) {
      return next(
        new ErrorResponse(
          `Role '${req.user?.role || "unknown"}' is not authorized to access this resource.`,
          403
        )
      );
    }
    next();
  };
};

/**
 * Check granular permissions
 * Usage: checkPermission('students.view', 'students.create')
 * User needs at least ONE of the listed permissions
 */
const checkPermission = (...permissions) => {
  return (req, res, next) => {
    if (!req.user) {
      return next(new ErrorResponse('Authentication required.', 401));
    }
    // Super admin and school_admin bypass permission checks
    if (['super_admin', 'school_admin', 'admin'].includes(req.user.role)) {
      return next();
    }
    // Check if user has any of the required permissions
    const userPerms = req.user.permissions || [];
    const hasPermission = permissions.some(p => userPerms.includes(p));
    if (!hasPermission) {
      return next(
        new ErrorResponse(
          `You do not have permission to perform this action. Required: ${permissions.join(' or ')}`,
          403
        )
      );
    }
    next();
  };
};

/**
 * Check resource ownership - prevents IDOR attacks
 * Verifies that the logged-in user owns the requested resource
 */
const checkOwnership = (model, paramName = 'id', userField = 'user') => {
  return async (req, res, next) => {
    if (!req.user) {
      return next(new ErrorResponse('Authentication required.', 401));
    }
    // Admin roles bypass ownership checks
    if (['super_admin', 'school_admin', 'admin', 'principal'].includes(req.user.role)) {
      return next();
    }
    try {
      const Model = require(`../models/${model}`);
      const resource = await Model.findById(req.params[paramName]);
      if (!resource) {
        return next(new ErrorResponse('Resource not found.', 404));
      }
      const ownerId = resource[userField]?.toString();
      if (ownerId !== req.user._id.toString()) {
        return next(new ErrorResponse('You are not authorized to access this resource.', 403));
      }
      next();
    } catch (error) {
      next(error);
    }
  };
};

// Shorthand helpers
const adminOnly = authorize('super_admin', 'school_admin', 'admin');
const staffOnly = authorize('admin', 'faculty', 'teacher', 'class_teacher', 'principal', 'vice_principal');
const managementOnly = authorize('super_admin', 'school_admin', 'admin', 'principal', 'vice_principal');

module.exports = {
  authorize,
  checkPermission,
  checkOwnership,
  adminOnly,
  staffOnly,
  managementOnly,
};