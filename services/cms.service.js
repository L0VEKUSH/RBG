const CmsContent = require('../models/WebsiteContent');

exports.getContentByPage = async (page) => {
    return await CmsContent.findOne({ pageIdentifier: page });
};

exports.getAllContent = async () => {
    return await CmsContent.find();
};

exports.updateContent = async (page, data) => {
    return await CmsContent.findOneAndUpdate({ pageIdentifier: page }, data, { new: true, upsert: true });
};
