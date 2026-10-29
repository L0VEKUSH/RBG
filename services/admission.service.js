const Admission = require('../models/Admission');
const User = require('../models/User');
const Student = require('../models/Student');
const Parent = require('../models/Parent');

exports.applyForAdmission = async (data) => {
    return await Admission.create(data);
};

exports.getAllAdmissions = async () => {
    return await Admission.find();
};

exports.getAdmissionStats = async () => {
    return await Admission.aggregate([
        { $group: { _id: '$status', count: { $sum: 1 } } }
    ]);
};

exports.getAdmissionById = async (id) => {
    return await Admission.findById(id);
};

exports.updateAdmission = async (id, data) => {
    return await Admission.findByIdAndUpdate(id, data, { new: true });
};

exports.updateAdmissionStatus = async (id, status) => {
    return await Admission.findByIdAndUpdate(id, { status }, { new: true });
};

const Counter = require('../models/Counter');

exports.admitStudent = async (id) => {
    const admission = await Admission.findById(id);
    if (!admission) throw new Error('Admission not found');
    if (admission.status !== 'Approved') throw new Error('Admission must be approved first');

    const academicYear = '2026-2027'; // Hardcoded for this context, ideally fetched from settings
    const counterId = `rollNumber_${academicYear}_${admission.classApplyingFor}`;
    
    // Atomically increment and fetch roll number
    const counter = await Counter.findByIdAndUpdate(
        counterId,
        { $inc: { seq: 1 } },
        { new: true, upsert: true }
    );
    const rollNumber = counter.seq;

    let studentUser, parentUser, parent, student;
    try {
        studentUser = await User.create({
            name: admission.studentName,
            email: admission.studentEmail || `student_${Date.now()}@sunriseschool.edu.in`, 
            password: 'Password@123', 
            role: 'student'
        });

        const parentName = admission.fatherName || admission.motherName || admission.guardianName || 'Parent';
        const parentEmail = admission.fatherEmail || admission.motherEmail || `parent_${studentUser._id}@sunriseschool.edu.in`;
        
        parentUser = await User.findOne({ email: parentEmail });
        if (!parentUser) {
            parentUser = await User.create({
                name: parentName,
                email: parentEmail,
                password: 'Password@123',
                role: 'parent'
            });
        }

        parent = await Parent.findOne({ user: parentUser._id });
        if (!parent) {
            parent = await Parent.create({
                user: parentUser._id,
                children: [],
                contactNumber: admission.fatherPhone || admission.motherPhone || '0000000000'
            });
        }

        student = await Student.create({
            user: studentUser._id,
            parentUser: parentUser._id,
            class: admission.classApplyingFor,
            stream: admission.stream || 'N/A',
            rollNumber: rollNumber,
            academicYear: academicYear,
            father: { name: admission.fatherName || 'Not Provided', phone: admission.fatherPhone, email: admission.fatherEmail },
            mother: { name: admission.motherName || 'Not Provided', phone: admission.motherPhone, email: admission.motherEmail }
        });

        if (!parent.children.includes(student._id)) {
            parent.children.push(student._id);
            await parent.save();
        }

        admission.status = 'Admitted';
        admission.createdStudent = student._id;
        await admission.save();

        // Create initial fee setup
        const FeeStructure = require('../models/FeeStructure');
        const StudentFee = require('../models/StudentFee');
        const feeStructure = await FeeStructure.findOne({ class: student.class, academicYear: student.academicYear, isActive: true });
        if (feeStructure) {
            const totalAmount = feeStructure.components ? feeStructure.components.reduce((acc, curr) => acc + (curr.amount || 0), 0) : 0;
            await StudentFee.create({
                student: student._id,
                feeStructure: feeStructure._id,
                class: student.class,
                academicYear: student.academicYear,
                totalAmount: totalAmount,
                status: 'Pending'
            });
        }

        return student;
    } catch (error) {
        // Safe rollback
        if (student) await Student.findByIdAndDelete(student._id);
        if (studentUser) await User.findByIdAndDelete(studentUser._id);
        // We do not delete parentUser/parent as they might be linked to other siblings
        // Revert counter to avoid skipping roll numbers, though small gaps are typically acceptable
        await Counter.findByIdAndUpdate(counterId, { $inc: { seq: -1 } });
        throw error;
    }
};
