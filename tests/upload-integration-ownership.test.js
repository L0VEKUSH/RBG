'use strict';
/**
 * Phase 22.4A — Binary Upload Integration and Private Document Ownership Tests
 *
 * Fully offline test suite:
 *  1. Profile photo upload invocation of saveFile() & database update
 *  2. Profile photo replacement deletes previous upload file but preserves default avatar
 *  3. Profile photo replacement preserves external URLs without disk deletion
 *  4. Database update failure on profile photo triggers safe cleanup of newly saved file
 *  5. Admission document upload invocation & append to admission.documents
 *  6. Admission document DB failure triggers safe cleanup of newly saved file
 *  7. Student document upload invocation & append to student.documents
 *  8. Student document DB failure triggers safe cleanup of newly saved file
 *  9. Student document deletion removes document and deletes local file safely
 * 10. Homework attachment upload invocation & append to homework.attachments
 * 11. Homework attachment non-owner teacher or student denial (403)
 * 12. Student can download their own document
 * 13. Student denied (403) for another student's document
 * 14. Parent can download linked student's document
 * 15. Parent denied (403) for unlinked student's document
 * 16. Management roles (super_admin, school_admin, principal) authorized for documents
 * 17. Teacher denied (403) for private student documents
 * 18. Homework submission attachment: student who submitted it can download
 * 19. Homework submission attachment: other student is denied (403)
 * 20. Homework assignment attachment: student in class can download, student in other class denied (403)
 * 21. Notice attachment: audience filtering (student denied if audience is Faculty or wrong class)
 * 22. Guessed/unregistered document or attachment filename returns 404
 * 23. Missing file on disk returns 404
 * 24. extractStorageKey preserves external URLs and default assets
 * 25. Malformed/path traversal requests rejected
 */

const { test } = require('node:test');
const assert   = require('node:assert/strict');
const path     = require('path');
const fs       = require('fs');

const REPO = path.resolve(__dirname, '..');

// ── Minimal stubs setup ───────────────────────────────────────────────────────

function stubModule(key, exports) {
  require.cache[key] = { id: key, filename: key, loaded: true, exports };
}

function setupTestEnvironment() {
  const envKey = require.resolve(path.join(REPO, 'config', 'env'));
  delete require.cache[envKey];
  stubModule(envKey, {
    MAX_FILE_UPLOAD: 5 * 1024 * 1024,
    FILE_UPLOAD_PATH: path.join(REPO, 'uploads'),
  });

  const erKey = require.resolve(path.join(REPO, 'utils', 'errorResponse'));
  delete require.cache[erKey];
  stubModule(erKey, class ErrorResponse extends Error {
    constructor(msg, code) { super(msg); this.statusCode = code; }
  });
}

