/**
 * Canonical Role-Permission Matrix
 * Defines base permissions for each role in the system.
 */

const PERMISSIONS = {
  STUDENT: [
    'students.view-own',
    'attendance.view-own',
    'homework.view',
    'homework.submit',
    'assignments.view',
    'assignments.submit',
    'materials.view',
    'timetable.view-own',
    'exams.view',
    'results.view-own',
    'fees.view-own',
    'library.view-own',
    'transport.view-own',
    'notices.view',
    'events.view',
    'leave.apply',
    'messages.view',
    'messages.send',
    'profile.view-own',
    'notifications.view'
  ],
  PARENT: [
    'students.view-linked',
    'attendance.view-linked',
    'homework.view-linked',
    'assignments.view-linked',
    'timetable.view-linked',
    'exams.view-linked',
    'results.view-linked',
    'fees.view-linked',
    'library.view-linked',
    'transport.view-linked',
    'notices.view',
    'events.view',
    'leave.apply',
    'messages.view-linked',
    'messages.send-linked',
    'notifications.view'
  ],
  TEACHER: [
    'classes.view-assigned',
    'students.view-assigned',
    'attendance.view-assigned',
    'attendance.mark',
    'attendance.edit-authorized',
    'homework.view',
    'homework.create',
    'homework.update-own',
    'homework.review',
    'assignments.create',
    'assignments.review',
    'materials.create',
    'materials.update-own',
    'marks.enter',
    'marks.update-authorized',
    'exams.view-assigned',
    'timetable.view-assigned',
    'timetable.view-own',
    'messages.view-authorized',
    'messages.reply',
    'leave.apply',
    'notifications.view'
  ],
  CLASS_TEACHER: [
    // Inherits all TEACHER permissions, plus class-level oversight
    'classes.view-assigned',
    'students.view-assigned',
    'attendance.view-assigned',
    'attendance.mark',
    'attendance.edit-authorized',
    'homework.view',
    'homework.create',
    'homework.update-own',
    'homework.review',
    'assignments.create',
    'assignments.review',
    'materials.create',
    'materials.update-own',
    'marks.enter',
    'marks.update-authorized',
    'exams.view-assigned',
    'timetable.view-assigned',
    'timetable.view-own',
    'messages.view-authorized',
    'messages.reply',
    'leave.apply',
    'notifications.view',
    'reports.view-class'
  ],
  ACCOUNTANT: [
    'fees.view',
    'fees.create',
    'fees.collect',
    'fees.update-authorized',
    'fees.receipt',
    'fees.report',
    'students.view-basic'
  ],
  LIBRARIAN: [
    'library.view',
    'library.manage',
    'library.issue',
    'library.return',
    'library.fine',
    'students.view-basic'
  ],
  TRANSPORT_ADMIN: [
    'transport.view',
    'transport.manage',
    'transport.assign',
    'students.view-transport-basic'
  ],
  ADMISSION_OFFICER: [
    'admissions.view',
    'admissions.review',
    'admissions.approve',
    'admissions.reject'
  ],
  EXAM_COORDINATOR: [
    'exams.view',
    'exams.create',
    'exams.update',
    'marks.view',
    'marks.approve',
    'results.generate',
    'results.publish'
  ],
  PRINCIPAL: [
    'students.view',
    'teachers.view',
    'attendance.view',
    'attendance.report',
    'exams.view',
    'marks.view',
    'results.view',
    'results.publish',
    'fees.report',
    'library.report',
    'admissions.view',
    'admissions.approve',
    'reports.view',
    'reports.export',
    'notices.create',
    'leave.view',
    'leave.approve'
  ],
  VICE_PRINCIPAL: [
    'students.view',
    'teachers.view',
    'attendance.view',
    'attendance.report',
    'exams.view',
    'results.view',
    'reports.view',
    'notices.create'
  ],
  ACADEMIC_COORDINATOR: [
    'classes.view',
    'classes.manage',
    'subjects.view',
    'subjects.manage',
    'teachers.view',
    'students.view',
    'timetable.view',
    'timetable.manage',
    'exams.view'
  ],
  SCHOOL_ADMIN: [
    'students.view',
    'students.create',
    'students.update',
    'students.promote',
    'students.transfer',
    'students.tc',
    'teachers.view',
    'teachers.create',
    'teachers.update',
    'classes.view',
    'classes.manage',
    'subjects.view',
    'subjects.manage',
    'attendance.view',
    'attendance.report',
    'fees.report',
    'transport.report',
    'library.report',
    'notices.create',
    'notices.update',
    'notices.delete',
    'events.create',
    'events.update',
    'events.delete',
    'users.view',
    'users.create',
    'users.update',
    'users.disable',
    'reports.view',
    'reports.export',
    'cms.view',
    'cms.manage',
    'settings.view',
    'settings.manage'
  ],
  SUPER_ADMIN: [
    '*'
  ],
  DRIVER: [
    'transport.view-own-route',
    'students.view-transport-basic'
  ],
  RECEPTIONIST: [
    'students.view-basic',
    'admissions.view',
    'visitors.manage',
    'messages.send'
  ],
  HR: [
    'teachers.view',
    'teachers.create',
    'teachers.update',
    'users.view',
    'leave.approve',
    'leave.reject',
    'leave.view'
  ],
  STAFF: [
    'leave.apply',
    'notices.view',
    'events.view',
    'profile.view-own'
  ]
};

const getRolePermissions = (role) => {
  const upperRole = (role || '').toUpperCase();
  return PERMISSIONS[upperRole] || [];
};

module.exports = {
  PERMISSIONS,
  getRolePermissions
};
