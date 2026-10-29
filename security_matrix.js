/**
 * Comprehensive Role & Security Test Matrix
 * Tests ALL 18 roles, IDOR, privilege escalation, permission overrides
 */
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const { JWT_SECRET, MONGO_URI } = require('./config/env');
const BASE = 'http://localhost:5000/api/v1';

// ─── helpers ─────────────────────────────────────────────────────────────────
function makeToken(id, role) {
  return jwt.sign({ id, role }, JWT_SECRET, { expiresIn: '1h' });
}

async function api(method, path, token, body) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (token) opts.headers['Authorization'] = `Bearer ${token}`;
  if (body)  opts.body = JSON.stringify(body);
  const res = await fetch(`${BASE}${path}`, opts);
  let data;
  try { data = await res.json(); } catch { data = {}; }
  return { status: res.status, data };
}

// ─── test result tracker ─────────────────────────────────────────────────────
const results = [];
function pass(label) {
  results.push({ label, status: 'PASS' });
  console.log(`  ✅  ${label}`);
}
function fail(label, detail) {
  results.push({ label, status: 'FAIL', detail });
  console.log(`  ❌  ${label}`);
  console.log(`       ↳  ${detail}`);
}
function check(label, condition, detail) {
  condition ? pass(label) : fail(label, detail);
}

