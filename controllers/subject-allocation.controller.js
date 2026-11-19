'use strict';

const subjectAllocationService = require('../services/subject-allocation.service');

exports.getAllocations = async (req, res) => {
  const filters = {};
  if (req.query.teacher) filters.teacher = req.query.teacher;
  if (req.query.subject) filters.subject = req.query.subject;
  if (req.query.class) filters.class = req.query.class;
  if (req.query.academicYear) filters.academicYear = req.query.academicYear;

  const allocations = await subjectAllocationService.listAllocations(filters);
  res.status(200).json({
    success: true,
    count: allocations.length,
    data: { allocations },
  });
};

exports.createAllocation = async (req, res) => {
  const allocation = await subjectAllocationService.createAllocation(req.body);
  res.status(201).json({
    success: true,
    message: 'Subject allocation created',
    data: { allocation },
  });
};

exports.getAllocation = async (req, res) => {
  const allocation = await subjectAllocationService.getAllocationById(req.params.id);
  res.status(200).json({
    success: true,
    data: { allocation },
  });
};

exports.updateAllocation = async (req, res) => {
  const allocation = await subjectAllocationService.updateAllocation(req.params.id, req.body);
  res.status(200).json({
    success: true,
    message: 'Subject allocation updated',
    data: { allocation },
  });
};

exports.deleteAllocation = async (req, res) => {
  await subjectAllocationService.deleteAllocation(req.params.id);
  res.status(200).json({
    success: true,
    message: 'Subject allocation deleted',
    data: {},
  });
};
