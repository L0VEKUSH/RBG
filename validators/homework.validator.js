'use strict';

const ErrorResponse = require('../utils/errorResponse');

const SUBMISSION_FIELDS = new Set(['content', 'attachments']);
const ATTACHMENT_FIELDS = new Set(['name', 'url']);

function normalizeHomeworkSubmission(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data) ||
      (Object.getPrototypeOf(data) !== Object.prototype && Object.getPrototypeOf(data) !== null)) {
    throw new ErrorResponse('A valid homework submission object is required', 400);
  }

  const unexpectedField = Object.keys(data).find(field => !SUBMISSION_FIELDS.has(field));
  if (unexpectedField) {
    throw new ErrorResponse(`Unsupported homework submission field: ${unexpectedField}`, 400);
  }

  let content = '';
  if (Object.prototype.hasOwnProperty.call(data, 'content')) {
    if (typeof data.content !== 'string') {
      throw new ErrorResponse('Submission content must be text', 400);
    }
    content = data.content.trim();
  }

  let attachments = [];
  if (Object.prototype.hasOwnProperty.call(data, 'attachments')) {
    if (!Array.isArray(data.attachments)) {
      throw new ErrorResponse('Submission attachments must be an array of links', 400);
    }
    attachments = data.attachments.map((attachment, index) => {
      if (!attachment || typeof attachment !== 'object' || Array.isArray(attachment) ||
          (Object.getPrototypeOf(attachment) !== Object.prototype && Object.getPrototypeOf(attachment) !== null)) {
        throw new ErrorResponse(`Submission attachment ${index + 1} must be an object`, 400);
      }
      const unknownAttachmentField = Object.keys(attachment).find(field => !ATTACHMENT_FIELDS.has(field));
      if (unknownAttachmentField) {
        throw new ErrorResponse(`Unsupported submission attachment field: ${unknownAttachmentField}`, 400);
      }

      const url = typeof attachment.url === 'string' ? attachment.url.trim() : '';
      let parsedUrl;
      try {
        parsedUrl = new URL(url);
      } catch (_) {
        throw new ErrorResponse(`Submission attachment ${index + 1} must contain a valid HTTP or HTTPS link`, 400);
      }
      if (!['http:', 'https:'].includes(parsedUrl.protocol) || parsedUrl.username || parsedUrl.password) {
        throw new ErrorResponse(`Submission attachment ${index + 1} must contain a valid HTTP or HTTPS link`, 400);
      }

      if (attachment.name !== undefined && typeof attachment.name !== 'string') {
        throw new ErrorResponse(`Submission attachment ${index + 1} name must be text`, 400);
      }
      return {
        name: typeof attachment.name === 'string' && attachment.name.trim()
          ? attachment.name.trim()
          : 'Submission link',
        url: parsedUrl.toString(),
        type: 'link',
      };
    });
  }

  if (!content && !attachments.length) {
    throw new ErrorResponse('Add submission text or at least one link', 400);
  }

  return { content, attachments };
}

function validateHomeworkSubmission(req, res, next) {
  try {
    req.homeworkSubmission = normalizeHomeworkSubmission(req.body);
    return next();
  } catch (error) {
    return next(error);
  }
}

module.exports = { normalizeHomeworkSubmission, validateHomeworkSubmission };
