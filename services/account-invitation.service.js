'use strict';

const crypto = require('crypto');
const mongoose = require('mongoose');
const ErrorResponse = require('../utils/errorResponse');
const User = require('../models/User');
const Student = require('../models/Student');
const Faculty = require('../models/Faculty');
const Class = require('../models/Class');
const authService = require('./auth.service');
const { resolveEffectiveDate } = require('./enrollment-date.service');

const USER_FIELDS = new Set(['name', 'email', 'phone', 'gender', 'dateOfBirth']);
const STUDENT_FIELDS = new Set([
  'rollNumber', 'class', 'academicYear', 'enrollmentEffectiveFrom', 'father', 'mother',
]);
const TEACHER_FIELDS = new Set(['department', 'designation', 'joiningDate']);
const FAMILY_FIELDS = new Set(['name']);

function assertRequestObject(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new ErrorResponse('A valid invitation request is required.', 400);
  }
}

function pickFields(data, allowed, label) {
  const result = {};
  for (const [key, value] of Object.entries(data)) {
    if (!allowed.has(key)) throw new ErrorResponse(`Unsupported ${label} field: ${key}`, 400);
    result[key] = value;
  }
  return result;
}

function cleanUserInput(data) {
  const userInput = pickFields(data, USER_FIELDS, 'invitation');
  if (typeof userInput.name !== 'string' || !userInput.name.trim()) {
    throw new ErrorResponse('Name is required.', 400);
  }
  if (typeof userInput.email !== 'string' || !userInput.email.trim()) {
    throw new ErrorResponse('Email is required.', 400);
  }
  userInput.name = userInput.name.trim();
  userInput.email = userInput.email.trim().toLowerCase();
  if (userInput.phone === '') delete userInput.phone;
  if (userInput.gender === '') delete userInput.gender;
  return userInput;
}

function cleanFamilyMember(value, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ErrorResponse(`${field} must include a name.`, 400);
  }
  const family = pickFields(value, FAMILY_FIELDS, field);
  if (typeof family.name !== 'string' || !family.name.trim()) {
    throw new ErrorResponse(`${field}.name is required.`, 400);
  }
  family.name = family.name.trim();
  return family;
}

function duplicateError(error) {
  if (error?.code === 11000) {
    return new ErrorResponse('An account or profile already uses these details.', 409);
  }
  return error;
}

function canonicalize(value) {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalize(value[key])]));
  }
  return value;
}

function invitationFingerprint(type, userData, profileData) {
  return crypto.createHash('sha256')
    .update(JSON.stringify(canonicalize({ type, userData, profileData })))
    .digest('hex');
}

function sameDate(left, right) {
  const leftTime = new Date(left).getTime();
  const rightTime = new Date(right).getTime();
  return Number.isFinite(leftTime) && leftTime === rightTime;
}

function matchesUserIdentity(user, userData) {
  if (user.name !== userData.name || user.email !== userData.email) return false;
  for (const field of ['phone', 'gender', 'dateOfBirth']) {
    if (!Object.prototype.hasOwnProperty.call(userData, field)) continue;
    if (field === 'dateOfBirth') {
      if (!sameDate(user[field], userData[field])) return false;
    } else if (user[field] !== userData[field]) {
      return false;
    }
  }
  return true;
}

function matchesProfile(profile, profileModel, profileData) {
  if (!profile) return false;
  if (profileModel === Student) {
    return Number(profile.rollNumber) === Number(profileData.rollNumber) &&
      profile.class === profileData.class &&
      profile.academicYear === profileData.academicYear &&
      sameDate(profile.enrollmentEffectiveFrom, profileData.enrollmentEffectiveFrom) &&
      profile.father?.name === profileData.father?.name &&
      profile.mother?.name === profileData.mother?.name;
  }
  return profile.department === profileData.department &&
    profile.designation === profileData.designation &&
    sameDate(profile.joiningDate, profileData.joiningDate);
}

async function findInviteProfile(profileModel, userId) {
  const fields = profileModel === Student
    ? '_id admissionNumber class academicYear rollNumber enrollmentEffectiveFrom father.name mother.name'
    : '_id employeeId department designation joiningDate';
  return profileModel.findOne({ user: userId }).select(fields).lean();
}

async function createMissingProfile(profileModel, userId, profileData) {
  try {
    return await profileModel.create({ user: userId, ...profileData });
  } catch (error) {
    if (error?.code === 11000) {
      throw new ErrorResponse('The account profile conflicts with another record; administrator review is required.', 409);
    }
    throw error;
  }
}

