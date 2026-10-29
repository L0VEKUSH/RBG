const { getRolePermissions } = require('../config/permissions');
const ErrorResponse = require('../utils/errorResponse');
const Student = require('../models/Student');
const Faculty = require('../models/Faculty');
const Parent = require('../models/Parent');
const SubjectAllocation = require('../models/SubjectAllocation');

// 1. requireAuth (assumes JWT already handled by another middleware or we combine it here)
// Actually, `auth.middleware.js` already has `protect`. Let's just import and use that for requireAuth, or implement it here if they meant role middleware.
// The user prompt specifically asked to implement reusable middleware: requireAuth(), requirePermission(), requireRole(), requireOwnership(), requireClassAccess(), requireSubjectAccess()

/**
 * Check if user has specific roles.
 *
 * BYPASS POLICY (Fix A):
 *  - super_admin implicitly passes every role check (they are the highest role).
 *  - 'admin' and 'faculty' are legacy aliases: when listed as allowed roles they
 *    expand to canonical equivalents, but super_admin implicit pass is the only
 *    unconditional bypass.
 *  - No other implicit promotion occurs.
 */
exports.requireRole = (...roles) => {
  return (req, res, next) => {
    if (!req.user) return next(new ErrorResponse('Not authenticated', 401));

    // super_admin can access any role-gated route.
    if (req.user.role === 'super_admin') return next();

    const expandedRoles = new Set(roles);
    // Expand legacy aliases when the caller allows them.
    if (expandedRoles.has('admin')) {
      expandedRoles.add('school_admin');
    }
    if (expandedRoles.has('faculty')) {
      expandedRoles.add('teacher');
      expandedRoles.add('class_teacher');
    }
    if (!expandedRoles.has(req.user.role)) {
      return next(new ErrorResponse('Role not authorized to access this resource', 403));
    }
    next();
  };
};

/**
 * Check granular permissions.
 *
 * BYPASS POLICY (Fix A):
 *  - super_admin has the wildcard '*' permission in the matrix and bypasses the
 *    loop for performance only.
 *  - school_admin and 'admin' (legacy alias) must pass through the normal
 *    permission matrix. They have an explicit, broad set of permissions defined
 *    in PERMISSIONS.SCHOOL_ADMIN. If a route requires a permission not in that
 *    set, they are correctly denied.
 *  - No other role receives an implicit bypass.
 */
exports.requirePermission = (...permissions) => {
  return (req, res, next) => {
    if (!req.user) return next(new ErrorResponse('Not authenticated', 401));

    // Only super_admin gets an unconditional pass (they hold '*' in the matrix).
    if (req.user.role === 'super_admin') return next();

    const rolePerms = getRolePermissions(req.user.role);
    const userPerms = req.user.permissions || [];

    // Calculate final effective permissions.
    // Precedence: USER overrides ROLE.
    // '-perm' in userPerms DENIES 'perm' even if role allows it.
    // 'perm' in userPerms ALLOWS 'perm' even if role denies it.
    let effectivePerms = new Set(rolePerms);
    userPerms.forEach(p => {
      if (p.startsWith('-')) {
        effectivePerms.delete(p.substring(1));
      } else {
        effectivePerms.add(p);
      }
    });

    const hasPermission = permissions.some(p => effectivePerms.has(p) || effectivePerms.has('*'));

    if (!hasPermission) {
      return next(new ErrorResponse(`Permission denied. Required: ${permissions.join(' or ')}`, 403));
    }
    next();
  };
};

exports.requireAllPermissions = (...permissions) => {
  return (req, res, next) => {
    if (!req.user) return next(new ErrorResponse('Not authenticated', 401));

    // Only super_admin gets an unconditional pass.
    if (req.user.role === 'super_admin') return next();

    const rolePerms = getRolePermissions(req.user.role);
    const userPerms = req.user.permissions || [];

    let effectivePerms = new Set(rolePerms);
    userPerms.forEach(p => {
      if (p.startsWith('-')) {
        effectivePerms.delete(p.substring(1));
      } else {
        effectivePerms.add(p);
      }
    });

    if (effectivePerms.has('*')) return next();

    const hasPermission = permissions.every(p => effectivePerms.has(p));

    if (!hasPermission) {
      return next(new ErrorResponse(`Permission denied. Required all of: ${permissions.join(', ')}`, 403));
    }
    next();
  };
};


/**
 * Prevent IDOR by checking resource ownership
 * modelName: e.g. 'Student', 'Attendance', 'Homework'
 * resourceIdParam: e.g. 'id'
 */
