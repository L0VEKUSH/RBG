const mongoose = require('mongoose');
const dotenv = require('dotenv');
const colors = require('colors');
const path = require('path');
const fs = require('fs');

// Load env vars
dotenv.config({ path: path.join(__dirname, '../.env') });

// Load models
const User = require('../models/User');
const Student = require('../models/Student');
const Faculty = require('../models/Faculty');
const Parent = require('../models/Parent');
const Class = require('../models/Class');
const Subject = require('../models/Subject');
const AcademicYear = require('../models/AcademicYear');

// Connect to DB
mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/school_management_db');

const classLevels = ['Pre-Nursery', 'Nursery', 'LKG', 'UKG', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'];

const generateAcademicYear = async () => {
  const currentYear = new Date().getFullYear();
  return await AcademicYear.create({
    name: `${currentYear}-${currentYear + 1}`,
    startDate: new Date(`${currentYear}-04-01`),
    endDate: new Date(`${currentYear + 1}-03-31`),
    isCurrent: true,
    isActive: true,
    terms: [
      { name: 'Term 1', startDate: new Date(`${currentYear}-04-01`), endDate: new Date(`${currentYear}-09-30`) },
      { name: 'Term 2', startDate: new Date(`${currentYear}-10-01`), endDate: new Date(`${currentYear + 1}-03-31`) }
    ]
  });
};

/**
 * SAFE seed: inserts baseline data without destroying existing records.
 * Idempotent — uses findOneOrCreate patterns so it is safe to re-run.
 * To wipe and reseed, use the explicit -d flag THEN run importData separately.
 */
const importData = async () => {
  try {
    if (process.env.NODE_ENV === 'production') {
      console.error('CRITICAL: Cannot run seed script in production environment!'.red.inverse);
      process.exit(1);
    }

    // Safety check: refuse to run against a URI that does not contain a
    // recognisable development/staging database name.
    const uri = process.env.MONGO_URI || 'mongodb://localhost:27017/school_management_db';
    const safeDbPatterns = ['school_management_db', 'school_management_staging', 'school_management_dev', 'school_management_test'];
    const isSafeTarget = safeDbPatterns.some(p => uri.includes(p));
    if (!isSafeTarget) {
      console.error('CRITICAL: MONGO_URI does not match a known dev/staging database name. Refusing to seed.'.red.inverse);
      console.error(`URI: ${uri.replace(/:\/\/[^@]+@/, '://***@')}`);
      process.exit(1);
    }

    console.log('Starting safe seed process (no database drop)...'.yellow);
    // NOTE: No dropDatabase() here. Use -d flag for destructive wipe.

    // 1. Create Academic Year (idempotent)
    const currentYear = new Date().getFullYear();
    const yearName = `${currentYear}-${currentYear + 1}`;
    let year = await AcademicYear.findOne({ name: yearName });
    if (!year) {
      year = await generateAcademicYear();
      console.log('Academic Year created'.green);
    } else {
      console.log('Academic Year already exists, skipping'.cyan);
    }

    // 2. Create Classes (idempotent — skip if already exist)
    const existingClassCount = await Class.countDocuments({ academicYear: year.name });
    if (existingClassCount > 0) {
      console.log(`Classes already exist for ${year.name}, skipping`.cyan);
    } else {
      const classes = [];
      for (const level of classLevels) {
        let academicLevel = 'Primary';
        if (['Pre-Nursery', 'Nursery', 'LKG', 'UKG'].includes(level)) academicLevel = 'Pre-Primary';
        else if (['6', '7', '8'].includes(level)) academicLevel = 'Middle';
        else if (['9', '10'].includes(level)) academicLevel = 'Secondary';
        else if (['11', '12'].includes(level)) academicLevel = 'Senior Secondary';

        const cls = await Class.create({
          name: level,
          academicYear: year.name,
          academicLevel,
          displayOrder: classLevels.indexOf(level)
        });
        classes.push(cls);
      }
      console.log(`Created ${classes.length} classes`.green);
    }

    // 3. Create Demo Users (idempotent — skip if email already exists)
    const createUserIfMissing = async (userData) => {
      const existing = await User.findOne({ email: userData.email });
      if (existing) {
        console.log(`  [skip] ${userData.email} already exists`.cyan);
        return existing;
      }
      return User.create(userData);
    };

    const adminUser = await createUserIfMissing({
      name: 'Super Admin',
      email: 'admin@sunriseschool.edu.in',
      password: 'Admin@1234',
      role: 'super_admin',
      phone: '9800000001'
    });

    const principalUser = await createUserIfMissing({
      name: 'Dr. Sarah Johnson',
      email: 'principal@sunriseschool.edu.in',
      password: 'Principal@1234',
      role: 'principal',
      phone: '9800000002'
    });

    const accountantUser = await createUserIfMissing({
      name: 'Rajeev Kumar',
      email: 'accountant@sunriseschool.edu.in',
      password: 'Accountant@1234',
      role: 'accountant',
      phone: '9800000003'
    });

    const librarianUser = await createUserIfMissing({
      name: 'Anita Desai',
      email: 'librarian@sunriseschool.edu.in',
      password: 'Librarian@1234',
      role: 'librarian',
      phone: '9800000004'
    });

    // 4. Create Teachers & Class Teachers (idempotent)
    const teacherUser = await createUserIfMissing({
      name: 'John Smith',
      email: 'teacher@sunriseschool.edu.in',
      password: 'Teacher@1234',
      role: 'class_teacher',
      phone: '9800000005'
    });

    let faculty = await Faculty.findOne({ user: teacherUser._id });
    if (!faculty) {
      faculty = await Faculty.create({
        user: teacherUser._id,
        employeeId: 'EMP001',
        designation: 'TGT',
        department: 'Mathematics',
        qualification: [
          { degree: 'M.Sc.', institution: 'Delhi University', year: 2015 },
          { degree: 'B.Ed.', institution: 'IP University', year: 2017 }
        ],
        joiningDate: new Date('2020-04-01'),
        classTeacherOf: { class: '10' },
        contactNumber: '9876543210'
      });
    }
    console.log('Created core staff accounts'.green);

    // 5. Create Parent & Student (idempotent)
    const parentUser = await createUserIfMissing({
      name: 'Mr. & Mrs. Sharma',
      email: 'parent@sunriseschool.edu.in',
      password: 'Parent@1234',
      role: 'parent',
      phone: '9800000006'
    });

    const studentUser = await createUserIfMissing({
      name: 'Aarav Sharma',
      email: 'student@sunriseschool.edu.in',
      password: 'Student@1234',
      role: 'student',
      phone: '9800000007'
    });

    let student = await Student.findOne({ user: studentUser._id });
    if (!student) {
      student = await Student.create({
        user: studentUser._id,
        parentUser: parentUser._id,
        admissionNumber: 'ADM2025-001',
        rollNumber: 1,
        class: '10',
        academicYear: year.name,
        dateOfBirth: new Date('2009-08-15'),
        gender: 'male',
        father: { name: 'Rajesh Sharma', occupation: 'Engineer', contactNumber: '9876543211' },
        mother: { name: 'Priya Sharma', occupation: 'Teacher', contactNumber: '9876543212' },
        contactNumber: '9876543211',
        address: 'B-12, Model Town, Delhi'
      });

      await Parent.findOneAndUpdate(
        { user: parentUser._id },
        { $addToSet: { children: student._id }, occupation: 'Software Engineer', relationship: 'Father', isActive: true },
        { upsert: true, new: true }
      );
    }

    console.log('Created demo parent and student'.green);

    console.log('Data Imported!'.green.inverse);
    process.exit();
  } catch (error) {
    console.error(`Error: ${error.message}`.red.inverse);
    console.error(error.stack);
    process.exit(1);
  }
};

const destroyData = async () => {
  try {
    if (process.env.NODE_ENV === 'production') {
      console.error('CRITICAL: Cannot run destroy script in production environment!'.red.inverse);
      process.exit(1);
    }

    // Require an explicit confirmation env variable to prevent accidental wipes.
    if (process.env.CONFIRM_DESTROY !== 'yes-i-know-this-drops-the-database') {
      console.error('CRITICAL: Set CONFIRM_DESTROY=yes-i-know-this-drops-the-database to confirm.'.red.inverse);
      process.exit(1);
    }

    // Safety check: refuse against non-dev databases.
    const uri = process.env.MONGO_URI || '';
    const safeDbPatterns = ['school_management_db', 'school_management_staging', 'school_management_dev', 'school_management_test'];
    const isSafeTarget = safeDbPatterns.some(p => uri.includes(p));
    if (!isSafeTarget) {
      console.error('CRITICAL: MONGO_URI does not match a known dev/staging database. Refusing to destroy.'.red.inverse);
      process.exit(1);
    }

    await mongoose.connection.dropDatabase();
    console.log('Data Destroyed!'.red.inverse);
    process.exit();
  } catch (error) {
    console.error(`Error: ${error.message}`.red.inverse);
    process.exit(1);
  }
};

if (process.argv[2] === '-d') {
  destroyData();
} else {
  importData();
}
