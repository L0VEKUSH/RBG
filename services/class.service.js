const Class = require('../models/Class');
const Student = require('../models/Student');
const ErrorResponse = require('../utils/errorResponse');

function getAcademicLevel(canonicalName) {
    if (['Nursery', 'LKG', 'UKG'].includes(canonicalName)) return 'Pre-Primary';
    if (['1', '2', '3', '4', '5'].includes(canonicalName)) return 'Primary';
    if (['6', '7', '8'].includes(canonicalName)) return 'Middle';
    if (['9', '10'].includes(canonicalName)) return 'Secondary';
    if (['11', '12'].includes(canonicalName)) return 'Senior Secondary';
    return null;
}

exports.getAllClasses = async () => {
    return await Class.find().populate('classTeacher', 'firstName lastName');
};

exports.createClass = async (data = {}) => {
    if (data.section !== undefined || data.sections !== undefined) {
        throw new ErrorResponse('Class sections are not supported. RBG School ERP models single undivided classes per level.', 400);
    }

    if (data.name === 'Pre-Nursery') {
        throw new ErrorResponse("'Pre-Nursery' is not an approved school class level. Approved structure has 15 classes starting from Nursery / NC.", 400);
    }

    const canonicalName = Class.normalizeClassLevel(data.name);
    if (!canonicalName || !Class.CANONICAL_CLASS_LEVELS.includes(canonicalName)) {
        throw new ErrorResponse(`Class name '${data.name}' is not one of the approved 15 school class levels.`, 400);
    }

    const payload = { ...data, name: canonicalName };

    if (!payload.academicLevel) {
        payload.academicLevel = getAcademicLevel(canonicalName);
    }
    if (payload.displayOrder === undefined) {
        payload.displayOrder = Class.CANONICAL_CLASS_LEVELS.indexOf(canonicalName);
    }

    if (payload.academicYear) {
        const existing = await Class.findOne({ name: canonicalName, academicYear: payload.academicYear });
        if (existing) {
            throw new ErrorResponse(`Class '${canonicalName}' already exists for academic year '${payload.academicYear}'.`, 400);
        }
    }

    return await Class.create(payload);
};

exports.getClassById = async (id) => {
    return await Class.findById(id).populate('classTeacher', 'firstName lastName');
};

exports.updateClass = async (id, data = {}) => {
    if (data.section !== undefined || data.sections !== undefined) {
        throw new ErrorResponse('Class sections are not supported. RBG School ERP models single undivided classes per level.', 400);
    }

    const payload = { ...data };

    if (payload.name !== undefined) {
        if (payload.name === 'Pre-Nursery') {
            throw new ErrorResponse("'Pre-Nursery' is not an approved school class level. Approved structure has 15 classes starting from Nursery / NC.", 400);
        }
        const canonicalName = Class.normalizeClassLevel(payload.name);
        if (!canonicalName || !Class.CANONICAL_CLASS_LEVELS.includes(canonicalName)) {
            throw new ErrorResponse(`Class name '${payload.name}' is not one of the approved 15 school class levels.`, 400);
        }
        payload.name = canonicalName;
        if (!payload.academicLevel) {
            payload.academicLevel = getAcademicLevel(canonicalName);
        }
        if (payload.displayOrder === undefined) {
            payload.displayOrder = Class.CANONICAL_CLASS_LEVELS.indexOf(canonicalName);
        }
    }

    if (payload.name || payload.academicYear) {
        const current = await Class.findById(id);
        if (current) {
            const checkName = payload.name || current.name;
            const checkYear = payload.academicYear || current.academicYear;
            const duplicate = await Class.findOne({
                _id: { $ne: id },
                name: checkName,
                academicYear: checkYear
            });
            if (duplicate) {
                throw new ErrorResponse(`Class '${checkName}' already exists for academic year '${checkYear}'.`, 400);
            }
        }
    }

    return await Class.findByIdAndUpdate(id, payload, { new: true, runValidators: true });
};

exports.deleteClass = async (id) => {
    return await Class.findByIdAndDelete(id);
};

exports.getStudentsInClass = async (classId) => {
    return await Student.find({ currentClass: classId }).populate('user', 'firstName lastName rollNumber');
};
