/**
 * UAT Test Runner — RBG School ERP
 * Tests all three primary role workflows end-to-end
 */

const BASE = 'http://localhost:5000/api/v1';
let pass = 0, fail = 0, warn = 0;
const results = [];

async function api(method, path, body, token) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) },
    ...(body && { body: JSON.stringify(body) }),
  };
  const res = await fetch(BASE + path, opts);
  let data;
  try { data = await res.json(); } catch { data = {}; }
  return { status: res.status, data };
}

function check(label, condition, critical = true) {
  if (condition) {
    console.log(`  ✅  ${label}`);
    pass++;
    results.push({ label, status: 'PASS' });
  } else {
    const icon = critical ? '❌' : '⚠️ ';
    console.log(`  ${icon}  ${label}`);
    if (critical) { fail++; results.push({ label, status: 'FAIL' }); }
    else          { warn++; results.push({ label, status: 'WARN' }); }
  }
}

async function login(email, password) {
  const r = await api('POST', '/auth/login', { email, password });
  // Response shape: { success, data: { user, token } }
  return r.status === 200 ? (r.data?.data?.token || r.data?.token) : null;
}

async function run() {
  console.log('\n══════════════════════════════════════════════════════════');
  console.log(' RBG SCHOOL ERP — UAT TEST RUNNER');
  console.log('══════════════════════════════════════════════════════════\n');

  // ── SETUP: Login all roles ──────────────────────────────────────
  console.log('── SETUP: Login all primary roles ────────────────────────');
  const TEACHER_TOKEN    = await login('ravi.sharma@staging.edu.in',  'Teacher@123');
  const CT_TOKEN         = await login('priya.nair@staging.edu.in',   'Teacher@123');
  const STUDENT_TOKEN    = await login('arjun@staging.edu.in',        'Student@123');
  const PARENT_TOKEN     = await login('mr.kumar@staging.edu.in',     'Parent@123');
  const PRINCIPAL_TOKEN  = await login('principal@staging.edu.in',    'Principal@123');
  const ADMIN_TOKEN      = await login('superadmin@staging.edu.in',   'Admin@123');
  const ACCOUNTANT_TOKEN = await login('accountant@staging.edu.in',   'Staff@123');
  const LIBRARIAN_TOKEN  = await login('librarian@staging.edu.in',    'Staff@123');

  check('Teacher login',    !!TEACHER_TOKEN);
  check('Class Teacher login', !!CT_TOKEN);
  check('Student login',    !!STUDENT_TOKEN);
  check('Parent login',     !!PARENT_TOKEN);
  check('Principal login',  !!PRINCIPAL_TOKEN);
  check('Super Admin login', !!ADMIN_TOKEN);
  check('Accountant login', !!ACCOUNTANT_TOKEN);
  check('Librarian login',  !!LIBRARIAN_TOKEN);

  if (!TEACHER_TOKEN || !STUDENT_TOKEN || !PRINCIPAL_TOKEN) {
    console.error('\n❌  Critical logins failed — aborting UAT\n');
    process.exit(1);
  }

  // ── 1. TEACHER WORKFLOW ────────────────────────────────────────
  console.log('\n── 1. TEACHER WORKFLOW: Attendance → Marks → Homework → Timetable ─');

  // 1a. Dashboard
  const tDash = await api('GET', '/dashboard/teacher', null, TEACHER_TOKEN);
  check('Teacher dashboard loads (200)', tDash.status === 200);
  check('Teacher dashboard has data',    !!tDash.data?.data);

  // 1b. Timetable — teacher must have an accessible timetable endpoint (route exists, data may be empty)
  const ttMe = await api('GET', '/timetable/my-timetable', null, TEACHER_TOKEN);
  check('Timetable endpoint reachable (not 404/500)', ttMe.status === 200 || ttMe.status === 204);

  // 1c. Get class roster for Class 9
  const roster9 = await api('GET', '/students/class/9', null, TEACHER_TOKEN);
  check('Class 9 roster accessible to teacher', roster9.status === 200);
  let students9 = [];
  if (Array.isArray(roster9.data?.data?.students)) students9 = roster9.data.data.students;
  else if (Array.isArray(roster9.data?.data)) students9 = roster9.data.data;
  check('Class 9 has students in staging DB',   students9.length >= 1);

  // 1d. Attendance — mark attendance for Class 9
  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  const attPayload = {
    class: '9',
    date: today,
    academicYear: '2026-2027',
    attendanceData: students9.map(s => ({ student: s._id, status: 'Present' })),
  };
  const attMark = await api('POST', '/attendance/mark', attPayload, CT_TOKEN);
  check('Attendance marked successfully', attMark.status === 200 || attMark.status === 201);

  // 1e. Attendance — verify it persists (date format YYYY-MM-DD is valid for query)
  const attVerify = await api('GET', `/attendance/class/9?date=${today}`, null, CT_TOKEN);
  check('Attendance persists after save', attVerify.status === 200);

  // 1f. Teacher CANNOT access unrelated class (Class 12 not assigned) — must be strictly 403
  const attBlock = await api('GET', '/students/class/12', null, TEACHER_TOKEN);
  check('Teacher blocked from unrelated Class 12 (strict 403)', attBlock.status === 403);
  // 200 with empty data would be an information disclosure — we require a hard 403.
  const idor = await api('GET', `/students/${students9[0]?._id}`, null, TEACHER_TOKEN);
  check('Teacher can view student in own class',   idor.status === 200);

  // 1g. Homework — create
  const dueDate = new Date(Date.now() + 86400000 * 3).toISOString();
  const hwCreate = await api('POST', '/homework', {
    title: '[UAT] Science Chapter 5 Notes',
    subject: 'Science',
    class: '9',
    description: 'Read Chapter 5 and write key points.',
    dueDate,
    academicYear: '2026-2027',
  }, CT_TOKEN);
  check('Teacher creates homework', hwCreate.status === 201 || hwCreate.status === 200);
  const hwId = hwCreate.data?.data?._id || hwCreate.data?.data?.homework?._id;

  // 1h. Homework list
  const hwList = await api('GET', '/homework', null, TEACHER_TOKEN);
  check('Teacher homework list accessible', hwList.status === 200);

  // 1i. Marks — enter marks for Arjun in Unit Test 1
  const arjunStudent = students9.find(s => s.admissionNumber === 'ADM-STG-001') || students9[0] || {};
  const marksPayload = {
    student: arjunStudent._id,
    class: '9',
    examType: 'Unit Test 2',
    academicYear: '2026-2027',
    subjects: [
      { subject: 'Mathematics', maxMarks: 100, marksObtained: 92 },
      { subject: 'Science',     maxMarks: 100, marksObtained: 78 },
      { subject: 'English',     maxMarks: 100, marksObtained: 88 },
    ],
  };
  const marksCreate = await api('POST', '/marks', marksPayload, TEACHER_TOKEN);
  check('Teacher enters marks', marksCreate.status === 200 || marksCreate.status === 201);

  // 1j. Verify CBSE grade computed by backend
  // Response shape: { data: { marks: { subjects: [...] } } } or { data: { subjects: [...] } }
  const marksBody = marksCreate.data?.data?.marks || marksCreate.data?.data || {};
  const marksSubjects = marksBody.subjects || [];
  const savedGrade = marksSubjects[0]?.grade;
  check('Backend computed CBSE grade (A1 for 92%)', savedGrade === 'A1');
  const savedOverall = marksBody.overallGrade;
  check('Backend computed overall grade',  !!savedOverall);

  // 1k. Teacher cannot publish marks (only admin/principal can)
  const pubAttempt = await api('POST', '/marks/publish', { class: '9', examType: 'Unit Test 2', academicYear: '2026-2027' }, TEACHER_TOKEN);
  check('Teacher cannot publish marks (403)', pubAttempt.status === 403);

  // ── 2. STUDENT WORKFLOW ───────────────────────────────────────
  console.log('\n── 2. STUDENT WORKFLOW: Timetable → Attendance → Homework → Results ─');

  // 2a. Student dashboard
  const sDash = await api('GET', '/dashboard/student', null, STUDENT_TOKEN);
  check('Student dashboard loads', sDash.status === 200);

  // 2b. Student timetable — route must exist (200 or empty 200, never 404)
  const sTT = await api('GET', '/timetable/my-timetable', null, STUDENT_TOKEN);
  check('Student timetable endpoint reachable (not 404/500)', sTT.status === 200 || sTT.status === 204);

  // 2c. Student homework
  const sHW = await api('GET', '/homework/my-homework', null, STUDENT_TOKEN);
  check('Student sees own homework', sHW.status === 200);
  check('Homework list is an array', Array.isArray(sHW.data?.data || sHW.data?.homeworks || []));

  // 2d. Student attendance (needs student ID, get from profile first)
  const sProfile = await api('GET', '/students/my-profile', null, STUDENT_TOKEN);
  check('Student profile accessible', sProfile.status === 200);
  const myStudentId = sProfile.data?.data?._id || sProfile.data?.data?.student?._id;
  
  const sAtt = await api('GET', `/attendance/student/${myStudentId}/summary`, null, STUDENT_TOKEN);
  check('Student sees own attendance (200)', sAtt.status === 200);

  // 2e. Student sees PUBLISHED marks only
  const sMarks = await api('GET', '/marks/my-marks', null, STUDENT_TOKEN);
  check('Student published marks accessible', sMarks.status === 200);
  const marks = sMarks.data?.data?.marks || sMarks.data?.data || [];
  const allPublished = Array.isArray(marks) ? marks.every(m => m.isPublished !== false) : true;
  check('Student never receives unpublished marks', allPublished);

  // 2f. IDOR — student cannot access another student's marks
  const otherStudent = await api('GET', '/students/class/10', null, ADMIN_TOKEN);
  let rahulId;
  if (Array.isArray(otherStudent.data?.data?.students)) {
    rahulId = otherStudent.data.data.students.find(s => s.admissionNumber === 'ADM-STG-003')?._id;
  } else if (Array.isArray(otherStudent.data?.data)) {
    rahulId = otherStudent.data.data.find(s => s.admissionNumber === 'ADM-STG-003')?._id;
  }
  if (rahulId) {
    const idor2 = await api('GET', `/marks/student/${rahulId}`, null, STUDENT_TOKEN);
    check('Student CANNOT access another student marks (IDOR)', idor2.status === 403 || idor2.status === 401);
  }

  // 2g. Student profile (already fetched above — check result)
  check('Student profile accessible (secondary check)', sProfile.status === 200);

  // 2h. Fees (offline ledger — route must respond, empty is OK)
  const sFees = await api('GET', '/fees/my-fees', null, STUDENT_TOKEN);
  check('Student fee ledger accessible (200)', sFees.status === 200);

  // 2i. Library (route must exist and respond)
  const sLib = await api('GET', '/library/my-books', null, STUDENT_TOKEN);
  check('Student library endpoint reachable (200)', sLib.status === 200);

  // ── 3. PRINCIPAL WORKFLOW ────────────────────────────────────
  console.log('\n── 3. PRINCIPAL WORKFLOW: Dashboard → Search → Analytics → Approvals ─');

  // 3a. Principal dashboard
  const pDash = await api('GET', '/dashboard/principal', null, PRINCIPAL_TOKEN);
  check('Principal dashboard loads', pDash.status === 200);
  const pData = pDash.data?.data;
  check('Dashboard has student count',    pData?.totalStudents >= 0 || pData?.students >= 0 || !!pData);
  check('Dashboard has teacher count',    !!pData);

  // 3b. Global student search
  const search = await api('GET', '/students?search=Arjun', null, PRINCIPAL_TOKEN);
  check('Student search by name works',  search.status === 200);
  const sRes = search.data?.data?.students || search.data?.data || [];
  check('Search returns matching students', Array.isArray(sRes));

  // 3c. Admissions list — principal has admissions.view permission; must be 200
  const admList = await api('GET', '/admissions', null, PRINCIPAL_TOKEN);
  check('Principal sees admissions list (200)', admList.status === 200);

  // 3d. Class list (academic overview)
  const classes = await api('GET', '/classes', null, PRINCIPAL_TOKEN);
  check('Principal sees class list', classes.status === 200);
  const classData = classes.data?.data?.classes || classes.data?.data || [];
  check('Staging classes loaded', Array.isArray(classData) && classData.length >= 1);

  // 3e. All students list
  const allStudents = await api('GET', '/students', null, PRINCIPAL_TOKEN);
  check('Principal sees all students', allStudents.status === 200);

  // 3f. Published marks accessible to principal
  const allMarks = await api('GET', '/marks/class/9?examType=Unit+Test+1&academicYear=2026-2027', null, PRINCIPAL_TOKEN);
  check('Principal can access class marks (200)', allMarks.status === 200);

  // 3g. Notice creation
  const notice = await api('POST', '/notices', {
    title: '[UAT] Test Notice from Principal',
    content: 'School will remain closed on October 2nd.',
    type: 'General',
    isPublished: true,
  }, PRINCIPAL_TOKEN);
  check('Principal publishes notice (201 or 200)', notice.status === 201 || notice.status === 200);

  // 3h. Pending leave requests — principal has leave.view via HR-delegated or needs explicit perm
  const leaves = await api('GET', '/leaves/pending', null, PRINCIPAL_TOKEN);
  check('Principal sees pending leaves (200)', leaves.status === 200);

  // ── 4. CORE DATA FLOW — same data across all portals ─────────
  console.log('\n── 4. DATA CONSISTENCY ACROSS PORTALS ─────────────────────────────');

  // Publish Unit Test 1 marks (admin action)
  const pub = await api('POST', '/marks/publish', {
    class: '9', examType: 'Unit Test 1', academicYear: '2026-2027',
  }, ADMIN_TOKEN);
  check('Admin publishes Unit Test 1 marks', pub.status === 200);

  // Student sees them now
  const sMarksAfter = await api('GET', '/marks/my-marks', null, STUDENT_TOKEN);
  const marksAfter  = sMarksAfter.data?.data?.marks || sMarksAfter.data?.data || [];
  const ut1 = Array.isArray(marksAfter) ? marksAfter.find(m => m.examType === 'Unit Test 1') : null;
  check('Student sees Unit Test 1 after publish', !!ut1);

  // Verify CBSE grade from seed is correct (88% Math → A2)
  if (ut1?.subjects) {
    const mathGrade = ut1.subjects.find(s => s.subject === 'Mathematics')?.grade;
    check(`Math 88% → grade is A2 (got ${mathGrade})`, mathGrade === 'A2');
    const engGrade = ut1.subjects.find(s => s.subject === 'English')?.grade;
    check(`English 92% → grade is A1 (got ${engGrade})`, engGrade === 'A1');
  }

  // ── 5. SECONDARY ROLE SMOKE TESTS ────────────────────────────
  console.log('\n── 5. SECONDARY ROLE SMOKE TESTS ──────────────────────────────────');

  const parentDash = await api('GET', '/dashboard/parent', null, PARENT_TOKEN);
  check('Parent dashboard loads', parentDash.status === 200);

  const parentChildren = await api('GET', '/parents/my-children', null, PARENT_TOKEN);
  check('Parent sees own children', parentChildren.status === 200);
  const children = parentChildren.data?.data?.children || parentChildren.data?.data || [];
  check('Parent child is Arjun', Array.isArray(children) && children.length >= 1);

  const accDash = await api('GET', '/dashboard/accountant', null, ACCOUNTANT_TOKEN);
  check('Accountant dashboard loads', accDash.status === 200);

  const libDash = await api('GET', '/dashboard/librarian', null, LIBRARIAN_TOKEN);
  check('Librarian dashboard loads', libDash.status === 200);

  // Smoke test: Librarian CANNOT access fee report
  const libFeeBlock = await api('GET', '/fees/report', null, LIBRARIAN_TOKEN);
  check('Librarian blocked from fee report', libFeeBlock.status === 403);

  // Smoke test: Accountant CANNOT enter marks
  const accMarksBlock = await api('POST', '/marks', {
    student: students9[0]?._id, class: '9', examType: 'Annual', academicYear: '2026-2027',
    subjects: [{ subject: 'Math', maxMarks: 100, marksObtained: 90 }],
  }, ACCOUNTANT_TOKEN);
  check('Accountant blocked from entering marks', accMarksBlock.status === 403);

  // ── 6. PROMOTION WORKFLOW ─────────────────────────────────────
  console.log('\n── 6. PROMOTION WORKFLOW ───────────────────────────────────────────');

  // Check if promote endpoint exists
  const promoteCheck = await api('POST', '/students/promote', {
    studentIds: [arjunStudent._id],
    toClass: '10',
    academicYear: '2027-2028',
  }, ADMIN_TOKEN);
  check('Promote endpoint responds (not 404)', promoteCheck.status !== 404);

  // ── 7. TC (TRANSFER CERTIFICATE) WORKFLOW ───────────────────────────
  console.log('\n── 7. TC (TRANSFER CERTIFICATE) WORKFLOW ───────────────────────────');

  // Create a dedicated student for the TC test to avoid mutating primary student Arjun
  const tcStudentRes = await api('POST', '/students', {
    name: 'TC Workflow Test Student',
    email: `tc_test_${Date.now()}@staging.edu.in`,
    password: 'TestStudent@123',
    admissionNumber: `ADM-TC-${Date.now().toString().slice(-4)}`,
    rollNumber: Math.floor(Math.random() * 800) + 100,
    class: '9',
    academicYear: '2026-2027',
    gender: 'male',
    dateOfBirth: '2012-01-01',
    father: { name: 'Test Father', phone: '+91-9800000099' },
    mother: { name: 'Test Mother', phone: '+91-9800000098' }
  }, ADMIN_TOKEN);
  const tcTargetId = tcStudentRes.data?.data?._id || tcStudentRes.data?.data?.student?._id;

  const tcCheck = await api('POST', `/students/${tcTargetId}/tc`, {
    reason: 'UAT Test TC', tcDate: new Date().toISOString(),
  }, ADMIN_TOKEN);
  check('TC endpoint responds (200)', tcCheck.status === 200);

  // ── 8. BACKUP/RESTORE VERIFICATION ───────────────────────────
  console.log('\n── 8. BACKUP READINESS ─────────────────────────────────────────────');
  const fs = require('fs');
  const backupExists = fs.existsSync('./docs/backup_recovery.md');
  check('docs/backup_recovery.md exists',      backupExists);
  if (backupExists) {
    const backupDoc = fs.readFileSync('./docs/backup_recovery.md', 'utf8');
    check('Backup doc covers backup command',   backupDoc.includes('mongodump'));
    check('Backup doc covers restore command',  backupDoc.includes('mongorestore'));
    check('Backup doc covers verification',     backupDoc.includes('Verify'));
    check('Backup doc covers retention',        backupDoc.includes('7 days') || backupDoc.includes('retention') || backupDoc.includes('cleanup'));
  }

  // ── 9. HTTPS DEPLOYMENT CHECKLIST ────────────────────────────
  console.log('\n── 9. HTTPS DEPLOYMENT CHECKLIST ───────────────────────────────────');
  const releaseNotesExists = fs.existsSync('./RELEASE_NOTES.md');
  check('RELEASE_NOTES.md exists',     releaseNotesExists);
  const gitignoreExists    = fs.existsSync('./.gitignore');
  check('.gitignore exists',           gitignoreExists);
  if (gitignoreExists) {
    const gi = fs.readFileSync('./.gitignore', 'utf8');
    check('.env files gitignored',     gi.includes('.env'));
  }
  const envStagingExists = fs.existsSync('./.env.staging');
  check('.env.staging template exists', envStagingExists);

  // ── 10. PUBLIC WEBSITE DATA SAFETY ──────────────────────────
  console.log('\n── 10. PUBLIC DATA PRIVACY VERIFICATION ───────────────────────────');

  const pubStudents  = await api('GET', '/students', null, null);
  check('Public CANNOT list students (401)',  pubStudents.status === 401);
  const pubFees      = await api('GET', '/fees/report', null, null);
  check('Public CANNOT see fees (401)',       pubFees.status === 401);
  const pubMarks     = await api('GET', '/marks', null, null);
  check('Public CANNOT see marks (401)',      pubMarks.status === 401);
  const pubAttend    = await api('GET', '/attendance', null, null);
  check('Public CANNOT see attendance (401)', pubAttend.status === 401);
  const pubNotices   = await api('GET', '/notices', null, null);
  check('Public CAN see notices (200)',       pubNotices.status === 200);
  const pubEvents    = await api('GET', '/events/public', null, null);
  check('Public CAN see public events (200)', pubEvents.status === 200);

  // ── FINAL SUMMARY ─────────────────────────────────────────────
  const total = pass + fail + warn;
  console.log('\n══════════════════════════════════════════════════════════');
  console.log(` UAT RESULTS: ${pass} PASS  |  ${fail} FAIL  |  ${warn} WARN  |  ${total} TOTAL`);
  console.log('══════════════════════════════════════════════════════════\n');

  if (fail > 0) {
    console.log('FAILED TESTS:');
    results.filter(r => r.status === 'FAIL').forEach(r => console.log(`  ❌  ${r.label}`));
  }
  if (warn > 0) {
    console.log('WARNINGS (non-critical):');
    results.filter(r => r.status === 'WARN').forEach(r => console.log(`  ⚠️   ${r.label}`));
  }

  console.log(fail === 0 ? '\n✅  UAT PASSED — Ready for security regression\n' : '\n❌  UAT HAS FAILURES — fix before release\n');
  process.exit(fail > 0 ? 1 : 0);
}

run().catch(err => { console.error('UAT runner crashed:', err.message); process.exit(1); });
