const Student = require('../models/Student');
const Faculty = require('../models/Faculty');
const Parent = require('../models/Parent');
const SubjectAllocation = require('../models/SubjectAllocation');
const ErrorResponse = require('../utils/errorResponse');

const FULL_STUDENT_ACCESS_ROLES = new Set([
  'super_admin', 'school_admin', 'admin', 'principal', 'vice_principal',
  'academic_coordinator', 'admission_officer',
]);
const BASIC_STUDENT_ACCESS_ROLES = new Set([
  'accountant', 'librarian', 'receptionist', 'driver', 'transport_admin',
]);
const BASIC_STUDENT_FIELDS = 'admissionNumber class rollNumber academicYear isActive user';

const toId = (value) => value && value._id ? value._id : value;

async function getStudentAccess(user) {
  if (!user || !user._id) throw new ErrorResponse('Not authenticated', 401);
  const role = user.role;

  if (FULL_STUDENT_ACCESS_ROLES.has(role)) return { filter: {}, basic: false };
  if (BASIC_STUDENT_ACCESS_ROLES.has(role)) return { filter: {}, basic: true };

  if (role === 'student') {
    const student = await Student.findOne({ user: user._id }).select('_id');
    if (!student) throw new ErrorResponse('Student profile not found', 404);
    return { filter: { _id: student._id }, basic: false };
  }

  if (role === 'parent') {
    const parent = await Parent.findOne({ user: user._id }).select('children');
    const legacyStudents = await Student.find({ parentUser: user._id }).select('_id');
    const childIdSet = new Set();
    for (const child of (parent?.children || [])) {
      const id = toId(child);
      if (id) childIdSet.add(String(id));
    }
    for (const student of legacyStudents) {
      if (student?._id) childIdSet.add(String(student._id));
    }
    const childIds = Array.from(childIdSet);
    if (!childIds.length) {
      if (!parent && !legacyStudents.length) {
        throw new ErrorResponse('Parent profile not found', 404);
      }
      return { filter: { _id: { $in: [] } }, basic: false };
    }
    return { filter: { _id: { $in: childIds } }, basic: false };
  }

  if (['teacher', 'class_teacher', 'faculty'].includes(role)) {
    const faculty = await Faculty.findOne({ user: user._id, isActive: true }).select('_id classTeacherOf');
    if (!faculty) throw new ErrorResponse('Teacher profile not found', 404);

    const assignments = await SubjectAllocation.find({ teacher: faculty._id }).select('class academicYear');
    const scopes = [];
    if (faculty.classTeacherOf && faculty.classTeacherOf.class && faculty.classTeacherOf.academicYear) {
      const classScope = { class: faculty.classTeacherOf.class };
      classScope.academicYear = faculty.classTeacherOf.academicYear;
      scopes.push(classScope);
    }
    for (const assignment of assignments) {
      if (assignment.class && assignment.academicYear) {
        scopes.push({ class: assignment.class, academicYear: assignment.academicYear });
      }
    }
    const uniqueScopes = [...new Map(scopes.map((scope) => [JSON.stringify(scope), scope])).values()];
    return {
      filter: uniqueScopes.length ? { $or: uniqueScopes } : { _id: { $in: [] } },
      basic: false,
    };
  }

  throw new ErrorResponse('Role is not authorized to view student records', 403);
}

async function assertStudentAccess(user, studentId) {
  const { filter } = await getStudentAccess(user);
  const accessible = await Student.exists({ $and: [filter, { _id: studentId }] });
  if (!accessible) throw new ErrorResponse('Student not found', 404);
  return true;
}

module.exports = {
  BASIC_STUDENT_FIELDS,
  FULL_STUDENT_ACCESS_ROLES,
  getStudentAccess,
  assertStudentAccess,
};
