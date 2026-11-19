'use strict';

const Homework = require('../models/Homework');
const Student = require('../models/Student');
const Parent = require('../models/Parent');
const Faculty = require('../models/Faculty');
const SubjectAllocation = require('../models/SubjectAllocation');
const ErrorResponse = require('../utils/errorResponse');
const { getRolePermissions } = require('../config/permissions');
const { normalizeHomeworkSubmission } = require('../validators/homework.validator');

const TEACHER_ROLES = new Set(['teacher', 'class_teacher', 'faculty']);
const ADMIN_ROLES = new Set(['super_admin', 'school_admin', 'admin']);
const STUDENT_ROLES = new Set(['student']);
const PARENT_ROLES = new Set(['parent']);
const UPDATE_FIELDS = ['title', 'description', 'dueDate', 'attachments'];

const idOf = value => value && value._id ? value._id : value;
const sameId = (left, right) => String(idOf(left)) === String(idOf(right));

function effectivePermissions(user) {
  const permissions = new Set(getRolePermissions(user?.role));
  for (const permission of Array.isArray(user?.permissions) ? user.permissions : []) {
    if (typeof permission !== 'string') continue;
    if (permission.startsWith('-')) permissions.delete(permission.slice(1));
    else permissions.add(permission);
  }
  return permissions;
}

function hasAnyPermission(user, permissionNames) {
  const role = String(user?.role || '').toLowerCase();
  if (role === 'super_admin') return true;
  const permissions = effectivePermissions(user);
  return permissionNames.some(permission => permissions.has(permission));
}

function canReviewSubmissions(user) {
  const role = String(user?.role || '').toLowerCase();
  return (TEACHER_ROLES.has(role) || ADMIN_ROLES.has(role)) &&
    hasAnyPermission(user, ['homework.review']);
}

function canManageAnyHomework(user) {
  const role = String(user?.role || '').toLowerCase();
  return ADMIN_ROLES.has(role) && hasAnyPermission(user, ['homework.manage', 'homework.manage-any']);
}

function canUpdateOwnHomework(user) {
  const role = String(user?.role || '').toLowerCase();
  return (TEACHER_ROLES.has(role) || ADMIN_ROLES.has(role)) &&
    hasAnyPermission(user, ['homework.update-own']);
}

function canCreateAnyHomework(user) {
  const role = String(user?.role || '').toLowerCase();
  return ADMIN_ROLES.has(role) && hasAnyPermission(user, ['homework.create', 'homework.manage']);
}

function requireHomeworkAccess(user, allowedRoles, permissions, message = 'Not authorized to access homework') {
  const role = String(user?.role || '').toLowerCase();
  if (!allowedRoles.has(role) || !hasAnyPermission(user, permissions)) {
    throw new ErrorResponse(message, 403);
  }
}

function toAttachmentDto(attachment) {
  if (!attachment || typeof attachment !== 'object') return null;
  return {
    name: attachment.name,
    url: attachment.url,
    type: attachment.type,
  };
}

function toSubmissionDto(submission, includeStudentId = false) {
  if (!submission) return null;
  const result = {
    _id: idOf(submission._id) ? String(idOf(submission._id)) : undefined,
    submittedAt: submission.submittedAt || null,
    content: submission.content || '',
    attachments: Array.isArray(submission.attachments)
      ? submission.attachments.map(toAttachmentDto).filter(Boolean)
      : [],
    grade: submission.grade || null,
    feedback: submission.feedback || null,
    status: String(submission.status || 'Pending').toLowerCase(),
  };
  if (includeStudentId && submission.student) result.studentId = String(idOf(submission.student));
  return result;
}

function toHomeworkBaseDto(homework) {
  return {
    _id: String(idOf(homework._id || homework.id)),
    title: homework.title,
    description: homework.description || '',
    class: homework.class,
    subject: homework.subject,
    dueDate: homework.dueDate,
    attachments: Array.isArray(homework.attachments)
      ? homework.attachments.map(toAttachmentDto).filter(Boolean)
      : [],
    academicYear: homework.academicYear,
  };
}