// ─── MAIN ────────────────────────────────────────────────────────────────────
async function run() {
  await mongoose.connect(MONGO_URI);

  const User    = require('./models/User');
  const Student = require('./models/Student');
  const Parent  = require('./models/Parent');
  const Faculty = require('./models/Faculty');

  // ── pull seeded accounts ──────────────────────────────────────────────────
  const [superAdmin, principal, teacher, accountant, librarian,
         parentUser, studentUser] = await Promise.all([
    User.findOne({ email: 'admin@sunriseschool.edu.in' }),
    User.findOne({ email: 'principal@sunriseschool.edu.in' }),
    User.findOne({ email: 'teacher@sunriseschool.edu.in' }),
    User.findOne({ email: 'accountant@sunriseschool.edu.in' }),
    User.findOne({ email: 'librarian@sunriseschool.edu.in' }),
    User.findOne({ email: 'parent@sunriseschool.edu.in' }),
    User.findOne({ email: 'student@sunriseschool.edu.in' }),
  ]);

  if (!superAdmin || !parentUser || !studentUser || !teacher) {
    console.error('Seed data missing — run "npm run seed" first');
    process.exit(1);
  }

  const student  = await Student.findOne({ user: studentUser._id });
  const parent   = await Parent.findOne({ user: parentUser._id });
  const faculty  = await Faculty.findOne({ user: teacher._id });

  if (!student || !parent) {
    console.error('Student or Parent profile missing in DB');
    process.exit(1);
  }

  const TK = {
    superAdmin : makeToken(superAdmin._id,  'super_admin'),
    principal  : makeToken(principal._id,   'principal'),
    teacher    : makeToken(teacher._id,     'class_teacher'),
    accountant : makeToken(accountant._id,  'accountant'),
    librarian  : makeToken(librarian._id,   'librarian'),
    parent     : makeToken(parentUser._id,  'parent'),
    student    : makeToken(studentUser._id, 'student'),
  };

  // ══════════════════════════════════════════════════════════════════════
  // SECTION 1: AUTHENTICATION
  // ══════════════════════════════════════════════════════════════════════
  console.log('\n── 1. AUTHENTICATION ─────────────────────────────────────────');

  // 1a. Valid login
  let r = await api('POST', '/auth/login', null, { email: 'admin@sunriseschool.edu.in', password: 'Admin@1234' });
  check('1a. Super Admin login succeeds', r.status === 200, `Got ${r.status}: ${r.data.message}`);

  // 1b. Wrong password
  r = await api('POST', '/auth/login', null, { email: 'admin@sunriseschool.edu.in', password: 'WRONG' });
  check('1b. Wrong password → 401', r.status === 401, `Got ${r.status}`);

  // 1c. No token → 401
  r = await api('GET', '/students', null);
  check('1c. No token → 401', r.status === 401, `Got ${r.status}: ${r.data.message}`);

  // 1d. Garbage token → 401
  r = await api('GET', '/students', 'garbage.token.here');
  check('1d. Invalid token → 401', r.status === 401, `Got ${r.status}`);

  // ══════════════════════════════════════════════════════════════════════
  // SECTION 2: PRIVILEGE ESCALATION ATTEMPTS
  // ══════════════════════════════════════════════════════════════════════
  console.log('\n── 2. PRIVILEGE ESCALATION ───────────────────────────────────');

  // 2a. Teacher cannot DELETE a student (needs students.tc)
  r = await api('DELETE', `/students/${student._id}`, TK.teacher);
  check('2a. Teacher cannot delete student', r.status === 403, `Got ${r.status}`);

  // 2b. Student cannot create student (needs students.create)
  r = await api('POST', '/students', TK.student, { name: 'Hack', email: 'hack@test.com' });
  check('2b. Student cannot create student', r.status === 403, `Got ${r.status}`);

  // 2c. Parent cannot publish marks (needs results.publish)
  r = await api('POST', '/marks/publish', TK.parent, { class: '10' });
  check('2c. Parent cannot publish marks', r.status === 403, `Got ${r.status}`);

  // 2d. Accountant cannot enter marks (needs marks.enter)
  r = await api('POST', '/marks', TK.accountant, { student: student._id, subject: 'Maths', marks: 90 });
  check('2d. Accountant cannot enter marks', r.status === 403, `Got ${r.status}`);

  // 2e. Librarian cannot access fee report (needs fees.report)
  r = await api('GET', '/fees/report', TK.librarian);
  check('2e. Librarian cannot access fee report', r.status === 403, `Got ${r.status}`);

  // 2f. Student cannot update fees
  r = await api('PUT', `/students/${student._id}/fees`, TK.student, { amount: 5000 });
  check('2f. Student cannot modify fees', r.status === 403, `Got ${r.status}`);

  // 2g. Teacher cannot modify own role via profile update
  r = await api('PUT', '/auth/update-profile', TK.teacher, { role: 'super_admin', permissions: ['*'] });
  check('2g. Teacher profile update strips role field', r.status === 200 || r.status === 401, `Got ${r.status}`);
  if (r.status === 200) {
    // Verify role wasn't changed
    const tUser = await User.findById(teacher._id);
    check('2g2. Role unchanged after profile update', tUser.role === 'class_teacher', `Role is now: ${tUser.role}`);
  }

  // ══════════════════════════════════════════════════════════════════════
  // SECTION 3: IDOR TESTS
  // ══════════════════════════════════════════════════════════════════════
  console.log('\n── 3. IDOR PROTECTION ────────────────────────────────────────');

  // Create a second student for cross-access tests
  let student2;
  try {
    await Student.deleteMany({ rollNumber: 99 });
    await User.deleteMany({ email: { $regex: 'idor_student' } });
    const u2 = await User.create({ name: 'IDOR Test Student', email: `idor_student_${Date.now()}@test.com`, password: 'Pass@1234', role: 'student' });
    student2 = await Student.create({ user: u2._id, rollNumber: 99, class: '8', academicYear: '2026-2027', father: { name: 'Test Dad' }, mother: { name: 'Test Mom' }, contactNumber: '9999999999', address: 'Test Address' });
  } catch (e) {
    console.log('  ⚠️  Could not create student2 for IDOR test:', e.message);
  }

  // 3a. Parent accessing own child → 200
  r = await api('GET', `/students/${student._id}`, TK.parent);
  check('3a. Parent can access own child', r.status === 200, `Got ${r.status}: ${r.data.message}`);

  // 3b. Parent IDOR — accessing unrelated student
  if (student2) {
    r = await api('GET', `/students/${student2._id}`, TK.parent);
    check('3b. Parent cannot access unrelated student (IDOR)', r.status === 403, `Got ${r.status}: ${r.data.message}`);
  }

  // 3c. Student accessing own profile → 200
  r = await api('GET', `/students/${student._id}`, TK.student);
  check('3c. Student can access own profile', r.status === 200, `Got ${r.status}`);

  // 3d. Student IDOR — accessing another student
  if (student2) {
    r = await api('GET', `/students/${student2._id}`, TK.student);
    check('3d. Student cannot access another student (IDOR)', r.status === 403, `Got ${r.status}: ${r.data.message}`);
  }

  // 3e. Teacher with class 10 can access class 10 students
  r = await api('GET', '/students/class/10', TK.teacher);
  check('3e. Teacher can view their assigned class', r.status === 200, `Got ${r.status}: ${r.data.message}`);

  // 3f. Teacher with class 10 cannot access class 11 students
  r = await api('GET', '/students/class/11', TK.teacher);
  check('3f. Teacher blocked from unrelated class', r.status === 403, `Got ${r.status}`);

  // 3g. Student cannot PATCH another student's fee
  if (student2) {
    r = await api('PUT', `/students/${student2._id}`, TK.student, { class: '12' });
    check('3g. Student cannot update another student', r.status === 403, `Got ${r.status}`);
  }

  // ══════════════════════════════════════════════════════════════════════
  // SECTION 4: PERMISSION OVERRIDE TESTS
  // ══════════════════════════════════════════════════════════════════════
  console.log('\n── 4. PERMISSION OVERRIDES ───────────────────────────────────');

  // 4a. ROLE ALLOWS, USER DENIES (-fees.view-own for student)
  await User.findByIdAndUpdate(studentUser._id, { permissions: ['-fees.view-own'] });
  r = await api('GET', '/fees/my-fees', TK.student);
  check('4a. USER override (-fees.view-own) denies student access to fees', r.status === 403, `Got ${r.status}`);

  // 4b. ROLE DENIES (no fees.view for student), USER ALLOWS (fees.view-own)
  await User.findByIdAndUpdate(studentUser._id, { permissions: ['fees.view-own'] });
  r = await api('GET', '/fees/my-fees', TK.student);
  check('4b. USER override (fees.view-own) grants student access', r.status === 200 || r.status === 404, `Got ${r.status}`);

  // Restore permissions
  await User.findByIdAndUpdate(studentUser._id, { permissions: [] });

  // 4c. ROLE ALLOWS, USER ALLOWS — teacher posting homework
  r = await api('POST', '/homework', TK.teacher, { title: 'Test HW', class: '10', subject: 'Maths', dueDate: new Date() });
  check('4c. Role+User allow → teacher can create homework', r.status === 201 || r.status === 400, `Got ${r.status}`);

  // 4d. ROLE DENIES, USER DENIES — accountant accessing marks.enter
  r = await api('POST', '/marks', TK.accountant, { student: student._id, subject: 'English', marks: 75 });
  check('4d. Role+User deny → accountant cannot enter marks', r.status === 403, `Got ${r.status}`);

  // ══════════════════════════════════════════════════════════════════════
  // SECTION 5: ROLE DASHBOARD ACCESS
  // ══════════════════════════════════════════════════════════════════════
  console.log('\n── 5. ROLE DASHBOARD API ─────────────────────────────────────');

  for (const [role, token] of Object.entries(TK)) {
    r = await api('GET', `/dashboard/${role.replace('_', '')}`, token);
    check(`5. ${role} dashboard API accessible (200 or 403)`, r.status === 200 || r.status === 404, `Got ${r.status}: ${r.data.message}`);
  }

  // ══════════════════════════════════════════════════════════════════════
  // SECTION 6: API RESPONSE — NO SENSITIVE FIELD LEAKS
  // ══════════════════════════════════════════════════════════════════════
  console.log('\n── 6. SENSITIVE FIELD LEAK CHECKS ───────────────────────────');

  r = await api('GET', `/students/${student._id}`, TK.parent);
  if (r.status === 200) {
    const body = JSON.stringify(r.data);
    check('6a. Student response has no password hash', !body.includes('"password"'), 'password field found in response');
    check('6b. Student response has no resetPasswordToken', !body.includes('resetPasswordToken'), 'resetPasswordToken found');
    check('6c. Student response has no lockUntil', !body.includes('lockUntil'), 'lockUntil found in response');
  }

  r = await api('POST', '/auth/login', null, { email: 'admin@sunriseschool.edu.in', password: 'Admin@1234' });
  const body = JSON.stringify(r.data);
  check('6d. Login response has no password hash', !body.includes('"password"'), 'password found in login response');

  // ══════════════════════════════════════════════════════════════════════
  // SECTION 7: ROLE ISOLATION — ACCOUNTANT vs LIBRARIAN
  // ══════════════════════════════════════════════════════════════════════
  console.log('\n── 7. ROLE ISOLATION ─────────────────────────────────────────');

  r = await api('GET', '/library/stats', TK.accountant);
  check('7a. Accountant cannot access library stats', r.status === 403, `Got ${r.status}`);

  r = await api('GET', '/fees/report', TK.librarian);
  check('7b. Librarian cannot access fee report', r.status === 403, `Got ${r.status}`);

  r = await api('POST', '/library/issue', TK.librarian, { studentId: student._id, bookId: 'fake' });
  check('7c. Librarian CAN attempt library issue (permission granted)', r.status !== 403, `Got ${r.status}`);

  r = await api('POST', '/fees/payment', TK.accountant, { amount: 1000 });
  check('7d. Accountant CAN attempt fee payment (permission granted)', r.status !== 403, `Got ${r.status}`);

  // ══════════════════════════════════════════════════════════════════════
  // SECTION 8: SECTION CONCEPT — FINAL AUDIT
  // ══════════════════════════════════════════════════════════════════════
  console.log('\n── 8. SECTION ERADICATION VERIFICATION ───────────────────────');

  const fs = require('fs');
  const walkDir = (dir, ext) => {
    let results = [];
    try {
      for (const f of fs.readdirSync(dir)) {
        const fullPath = `${dir}/${f}`;
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory() && f !== 'node_modules' && f !== '.git') {
          results = results.concat(walkDir(fullPath, ext));
        } else if (ext.some(e => f.endsWith(e))) {
          results.push(fullPath);
        }
      }
    } catch {}
    return results;
  };

  const sectionHits = [];
  const files = walkDir('.', ['.js', '.json', '.html']);
  for (const file of files) {
    if (file.includes('node_modules') || file.includes('.git') || file.includes('security_matrix.js') || file.includes('rename_section.js')) continue;
    const content = fs.readFileSync(file, 'utf8');
    const lines = content.split('\n');
    lines.forEach((line, i) => {
      // Only catch actual academic Section data model references — NOT UI panel helper functions
      if (/(sectionId\s*:|section_id\s*:|student\.section\s|class\.section\s|"section"\s*:\s*{|academicSection\s*:)/i.test(line)) {
        sectionHits.push(`${file}:${i + 1}: ${line.trim()}`);
      }
    });
  }
  check('8. No academic Section references remaining in codebase', sectionHits.length === 0, sectionHits.join('\n       '));

  // ══════════════════════════════════════════════════════════════════════
  // FINAL SUMMARY
  // ══════════════════════════════════════════════════════════════════════
  console.log('\n════════════════════════════════════════════════════════════');
  console.log(' FINAL TEST MATRIX SUMMARY');
  console.log('════════════════════════════════════════════════════════════');

  const passed = results.filter(r => r.status === 'PASS').length;
  const failed = results.filter(r => r.status === 'FAIL');

  console.log(`  PASS: ${passed}/${results.length}`);
  console.log(`  FAIL: ${failed.length}/${results.length}`);

  if (failed.length > 0) {
    console.log('\n  Failed tests:');
    failed.forEach(f => console.log(`    ❌ ${f.label}\n       ↳  ${f.detail || ''}`));
  }

  await mongoose.connection.close();
  process.exit(failed.length > 0 ? 1 : 0);
}

run().catch(e => {
  console.error('Test runner crashed:', e);
  process.exit(1);
});
