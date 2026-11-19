'use strict';
/**
 * upload.controller.js — Authenticated file download & upload controllers
 *
 * All files stored under FILE_UPLOAD_PATH are served ONLY through this
 * authenticated endpoint.
 *
 * Authorization policy (Phase 22.4A):
 *   - profiles/     : Any authenticated user (self, students, staff, parents viewing profiles).
 *   - documents/    : Private student documents & admission files.
 *                     Verified against Student and Admission records.
 *                     - Student: only own documents.
 *                     - Parent: only linked student's documents.
 *                     - Management: authorized.
 *                     - Teachers: denied access to general student documents.
 *                     - Unregistered/guessed filenames: rejected with 404.
 *   - attachments/  : Verified against Homework, Notice, and Event records.
 *                     - Homework assignments: managers, teachers, students in class, parents of students in class.
 *                     - Homework submissions: managers, homework teacher, and the submitting student/parent ONLY.
 *                     - Notices: target audience and class filtering enforced.
 *                     - Events: target audience enforced.
 *                     - Unregistered/guessed filenames: rejected with 404.
 */

const path    = require('path');
const fs      = require('fs');
const Student = require('../models/Student');
const Admission = require('../models/Admission');
const Homework = require('../models/Homework');
const Notice = require('../models/Notice');
const Event = require('../models/Event');
const Parent = require('../models/Parent');
const { resolveFilePath } = require('../services/upload.service');
const ErrorResponse       = require('../utils/errorResponse');

const MANAGER_ROLES = new Set(['super_admin', 'school_admin', 'admin', 'principal', 'academic_coordinator']);

/**
 * GET /api/v1/uploads/:category/:filename
 *
 * Serves a stored file after verifying authentication, resource association,
 * and fine-grained ownership / audience rules.
 */
