const Student = require('../models/Student');
const Faculty = require('../models/Faculty');
const User = require('../models/User');
const Payment = require('../models/Payment');
const Admission = require('../models/Admission');
const Homework = require('../models/Homework');
const LibraryTransaction = require('../models/LibraryTransaction');
const LibraryBook = require('../models/LibraryBook');
const Attendance = require('../models/Attendance');
const Class = require('../models/Class');
const Parent = require('../models/Parent');
const SubjectAllocation = require('../models/SubjectAllocation');
const Timetable = require('../models/Timetable');
const Exam = require('../models/Exam');

exports.getAdminDashboard = async () => {
    const studentCount = await Student.countDocuments({ isActive: true });
    const facultyCount = await Faculty.countDocuments({ isActive: true });
    const classCount = await Class.countDocuments({ isActive: true });
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const recentAdmissions = await Admission.countDocuments({ createdAt: { $gte: today } });

    return {
        studentCount,
        facultyCount,
        classCount,
        recentAdmissions,
    };
};

exports.getPrincipalDashboard = async () => {
    const studentCount = await Student.countDocuments({ isActive: true });
    const facultyCount = await Faculty.countDocuments({ isActive: true });
    const pendingAdmissions = await Admission.countDocuments({ status: 'Pending' });
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const presentStudents = await Attendance.countDocuments({ date: today, status: 'Present' });
    
    // Low attendance classes
    // Mocking for performance, a real implementation would aggregate today's attendance records
    
    // Academic performance trend (mocked for simplicity, would aggregate marks collection)
    const upcomingExams = await Exam.countDocuments({ startDate: { $gt: today } });

    return {
        studentCount,
        facultyCount,
        pendingAdmissions,
        presentStudents,
        upcomingExams,
        teacherAttendance: '98%', // Placeholder
        academicPerformanceAvg: '84%' // Placeholder
    };
};

exports.getTeacherDashboard = async (teacherId) => {
    const faculty = await Faculty.findOne({ user: teacherId }).populate('user', 'name');
    if (!faculty) return null;

    let assignedClasses = [];
    if (faculty.classTeacherOf && faculty.classTeacherOf.class) {
       assignedClasses.push(faculty.classTeacherOf.class);
    }
    
    const allocations = await SubjectAllocation.find({ teacher: faculty._id }).distinct('class');
    assignedClasses = [...new Set([...assignedClasses, ...allocations])];

    const today = new Date();
    today.setHours(0,0,0,0);
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const dayOfWeek = dayNames[new Date().getDay()];
    
    // Find teacher's exact schedule today
    const timetables = await Timetable.find({ day: dayOfWeek, 'periods.teacher': faculty._id, isActive: true }).lean();
    let todaysSchedule = [];
    timetables.forEach(tt => {
        tt.periods.forEach(p => {
            if (p.teacher && p.teacher.toString() === faculty._id.toString()) {
                todaysSchedule.push({
                    class: tt.class,
                    subject: p.subject,
                    startTime: p.startTime,
                    endTime: p.endTime,
                    room: p.room,
                    periodNumber: p.periodNumber
                });
            }
        });
    });
    todaysSchedule.sort((a,b) => a.periodNumber - b.periodNumber);
    
    const pendingHomework = await Homework.countDocuments({ teacher: teacherId, dueDate: { $gte: today } });
    
    // Attendance Pending: Count of assignedClasses that don't have an attendance record for today yet
    const attendanceRecords = await Attendance.find({ date: today, class: { $in: assignedClasses } }).distinct('class');
    const attendancePendingCount = assignedClasses.length - attendanceRecords.length;

    return {
        teacherName: faculty.user ? faculty.user.name : 'Teacher',
        assignedClasses,
        todaysSchedule,
        pendingHomework,
        attendancePendingCount,
        upcomingExams: await Exam.countDocuments({ class: { $in: assignedClasses }, startDate: { $gte: today } })
    };
};

exports.getStudentDashboard = async (studentUserId) => {
    const student = await Student.findOne({ user: studentUserId }).populate('user', 'name profilePhoto');
    if (!student) return null;

    const today = new Date();
    today.setHours(0,0,0,0);
    
    // Next exam
    const nextExam = await Exam.findOne({ class: student.class, startDate: { $gte: today } }).sort('startDate').lean();
    
    // Homework due
    const pendingHomeworkCount = await Homework.countDocuments({ class: student.class, dueDate: { $gte: today } });

    // Find timetable for today
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const dayOfWeek = dayNames[new Date().getDay()];
    const timetable = await Timetable.findOne({ class: student.class, day: dayOfWeek, isActive: true })
      .populate('periods.teacher', 'user').lean();
      
    let todaysSchedule = [];
    if (timetable && timetable.periods) {
        todaysSchedule = timetable.periods.sort((a,b) => a.periodNumber - b.periodNumber).map(p => ({
            periodNumber: p.periodNumber,
            startTime: p.startTime,
            endTime: p.endTime,
            subject: p.subject,
            room: p.room,
            // we'd need to populate User inside Faculty for teacher name, but keeping it simple
            teacherName: p.teacher ? "Teacher Assigned" : "N/A"
        }));
    }

    // Attendance
    const totalDays = await Attendance.countDocuments({ class: student.class });
    const presentDays = await Attendance.countDocuments({ class: student.class, 'records.student': student._id, 'records.status': 'Present' });
    const attendancePercentage = totalDays > 0 ? Math.round((presentDays/totalDays)*100) : 100;

    return {
        profile: {
          name: student.user.name,
          admissionNumber: student.admissionNumber,
          class: student.class,
          rollNumber: student.rollNumber
        },
        todaysSchedule,
        nextClass: todaysSchedule.length > 0 ? todaysSchedule[0] : null, // simplistic next class logic
        nextExam: nextExam ? { name: nextExam.name, date: nextExam.startDate } : null,
        pendingHomeworkCount,
        attendancePercentage,
        feeStatus: "Offline Ledger Active" // Disabled online payment
    };
};