async function cleanupUnactivatedAccount({ userId, profileModel, profileId }) {
  try {
    await profileModel.deleteOne({ _id: profileId, user: userId });
    const deleted = await User.deleteOne({
      _id: userId,
      isActive: false,
      activationToken: { $exists: false },
    });
    if (deleted.deletedCount === 1) return true;
    return !(await User.exists({ _id: userId }));
  } catch (_) {
    return false;
  }
}

async function findExistingInvite({ email, role, invitationType, userData, profileModel, profileData }) {
  const existingUser = await User.findOne({ email })
    .select('+admissionSagaId +admissionSagaGeneration +admissionSagaOwnership +activationTokenSagaId +activationTokenSagaGeneration +accountInvitationType +accountInvitationFingerprint');
  if (!existingUser) return null;

  const hasSagaMarker = [
    existingUser.admissionSagaId,
    existingUser.admissionSagaGeneration,
    existingUser.admissionSagaOwnership,
    existingUser.activationTokenSagaId,
    existingUser.activationTokenSagaGeneration,
  ].some(value => value !== undefined);
  const baseIdentityMatches = existingUser.role === role &&
    existingUser.isActive === false && existingUser.isEmailVerified === false &&
    existingUser.name === userData.name && existingUser.email === email &&
    !hasSagaMarker &&
    matchesUserIdentity(existingUser, userData);
  const fingerprint = invitationFingerprint(invitationType, userData, profileData);
  const hasInvitationMarker = Boolean(existingUser.accountInvitationType || existingUser.accountInvitationFingerprint);
  const markerMatches = existingUser.accountInvitationType === invitationType &&
    existingUser.accountInvitationFingerprint === fingerprint;

  if (!baseIdentityMatches || (hasInvitationMarker && !markerMatches)) {
    throw new ErrorResponse('This email belongs to an account that cannot be safely reused. Exact-record administrator reconciliation is required.', 409);
  }

  let profile = await findInviteProfile(profileModel, existingUser._id);
  if (profile) {
    if (!matchesProfile(profile, profileModel, profileData)) {
      throw new ErrorResponse('The existing profile does not match this invitation. Profile details were not changed.', 409);
    }
  } else {
    const safeToResume = markerMatches && !existingUser.activationToken;
    if (!safeToResume) {
      throw new ErrorResponse('The inactive account has no verifiable invitation profile. Exact-record administrator reconciliation is required.', 409);
    }
    try {
      profile = await createMissingProfile(profileModel, existingUser._id, profileData);
    } catch (error) {
      if (error.statusCode === 409) {
        const concurrentProfile = await findInviteProfile(profileModel, existingUser._id);
        if (matchesProfile(concurrentProfile, profileModel, profileData)) profile = concurrentProfile;
        else throw error;
      } else {
        throw error;
      }
    }
  }

  try {
    const delivery = await authService.sendActivationEmail(existingUser);
    return { created: false, user: existingUser, profile, delivery };
  } catch (_) {
    throw new ErrorResponse(
      'The existing account remains inactive and the invitation was not confirmed. Retry later or contact an administrator.',
      503
    );
  }
}

async function createInvitedAccount({ userData, role, invitationType, profileModel, profileData }) {
  const userId = new mongoose.Types.ObjectId();
  const profileId = new mongoose.Types.ObjectId();
  const fingerprint = invitationFingerprint(invitationType, userData, profileData);
  const user = {
    _id: userId,
    ...userData,
    // User.password is schema-required. This high-entropy server-generated
    // value is never returned or disclosed; the account is disabled until its
    // owner atomically replaces it through account activation.
    password: crypto.randomBytes(48).toString('hex'),
    role,
    isActive: false,
    isEmailVerified: false,
    accountInvitationType: invitationType,
    accountInvitationFingerprint: fingerprint,
  };

  let createdUser;
  let profile;
  try {
    createdUser = await User.create(user);
    profile = await profileModel.create({ _id: profileId, user: userId, ...profileData });
  } catch (error) {
    const cleaned = await cleanupUnactivatedAccount({ userId, profileModel, profileId });
    if (!cleaned) {
      throw new ErrorResponse('Account setup failed and requires administrator review.', 500);
    }
    throw duplicateError(error);
  }

  let delivery;
  try {
    delivery = await authService.sendActivationEmail(createdUser);
  } catch (_) {
    // The existing auth service invalidates failed activation deliveries. Keep
    // the inactive profile so an Admin can retry this same invitation safely.
    throw new ErrorResponse(
      'The account was created, but invitation delivery was not confirmed. Retry the invitation for this email or contact an administrator.',
      503
    );
  }

  return { created: true, user: createdUser, profile, delivery };
}

