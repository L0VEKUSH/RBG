const settingsService = require('../services/settings.service');
const ErrorResponse = require('../utils/errorResponse');

exports.getAllSettings = async (req, res, next) => {
    try {
        const settings = await settingsService.getAllSettings();
        res.status(200).json({ success: true, message: 'Settings retrieved', data: settings, count: settings.length });
    } catch (error) { next(error); }
};

exports.getSetting = async (req, res, next) => {
    try {
        const setting = await settingsService.getSettingByKey(req.params.key);
        if (!setting) return next(new ErrorResponse('Setting not found', 404));
        res.status(200).json({ success: true, message: 'Setting retrieved', data: setting });
    } catch (error) { next(error); }
};

exports.updateSetting = async (req, res, next) => {
    try {
        const setting = await settingsService.updateSetting(req.params.key, req.body.value);
        res.status(200).json({ success: true, message: 'Setting updated', data: setting });
    } catch (error) { next(error); }
};

exports.bulkUpdate = async (req, res, next) => {
    try {
        const settings = await settingsService.bulkUpdateSettings(req.body.settings);
        res.status(200).json({ success: true, message: 'Settings updated', data: settings, count: settings.length });
    } catch (error) { next(error); }
};
