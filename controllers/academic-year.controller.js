'use strict';

const academicYearService = require('../services/academic-year.service');

exports.getAcademicYears = async (req, res) => {
  const academicYears = await academicYearService.listAcademicYears();
  res.status(200).json({
    success: true,
    count: academicYears.length,
    data: { academicYears },
  });
};

exports.getAcademicYear = async (req, res) => {
  const academicYear = await academicYearService.getAcademicYear(req.params.id);
  res.status(200).json({ success: true, data: { academicYear } });
};

exports.createAcademicYear = async (req, res) => {
  const academicYear = await academicYearService.createAcademicYear(req.body);
  res.status(201).json({
    success: true,
    message: 'Academic year created',
    data: { academicYear },
  });
};

exports.updateAcademicYear = async (req, res) => {
  const academicYear = await academicYearService.updateAcademicYear(req.params.id, req.body);
  res.status(200).json({
    success: true,
    message: 'Academic year updated',
    data: { academicYear },
  });
};

exports.activateAcademicYear = async (req, res) => {
  const academicYear = await academicYearService.activateAcademicYear(req.params.id);
  res.status(200).json({
    success: true,
    message: 'Academic year activated',
    data: { academicYear },
  });
};

exports.deactivateAcademicYear = async (req, res) => {
  const academicYear = await academicYearService.deactivateAcademicYear(req.params.id);
  res.status(200).json({
    success: true,
    message: 'Academic year deactivated',
    data: { academicYear },
  });
};

exports.establishCurrentAcademicYear = async (req, res) => {
  const auditContext = {
    ipAddress: req.ip || req.connection?.remoteAddress,
    userAgent: req.get ? req.get('user-agent') : req.headers?.['user-agent'],
  };
  const academicYear = await academicYearService.establishCurrentAcademicYear(
    req.params.id,
    req.user,
    auditContext
  );
  res.status(200).json({
    success: true,
    message: 'Academic year established as current',
    data: { academicYear },
  });
};
