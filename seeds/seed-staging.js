/**
 * STAGING SEED — RBG School ERP
 * 
 * Creates clearly labelled DEMO/STAGING data in a SEPARATE database.
 * NEVER run against production database.
 * 
 * Usage:
 *   NODE_ENV=staging MONGO_URI=mongodb://localhost:27017/school_management_staging node seeds/seed-staging.js
 * 
 * WARNING: Running with --destroy will drop the staging database first.
 */

const mongoose = require('mongoose');
const bcrypt   = require('bcryptjs');
const path     = require('path');
const { assertLocalSyntheticSeedTarget } = require('../scripts/seed-safety');

// ── Safety check ───────────────────────────────────────────────────
let MONGO_URI;
try {
  MONGO_URI = assertLocalSyntheticSeedTarget({
    expectedEnvironment: 'staging',
    optInVariable: 'ALLOW_STAGING_DEMO_SEED',
    databaseName: 'school_management_staging',
  });
} catch (error) {
  console.error(`\nSAFETY STOP: ${error.message}\n`);
  process.exit(1);
}

const DESTROY = process.argv.includes('--destroy');

// ── Models ─────────────────────────────────────────────────────────
const User         = require('../models/User');
const Student      = require('../models/Student');
const Faculty      = require('../models/Faculty');
const Parent       = require('../models/Parent');
const Class        = require('../models/Class');
const Subject      = require('../models/Subject');
const AcademicYear = require('../models/AcademicYear');
const Timetable    = require('../models/Timetable');
const Attendance   = require('../models/Attendance');
const Marks        = require('../models/Marks');
const Homework     = require('../models/Homework');
const Notice       = require('../models/Notice');
const Event        = require('../models/Event');

const hash = async pw => bcrypt.hash(pw, 12);