async function inviteStudent(data) {
  assertRequestObject(data);
  const userData = cleanUserInput(Object.fromEntries(
    Object.entries(data).filter(([key]) => USER_FIELDS.has(key))
  ));
  const studentData = pickFields(
    Object.fromEntries(Object.entries(data).filter(([key]) => STUDENT_FIELDS.has(key))),
    STUDENT_FIELDS,
    'student'
  );
  const unknown = Object.keys(data).find(key => !USER_FIELDS.has(key) && !STUDENT_FIELDS.has(key));
  if (unknown) throw new ErrorResponse(`Unsupported invitation field: ${unknown}`, 400);

  studentData.father = cleanFamilyMember(studentData.father, 'father');
  studentData.mother = cleanFamilyMember(studentData.mother, 'mother');
  try {
    studentData.class = Class.validateAndNormalizeClassWrite(studentData.class, 'class');
  } catch (err) {
    throw new ErrorResponse(err.message, 400);
  }
  if (!['male', 'female', 'other'].includes(userData.gender)) throw new ErrorResponse('A valid student gender is required.', 400);
  if (!userData.dateOfBirth || Number.isNaN(new Date(userData.dateOfBirth).getTime())) {
    throw new ErrorResponse('A valid student date of birth is required.', 400);
  }
  if (typeof studentData.rollNumber !== 'string' && typeof studentData.rollNumber !== 'number') {
    throw new ErrorResponse('Roll number is required.', 400);
  }
  if (!/^\d+$/.test(String(studentData.rollNumber))) throw new ErrorResponse('Roll number must be numeric.', 400);
  if (typeof studentData.academicYear !== 'string' || !/^\d{4}-\d{4}$/.test(studentData.academicYear)) {
    throw new ErrorResponse('A selected academic year in YYYY-YYYY format is required.', 400);
  }
  const enrollment = await resolveEffectiveDate(studentData.enrollmentEffectiveFrom, studentData.academicYear);
  studentData.enrollmentEffectiveFrom = enrollment.effectiveFrom;
  studentData.academicYear = enrollment.academicYear;

  const existing = await findExistingInvite({
    email: userData.email,
    role: 'student',
    invitationType: 'student',
    userData,
    profileModel: Student,
    profileData: studentData,
  });
  if (existing) return existing;

  return createInvitedAccount({
    userData,
    role: 'student',
    invitationType: 'student',
    profileModel: Student,
    profileData: studentData,
  });
}

async function inviteTeacher(data) {
  assertRequestObject(data);
  const userData = cleanUserInput(Object.fromEntries(
    Object.entries(data).filter(([key]) => USER_FIELDS.has(key))
  ));
  const teacherData = pickFields(
    Object.fromEntries(Object.entries(data).filter(([key]) => TEACHER_FIELDS.has(key))),
    TEACHER_FIELDS,
    'teacher'
  );
  const unknown = Object.keys(data).find(key => !USER_FIELDS.has(key) && !TEACHER_FIELDS.has(key));
  if (unknown) throw new ErrorResponse(`Unsupported invitation field: ${unknown}`, 400);
  if (!Faculty.schema.path('department').enumValues.includes(teacherData.department) ||
      !Faculty.schema.path('designation').enumValues.includes(teacherData.designation)) {
    throw new ErrorResponse('Choose a valid teacher department and designation.', 400);
  }
  if (!teacherData.joiningDate || Number.isNaN(new Date(teacherData.joiningDate).getTime())) {
    throw new ErrorResponse('A valid joining date is required.', 400);
  }

  const existing = await findExistingInvite({
    email: userData.email,
    role: 'faculty',
    invitationType: 'teacher',
    userData,
    profileModel: Faculty,
    profileData: teacherData,
  });
  if (existing) return existing;

  return createInvitedAccount({
    userData,
    role: 'faculty',
    invitationType: 'teacher',
    profileModel: Faculty,
    profileData: teacherData,
  });
}

module.exports = { inviteStudent, inviteTeacher };