function toStudentHomeworkDto(homework, student) {
  const ownSubmission = (homework.submissions || []).find((submission) => sameId(submission.student, student._id));
  const dto = toHomeworkBaseDto(homework);
  dto.status = String(ownSubmission?.status || 'Pending').toLowerCase();
  dto.submission = toSubmissionDto(ownSubmission);
  return dto;
}

function toParentHomeworkDto(homework, student) {
  const dto = toStudentHomeworkDto(homework, student);
  dto.studentId = String(idOf(student._id));
  return dto;
}

function toPrivilegedHomeworkDto(homework, user) {
  const dto = toHomeworkBaseDto(homework);
  if (canReviewSubmissions(user)) {
    dto.submissions = (homework.submissions || []).map((submission) => toSubmissionDto(submission, true));
  }
  return dto;
}

function sameSubmissionPayload(submission, payload) {
  if (String(submission?.content || '').trim() !== payload.content) return false;
  const currentAttachments = Array.isArray(submission?.attachments) ? submission.attachments : [];
  if (currentAttachments.length !== payload.attachments.length) return false;
  return payload.attachments.every((attachment, index) => {
    const current = currentAttachments[index];
    return String(current?.name || '') === attachment.name &&
      String(current?.url || '') === attachment.url &&
      String(current?.type || '') === attachment.type;
  });
}

function buildStudentHomeworkFilter(student) {
  if (!student || !student.class || !student.academicYear) return null;
  return {
    class: student.class,
    academicYear: student.academicYear,
    isActive: { $ne: false },
  };
}

function buildOwnerFilter(homeworkId, user) {
  return { _id: homeworkId, teacher: idOf(user?._id) };
}

