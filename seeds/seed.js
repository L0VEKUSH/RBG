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

const importData = async () => {
  try {
    if (process.env.NODE_ENV === 'production') {
      console.error('CRITICAL: Cannot run seed script in production environment!'.red.inverse);
      process.exit(1);
    }
    
    console.log('Starting seed process...'.yellow);
    await mongoose.connection.dropDatabase();
    console.log('Database cleared'.red.inverse);

    // 1. Create Academic Year
    const year = await generateAcademicYear();
    console.log('Academic Year created'.green);

    // 2. Create Classes
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

    // 3. Create Demo Users (Admin, Principal, Accountant, Librarian)
    const adminUser = await User.create({
      name: 'Super Admin',
      email: 'admin@sunriseschool.edu.in',
      password: 'Admin@1234',
      role: 'super_admin'
    });

    const principalUser = await User.create({
      name: 'Dr. Sarah Johnson',
      email: 'principal@sunriseschool.edu.in',
      password: 'Principal@1234',
      role: 'principal'
    });

    const accountantUser = await User.create({
      name: 'Rajeev Kumar',
      email: 'accountant@sunriseschool.edu.in',
      password: 'Accountant@1234',
      role: 'accountant'
    });

    const librarianUser = await User.create({
      name: 'Anita Desai',
      email: 'librarian@sunriseschool.edu.in',
      password: 'Librarian@1234',
      role: 'librarian'
    });

    // 4. Create Teachers & Class Teachers
    const teacherUser = await User.create({
      name: 'John Smith',
      email: 'teacher@sunriseschool.edu.in',
      password: 'Teacher@1234',
      role: 'class_teacher'
    });

    const faculty = await Faculty.create({
      user: teacherUser._id,
      employeeId: 'EMP001',
      designation: 'TGT',
      department: 'Mathematics',
      qualification: [{ degree: 'M.Sc.', institution: 'Delhi University', year: 2015 }, { degree: 'B.Ed.', institution: 'IP University', year: 2017 }],
      joiningDate: new Date('2020-04-01'),
      classTeacherOf: { class: '10' },
      contactNumber: '9876543210'
    });
    console.log('Created core staff accounts'.green);

    // 5. Create Parent & Student
    const parentUser = await User.create({
      name: 'Mr. & Mrs. Sharma',
      email: 'parent@sunriseschool.edu.in',
      password: 'Parent@1234',
      role: 'parent'
    });

    const studentUser = await User.create({
      name: 'Aarav Sharma',
      email: 'student@sunriseschool.edu.in',
      password: 'Student@1234',
      role: 'student'
    });

    const student = await Student.create({
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

    const parent = await Parent.create({
      user: parentUser._id,
      children: [student._id],
      occupation: 'Software Engineer',
      relationship: 'Father',
      isActive: true
    });

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
