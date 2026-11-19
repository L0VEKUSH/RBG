'use strict';

const STUDENT_VISIBLE_EXAM_STATUSES = Object.freeze([
  'Scheduled', 'Ongoing', 'Completed', 'ResultPublished',
]);

function publishedExamFilter() {
  return {
    isActive: { $ne: false },
    status: { $in: [...STUDENT_VISIBLE_EXAM_STATUSES] },
  };
}

function isPublishedExam(exam) {
  return Boolean(exam)
    && exam.isActive !== false
    && STUDENT_VISIBLE_EXAM_STATUSES.includes(exam.status);
}

module.exports = {
  STUDENT_VISIBLE_EXAM_STATUSES,
  publishedExamFilter,
  isPublishedExam,
};
