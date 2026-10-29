const Setting = require('../models/SchoolSettings');

exports.getAllSettings = async () => {
    return await Setting.find();
};

exports.getSettingByKey = async (key) => {
    return await Setting.findOne({ key });
};

exports.updateSetting = async (key, value) => {
    return await Setting.findOneAndUpdate({ key }, { value }, { new: true, upsert: true });
};

exports.bulkUpdateSettings = async (settingsArray) => {
    const promises = settingsArray.map(setting => 
        Setting.findOneAndUpdate({ key: setting.key }, { value: setting.value }, { new: true, upsert: true })
    );
    return await Promise.all(promises);
};
