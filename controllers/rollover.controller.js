'use strict';

const rolloverService = require('../services/rollover.service');

exports.createDraft = async (req, res) => {
  const rollover = await rolloverService.createDraft({ ...req.body, actor: req.user });
  res.status(201).json({ success: true, data: { rollover } });
};

exports.getDraft = async (req, res) => {
  const rollover = await rolloverService.getDraft(req.params.id, req.user);
  res.status(200).json({ success: true, data: { rollover } });
};

exports.listDrafts = async (req, res) => {
  const rollovers = await rolloverService.listDrafts(req.user);
  res.status(200).json({ success: true, data: { rollovers } });
};

exports.saveDecisions = async (req, res) => {
  const rollover = await rolloverService.saveDecisions(req.params.id, req.body, req.user);
  res.status(200).json({ success: true, data: { rollover } });
};

exports.execute = async (req, res) => {
  const rollover = await rolloverService.execute(req.params.id, req.user, {
    ipAddress: req.ip,
    userAgent: typeof req.get === 'function' ? req.get('user-agent') : null,
  });
  res.status(200).json({ success: true, message: 'Academic year rollover completed', data: { rollover } });
};