exports.requireOwnership = (modelName, resourceIdParam = 'id') => {
  return async (req, res, next) => {
    if (!req.user) return next(new ErrorResponse('Not authenticated', 401));
    
    // Admins bypass
    if (['super_admin', 'school_admin', 'admin', 'principal'].includes(req.user.role)) return next();

    try {
      const Model = require(`../models/${modelName}`);
      const resourceId = req.params[resourceIdParam] || req.body[resourceIdParam] || req.query[resourceIdParam];
      
      if (!resourceId) return next(); // If no ID is provided, nothing to check ownership against here.

      // If user is a student, verify if the ID matches their student ID
      if (req.user.role === 'student') {
        const student = await Student.findOne({ user: req.user._id });
        if (!student) return next(new ErrorResponse('Student profile not found', 404));
        
        if (modelName === 'Student' && resourceId.toString() !== student._id.toString()) {
          return next(new ErrorResponse('Access denied. You can only access your own profile.', 403));
        } else if (modelName !== 'Student') {
          // For other resources (Attendance, Marks, etc.), check if the resource's student field matches
          const resource = await Model.findById(resourceId);
          if (resource && resource.student && resource.student.toString() !== student._id.toString()) {
             return next(new ErrorResponse('Access denied. Resource does not belong to you.', 403));
          }
        }
      }

      // If user is a parent, verify if the resource belongs to one of their children
      if (req.user.role === 'parent') {
        const parent = await Parent.findOne({ user: req.user._id });
        if (!parent || !parent.children) return next(new ErrorResponse('Parent profile not found', 404));
        
        const childIds = parent.children.map(id => id.toString());

        if (modelName === 'Student' && !childIds.includes(resourceId.toString())) {
          return next(new ErrorResponse('Access denied. You can only access your own children.', 403));
        } else if (modelName !== 'Student') {
          const resource = await Model.findById(resourceId);
          if (resource && resource.student && !childIds.includes(resource.student.toString())) {
             return next(new ErrorResponse('Access denied. Resource does not belong to your child.', 403));
          }
        }
      }

      next();
    } catch (error) {
      next(error);
    }
  };
};

/**
 * Require Class Access: 
 * Teacher -> must be assigned to the class (as class teacher or subject teacher)
 * Student -> must belong to the class
 * Parent -> child must belong to the class
 */
exports.requireClassAccess = (classParam = 'class') => {
  return async (req, res, next) => {
    if (!req.user) return next(new ErrorResponse('Not authenticated', 401));
    if (['super_admin', 'school_admin', 'admin', 'principal'].includes(req.user.role)) return next();

    try {
      const classLevel = req.params[classParam] || req.body[classParam] || req.query[classParam];
      if (!classLevel) return next(); // If no class specified, skip check (let the controller handle scoping)

      if (req.user.role === 'student') {
        const student = await Student.findOne({ user: req.user._id });
        if (student && student.class !== classLevel) {
          return next(new ErrorResponse(`Access denied. You do not belong to class ${classLevel}`, 403));
        }
      }

      if (req.user.role === 'parent') {
        const parent = await Parent.findOne({ user: req.user._id }).populate('children');
        const hasChildInClass = parent.children.some(child => child.class === classLevel);
        if (!hasChildInClass) {
          return next(new ErrorResponse(`Access denied. You do not have children in class ${classLevel}`, 403));
        }
      }

      if (['teacher', 'class_teacher', 'faculty'].includes(req.user.role)) {
        const faculty = await Faculty.findOne({ user: req.user._id });
        const isClassTeacher = faculty.classTeacherOf && faculty.classTeacherOf.class === classLevel;
        
        const allocations = await SubjectAllocation.find({ teacher: faculty._id, class: classLevel });
        const isSubjectTeacher = allocations.length > 0;

        if (!isClassTeacher && !isSubjectTeacher) {
          return next(new ErrorResponse(`Access denied. You are not assigned to class ${classLevel}`, 403));
        }
      }

      next();
    } catch (error) {
      next(error);
    }
  };
};

/**
 * Require Subject Access:
 * Teacher must teach this subject in this class
 */
exports.requireSubjectAccess = (classParam = 'class', subjectParam = 'subject') => {
  return async (req, res, next) => {
    if (!req.user) return next(new ErrorResponse('Not authenticated', 401));
    if (['super_admin', 'school_admin', 'admin', 'principal'].includes(req.user.role)) return next();

    // Students and Parents just need class access, which should be checked by requireClassAccess
    if (['student', 'parent'].includes(req.user.role)) return next();

    try {
      const classLevel = req.params[classParam] || req.body[classParam] || req.query[classParam];
      const subject = req.params[subjectParam] || req.body[subjectParam] || req.query[subjectParam];

      if (!classLevel || !subject) return next();

      if (['teacher', 'class_teacher', 'faculty'].includes(req.user.role)) {
        const faculty = await Faculty.findOne({ user: req.user._id });
        const allocation = await SubjectAllocation.findOne({ teacher: faculty._id, class: classLevel, subject });
        if (!allocation) {
          return next(new ErrorResponse(`Access denied. You do not teach ${subject} in class ${classLevel}`, 403));
        }
      }
      next();
    } catch (error) {
      next(error);
    }
  };
};