exports.downloadFile = async (req, res, next) => {
  try {
    const { category, filename } = req.params;

    if (!req.user) {
      return next(new ErrorResponse('Not authenticated', 401));
    }

    const role   = String(req.user?.role || '').toLowerCase();
    const userId = String(req.user?._id || req.user?.id || '');

    // ── 1. Category-specific authorization ──────────────────────────────────
    if (category === 'profiles') {
      // Authenticated users across the school community can view profile photos.
    } else if (category === 'documents') {
      let authorized = false;

      // Check if document belongs to a Student record
      const student = await Student.findOne({ 'documents.url': { $regex: filename } });
      if (student) {
        if (MANAGER_ROLES.has(role)) {
          authorized = true;
        } else if (role === 'student') {
          if (String(student.user) === userId) {
            authorized = true;
          } else {
            return next(new ErrorResponse('Not authorized to access this student document', 403));
          }
        } else if (role === 'parent') {
          if (String(student.parentUser) === userId) {
            authorized = true;
          } else {
            const parent = await Parent.findOne({ user: userId });
            const childIds = Array.isArray(parent?.children)
              ? parent.children.map(id => String(id?._id || id))
              : [];
            if (childIds.includes(String(student._id))) {
              authorized = true;
            } else {
              return next(new ErrorResponse('Not authorized to access this student document', 403));
            }
          }
        } else {
          // Teachers and other non-management roles must not access private student documents
          return next(new ErrorResponse('Not authorized to access private student documents', 403));
        }
      } else {
        // Check if document belongs to an Admission record
        const admission = await Admission.findOne({
          $or: [
            { 'documents.url': { $regex: filename } },
            { photo: { $regex: filename } },
          ],
        });
        if (admission) {
          if (MANAGER_ROLES.has(role) || role === 'admission_officer') {
            authorized = true;
          } else {
            return next(new ErrorResponse('Not authorized to access this admission document', 403));
          }
        } else {
          // File not registered in any student or admission record — reject to prevent guessing
          return next(new ErrorResponse('Document not found', 404));
        }
      }

      if (!authorized) {
        return next(new ErrorResponse('Not authorized to download this document', 403));
      }

    } else if (category === 'attachments') {
      let authorized = false;

      // ── Check Homework ───────────────────────────────────────────────────
      const homework = await Homework.findOne({
        $or: [
          { 'attachments.url': { $regex: filename } },
          { 'submissions.attachments.url': { $regex: filename } },
        ],
      });

      if (homework) {
        const isSubmissionAttachment = (homework.submissions || []).some(s =>
          (s.attachments || []).some(a => (a.url || '').includes(filename))
        );

        if (isSubmissionAttachment) {
          const submission = homework.submissions.find(s =>
            (s.attachments || []).some(a => (a.url || '').includes(filename))
          );
          if (MANAGER_ROLES.has(role) || String(homework.teacher) === userId) {
            authorized = true;
          } else if (submission) {
            const submittingStudent = await Student.findById(submission.student);
            if (submittingStudent && String(submittingStudent.user) === userId) {
              authorized = true;
            } else if (submittingStudent) {
              const parent = await Parent.findOne({ user: userId });
              const childIds = Array.isArray(parent?.children)
                ? parent.children.map(id => String(id?._id || id))
                : [];
              if (String(submittingStudent.parentUser) === userId || childIds.includes(String(submittingStudent._id))) {
                authorized = true;
              } else {
                return next(new ErrorResponse('Not authorized to access this homework submission attachment', 403));
              }
            } else {
              return next(new ErrorResponse('Not authorized to access this homework submission attachment', 403));
            }
          } else {
            return next(new ErrorResponse('Not authorized to access this homework submission attachment', 403));
          }
        } else {
          // General homework assignment attachment
          if (MANAGER_ROLES.has(role) || ['teacher', 'class_teacher', 'faculty'].includes(role)) {
            authorized = true;
          } else if (role === 'student') {
            const student = await Student.findOne({ user: userId, isActive: { $ne: false } });
            if (student && student.class === homework.class) {
              authorized = true;
            } else {
              return next(new ErrorResponse('Not authorized to view attachments for this class', 403));
            }
          } else if (role === 'parent') {
            const parent = await Parent.findOne({ user: userId });
            const childIds = Array.isArray(parent?.children)
              ? parent.children.map(id => id?._id || id)
              : [];
            const childInClass = await Student.findOne({
              $or: [{ parentUser: userId }, { _id: { $in: childIds } }],
              class: homework.class,
              isActive: { $ne: false },
            });
            if (childInClass) {
              authorized = true;
            } else {
              return next(new ErrorResponse('Not authorized to view attachments for this class', 403));
            }
          } else {
            return next(new ErrorResponse('Not authorized to access this homework attachment', 403));
          }
        }
      } else {
        // ── Check Notice ───────────────────────────────────────────────────
        const notice = await Notice.findOne({
          'attachments.url': { $regex: filename },
          isActive: { $ne: false },
          isPublished: { $ne: false },
        });

        if (notice) {
          if (MANAGER_ROLES.has(role)) {
            authorized = true;
          } else {
            const audiences = Array.isArray(notice.targetAudience) ? notice.targetAudience : [];
            const audienceAll = audiences.includes('All');
            const audienceMatch = audienceAll ||
              (role === 'student' && audiences.includes('Students')) ||
              (['teacher', 'class_teacher', 'faculty'].includes(role) && audiences.includes('Faculty')) ||
              (role === 'parent' && audiences.includes('Parents')) ||
              (['admin', 'school_admin'].includes(role) && audiences.includes('Admin'));

            if (!audienceMatch) {
              return next(new ErrorResponse('Not authorized to view this notice attachment', 403));
            }

            if (role === 'student') {
              const student = await Student.findOne({ user: userId });
              const classes = Array.isArray(notice.targetClasses) ? notice.targetClasses : [];
              if (classes.length && !classes.includes('All') && (!student || !classes.includes(student.class))) {
                return next(new ErrorResponse('Not authorized to view notice attachments for this class', 403));
              }
            }
            authorized = true;
          }
        } else {
          // ── Check Event ──────────────────────────────────────────────────
          const event = await Event.findOne({ 'attachments.url': { $regex: filename } });
          if (event) {
            if (MANAGER_ROLES.has(role)) {
              authorized = true;
            } else {
              const audiences = Array.isArray(event.targetAudience) ? event.targetAudience : [];
              const audienceMatch = audiences.includes('All') ||
                (role === 'student' && audiences.includes('Students')) ||
                (['teacher', 'class_teacher', 'faculty'].includes(role) && audiences.includes('Teachers')) ||
                (role === 'parent' && audiences.includes('Parents')) ||
                audiences.includes('Staff');
              if (audienceMatch) {
                authorized = true;
              } else {
                return next(new ErrorResponse('Not authorized to view this event attachment', 403));
              }
            }
          } else {
            // Unregistered/guessed attachment filename
            return next(new ErrorResponse('Attachment not found', 404));
          }
        }
      }

      if (!authorized) {
        return next(new ErrorResponse('Not authorized to access this attachment', 403));
      }
    } else {
      return next(new ErrorResponse('Unknown upload category', 404));
    }

    // ── 2. Resolve the path with traversal protection ────────────────────────
    let filePath;
    try {
      filePath = resolveFilePath(category, filename);
    } catch (err) {
      return next(err);
    }

    // ── 3. Verify the file exists on disk ────────────────────────────────────
    try {
      await fs.promises.access(filePath, fs.constants.R_OK);
    } catch {
      return next(new ErrorResponse('File not found', 404));
    }

    // ── 4. Determine content-type from extension ─────────────────────────────
    const ext = path.extname(filename).toLowerCase();
    const CONTENT_TYPES = {
      '.jpg':  'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png':  'image/png',
      '.webp': 'image/webp',
      '.gif':  'image/gif',
      '.pdf':  'application/pdf',
      '.doc':  'application/msword',
      '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    };
    const contentType = CONTENT_TYPES[ext] || 'application/octet-stream';

    // ── 5. Security headers ──────────────────────────────────────────────────
    const isImage = ['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(ext);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Type', contentType);
    res.setHeader(
      'Content-Disposition',
      isImage ? 'inline' : `attachment; filename="${filename}"`
    );

    if (category === 'documents') {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    } else {
      res.setHeader('Cache-Control', 'private, max-age=3600');
    }

    res.sendFile(filePath);
  } catch (err) {
    next(err);
  }
};
