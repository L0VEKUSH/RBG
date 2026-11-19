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
const { isValidAcademicYear } = require('../utils/academic-year');
const { publishedExamFilter } = require('../utils/exam-visibility');
const { todaySchoolDate, parseSchoolDate, schoolDayBounds } = require('../utils/attendance-date');

const SCHOOL_WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function currentSchoolDay() {
    const dateKey = todaySchoolDate();
    const { year, month, day } = parseSchoolDate(dateKey);
    const { start, end } = schoolDayBounds(dateKey);
    const weekdayIndex = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
    return { dateKey, start, end, weekday: SCHOOL_WEEKDAYS[weekdayIndex] };
}

exports.getAdminDashboard = async () => {
    const studentCount = await Student.countDocuments({ isActive: true });
    const facultyCount = await Faculty.countDocuments({ isActive: true });
    const classCount = await Class.countDocuments({ isActive: true });
    const today = currentSchoolDay();
    const recentAdmissions = await Admission.countDocuments({ createdAt: { $gte: today.start, $lt: today.end } });

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
    const pendingAdmissions = await Admission.countDocuments({ status: { $in: ['Submitted', 'Under_Review', 'Document_Verification', 'Waitlisted'] } });
    const today = currentSchoolDay();
    const presentStudents = await Attendance.countDocuments({
        date: { $gte: today.start, $lt: today.end },
        status: 'Present',
    });
    
    const upcomingExams = await Exam.countDocuments({
        startDate: { $gte: today.start },
        ...publishedExamFilter(),
    });

    return {
        studentCount,
        facultyCount,
        pendingAdmissions,
        presentStudents,
        upcomingExams
    };
};

exports.getTeacherDashboard = async (teacherId) => {
    const faculty = await Faculty.findOne({ user: teacherId, isActive: true }).populate('user', 'name');
    if (!faculty) return null;

    let assignedClasses = [];
    if (faculty.classTeacherOf && faculty.classTeacherOf.class) {
       assignedClasses.push(faculty.classTeacherOf.class);
    }
    
    const assignmentRows = await SubjectAllocation.find({ teacher: faculty._id })
        .select('class academicYear subject')
        .populate('subject', '_id name code');
    const allocations = [...new Set(assignmentRows.map(row => row.class).filter(Boolean))];
    assignedClasses = [...new Set([...assignedClasses, ...allocations])];
    const attendanceScopes = [];
    if (faculty.classTeacherOf?.class && faculty.classTeacherOf?.academicYear) {
        attendanceScopes.push({
            class: faculty.classTeacherOf.class,
            academicYear: faculty.classTeacherOf.academicYear,
            isClassTeacher: true,
            subjects: [],
        });
    }
    for (const row of assignmentRows) {
        if (!row.class || !row.academicYear || !row.subject) continue;
        const subjectId = String(row.subject._id || row.subject);
        const subjectOption = {
            id: subjectId,
            label: row.subject.name || row.subject.code || 'Assigned subject',
        };
        const existing = attendanceScopes.find(scope =>
            scope.class === row.class && scope.academicYear === row.academicYear
        );
        if (existing && existing.subjects.some(subject => subject.id === subjectId)) continue;
        if (existing) existing.subjects.push(subjectOption);
        else attendanceScopes.push({
            class: row.class,
            academicYear: row.academicYear,
            isClassTeacher: false,
            subjects: [subjectOption],
        });
    }

    const today = currentSchoolDay();
    const dayOfWeek = today.weekday;
    
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
    
    const pendingHomework = await Homework.countDocuments({ teacher: teacherId, dueDate: { $gte: today.start } });
    
    // Attendance Pending: Count of assignedClasses that don't have an attendance record for today yet
    const attendanceChecks = await Promise.all(attendanceScopes.map(async scope => {
        const filter = {
            date: { $gte: today.start, $lt: today.end },
            class: scope.class,
            academicYear: scope.academicYear,
        };
        if (!scope.isClassTeacher && scope.subjects.length) {
            filter.subject = { $in: scope.subjects.map(subject => subject.id) };
        }
        return !(await Attendance.exists(filter));
    }));
    const attendancePendingCount = attendanceChecks.filter(Boolean).length;

    return {
        teacherName: faculty.user ? faculty.user.name : 'Teacher',
        assignedClasses,
        attendanceScopes: attendanceScopes.map(({ class: className, academicYear, isClassTeacher, subjects }) => ({
            class: className,
            academicYear,
            isClassTeacher,
            subjects,
        })),
        todaysSchedule,
        pendingHomework,
        attendancePendingCount,
        upcomingExams: await Exam.countDocuments({ class: { $in: assignedClasses }, startDate: { $gte: today.start } })
    };
};