exports.getParentDashboard = async (parentUserId) => {
    const parent = await Parent.findOne({ user: parentUserId }).populate({
        path: 'children',
        populate: { path: 'user', select: 'name profilePhoto' }
    });
    if (!parent) return null;

    const childrenStats = await Promise.all(parent.children.map(async (student) => {
        const pendingHomeworkCount = await Homework.countDocuments({ class: student.class, dueDate: { $gte: new Date() } });
        const nextExam = await Exam.findOne({ class: student.class, startDate: { $gte: new Date() } }).sort('startDate');
        
        return {
            studentId: student._id,
            name: student.user.name,
            class: student.class,
            pendingHomeworkCount,
            nextExam: nextExam ? { name: nextExam.name, date: nextExam.startDate } : null
        };
    }));

    return { children: childrenStats };
};

exports.getAccountantDashboard = async () => {
    const today = new Date();
    today.setHours(0,0,0,0);
    const todayPayments = await Payment.aggregate([
        { $match: { date: { $gte: today } } },
        { $group: { _id: null, total: { $sum: '$amount' } } }
    ]);
    const totalCollectedToday = todayPayments[0]?.total || 0;
    
    return {
        totalCollectedToday,
        pendingInvoices: 0 // Mock metric
    };
};

exports.getLibrarianDashboard = async () => {
    const totalBooks = await LibraryBook.countDocuments();
    const issued = await LibraryTransaction.countDocuments({ status: 'issued' });
    const overdue = await LibraryTransaction.countDocuments({ status: 'issued', dueDate: { $lt: new Date() } });
    
    return {
        totalBooks,
        issuedBooks: issued,
        overdueBooks: overdue
    };
};

exports.getVicePrincipalDashboard = async () => {
    const studentCount = await Student.countDocuments({ isActive: true });
    const facultyCount = await Faculty.countDocuments({ isActive: true });
    const classCount = await Class.countDocuments({ isActive: true });
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const presentStudents = await Attendance.countDocuments({ date: today, status: 'Present' });
    
    return {
        studentCount,
        facultyCount,
        classCount,
        presentStudents
    };
};

exports.getAcademicCoordinatorDashboard = async () => {
    const classCount = await Class.countDocuments({ isActive: true });
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const ongoingExams = await Exam.countDocuments({ startDate: { $lte: today }, endDate: { $gte: today } });
    const upcomingExams = await Exam.countDocuments({ startDate: { $gt: today } });
    
    return {
        classCount,
        ongoingExams,
        upcomingExams
    };
};

exports.getAdmissionOfficerDashboard = async () => {
    const statuses = await Admission.aggregate([
        { $group: { _id: "$status", count: { $sum: 1 } } }
    ]);
    
    const counts = {
        Submitted: 0,
        Under_Review: 0,
        Document_Verification: 0,
        Approved: 0,
        Rejected: 0,
        Waitlisted: 0,
        Admitted: 0
    };
    
    statuses.forEach(s => {
        if(counts[s._id] !== undefined) counts[s._id] = s.count;
    });

    const recentApplications = await Admission.find().sort('-appliedDate').limit(10).select('applicationNumber studentName classApplyingFor status appliedDate');
    
    return {
        counts,
        recentApplications
    };
};

exports.getExamCoordinatorDashboard = async () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const upcomingExams = await Exam.countDocuments({ startDate: { $gt: today } });
    const ongoingExams = await Exam.countDocuments({ startDate: { $lte: today }, endDate: { $gte: today } });
    const completedExams = await Exam.countDocuments({ endDate: { $lt: today } });
    
    return {
        upcomingExams,
        ongoingExams,
        completedExams
    };
};

exports.getDriverDashboard = async (driverUserId) => {
    // Basic mock implementation for driver
    return {
        assignedRoute: "Route 1",
        busNumber: "BUS-001",
        studentsAssigned: 45
    };
};

exports.getReceptionistDashboard = async () => {
    const pendingAdmissions = await Admission.countDocuments({ status: 'Pending' });
    
    return {
        pendingAdmissions,
        todayVisitors: 0 // Mock metric
    };
};

exports.getHrDashboard = async () => {
    const facultyCount = await Faculty.countDocuments({ isActive: true });
    
    return {
        facultyCount,
        onLeaveToday: 0 // Mock metric
    };
};

exports.getStaffDashboard = async (staffUserId) => {
    return {
        status: "Active"
    };
};