async function run() {
  await mongoose.connect(MONGO_URI);
  console.log('✅  Connected to isolated staging database.');

  if (DESTROY) {
    await mongoose.connection.dropDatabase();
    console.log('🗑   Staging database dropped.');
  }

  // ── 1. Academic Year ────────────────────────────────────────────
  const ay = await AcademicYear.findOneAndUpdate(
    { name: '2026-2027' },
    {
      name: '2026-2027',
      startDate: new Date('2026-04-01'),
      endDate:   new Date('2027-03-31'),
      isCurrent: true,
      isActive:  true,
      terms: [
        { name: 'Term 1', startDate: new Date('2026-04-01'), endDate: new Date('2026-09-30') },
        { name: 'Term 2', startDate: new Date('2026-10-01'), endDate: new Date('2027-03-31') },
      ],
    },
    { upsert: true, new: true }
  );
  console.log(`  📅  Academic Year: ${ay.name}`);

  // ── 2. Classes ──────────────────────────────────────────────────
  const classData = [
    { name: '9', level: '9', academicYear: ay._id },
    { name: '10', level: '10', academicYear: ay._id },
    { name: '11-Science', level: '11', stream: 'Science', academicYear: ay._id },
    { name: '12-Commerce', level: '12', stream: 'Commerce', academicYear: ay._id },
  ];
  const classes = {};
  for (const cd of classData) {
    const cls = await Class.findOneAndUpdate(
      { name: cd.name, academicYear: ay._id },
      cd, { upsert: true, new: true }
    );
    classes[cd.name] = cls;
    console.log(`  🏫  Class: ${cls.name}`);
  }

  // ── 3. Subjects ─────────────────────────────────────────────────
  const subjectData = [
    { name: 'Mathematics', code: 'MATH', classLevel: '9' },
    { name: 'Science', code: 'SCI', classLevel: '9' },
    { name: 'English', code: 'ENG', classLevel: '9' },
    { name: 'Social Science', code: 'SST', classLevel: '9' },
    { name: 'Hindi', code: 'HIN', classLevel: '9' },
    { name: 'Mathematics', code: 'MATH10', classLevel: '10' },
    { name: 'Science', code: 'SCI10', classLevel: '10' },
    { name: 'English', code: 'ENG10', classLevel: '10' },
    { name: 'Physics', code: 'PHY11', classLevel: '11' },
    { name: 'Chemistry', code: 'CHE11', classLevel: '11' },
    { name: 'Mathematics', code: 'MATH11', classLevel: '11' },
  ];
  for (const sd of subjectData) {
    await Subject.findOneAndUpdate({ code: sd.code }, sd, { upsert: true, new: true });
  }
  console.log(`  📚  Subjects seeded`);

  // ── 4. Users + Roles ────────────────────────────────────────────
  const accounts = [
    // Admins
    { name: 'Super Admin [STAGING]',      email: 'superadmin@staging.edu.in',   role: 'super_admin',       password: 'Admin@123',     phone: '9800000001' },
    { name: 'School Admin [STAGING]',     email: 'admin@staging.edu.in',         role: 'school_admin',      password: 'Admin@123',     phone: '9800000002' },
    { name: 'Principal [STAGING]',        email: 'principal@staging.edu.in',     role: 'principal',         password: 'Principal@123', phone: '9800000003' },
    // Teachers
    { name: 'Ravi Sharma [STAGING]',      email: 'ravi.sharma@staging.edu.in',   role: 'teacher',           password: 'Teacher@123',   phone: '9800000004' },
    { name: 'Priya Nair [STAGING]',       email: 'priya.nair@staging.edu.in',    role: 'class_teacher',     password: 'Teacher@123',   phone: '9800000005' },
    // Students
    { name: 'Arjun Kumar [STAGING]',      email: 'arjun@staging.edu.in',         role: 'student',           password: 'Student@123',   phone: '9800000006' },
    { name: 'Meera Singh [STAGING]',      email: 'meera@staging.edu.in',         role: 'student',           password: 'Student@123',   phone: '9800000007' },
    { name: 'Rahul Verma [STAGING]',      email: 'rahul@staging.edu.in',         role: 'student',           password: 'Student@123',   phone: '9800000008' },
    // Parents
    { name: 'Mr Kumar [STAGING]',         email: 'mr.kumar@staging.edu.in',      role: 'parent',            password: 'Parent@123',    phone: '9800000009' },
    // Secondary roles
    { name: 'Accountant [STAGING]',       email: 'accountant@staging.edu.in',    role: 'accountant',        password: 'Staff@123',     phone: '9800000010' },
    { name: 'Librarian [STAGING]',        email: 'librarian@staging.edu.in',     role: 'librarian',         password: 'Staff@123',     phone: '9800000011' },
    { name: 'Admission Officer [STAGING]',email: 'admission@staging.edu.in',     role: 'admission_officer', password: 'Staff@123',     phone: '9800000012' },
    { name: 'Exam Coordinator [STAGING]', email: 'exam@staging.edu.in',          role: 'exam_coordinator',  password: 'Staff@123',     phone: '9800000013' },
    { name: 'Vice Principal [STAGING]',   email: 'vp@staging.edu.in',            role: 'vice_principal',    password: 'Staff@123',     phone: '9800000014' },
  ];

  const userMap = {};
  for (const acc of accounts) {
    const existing = await User.findOne({ email: acc.email });
    if (existing) {
      if (!existing.isActive) {
        existing.isActive = true;
        await existing.save();
      }
      userMap[acc.role + '_' + acc.email] = existing;
      continue;
    }
    const user = await User.create({
      name:     acc.name,
      email:    acc.email,
      password: acc.password,  // Model pre-save hook hashes it — do NOT pre-hash here
      role:     acc.role,
      isActive: true,
      phone:    acc.phone,     // 10-digit from account definition
    });
    userMap[acc.role + '_' + acc.email] = user;
    console.log(`  👤  User: ${acc.name} (${acc.role})`);
  }

  const teacherUser    = userMap['teacher_ravi.sharma@staging.edu.in']    || await User.findOne({ email: 'ravi.sharma@staging.edu.in' });
  const classTeachUser = userMap['class_teacher_priya.nair@staging.edu.in'] || await User.findOne({ email: 'priya.nair@staging.edu.in' });
  const arjunUser      = userMap['student_arjun@staging.edu.in']          || await User.findOne({ email: 'arjun@staging.edu.in' });
  const meeraUser      = userMap['student_meera@staging.edu.in']          || await User.findOne({ email: 'meera@staging.edu.in' });
  const rahulUser      = userMap['student_rahul@staging.edu.in']          || await User.findOne({ email: 'rahul@staging.edu.in' });
  const parentUser     = userMap['parent_mr.kumar@staging.edu.in']        || await User.findOne({ email: 'mr.kumar@staging.edu.in' });

  // ── 5. Faculty records ──────────────────────────────────────────
  const faculty1 = await Faculty.findOneAndUpdate(
    { user: teacherUser._id },
    {
      user:            teacherUser._id,
      employeeId:      'EMP-STAGING-001',
      department:      'Mathematics',
      designation:     'Teacher',
      joiningDate:     new Date('2020-05-15'),
      subjects: [
        { subject: 'Mathematics', classes: ['9', '10'] }
      ],
      isActive:        true,
    },
    { upsert: true, new: true }
  );

  const faculty2 = await Faculty.findOneAndUpdate(
    { user: classTeachUser._id },
    {
      user:            classTeachUser._id,
      employeeId:      'EMP-STAGING-002',
      department:      'Science',
      designation:     'Class Teacher',
      joiningDate:     new Date('2019-03-10'),
      subjects: [
        { subject: 'Science', classes: ['9'] }
      ],
      classTeacherOf:  { class: '9', academicYear: '2026-2027' },
      isClassTeacher:  true,
      isActive:        true,
    },
    { upsert: true, new: true }
  );
  console.log(`  🧑‍🏫  Faculty records: ${faculty1.employeeId}, ${faculty2.employeeId}`);

  // Create SubjectAllocations so teacher authorization (requireClassAccess) works
  const SubjectAllocation = require('../models/SubjectAllocation');
  const mathSub = await Subject.findOne({ code: 'MATH' });
  if (mathSub) await SubjectAllocation.findOneAndUpdate(
    { teacher: faculty1._id, subject: mathSub._id, class: '9' },
    { teacher: faculty1._id, subject: mathSub._id, class: '9', academicYear: '2026-2027' },
    { upsert: true, new: true }
  );
  const sciSub = await Subject.findOne({ code: 'SCI' });
  if (sciSub) await SubjectAllocation.findOneAndUpdate(
    { teacher: faculty2._id, subject: sciSub._id, class: '9' },
    { teacher: faculty2._id, subject: sciSub._id, class: '9', academicYear: '2026-2027' },
    { upsert: true, new: true }
  );
  console.log(`  🔗  Subject allocations created`);


  // ── 6. Students ─────────────────────────────────────────────────
  const studentsSeed = [
    { user: arjunUser._id, admNo: 'ADM-STG-001', roll: 1,  class: '9', name: 'Arjun Kumar', dob: '2012-05-15', gender: 'male' },
    { user: meeraUser._id, admNo: 'ADM-STG-002', roll: 2,  class: '9', name: 'Meera Singh',  dob: '2012-08-22', gender: 'female' },
    { user: rahulUser._id, admNo: 'ADM-STG-003', roll: 3,  class: '10', name: 'Rahul Verma', dob: '2011-03-10', gender: 'male' },
  ];
  const studentMap = {};
  for (const sd of studentsSeed) {
    const st = await Student.findOneAndUpdate(
      { admissionNumber: sd.admNo },
      {
        user:            sd.user,
        admissionNumber: sd.admNo,
        rollNumber:      sd.roll,
        class:           sd.class,
        academicYear:    ay.name,
        dateOfBirth:     new Date(sd.dob),
        gender:          sd.gender,
        isActive:        true,
        tcIssued:        false,
        father: { name: `Father of ${sd.name.split(' ')[0]}`, phone: '+91-9800000001' },
        mother: { name: `Mother of ${sd.name.split(' ')[0]}`, phone: '+91-9800000002' },
      },
      { upsert: true, new: true }
    );
    studentMap[sd.admNo] = st;
    console.log(`  🎒  Student: ${sd.name} — ${sd.admNo} Class ${sd.class}`);
  }

  // ── 7. Parent ───────────────────────────────────────────────────
  await Student.findByIdAndUpdate(studentMap['ADM-STG-001']._id, { parentUser: parentUser._id });
  await Parent.findOneAndUpdate(
    { user: parentUser._id },
    {
      user:     parentUser._id,
      children: [studentMap['ADM-STG-001']._id],
      occupation: 'Engineer',
      isActive: true,
    },
    { upsert: true, new: true }
  );
  console.log(`  👨‍👩‍👧  Parent linked to Arjun`);

  // ── 8. Timetable (Class 9, Monday–Friday) ───────────────────────
  const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
  const periods = [
    { period: 1, startTime: '08:00', endTime: '08:45', subject: 'Mathematics', teacher: teacherUser._id },
    { period: 2, startTime: '08:45', endTime: '09:30', subject: 'Science',     teacher: classTeachUser._id },
    { period: 3, startTime: '09:45', endTime: '10:30', subject: 'English',     teacher: classTeachUser._id },
    { period: 4, startTime: '10:30', endTime: '11:15', subject: 'Hindi',       teacher: teacherUser._id },
    { period: 5, startTime: '12:00', endTime: '12:45', subject: 'Social Science', teacher: teacherUser._id },
    { period: 6, startTime: '12:45', endTime: '13:30', subject: 'Mathematics', teacher: teacherUser._id },
  ];

  for (const day of days) {
    await Timetable.findOneAndUpdate(
      { class: '9', day, academicYear: ay._id },
      { class: '9', day, academicYear: ay._id, periods, createdBy: teacherUser._id },
      { upsert: true, new: true }
    );
  }
  console.log(`  📅  Timetable seeded for Class 9 (Mon–Fri)`);

  // ── 9. Attendance (last 30 days for Arjun) ──────────────────────
  const arjun = studentMap['ADM-STG-001'];
  for (let d = 29; d >= 0; d--) {
    const date = new Date();
    date.setDate(date.getDate() - d);
    date.setHours(0, 0, 0, 0);
    if (date.getDay() === 0 || date.getDay() === 6) continue; // skip weekends
    const status = d % 7 === 0 ? 'Absent' : 'Present'; // ~1 absent per week
    await Attendance.findOneAndUpdate(
      { student: arjun._id, date },
      { student: arjun._id, class: '9', date, status, academicYear: ay._id, markedBy: classTeachUser._id },
      { upsert: true, new: true }
    );
  }
  console.log(`  📋  Attendance seeded for Arjun (30 days)`);

  // ── 10. Marks ───────────────────────────────────────────────────
  // Use new+save instead of findOneAndUpdate so the pre-save hook computesUP Board grades
  await Marks.deleteMany({ student: arjun._id, examType: 'Unit Test 1', academicYear: '2026-2027' });
  const marksDoc = new Marks({
    student:     arjun._id,
    class:       '9',
    academicYear: '2026-2027',
    examType:    'Unit Test 1',
    isPublished: true,
    publishedAt: new Date(),
    subjects: [
      { subject: 'Mathematics',    maxMarks: 100, marksObtained: 88 },
      { subject: 'Science',        maxMarks: 100, marksObtained: 76 },
      { subject: 'English',        maxMarks: 100, marksObtained: 92 },
      { subject: 'Social Science', maxMarks: 100, marksObtained: 81 },
      { subject: 'Hindi',          maxMarks: 100, marksObtained: 69 },
    ],
    markedBy: teacherUser._id,
  });
  await marksDoc.save();
  console.log(`  📝  Marks seeded for Arjun — Unit Test 1 (published, grades computed)`);

  // ── 11. Homework ─────────────────────────────────────────────────
  const dueDate = new Date();
  dueDate.setDate(dueDate.getDate() + 3);
  await Homework.findOneAndUpdate(
    { title: '[STAGING] Math HW — Chapter 4 Exercises' },
    {
      title:       '[STAGING] Math HW — Chapter 4 Exercises',
      subject:     'Mathematics',
      class:       '9',
      description: 'Complete exercises 4.1 to 4.5 from the textbook.',
      dueDate,
      assignedBy:  teacherUser._id,
      academicYear: ay._id,
    },
    { upsert: true, new: true }
  );
  console.log(`  📖  Homework seeded for Class 9`);

  // ── 12. Notices ──────────────────────────────────────────────────
  const noticesData = [
    { title: '[STAGING] Admissions Open 2026-27', type: 'Admission', content: 'Applications now being accepted for all classes.', isPublished: true, isPinned: true },
    { title: '[STAGING] Parent-Teacher Meeting', type: 'Academic', content: 'Mandatory PTM for Class 9 and 10 parents on 15th October.', isPublished: true },
    { title: '[STAGING] Annual Sports Day', type: 'Events', content: 'Annual sports day scheduled for 20th November.', isPublished: true },
    { title: '[STAGING] INTERNAL — Staff Meeting', type: 'General', content: 'Internal staff meeting at 3PM Friday.', isPublished: false },
  ];
  const adminUser = await User.findOne({ role: 'super_admin' });
  for (const nd of noticesData) {
    await Notice.findOneAndUpdate(
      { title: nd.title },
      { ...nd, createdBy: adminUser._id, publishDate: new Date() },
      { upsert: true, new: true }
    );
  }
  console.log(`  📢  Notices seeded (3 public, 1 private)`);

  // ── 13. Events ───────────────────────────────────────────────────
  const eventsData = [
    { title: '[STAGING] Science Exhibition', description: 'Annual science exhibition by middle school students.', startDate: new Date(Date.now() + 86400000 * 7), isPublic: true },
    { title: '[STAGING] Inter-School Debate', description: 'Regional debate competition. School auditorium.', startDate: new Date(Date.now() + 86400000 * 14), isPublic: true },
    { title: '[STAGING] Staff Development Day', description: 'Internal training day.', startDate: new Date(Date.now() + 86400000 * 3), isPublic: false },
  ];
  for (const ed of eventsData) {
    await Event.findOneAndUpdate(
      { title: ed.title },
      { ...ed, createdBy: adminUser._id, endDate: new Date(ed.startDate.getTime() + 3600000 * 3) },
      { upsert: true, new: true }
    );
  }
  console.log(`  🎉  Events seeded (2 public, 1 private)`);

  // ── Done ─────────────────────────────────────────────────────────
  console.log('\n════════════════════════════════════════════════════');
  console.log(' STAGING SEED COMPLETE');
  console.log('════════════════════════════════════════════════════');
  console.log('\nSynthetic staging fixtures created. Credentials are not printed.');

  await mongoose.disconnect();
}

run().catch(err => {
  console.error('\n❌  Seed failed:', err.message);
  process.exit(1);
});