function createHomeworkService({
  Homework: HomeworkModel,
  Student: StudentModel,
  Parent: ParentModel,
  Faculty: FacultyModel,
  SubjectAllocation: SubjectAllocationModel,
}) {
  async function findStudentForUser(userId) {
    if (!idOf(userId)) return null;
    return StudentModel.findOne({ user: idOf(userId), isActive: { $ne: false } });
  }

  async function findLinkedStudents(parentUserId) {
    if (!idOf(parentUserId)) throw new ErrorResponse('Linked student not found', 404);
    const parent = await ParentModel.findOne({ user: idOf(parentUserId) });
    const childIds = Array.isArray(parent?.children) ? parent.children.map(idOf).filter(Boolean) : [];
    return StudentModel.find({
      isActive: { $ne: false },
      $or: [
        { _id: { $in: childIds } },
        { parentUser: idOf(parentUserId) },
      ],
    });
  }

  async function findTeacherAssignmentScopes(user) {
    if (!idOf(user?._id)) return [];
    const faculty = await FacultyModel.findOne({
      user: idOf(user._id),
      isActive: { $ne: false },
    });
    if (!faculty) return [];

    const scopes = [];
    const classTeacher = faculty.classTeacherOf || {};
    if (classTeacher.class && classTeacher.academicYear) {
      // A class teacher's existing class/year assignment covers all subjects in that class.
      scopes.push({ class: String(classTeacher.class), academicYear: String(classTeacher.academicYear) });
    }

    let allocationQuery = SubjectAllocationModel.find({ teacher: idOf(faculty._id) });
    if (allocationQuery && typeof allocationQuery.populate === 'function') {
      allocationQuery = allocationQuery.populate('subject', 'name');
    }
    const allocations = await allocationQuery;
    for (const allocation of allocations || []) {
      if (!allocation.class || !allocation.academicYear || !allocation.subject) continue;
      const subjectId = idOf(allocation.subject);
      const subjectName = typeof allocation.subject === 'object' ? allocation.subject.name : null;
      const subjects = [...new Set([subjectId, subjectName].filter(Boolean).map(String))];
      if (!subjects.length) continue;
      scopes.push({
        class: String(allocation.class),
        academicYear: String(allocation.academicYear),
        subject: { $in: subjects },
      });
    }
    return scopes;
  }

  async function teacherHomeworkFilter(user, homeworkId = null, extraFilters = {}) {
    const assignmentScopes = await findTeacherAssignmentScopes(user);
    if (!assignmentScopes.length) return null;
    return {
      ...extraFilters,
      ...(homeworkId ? { _id: homeworkId } : {}),
      teacher: idOf(user._id),
      isActive: { $ne: false },
      $or: assignmentScopes,
    };
  }

  function authorizedAdministrator(user, permissions) {
    const role = String(user?.role || '').toLowerCase();
    return ADMIN_ROLES.has(role) && hasAnyPermission(user, permissions);
  }

  function studentScopes(students, requestedClass) {
    const scopes = [];
    for (const student of students) {
      if (!student.class || !student.academicYear) continue;
      if (requestedClass && String(student.class) !== String(requestedClass)) continue;
      const scope = { class: student.class, academicYear: student.academicYear };
      if (!scopes.some(existing => existing.class === scope.class && existing.academicYear === scope.academicYear)) {
        scopes.push(scope);
      }
    }
    return scopes;
  }

  async function getParentHomework(user, filters = {}, homeworkId = null, detail = false) {
    const linkedStudents = await findLinkedStudents(user._id);
    let students = linkedStudents || [];
    if (!students.length) throw new ErrorResponse('Linked student not found', 404);
    const requestedStudentId = filters.studentId;

    if (requestedStudentId) {
      students = students.filter(student => sameId(student._id, requestedStudentId));
      if (!students.length) {
        if (detail) return null;
        throw new ErrorResponse('Linked student not found', 404);
      }
    }

    const scopes = studentScopes(students, filters.class);
    if (!scopes.length) return detail ? null : [];

    const query = {
      $or: scopes,
      isActive: { $ne: false },
    };
    if (homeworkId) query._id = homeworkId;
    if (filters.academicYear) query.academicYear = filters.academicYear;

    const homeworkRows = await HomeworkModel.find(query);
    const rows = [];
    for (const homework of homeworkRows || []) {
      const relevantChildren = students.filter(student =>
        String(student.class) === String(homework.class) &&
        String(student.academicYear) === String(homework.academicYear));
      for (const child of relevantChildren) rows.push(toParentHomeworkDto(homework, child));
    }

    if (detail) {
      if (!rows.length) return null;
      if (requestedStudentId) return rows[0];
      const dto = toHomeworkBaseDto(homeworkRows[0]);
      dto.children = rows.map(row => ({
        studentId: row.studentId,
        status: row.status,
        submission: row.submission,
      }));
      return dto;
    }
    return rows;
  }

  async function listForStudent(user, filters = {}, homeworkId = null) {
    const student = await findStudentForUser(user._id);
    const scope = buildStudentHomeworkFilter(student);
    if (!scope) return homeworkId ? null : [];
    if (filters.class && String(filters.class) !== String(student.class)) return homeworkId ? null : [];

    const query = { ...scope };
    if (homeworkId) query._id = homeworkId;
    if (filters.academicYear && String(filters.academicYear) !== String(student.academicYear)) return homeworkId ? null : [];

    if (homeworkId) {
      const homework = await HomeworkModel.findOne(query);
      return homework ? toStudentHomeworkDto(homework, student) : null;
    }
    const homeworkRows = await HomeworkModel.find(query);
    return (homeworkRows || []).map(homework => toStudentHomeworkDto(homework, student));
  }

  async function getHomework(filters = {}, user) {
    const role = String(user?.role || '').toLowerCase();
    if (STUDENT_ROLES.has(role)) {
      requireHomeworkAccess(user, STUDENT_ROLES, ['homework.view', 'homework.view-own']);
      return listForStudent(user, filters);
    }
    if (PARENT_ROLES.has(role)) {
      requireHomeworkAccess(user, PARENT_ROLES, ['homework.view-linked']);
      return getParentHomework(user, filters);
    }
    if (TEACHER_ROLES.has(role)) {
      requireHomeworkAccess(user, TEACHER_ROLES, ['homework.view', 'homework.view-assigned']);
      const query = await teacherHomeworkFilter(user, null, {
        ...(filters.class ? { class: filters.class } : {}),
        ...(filters.academicYear ? { academicYear: filters.academicYear } : {}),
      });
      if (!query) throw new ErrorResponse('Teacher assignment not found', 403);
      const homeworkRows = await HomeworkModel.find(query);
      return (homeworkRows || []).map(homework => toPrivilegedHomeworkDto(homework, user));
    }
    if (!authorizedAdministrator(user, ['homework.view', 'homework.manage', 'homework.manage-any'])) {
      throw new ErrorResponse('Not authorized to access homework', 403);
    }

    const query = { isActive: { $ne: false } };
    if (filters.class) query.class = filters.class;
    if (filters.academicYear) query.academicYear = filters.academicYear;

    const homeworkRows = await HomeworkModel.find(query);
    return (homeworkRows || []).map(homework => toPrivilegedHomeworkDto(homework, user));
  }

  async function getStudentHomework(user) {
    if (!user || typeof user !== 'object' || Array.isArray(user)) {
      throw new ErrorResponse('Authenticated user context is required', 403);
    }
    return getHomework({}, user);
  }

  async function getHomeworkByClass(classLevel, user) {
    return getHomework({ class: classLevel }, user);
  }

  async function getHomeworkById(id, user, filters = {}) {
    const role = String(user?.role || '').toLowerCase();
    if (STUDENT_ROLES.has(role)) {
      requireHomeworkAccess(user, STUDENT_ROLES, ['homework.view', 'homework.view-own']);
      return listForStudent(user, filters, id);
    }
    if (PARENT_ROLES.has(role)) {
      requireHomeworkAccess(user, PARENT_ROLES, ['homework.view-linked']);
      return getParentHomework(user, filters, id, true);
    }
    if (TEACHER_ROLES.has(role)) {
      requireHomeworkAccess(user, TEACHER_ROLES, ['homework.view', 'homework.view-assigned']);
      const query = await teacherHomeworkFilter(user, id);
      if (!query) return null;
      const homework = await HomeworkModel.findOne(query);
      return homework ? toPrivilegedHomeworkDto(homework, user) : null;
    }
    if (!authorizedAdministrator(user, ['homework.view', 'homework.manage', 'homework.manage-any'])) {
      throw new ErrorResponse('Not authorized to access homework', 403);
    }

    const query = { _id: id, isActive: { $ne: false } };
    const homework = await HomeworkModel.findOne(query);
    return homework ? toPrivilegedHomeworkDto(homework, user) : null;
  }

  async function createHomework(data, user) {
    const homeworkData = { ...data };
    const role = String(user?.role || '').toLowerCase();
    const managerMayCreate = canCreateAnyHomework(user);
    const teacherMayCreate = TEACHER_ROLES.has(role) && hasAnyPermission(user, ['homework.create']);
    if (!managerMayCreate && !teacherMayCreate) {
      throw new ErrorResponse('Not authorized to create homework', 403);
    }

    if (teacherMayCreate) {
      homeworkData.teacher = idOf(user?._id);
      const faculty = await FacultyModel.findOne({
        user: idOf(user?._id),
        isActive: { $ne: false },
      });
      if (!faculty) throw new ErrorResponse('Teacher assignment not found', 403);

      const classTeacher = faculty.classTeacherOf || {};
      const isAssignedClassTeacher = Boolean(homeworkData.class && classTeacher.class && classTeacher.academicYear) &&
        String(classTeacher.class) === String(homeworkData.class);
      let allocationQuery = SubjectAllocationModel.find({
        teacher: idOf(faculty._id),
        class: homeworkData.class,
      });
      if (allocationQuery && typeof allocationQuery.populate === 'function') {
        allocationQuery = allocationQuery.populate('subject', 'name');
      }
      const allocations = await allocationQuery;
      const assignedYears = new Set();

      if (isAssignedClassTeacher) assignedYears.add(String(classTeacher.academicYear));
      for (const allocation of allocations || []) {
        if (!allocation.academicYear) continue;
        const assignedSubject = allocation.subject;
        const subjectName = assignedSubject && typeof assignedSubject === 'object' ? assignedSubject.name : null;
        const subjectId = idOf(assignedSubject);
        const requestedSubject = String(homeworkData.subject || '').trim().toLowerCase();
        const subjectMatches = requestedSubject && (
          (subjectName && String(subjectName).trim().toLowerCase() === requestedSubject) ||
          (subjectId && String(subjectId) === String(homeworkData.subject))
        );
        if (subjectMatches) assignedYears.add(String(allocation.academicYear));
      }

      const requestedYear = homeworkData.academicYear ? String(homeworkData.academicYear) : '';
      if (requestedYear) {
        if (!assignedYears.has(requestedYear)) throw new ErrorResponse('Teacher is not assigned to this class and academic year', 403);
        homeworkData.academicYear = requestedYear;
      } else if (assignedYears.size === 1) {
        homeworkData.academicYear = [...assignedYears][0];
      } else if (assignedYears.size > 1) {
        throw new ErrorResponse('Select an academic year assigned to you for this class', 400);
      } else {
        throw new ErrorResponse('Teacher is not assigned to this class, year, and subject', 403);
      }
    }

    const homework = await HomeworkModel.create(homeworkData);
    return toHomeworkBaseDto(homework);
  }

  async function updateHomework(id, user, data) {
    const role = String(user?.role || '').toLowerCase();
    const adminMayUpdate = canManageAnyHomework(user);
    const ownerMayUpdate = canUpdateOwnHomework(user);
    if (!adminMayUpdate && !ownerMayUpdate) throw new ErrorResponse('Not authorized to update homework', 403);

    const set = {};
    for (const field of UPDATE_FIELDS) {
      if (!Object.prototype.hasOwnProperty.call(data || {}, field)) continue;
      set[field] = data[field];
    }
    if (!Object.keys(set).length) throw new ErrorResponse('No editable homework fields were provided', 400);

    let filter = adminMayUpdate
      ? { _id: id, isActive: { $ne: false } }
      : { ...buildOwnerFilter(id, user), isActive: { $ne: false } };
    if (!adminMayUpdate && TEACHER_ROLES.has(role)) {
      const scopedFilter = await teacherHomeworkFilter(user, id);
      if (!scopedFilter) throw new ErrorResponse('Homework not found', 404);
      filter = scopedFilter;
    }
    const homework = await HomeworkModel.findOneAndUpdate(
      filter,
      { $set: set },
      { new: true, runValidators: true }
    );
    if (!homework) throw new ErrorResponse('Homework not found', 404);
    return toPrivilegedHomeworkDto(homework, user);
  }

  async function deleteHomework(id, user) {
    const role = String(user?.role || '').toLowerCase();
    const adminMayUpdate = canManageAnyHomework(user);
    const ownerMayUpdate = canUpdateOwnHomework(user);
    if (!adminMayUpdate && !ownerMayUpdate) throw new ErrorResponse('Not authorized to delete homework', 403);

    let filter = adminMayUpdate
      ? { _id: id, isActive: { $ne: false } }
      : { ...buildOwnerFilter(id, user), isActive: { $ne: false } };
    if (!adminMayUpdate && TEACHER_ROLES.has(role)) {
      const scopedFilter = await teacherHomeworkFilter(user, id);
      if (!scopedFilter) throw new ErrorResponse('Homework not found', 404);
      filter = scopedFilter;
    }
    const homework = await HomeworkModel.findOneAndDelete(filter);
    if (!homework) throw new ErrorResponse('Homework not found', 404);
    return true;
  }

  async function submitHomework(homeworkId, user, data) {
    requireHomeworkAccess(user, STUDENT_ROLES, ['homework.submit']);
    const submissionPayload = normalizeHomeworkSubmission(data);
    if (typeof homeworkId !== 'string' || !/^[a-f\d]{24}$/i.test(homeworkId)) {
      throw new ErrorResponse('Homework not found', 404);
    }
    const student = await findStudentForUser(user._id);
    const scope = buildStudentHomeworkFilter(student);
    if (!scope) throw new ErrorResponse('Homework not found', 404);
    const homeworkFilter = { ...scope, _id: homeworkId };
    const homework = await HomeworkModel.findOne(homeworkFilter);
    if (!homework) throw new ErrorResponse('Homework not found', 404);

    const existingSubmissions = (homework.submissions || []).filter(submission =>
      sameId(submission.student, student._id)
    );
    if (existingSubmissions.length > 1) {
      throw new ErrorResponse('Multiple existing submissions were found for this student; contact a teacher before retrying.', 409);
    }
    const existingSubmission = existingSubmissions[0];
    if (existingSubmission && existingSubmission.status !== 'Pending') {
      if (sameSubmissionPayload(existingSubmission, submissionPayload)) {
        return { submission: toSubmissionDto(existingSubmission), created: false };
      }
      throw new ErrorResponse('A submission already exists and cannot be replaced.', 409);
    }

    const dueDate = new Date(homework.dueDate);
    if (!Number.isFinite(dueDate.getTime())) {
      throw new ErrorResponse('Homework deadline is invalid; contact a teacher before submitting.', 409);
    }
    const submittedAt = new Date();
    const status = submittedAt > dueDate ? 'Late' : 'Submitted';
    const dueDateGuard = homework.dueDate;
    let updatedHomework;

    if (existingSubmission) {
      updatedHomework = await HomeworkModel.findOneAndUpdate({
        ...homeworkFilter,
        dueDate: dueDateGuard,
        submissions: { $elemMatch: { student: student._id, status: 'Pending' } },
      }, {
        $set: {
          'submissions.$.content': submissionPayload.content,
          'submissions.$.attachments': submissionPayload.attachments,
          'submissions.$.submittedAt': submittedAt,
          'submissions.$.status': status,
        },
      }, { new: true, runValidators: true });
    } else {
      updatedHomework = await HomeworkModel.findOneAndUpdate({
        ...homeworkFilter,
        dueDate: dueDateGuard,
        submissions: { $not: { $elemMatch: { student: student._id } } },
      }, {
        $push: {
          submissions: {
            student: student._id,
            submittedAt,
            content: submissionPayload.content,
            attachments: submissionPayload.attachments,
            status,
          },
        },
      }, { new: true, runValidators: true });
    }

    if (!updatedHomework) {
      const latestHomework = await HomeworkModel.findOne(homeworkFilter);
      if (!latestHomework) throw new ErrorResponse('Homework not found', 404);
      const latestSubmissions = (latestHomework.submissions || []).filter(submission =>
        sameId(submission.student, student._id)
      );
      if (latestSubmissions.length > 1) {
        throw new ErrorResponse('Multiple existing submissions were found for this student; contact a teacher before retrying.', 409);
      }
      const latestSubmission = latestSubmissions[0];
      if (latestSubmission && latestSubmission.status !== 'Pending' &&
          sameSubmissionPayload(latestSubmission, submissionPayload)) {
        return { submission: toSubmissionDto(latestSubmission), created: false };
      }
      if (latestSubmission && latestSubmission.status !== 'Pending') {
        throw new ErrorResponse('A submission already exists and cannot be replaced.', 409);
      }
      throw new ErrorResponse('Homework changed while the submission was being saved. Reload and try again.', 409);
    }

    const savedSubmission = (updatedHomework.submissions || []).find(submission =>
      sameId(submission.student, student._id)
    );
    if (!savedSubmission) {
      throw new ErrorResponse('The server could not confirm the saved submission.', 503);
    }
    return {
      submission: toSubmissionDto(savedSubmission),
      created: !existingSubmission,
    };
  }

  async function reviewSubmission(homeworkId, submissionId, data, user) {
    if (!canReviewSubmissions(user)) throw new ErrorResponse('Not authorized to review homework', 403);
    const role = String(user?.role || '').toLowerCase();
    let homeworkFilter;
    if (TEACHER_ROLES.has(role)) {
      homeworkFilter = await teacherHomeworkFilter(user, homeworkId);
      if (!homeworkFilter) throw new ErrorResponse('Homework not found', 404);
    } else if (ADMIN_ROLES.has(role)) {
      homeworkFilter = { _id: homeworkId, isActive: { $ne: false } };
    } else {
      throw new ErrorResponse('Not authorized to review homework', 403);
    }
    const homework = await HomeworkModel.findOne(homeworkFilter);
    if (!homework) throw new ErrorResponse('Homework not found', 404);
    throw new ErrorResponse('Homework review is unavailable until its embedded-submission contract is completed', 501);
  }

  return {
    getHomework,
    getStudentHomework,
    getHomeworkByClass,
    getHomeworkById,
    createHomework,
    updateHomework,
    deleteHomework,
    submitHomework,
    reviewSubmission,
  };
}

module.exports = {
  ...createHomeworkService({ Homework, Student, Parent, Faculty, SubjectAllocation }),
  createHomeworkService,
  buildStudentHomeworkFilter,
  buildOwnerFilter,
  toStudentHomeworkDto,
};