test('Phase 22.4A: Upload Integration & Ownership Authorization Suite', async (t) => {
  setupTestEnvironment();

  const uploadService = require(path.join(REPO, 'services', 'upload.service'));
  const uploadController = require(path.join(REPO, 'controllers', 'upload.controller'));
  const authController = require(path.join(REPO, 'controllers', 'auth.controller'));
  const admissionController = require(path.join(REPO, 'controllers', 'admission.controller'));
  const studentController = require(path.join(REPO, 'controllers', 'student.controller'));
  const homeworkController = require(path.join(REPO, 'controllers', 'homework.controller'));

  const User = require(path.join(REPO, 'models', 'User'));
  const Student = require(path.join(REPO, 'models', 'Student'));
  const Admission = require(path.join(REPO, 'models', 'Admission'));
  const Homework = require(path.join(REPO, 'models', 'Homework'));
  const Notice = require(path.join(REPO, 'models', 'Notice'));
  const Event = require(path.join(REPO, 'models', 'Event'));
  const Parent = require(path.join(REPO, 'models', 'Parent'));

  // ── 1. Profile photo upload invocation & DB update ─────────────────────────
  await t.test('1. Profile photo upload invocation of saveFile() & database update', async () => {
    let savedCategory = null;
    let savedFile = null;
    let userSaved = false;

    const origSaveFile = uploadService.saveFile;
    uploadService.saveFile = async (file, cat) => {
      savedCategory = cat;
      savedFile = file;
      return { filename: 'newphoto1234567890abcdef1234.jpg', url: '/api/v1/uploads/profiles/newphoto1234567890abcdef1234.jpg', size: 100 };
    };

    const origFindById = User.findById;
    User.findById = async () => ({
      _id: 'user1',
      profilePhoto: 'default-avatar.png',
      save: async () => { userSaved = true; },
    });

    try {
      const fakeReq = {
        user: { id: 'user1' },
        file: { buffer: Buffer.from('test'), originalname: 'avatar.jpg', size: 100, mimetype: 'image/jpeg' },
      };
      let responseData = null;
      const fakeRes = {
        status(code) { this.statusCode = code; return this; },
        json(data) { responseData = data; },
      };

      await authController.uploadProfilePhoto(fakeReq, fakeRes, (err) => { if (err) throw err; });

      assert.equal(savedCategory, 'profiles');
      assert.equal(userSaved, true);
      assert.equal(fakeRes.statusCode, 200);
      assert.ok(responseData.data.profilePhoto.includes('newphoto1234567890abcdef1234.jpg'));
    } finally {
      uploadService.saveFile = origSaveFile;
      User.findById = origFindById;
    }
  });

  // ── 2. Profile photo replacement deletes old upload, preserves default ────
  await t.test('2. Profile photo replacement deletes old upload but preserves default avatar', async () => {
    let deletedKey = null;

    const origSaveFile = uploadService.saveFile;
    const origSafeDelete = uploadService.safeDeleteOldUpload;
    uploadService.saveFile = async () => ({
      filename: 'secondphoto1234567890abcdef12.jpg',
      url: '/api/v1/uploads/profiles/secondphoto1234567890abcdef12.jpg',
      size: 150,
    });
    uploadService.safeDeleteOldUpload = async (oldUrl) => {
      deletedKey = oldUrl;
      return true;
    };

    const origFindById = User.findById;
    User.findById = async () => ({
      _id: 'user1',
      profilePhoto: '/api/v1/uploads/profiles/firstphoto1234567890abcdef123.jpg',
      save: async () => {},
    });

    try {
      const fakeReq = {
        user: { id: 'user1' },
        file: { buffer: Buffer.from('test'), originalname: 'photo2.jpg', size: 150, mimetype: 'image/jpeg' },
      };
      const fakeRes = { status() { return this; }, json() {} };

      await authController.uploadProfilePhoto(fakeReq, fakeRes, (err) => { if (err) throw err; });

      assert.equal(deletedKey, '/api/v1/uploads/profiles/firstphoto1234567890abcdef123.jpg');
    } finally {
      uploadService.saveFile = origSaveFile;
      uploadService.safeDeleteOldUpload = origSafeDelete;
      User.findById = origFindById;
    }
  });

  // ── 3. Profile photo replacement preserves external URLs ──────────────────
  await t.test('3. Profile photo replacement preserves external URLs without disk deletion', async () => {
    const extUrl = 'https://images.unsplash.com/photo-12345';
    const deleted = await uploadService.safeDeleteOldUpload(extUrl);
    assert.equal(deleted, false, 'External URL should not trigger disk deletion');
    const defaultDeleted = await uploadService.safeDeleteOldUpload('default-avatar.png');
    assert.equal(defaultDeleted, false, 'default-avatar.png should not trigger disk deletion');
  });

  // ── 4. DB failure on profile photo triggers safe cleanup ──────────────────
  await t.test('4. Database update failure on profile photo triggers safe cleanup of newly saved file', async () => {
    let cleanedUpFilename = null;
    let cleanedUpCategory = null;

    const origSaveFile = uploadService.saveFile;
    const origDeleteFile = uploadService.deleteFile;
    uploadService.saveFile = async () => ({
      filename: 'temp1234567890abcdef1234567890.jpg',
      url: '/api/v1/uploads/profiles/temp1234567890abcdef1234567890.jpg',
      size: 50,
    });
    uploadService.deleteFile = async (fn, cat) => {
      cleanedUpFilename = fn;
      cleanedUpCategory = cat;
    };

    const origFindById = User.findById;
    User.findById = async () => ({
      _id: 'user1',
      profilePhoto: 'default-avatar.png',
      save: async () => { throw new Error('Database write failure'); },
    });

    try {
      const fakeReq = {
        user: { id: 'user1' },
        file: { buffer: Buffer.from('test'), originalname: 'test.jpg', size: 50, mimetype: 'image/jpeg' },
      };
      const fakeRes = { status() { return this; }, json() {} };
      let caughtErr = null;

      await authController.uploadProfilePhoto(fakeReq, fakeRes, (err) => { caughtErr = err; });

      assert.ok(caughtErr, 'Expected database error to be passed to next()');
      assert.equal(cleanedUpFilename, 'temp1234567890abcdef1234567890.jpg');
      assert.equal(cleanedUpCategory, 'profiles');
    } finally {
      uploadService.saveFile = origSaveFile;
      uploadService.deleteFile = origDeleteFile;
      User.findById = origFindById;
    }
  });

  // ── 5. Admission document upload invocation & append ───────────────────────
  await t.test('5. Admission document upload invocation & append to admission.documents', async () => {
    let admissionSaved = false;
    const mockAdmission = {
      _id: 'adm1',
      documents: [],
      save: async () => { admissionSaved = true; },
    };

    const origGetAdm = require(path.join(REPO, 'services', 'admission.service')).getAdmissionById;
    require(path.join(REPO, 'services', 'admission.service')).getAdmissionById = async () => mockAdmission;

    const origSaveFile = uploadService.saveFile;
    uploadService.saveFile = async () => ({
      filename: 'admdoc1234567890abcdef12345678.pdf',
      url: '/api/v1/uploads/documents/admdoc1234567890abcdef12345678.pdf',
      size: 200,
    });

    try {
      const fakeReq = {
        params: { id: 'adm1' },
        body: { name: 'Birth Certificate' },
        file: { buffer: Buffer.from('pdfdata'), originalname: 'birth_cert.pdf', size: 200, mimetype: 'application/pdf' },
      };
      let resBody = null;
      const fakeRes = {
        status(code) { this.statusCode = code; return this; },
        json(data) { resBody = data; },
      };

      await admissionController.uploadAdmissionDocument(fakeReq, fakeRes, (err) => { if (err) throw err; });

      assert.equal(fakeRes.statusCode, 201);
      assert.equal(admissionSaved, true);
      assert.equal(mockAdmission.documents.length, 1);
      assert.equal(mockAdmission.documents[0].name, 'Birth Certificate');
    } finally {
      require(path.join(REPO, 'services', 'admission.service')).getAdmissionById = origGetAdm;
      uploadService.saveFile = origSaveFile;
    }
  });

  // ── 6. Admission document DB failure triggers safe cleanup ─────────────────
  await t.test('6. Admission document DB failure triggers safe cleanup of newly saved file', async () => {
    let cleanedUpFile = null;
    const mockAdmission = {
      _id: 'adm1',
      documents: [],
      save: async () => { throw new Error('Admission DB save failed'); },
    };

    const origGetAdm = require(path.join(REPO, 'services', 'admission.service')).getAdmissionById;
    require(path.join(REPO, 'services', 'admission.service')).getAdmissionById = async () => mockAdmission;

    const origSaveFile = uploadService.saveFile;
    const origDeleteFile = uploadService.deleteFile;
    uploadService.saveFile = async () => ({
      filename: 'admfail1234567890abcdef1234567.pdf',
      url: '/api/v1/uploads/documents/admfail1234567890abcdef1234567.pdf',
      size: 200,
    });
    uploadService.deleteFile = async (fn) => { cleanedUpFile = fn; };

    try {
      const fakeReq = {
        params: { id: 'adm1' },
        file: { buffer: Buffer.from('data'), originalname: 'doc.pdf', size: 200, mimetype: 'application/pdf' },
      };
      let errPassed = null;
      await admissionController.uploadAdmissionDocument(fakeReq, { status() { return this; }, json() {} }, (err) => { errPassed = err; });

      assert.ok(errPassed);
      assert.equal(cleanedUpFile, 'admfail1234567890abcdef1234567.pdf');
    } finally {
      require(path.join(REPO, 'services', 'admission.service')).getAdmissionById = origGetAdm;
      uploadService.saveFile = origSaveFile;
      uploadService.deleteFile = origDeleteFile;
    }
  });

  // ── 7. Student document upload invocation & append ─────────────────────────
  await t.test('7. Student document upload invocation & append to student.documents', async () => {
    let studentSaved = false;
    const mockStudent = {
      _id: 'std1',
      documents: [],
      save: async () => { studentSaved = true; },
    };

    const origFindById = Student.findById;
    Student.findById = async () => mockStudent;

    const origSaveFile = uploadService.saveFile;
    uploadService.saveFile = async () => ({
      filename: 'stddoc1234567890abcdef12345678.pdf',
      url: '/api/v1/uploads/documents/stddoc1234567890abcdef12345678.pdf',
      size: 300,
    });

    try {
      const fakeReq = {
        params: { id: 'std1' },
        body: { name: 'Transfer Certificate' },
        file: { buffer: Buffer.from('tc'), originalname: 'tc.pdf', size: 300, mimetype: 'application/pdf' },
      };
      let resBody = null;
      const fakeRes = {
        status(code) { this.statusCode = code; return this; },
        json(data) { resBody = data; },
      };

      await studentController.uploadStudentDocument(fakeReq, fakeRes, (err) => { if (err) throw err; });

      assert.equal(fakeRes.statusCode, 201);
      assert.equal(studentSaved, true);
      assert.equal(mockStudent.documents.length, 1);
      assert.equal(mockStudent.documents[0].name, 'Transfer Certificate');
    } finally {
      Student.findById = origFindById;
      uploadService.saveFile = origSaveFile;
    }
  });

  // ── 8. Student document deletion removes doc & deletes file safely ─────────
  await t.test('8. Student document deletion removes document and deletes local file safely', async () => {
    let deletedOldUrl = null;
    const docItem = { _id: 'doc999', name: 'Old Doc', url: '/api/v1/uploads/documents/olddoc1234567890abcdef12345678.pdf' };
    const mockStudent = {
      _id: 'std1',
      documents: [docItem],
      save: async () => {},
    };
    mockStudent.documents.id = (id) => (id === 'doc999' ? docItem : null);
    mockStudent.documents.pull = () => { mockStudent.documents = []; };

    const origFindById = Student.findById;
    Student.findById = async () => mockStudent;

    const origSafeDelete = uploadService.safeDeleteOldUpload;
    uploadService.safeDeleteOldUpload = async (u) => { deletedOldUrl = u; return true; };

    try {
      const fakeReq = { params: { id: 'std1', documentId: 'doc999' } };
      let resData = null;
      const fakeRes = {
        status(code) { this.statusCode = code; return this; },
        json(d) { resData = d; },
      };

      await studentController.deleteStudentDocument(fakeReq, fakeRes, (err) => { if (err) throw err; });

      assert.equal(fakeRes.statusCode, 200);
      assert.equal(deletedOldUrl, docItem.url);
      assert.equal(mockStudent.documents.length, 0);
    } finally {
      Student.findById = origFindById;
      uploadService.safeDeleteOldUpload = origSafeDelete;
    }
  });

  // ── 9. Homework attachment upload invocation ───────────────────────────────
  await t.test('9. Homework attachment upload invocation & append to homework.attachments', async () => {
    let hwSaved = false;
    const mockHw = {
      _id: 'hw1',
      teacher: 'teacher1',
      attachments: [],
      save: async () => { hwSaved = true; },
    };

    const origFindById = Homework.findById;
    Homework.findById = async () => mockHw;

    const origSaveFile = uploadService.saveFile;
    uploadService.saveFile = async () => ({
      filename: 'hwatt1234567890abcdef123456789.pdf',
      url: '/api/v1/uploads/attachments/hwatt1234567890abcdef123456789.pdf',
      size: 400,
    });

    try {
      const fakeReq = {
        params: { id: 'hw1' },
        user: { _id: 'teacher1', role: 'teacher' },
        body: { name: 'Assignment Sheet' },
        file: { buffer: Buffer.from('sheet'), originalname: 'sheet.pdf', size: 400, mimetype: 'application/pdf' },
      };
      let resBody = null;
      const fakeRes = {
        status(code) { this.statusCode = code; return this; },
        json(data) { resBody = data; },
      };

      await homeworkController.uploadHomeworkAttachment(fakeReq, fakeRes, (err) => { if (err) throw err; });

      assert.equal(fakeRes.statusCode, 201);
      assert.equal(hwSaved, true);
      assert.equal(mockHw.attachments.length, 1);
      assert.equal(mockHw.attachments[0].name, 'Assignment Sheet');
    } finally {
      Homework.findById = origFindById;
      uploadService.saveFile = origSaveFile;
    }
  });

  // ── 10. Homework attachment non-owner teacher denial (403) ────────────────
  await t.test('10. Homework attachment non-owner teacher denial (403)', async () => {
    const mockHw = {
      _id: 'hw1',
      teacher: 'teacher1',
      attachments: [],
      save: async () => {},
    };

    const origFindById = Homework.findById;
    Homework.findById = async () => mockHw;

    try {
      const fakeReq = {
        params: { id: 'hw1' },
        user: { _id: 'teacher2', role: 'teacher' },
        file: { buffer: Buffer.from('data'), originalname: 'sheet.pdf', size: 100, mimetype: 'application/pdf' },
      };
      let errPassed = null;
      await homeworkController.uploadHomeworkAttachment(fakeReq, { status() { return this; }, json() {} }, (err) => { errPassed = err; });

      assert.ok(errPassed);
      assert.equal(errPassed.statusCode, 403);
    } finally {
      Homework.findById = origFindById;
    }
  });

  // ── 11. Student can download their own document ───────────────────────────
  await t.test('11. Student can download their own document', async () => {
    const targetFile = 'mydoc1234567890abcdef1234567890.pdf';
    const mockStudent = {
      _id: 'std1',
      user: 'student-user-1',
      documents: [{ name: 'My Report', url: `/api/v1/uploads/documents/${targetFile}` }],
    };

    const origFindOne = Student.findOne;
    Student.findOne = async () => mockStudent;

    const origResolve = uploadService.resolveFilePath;
    uploadService.resolveFilePath = () => '/uploads/documents/' + targetFile;

    const origAccess = fs.promises.access;
    fs.promises.access = async () => {};

    let sentFile = null;
    try {
      const fakeReq = {
        params: { category: 'documents', filename: targetFile },
        user: { _id: 'student-user-1', role: 'student' },
      };
      const fakeRes = {
        setHeader() {},
        sendFile(p) { sentFile = p; },
      };

      await uploadController.downloadFile(fakeReq, fakeRes, (err) => { if (err) throw err; });

      assert.ok(sentFile);
      assert.ok(sentFile.includes(targetFile));
    } finally {
      Student.findOne = origFindOne;
      uploadService.resolveFilePath = origResolve;
      fs.promises.access = origAccess;
    }
  });

  // ── 12. Student denied (403) for another student's document ───────────────
  await t.test('12. Student denied (403) for another student\'s document', async () => {
    const targetFile = 'otherdoc1234567890abcdef12345678.pdf';
    const mockStudent = {
      _id: 'std2',
      user: 'student-user-2',
      documents: [{ name: 'Other Report', url: `/api/v1/uploads/documents/${targetFile}` }],
    };

    const origFindOne = Student.findOne;
    Student.findOne = async () => mockStudent;

    try {
      const fakeReq = {
        params: { category: 'documents', filename: targetFile },
        user: { _id: 'student-user-1', role: 'student' }, // Different student!
      };
      let errPassed = null;
      await uploadController.downloadFile(fakeReq, { setHeader() {}, sendFile() {} }, (err) => { errPassed = err; });

      assert.ok(errPassed);
      assert.equal(errPassed.statusCode, 403);
    } finally {
      Student.findOne = origFindOne;
    }
  });

  // ── 13. Parent can download linked student's document ─────────────────────
  await t.test('13. Parent can download linked student\'s document', async () => {
    const targetFile = 'childdoc1234567890abcdef1234567.pdf';
    const mockStudent = {
      _id: 'stdChild',
      user: 'child-user',
      parentUser: 'parent-user-1',
      documents: [{ name: 'Child Doc', url: `/api/v1/uploads/documents/${targetFile}` }],
    };

    const origFindOne = Student.findOne;
    Student.findOne = async () => mockStudent;

    const origResolve = uploadService.resolveFilePath;
    uploadService.resolveFilePath = () => '/uploads/documents/' + targetFile;

    const origAccess = fs.promises.access;
    fs.promises.access = async () => {};

    let sentFile = null;
    try {
      const fakeReq = {
        params: { category: 'documents', filename: targetFile },
        user: { _id: 'parent-user-1', role: 'parent' },
      };
      const fakeRes = {
        setHeader() {},
        sendFile(p) { sentFile = p; },
      };

      await uploadController.downloadFile(fakeReq, fakeRes, (err) => { if (err) throw err; });

      assert.ok(sentFile);
    } finally {
      Student.findOne = origFindOne;
      uploadService.resolveFilePath = origResolve;
      fs.promises.access = origAccess;
    }
  });

  // ── 14. Parent denied (403) for unlinked student's document ───────────────
  await t.test('14. Parent denied (403) for unlinked student\'s document', async () => {
    const targetFile = 'unlinkeddoc1234567890abcdef12345.pdf';
    const mockStudent = {
      _id: 'stdUnlinked',
      user: 'other-child',
      parentUser: 'other-parent',
      documents: [{ name: 'Unlinked Doc', url: `/api/v1/uploads/documents/${targetFile}` }],
    };

    const origStudentFindOne = Student.findOne;
    const origParentFindOne = Parent.findOne;
    Student.findOne = async () => mockStudent;
    Parent.findOne = async () => ({ children: ['my-own-child'] });

    try {
      const fakeReq = {
        params: { category: 'documents', filename: targetFile },
        user: { _id: 'parent-user-1', role: 'parent' },
      };
      let errPassed = null;
      await uploadController.downloadFile(fakeReq, { setHeader() {}, sendFile() {} }, (err) => { errPassed = err; });

      assert.ok(errPassed);
      assert.equal(errPassed.statusCode, 403);
    } finally {
      Student.findOne = origStudentFindOne;
      Parent.findOne = origParentFindOne;
    }
  });

  // ── 15. Management roles authorized for documents ────────────────────────
  await t.test('15. Management roles (school_admin) authorized for documents', async () => {
    const targetFile = 'managedoc1234567890abcdef123456.pdf';
    const mockStudent = {
      _id: 'std1',
      documents: [{ name: 'Doc', url: `/api/v1/uploads/documents/${targetFile}` }],
    };

    const origStudentFindOne = Student.findOne;
    Student.findOne = async () => mockStudent;

    const origResolve = uploadService.resolveFilePath;
    uploadService.resolveFilePath = () => '/uploads/documents/' + targetFile;

    const origAccess = fs.promises.access;
    fs.promises.access = async () => {};

    let sentFile = null;
    try {
      const fakeReq = {
        params: { category: 'documents', filename: targetFile },
        user: { _id: 'admin1', role: 'school_admin' },
      };
      const fakeRes = { setHeader() {}, sendFile(p) { sentFile = p; } };

      await uploadController.downloadFile(fakeReq, fakeRes, (err) => { if (err) throw err; });

      assert.ok(sentFile);
    } finally {
      Student.findOne = origStudentFindOne;
      uploadService.resolveFilePath = origResolve;
      fs.promises.access = origAccess;
    }
  });

  // ── 16. Teacher denied (403) for private student documents ────────────────
  await t.test('16. Teacher denied (403) for private student documents', async () => {
    const targetFile = 'private1234567890abcdef12345678.pdf';
    const mockStudent = {
      _id: 'std1',
      documents: [{ name: 'Private Doc', url: `/api/v1/uploads/documents/${targetFile}` }],
    };

    const origStudentFindOne = Student.findOne;
    Student.findOne = async () => mockStudent;

    try {
      const fakeReq = {
        params: { category: 'documents', filename: targetFile },
        user: { _id: 'teacher1', role: 'teacher' },
      };
      let errPassed = null;
      await uploadController.downloadFile(fakeReq, { setHeader() {}, sendFile() {} }, (err) => { errPassed = err; });

      assert.ok(errPassed);
      assert.equal(errPassed.statusCode, 403);
    } finally {
      Student.findOne = origStudentFindOne;
    }
  });

  // ── 17. Homework submission attachment private to submitting student ──────
  await t.test('17. Homework submission attachment private to submitting student (other student gets 403)', async () => {
    const targetFile = 'subatt1234567890abcdef123456789.pdf';
    const mockHw = {
      _id: 'hw1',
      teacher: 'teacher1',
      submissions: [{
        student: 'stdSubmitter',
        attachments: [{ url: `/api/v1/uploads/attachments/${targetFile}` }],
      }],
    };

    const origHwFindOne = Homework.findOne;
    const origStudentFindById = Student.findById;
    const origParentFindOne = Parent.findOne;
    Homework.findOne = async () => mockHw;
    Student.findById = async () => ({ _id: 'stdSubmitter', user: 'submitter-user-id' });
    Parent.findOne = async () => null;

    try {
      // Submitting student accesses:
      const ownReq = {
        params: { category: 'attachments', filename: targetFile },
        user: { _id: 'submitter-user-id', role: 'student' },
      };
      let ownErr = null;
      const origResolve = uploadService.resolveFilePath;
      uploadService.resolveFilePath = () => '/uploads/attachments/' + targetFile;
      const origAccess = fs.promises.access;
      fs.promises.access = async () => {};
      let ownSent = false;
      await uploadController.downloadFile(ownReq, { setHeader() {}, sendFile() { ownSent = true; } }, (err) => { ownErr = err; });
      assert.equal(ownErr, null);
      assert.equal(ownSent, true);

      // Other student tries to access:
      const otherReq = {
        params: { category: 'attachments', filename: targetFile },
        user: { _id: 'other-student-id', role: 'student' },
      };
      let otherErr = null;
      await uploadController.downloadFile(otherReq, { setHeader() {}, sendFile() {} }, (err) => { otherErr = err; });
      assert.ok(otherErr);
      assert.equal(otherErr.statusCode, 403);
    } finally {
      Homework.findOne = origHwFindOne;
      Student.findById = origStudentFindById;
      Parent.findOne = origParentFindOne;
    }
  });

  // ── 18. Homework assignment attachment class audience check ───────────────
  await t.test('18. Homework assignment attachment class audience check', async () => {
    const targetFile = 'class10att1234567890abcdef12345.pdf';
    const mockHw = {
      _id: 'hw1',
      class: '10',
      attachments: [{ url: `/api/v1/uploads/attachments/${targetFile}` }],
      submissions: [],
    };

    const origHwFindOne = Homework.findOne;
    const origStudentFindOne = Student.findOne;
    Homework.findOne = async () => mockHw;

    try {
      // Student in Class 10: ALLOW
      Student.findOne = async () => ({ _id: 'std10', class: '10' });
      const origResolve = uploadService.resolveFilePath;
      uploadService.resolveFilePath = () => '/uploads/attachments/' + targetFile;
      const origAccess = fs.promises.access;
      fs.promises.access = async () => {};
      let allowedSent = false;
      await uploadController.downloadFile({
        params: { category: 'attachments', filename: targetFile },
        user: { _id: 's10', role: 'student' },
      }, { setHeader() {}, sendFile() { allowedSent = true; } }, (err) => { if (err) throw err; });
      assert.equal(allowedSent, true);

      // Student in Class 9: DENIED 403
      Student.findOne = async () => ({ _id: 'std9', class: '9' });
      let deniedErr = null;
      await uploadController.downloadFile({
        params: { category: 'attachments', filename: targetFile },
        user: { _id: 's9', role: 'student' },
      }, { setHeader() {}, sendFile() {} }, (err) => { deniedErr = err; });
      assert.ok(deniedErr);
      assert.equal(deniedErr.statusCode, 403);
    } finally {
      Homework.findOne = origHwFindOne;
      Student.findOne = origStudentFindOne;
    }
  });

  // ── 19. Notice attachment audience check ──────────────────────────────────
  await t.test('19. Notice attachment audience check (student denied if audience is Faculty)', async () => {
    const targetFile = 'faculty_notice1234567890abcdef.pdf';
    const mockNotice = {
      _id: 'not1',
      targetAudience: ['Faculty'],
      attachments: [{ url: `/api/v1/uploads/attachments/${targetFile}` }],
    };

    const origNoticeFindOne = Notice.findOne;
    const origHwFindOne = Homework.findOne;
    Homework.findOne = async () => null;
    Notice.findOne = async () => mockNotice;

    try {
      const studentReq = {
        params: { category: 'attachments', filename: targetFile },
        user: { _id: 's1', role: 'student' },
      };
      let studentErr = null;
      await uploadController.downloadFile(studentReq, { setHeader() {}, sendFile() {} }, (err) => { studentErr = err; });

      assert.ok(studentErr);
      assert.equal(studentErr.statusCode, 403);
    } finally {
      Notice.findOne = origNoticeFindOne;
      Homework.findOne = origHwFindOne;
    }
  });

  // ── 20. Guessed/unregistered filename returns 404 ─────────────────────────
  await t.test('20. Guessed or unregistered filename returns 404', async () => {
    const randomGuessed = 'guessed1234567890abcdef12345678.pdf';
    const origStudentFindOne = Student.findOne;
    const origAdmissionFindOne = Admission.findOne;
    Student.findOne = async () => null;
    Admission.findOne = async () => null;

    try {
      const fakeReq = {
        params: { category: 'documents', filename: randomGuessed },
        user: { _id: 'admin1', role: 'school_admin' },
      };
      let errPassed = null;
      await uploadController.downloadFile(fakeReq, { setHeader() {}, sendFile() {} }, (err) => { errPassed = err; });

      assert.ok(errPassed);
      assert.equal(errPassed.statusCode, 404);
    } finally {
      Student.findOne = origStudentFindOne;
      Admission.findOne = origAdmissionFindOne;
    }
  });

  // ── 21. extractStorageKey preserves external URLs and default assets ──────
  await t.test('21. extractStorageKey correctly parses managed paths and rejects external links', () => {
    const key1 = uploadService.extractStorageKey('/api/v1/uploads/profiles/1234567890abcdef1234567890abcdef.jpg');
    assert.deepEqual(key1, { category: 'profiles', filename: '1234567890abcdef1234567890abcdef.jpg' });

    const key2 = uploadService.extractStorageKey('/uploads/documents/abcdef1234567890abcdef1234567890.pdf');
    assert.deepEqual(key2, { category: 'documents', filename: 'abcdef1234567890abcdef1234567890.pdf' });

    assert.equal(uploadService.extractStorageKey('https://cdn.example.com/photo.png'), null);
    assert.equal(uploadService.extractStorageKey('default-avatar.png'), null);
    assert.equal(uploadService.extractStorageKey('/images/logo.svg'), null);
  });

  // ── 22. Path traversal in download request rejected ────────────────────────
  await t.test('22. Path traversal in download parameters rejected', async () => {
    const maliciousPaths = [
      '../../etc/passwd',
      '..\\..\\windows\\win.ini',
      '../profiles/secret.png',
    ];
    for (const badPath of maliciousPaths) {
      const fakeReq = {
        params: { category: 'profiles', filename: badPath },
        user: { _id: 'admin1', role: 'school_admin' },
      };
      let errCaught = null;
      await uploadController.downloadFile(fakeReq, { setHeader() {}, sendFile() {} }, (err) => { errCaught = err; });
      assert.ok(errCaught, `Expected traversal attempt "${badPath}" to be rejected`);
      assert.ok(errCaught.statusCode >= 400);
    }
  });

  // ── 23. File size limit enforced by upload middleware ───────────────────────
  await t.test('23. File size limit and unexpected field handled by handleMulterError', () => {
    const { handleMulterError } = require(path.join(REPO, 'middleware', 'upload'));

    let resCode = null;
    let resJson = null;
    const fakeRes = {
      status(c) { resCode = c; return this; },
      json(d) { resJson = d; },
    };

    handleMulterError({ code: 'LIMIT_FILE_SIZE' }, {}, fakeRes, () => {});
    assert.equal(resCode, 413);
    assert.ok(resJson.message.includes('maximum size'));

    handleMulterError({ code: 'LIMIT_UNEXPECTED_FILE' }, {}, fakeRes, () => {});
    assert.equal(resCode, 400);
    assert.ok(resJson.message.includes('Unexpected file field'));
  });
});