exports.getStudentDashboard = async (studentUserId) => {
    const student = await Student.findOne({ user: studentUserId }).populate('user', 'name profilePhoto');
    if (!student) return null;

    const today = currentSchoolDay();
    
    const hasScheduleScope = Student.CLASS_LEVELS.includes(student.class)
        && isValidAcademicYear(student.academicYear);

    // Next exam: use the same year and publication policy as canonical Student exam reads.
    const nextExam = hasScheduleScope
        ? await Exam.findOne({
            class: student.class,
            academicYear: student.academicYear,
            startDate: { $gte: today.start },
            ...publishedExamFilter(),
        }).sort('startDate').lean()
        : null;
    
    // Homework due
    const pendingHomeworkCount = await Homework.countDocuments({ class: student.class, dueDate: { $gte: today.start } });

    // Find timetable for today
    const timetable = hasScheduleScope
        ? await Timetable.findOne({
            class: student.class,
            academicYear: student.academicYear,
            day: today.weekday,
            isActive: true,
        }).populate('periods.teacher', 'user').lean()
        : null;
      
    let todaysSchedule = [];
    if (timetable && timetable.periods) {
        todaysSchedule = timetable.periods.sort((a,b) => a.periodNumber - b.periodNumber).map(p => ({
            periodNumber: p.periodNumber,
            startTime: p.startTime,
            endTime: p.endTime,
            subject: p.subject,
            room: p.room,
            teacherName: null
        }));
    }

    // Attendance
    const attendanceSummary = await Attendance.getStudentSummary(
        student._id,
        student.academicYear,
        student.class
    );
    const attendancePercentage = attendanceSummary.total > 0
        ? Math.round(attendanceSummary.percentage)
        : null;

    return {
        studentId: String(student._id),
        profile: {
          name: student.user.name,
          admissionNumber: student.admissionNumber,
          class: student.class,
          rollNumber: student.rollNumber,
          academicYear: student.academicYear,
        },
        todaysSchedule,
        nextClass: todaysSchedule.length > 0 ? todaysSchedule[0] : null, // simplistic next class logic
        nextExam: nextExam ? { name: nextExam.name, date: nextExam.startDate } : null,
        pendingHomeworkCount,
        attendancePercentage
    };
};

exports.getParentDashboard = async (parentUserId) => {
    const parent = await Parent.findOne({ user: parentUserId }).populate({
        path: 'children',
        populate: { path: 'user', select: 'name profilePhoto' }
    });
    const currentChildren = parent?.children || [];
    const legacyChildren = await Student.find({ parentUser: parentUserId })
        .select('_id user class academicYear')
        .populate('user', 'name');
    const childMap = new Map();
    for (const student of [...currentChildren, ...legacyChildren]) {
        childMap.set(String(student._id), student);
    }
    const children = [...childMap.values()];
    if (!children.length) return { children: [] };

    const today = currentSchoolDay();
    const childrenStats = await Promise.all(children.map(async (student) => {
        const pendingHomeworkCount = await Homework.countDocuments({ class: student.class, dueDate: { $gte: today.start } });
        const nextExam = await Exam.findOne({ class: student.class, startDate: { $gte: today.start } }).sort('startDate');
        
        return {
            _id: String(student._id),
            studentId: student._id,
            name: student.user.name,
            class: student.class,
            academicYear: student.academicYear,
            pendingHomeworkCount,
            nextExam: nextExam ? { name: nextExam.name, date: nextExam.startDate } : null
        };
    }));

    return { children: childrenStats };
};

exports.getAccountantDashboard = async () => {
    const today = currentSchoolDay();
    const todayPayments = await Payment.aggregate([
        { $match: { date: { $gte: today.start, $lt: today.end } } },
        { $group: { _id: null, total: { $sum: '$amount' } } }
    ]);
    const totalCollectedToday = todayPayments[0]?.total || 0;
    
    return { totalCollectedToday };
};

exports.getLibrarianDashboard = async () => {
    const totalBooks = await LibraryBook.countDocuments({ isActive: { $ne: false } });
    const issued = await LibraryTransaction.countDocuments({ status: 'Issued' });
    const overdue = await LibraryTransaction.countDocuments({ status: 'Issued', dueDate: { $lt: new Date() } });
    
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
    
    const today = currentSchoolDay();
    const presentStudents = await Attendance.countDocuments({
        date: { $gte: today.start, $lt: today.end },
        status: 'Present',
    });
    
    return {
        studentCount,
        facultyCount,
        classCount,
        presentStudents
    };
};

exports.getAcademicCoordinatorDashboard = async () => {
    const classCount = await Class.countDocuments({ isActive: true });
    const today = currentSchoolDay();
    const ongoingExams = await Exam.countDocuments({ startDate: { $lt: today.end }, endDate: { $gte: today.start } });
    const upcomingExams = await Exam.countDocuments({ startDate: { $gte: today.end } });
    
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
    const today = currentSchoolDay();
    
    const upcomingExams = await Exam.countDocuments({ startDate: { $gte: today.end } });
    const ongoingExams = await Exam.countDocuments({ startDate: { $lt: today.end }, endDate: { $gte: today.start } });
    const completedExams = await Exam.countDocuments({ endDate: { $lt: today.start } });
    
    return {
        upcomingExams,
        ongoingExams,
        completedExams
    };
};

exports.getDriverDashboard = async () => {
    return {};
};

exports.getReceptionistDashboard = async () => {
    const pendingAdmissions = await Admission.countDocuments({ status: { $in: ['Submitted', 'Under_Review', 'Document_Verification', 'Waitlisted'] } });
    
    return { pendingAdmissions };
};

exports.getHrDashboard = async () => {
    const facultyCount = await Faculty.countDocuments({ isActive: true });
    
    return { facultyCount };
};

exports.getStaffDashboard = async () => {
    return {};
};
