'use strict';

const invitationService = require('../services/account-invitation.service');

exports.rejectLegacyPasswordCreation = (req, res) => {
  res.status(410).json({
    success: false,
    message: 'Password-based account creation is disabled. Use the Student or Teacher invitation workflow; the account owner sets their password during activation.',
  });
};

function sendInvitationResponse(res, result, role) {
  const profile = result.profile;
  const statusCode = result.created ? 201 : 200;
  const deliveryStatus = result.delivery?.status || 'sent';
  const accepted = ['pending', 'processing', 'sent'].includes(deliveryStatus);
  const message = accepted
    ? (result.created
      ? 'Account created; activation invitation accepted by the delivery workflow.'
      : 'Existing inactive account found; activation invitation accepted. Profile details were not changed.')
    : (result.created
      ? 'Account created, but invitation delivery was not accepted. Retry this email or contact an administrator.'
      : 'Existing inactive account found, but invitation delivery was not accepted. Profile details were not changed.');
  res.status(statusCode).json({
    success: true,
    message,
    data: {
      invitation: {
        accepted,
        status: deliveryStatus,
        email: result.user.email,
        role,
      },
      profile: role === 'student'
        ? { id: profile._id, admissionNumber: profile.admissionNumber, class: profile.class, academicYear: profile.academicYear }
        : { id: profile._id, employeeId: profile.employeeId, department: profile.department, designation: profile.designation },
    },
  });
}

exports.inviteStudent = async (req, res, next) => {
  try {
    const result = await invitationService.inviteStudent(req.body);
    sendInvitationResponse(res, result, 'student');
  } catch (error) {
    next(error);
  }
};

exports.inviteTeacher = async (req, res, next) => {
  try {
    const result = await invitationService.inviteTeacher(req.body);
    sendInvitationResponse(res, result, 'teacher');
  } catch (error) {
    next(error);
  }
};
