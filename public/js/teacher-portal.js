/* ── Teacher Portal JS ── */
'use strict';

const TEACHER_NAV = [
  { label: 'Overview', items: [
    { icon: 'home', text: 'Today', panel: 'dashboard' },
    { icon: 'chalkboard', text: 'My Classes', panel: 'classes' },
    { icon: 'users', text: 'Students', panel: 'roster' }
  ]},
  { label: 'Daily Tasks', items: [
    { icon: 'calendar-check', text: 'Attendance', panel: 'attendance' },
    { icon: 'book', text: 'Homework', panel: 'homework' },
    { icon: 'folder-open', text: 'Materials', panel: 'materials' }
  ]},
  { label: 'Evaluation', items: [
    { icon: 'file-alt', text: 'Exams', panel: 'exams' },
    { icon: 'calendar-alt', text: 'Timetable', panel: 'timetable' },
    { icon: 'edit', text: 'Marks', panel: 'marks' }
  ]},
  { label: 'Misc', items: [
    { icon: 'bell', text: 'Notices', panel: 'notices' },
    { icon: 'sign-out-alt', text: 'Leave', panel: 'leave' }
  ]}
];

let _teacherData = null;
let _assignedClasses = [];
let _attendanceScopes = [];
let _attRoster = [];
let _attendanceNeedsReview = false;
let _attendanceCurrentReloaded = false;

function escapeAttendanceText(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

initPortal({
  role: 'teacher',
  expectedRoles: ['teacher', 'class_teacher'],
  navConfig: TEACHER_NAV,
  onDashboardLoad: loadTeacherDashboard
});

window.onPanel_dashboard = loadTeacherDashboard;
window.onPanel_classes = loadClassesPanel;
window.onPanel_timetable = loadTeacherTimetable;
window.onPanel_attendance = loadAttendancePanelOpts;
window.onPanel_homework = loadHomeworkOpts;
window.onPanel_marks = loadMarksOpts;
window.onPanel_roster = loadRosterOpts;
window.onPanel_notices = loadNoticesFull;
window.onPanel_exams = loadAssignedExamSchedules;

async function loadTeacherTimetable() {
  const body = document.getElementById('teacherTimetableBody');
  const status = document.getElementById('teacherTimetableStatus');
  if (!body || !status) return;
  body.replaceChildren();
  status.textContent = 'Loading your assigned timetable…';
  try {
    const response = await apiFetch('/timetable/my-timetable');
    if (response?.success !== true || !Array.isArray(response.data)) {
      throw new Error('Timetable response was invalid.');
    }
    const order = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const periods = response.data.flatMap(schedule => (Array.isArray(schedule.periods) ? schedule.periods : [])
      .map(period => ({ ...period, day: schedule.day, className: schedule.class, academicYear: schedule.academicYear })));
    periods.sort((left, right) => order.indexOf(left.day) - order.indexOf(right.day)
      || Number(left.periodNumber || 0) - Number(right.periodNumber || 0));
    if (!periods.length) {
      status.textContent = 'No assigned timetable periods are configured.';
      return;
    }
    status.textContent = `${periods.length} assigned period${periods.length === 1 ? '' : 's'}.`;
    for (const period of periods) {
      const row = document.createElement('tr');
      for (const value of [
        period.day, period.className, period.academicYear, period.periodNumber,
        [period.startTime, period.endTime].filter(Boolean).join(' – ') || 'Unavailable',
        period.subject, period.room || '—',
      ]) {
        const cell = document.createElement('td');
        cell.textContent = String(value ?? 'Unavailable');
        row.appendChild(cell);
      }
      body.appendChild(row);
    }
  } catch (error) {
    status.textContent = error.message || 'Your assigned timetable could not be loaded.';
  }
}

async function loadAssignedExamSchedules() {
  const body = document.getElementById('teacherExamScheduleBody');
  const status = document.getElementById('teacherExamScheduleStatus');
  if (!body || !status) return;
  body.replaceChildren();
  const scopes = _attendanceScopes.filter(scope => scope && scope.class && scope.academicYear &&
    (scope.isClassTeacher || (Array.isArray(scope.subjects) && scope.subjects.length)));
  if (!scopes.length) {
    status.textContent = 'No year-specific exam assignment is configured.';
    return;
  }

  status.textContent = 'Loading your assigned exam schedules…';
  try {
    const responses = await Promise.all(scopes.map(scope => apiFetch(
      `/exams/class/${encodeURIComponent(scope.class)}?academicYear=${encodeURIComponent(scope.academicYear)}`
    )));
    const schedules = responses.flatMap((response, index) => {
      if (response?.success !== true || !Array.isArray(response.data)) {
        throw new Error('An assigned exam schedule response was invalid.');
      }
      return response.data.map(exam => ({ ...exam, class: scopes[index].class, academicYear: scopes[index].academicYear }));
    });
    const seen = new Set();
    const rows = schedules.flatMap(exam => (exam.subjects || []).map(subject => ({ exam, subject })))
      .filter(({ exam, subject }) => {
        const key = `${exam._id}:${subject.subject || ''}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    if (!rows.length) {
      status.textContent = 'No assigned exam schedules are available.';
      return;
    }
    for (const { exam, subject } of rows) {
      const row = document.createElement('tr');
      const date = subject.date ? String(subject.date).slice(0, 10) : 'Unavailable';
      const time = [subject.startTime, subject.endTime].filter(Boolean).join(' – ') || 'Unavailable';
      for (const value of [exam.name, exam.examType, `${exam.class} · ${exam.academicYear}`, subject.subject, date, time, subject.room || '—', exam.status]) {
        const cell = document.createElement('td');
        cell.textContent = String(value || 'Unavailable');
        row.appendChild(cell);
      }
      body.appendChild(row);
    }
    status.textContent = `${rows.length} assigned exam subject${rows.length === 1 ? '' : 's'}.`;
  } catch (error) {
    body.replaceChildren();
    status.textContent = error.message || 'Assigned exam schedules could not be loaded.';
  }
}

async function loadTeacherDashboard(user) {
  try {
    const response = await apiFetch('/dashboard/teacher');
    const d = response && response.success === true && response.data && typeof response.data === 'object'
      ? response.data
      : null;
    const isCount = value => Number.isSafeInteger(value) && value >= 0;
    if (!d || !Array.isArray(d.assignedClasses) || !Array.isArray(d.attendanceScopes) || !Array.isArray(d.todaysSchedule) ||
        !isCount(d.attendancePendingCount) || !isCount(d.pendingHomework) || !isCount(d.upcomingExams)) {
      throw new Error('Teacher dashboard response is incomplete.');
    }
    _teacherData = d;
    _assignedClasses = d.assignedClasses;
    _attendanceScopes = d.attendanceScopes.filter(scope =>
      scope && typeof scope.class === 'string' && /^\d{4}-\d{4}$/.test(scope.academicYear) &&
      typeof scope.isClassTeacher === 'boolean' && Array.isArray(scope.subjects)
    );
    if (!document.getElementById('attDateSel').value) {
      document.getElementById('attDateSel').valueAsDate = new Date();
    }

    const periods = d.todaysSchedule;
    document.getElementById('todayClassCount').textContent = `${periods.length} classes`;
    const scheduleEl = document.getElementById('todaySchedule');
    if (!periods.length) {
      setEmptyState(scheduleEl, 'calendar-day', 'No Classes', 'You have no scheduled classes today.');
    } else {
      const now = new Date();
      scheduleEl.innerHTML = periods.map(p => {
        const [sh, sm] = (p.startTime || '0:0').split(':').map(Number);
        const [eh, em] = (p.endTime || '0:0').split(':').map(Number);
        const start = new Date(); start.setHours(sh, sm, 0);
        const end = new Date(); end.setHours(eh, em, 0);
        const isCurrent = now >= start && now <= end;
        return `<div class="schedule-item ${isCurrent ? 'current' : ''}">
          <div class="schedule-time">${p.startTime} - ${p.endTime}</div>
          <div class="schedule-details">
            <div class="schedule-subject">${p.subject || 'Unavailable'}</div>
            <div class="schedule-meta">Class ${p.class || 'Unavailable'} ${p.room ? 'Room ' + p.room : ''}</div>
            <div class="schedule-actions">
               <button class="btn btn-sm btn-ghost" ${cspActionAttrs('goToAttendance', [String(p.class)], 'click', [], [])}><i class="fas fa-check"></i> Attendance</button>
               <button class="btn btn-sm btn-ghost" ${cspActionAttrs('goToHomework', [String(p.class)], 'click', [], [])}><i class="fas fa-book"></i> Homework</button>
               <button class="btn btn-sm btn-ghost" ${cspActionAttrs('goToStudents', [String(p.class)], 'click', [], [])}><i class="fas fa-users"></i> Students</button>
            </div>
          </div>
        </div>`;
      }).join('');
    }

    const attendanceEl = document.getElementById('dashAttendancePending');
    if (!d.assignedClasses.length) {
      setEmptyState(attendanceEl, 'users', 'No Assigned Classes', 'Attendance status is unavailable because no classes are assigned.');
    } else if (!_attendanceScopes.length) {
      setEmptyState(attendanceEl, 'calendar-check', 'Attendance Unavailable', 'No year-specific attendance assignment is configured for your account.');
    } else if (d.attendancePendingCount > 0) {
      setEmptyState(attendanceEl, 'exclamation-circle', 'Attendance Pending',
        `${d.attendancePendingCount} assigned ${d.attendancePendingCount === 1 ? 'class has' : 'classes have'} no attendance record yet.`);
    } else {
      setEmptyState(attendanceEl, 'check-circle', 'Attendance Records Present', 'Every assigned class has an attendance record for today.');
    }

    // This service counts teacher assignments, not unreviewed submissions.
    const homeworkEl = document.getElementById('dashHomework');
    if (d.pendingHomework > 0) {
      setEmptyState(homeworkEl, 'book', 'Active Homework',
        `${d.pendingHomework} assignment${d.pendingHomework === 1 ? '' : 's'} due today or later.`);
    } else {
      setEmptyState(homeworkEl, 'check-circle', 'No Active Homework', 'No assignments are due today or later.');
    }

    // This service returns an exam count, not individual exam records.
    const examsEl = document.getElementById('dashExams');
    if (!d.assignedClasses.length) {
      setEmptyState(examsEl, 'users', 'No Assigned Classes', 'Exam status is unavailable because no classes are assigned.');
    } else if (d.upcomingExams > 0) {
      setEmptyState(examsEl, 'file-alt', 'Upcoming Exams',
        `${d.upcomingExams} upcoming exam${d.upcomingExams === 1 ? '' : 's'} for assigned classes. Individual exam details are unavailable in this summary.`);
    } else {
      setEmptyState(examsEl, 'check-circle', 'No Upcoming Exams', 'No upcoming exams were found for assigned classes.');
    }
  } catch (error) {
    _teacherData = null;
    _assignedClasses = [];
    _attendanceScopes = [];
    const states = [
      ['todaySchedule', 'calendar-day', 'Schedule Unavailable', "Today's schedule could not be loaded."],
      ['dashAttendancePending', 'calendar-check', 'Attendance Unavailable', 'Attendance status could not be loaded.'],
      ['dashHomework', 'book', 'Homework Unavailable', 'Homework status could not be loaded.'],
      ['dashExams', 'file-alt', 'Exams Unavailable', 'Exam status could not be loaded.'],
    ];
    states.forEach(([id, icon, title, description]) => {
      const element = document.getElementById(id);
      if (element) setEmptyState(element, icon, title, description);
    });
    const classCount = document.getElementById('todayClassCount');
    if (classCount) classCount.textContent = 'Unavailable';
    toast.error('Dashboard unavailable', 'Teacher dashboard data could not be loaded.');
  }
}

window.goToAttendance = function(cls) {
  showPanel('attendance');
  loadAttendancePanelOpts();
  const sel = document.getElementById('attClassSel');
  sel.value = cls;
  window.updateAttendanceYears();
  const yearSel = document.getElementById('attAcademicYearSel');
  if (yearSel.options.length === 2) {
    yearSel.selectedIndex = 1;
    loadClassRosterForAttendance();
  }
}
window.goToHomework = function(cls) {
  showPanel('homework');
  const sel = document.getElementById('hwClassFilter');
  if(!sel.options.length) {
    sel.innerHTML = '<option value="">All Classes</option>' + _assignedClasses.map(c => `<option value="${c}">${c}</option>`).join('');
  }
  sel.value = cls;
  filterTeacherHomework();
}
window.goToStudents = function(cls) {
  showPanel('roster');
  const sel = document.getElementById('rosterClassSel');
  if(!sel.options.length) {
    sel.innerHTML = _assignedClasses.map(c => `<option value="${c}">${c}</option>`).join('');
  }
  sel.value = cls;
  loadRoster();
}

/* ── My Classes ── */
function loadClassesPanel() {
  const grid = document.getElementById('myClassesGrid');
  if (!_assignedClasses.length) {
    setEmptyState(grid, 'chalkboard', 'No Classes', 'You are not assigned to any classes.');
    return;
  }
  grid.innerHTML = _assignedClasses.map(c => `
    <div class="class-card">
      <div class="class-card-header">
        <div class="class-card-title">Class ${c}</div>
        <div class="badge badge-teal">Assigned</div>
      </div>
      <div class="class-card-stats">
        <span><i class="fas fa-users"></i> Students</span>
        <span><i class="fas fa-calendar-alt"></i> Timetable</span>
      </div>
      <div class="class-card-actions mt-3">
        <button class="btn btn-outline btn-sm" ${cspActionAttrs("goToStudents", ['${c}'], "click", [], [])}><i class="fas fa-users"></i> Roster</button>
        <button class="btn btn-primary btn-sm" ${cspActionAttrs("goToAttendance", ['${c}'], "click", [], [])}><i class="fas fa-user-check"></i> Attendance</button>
      </div>
    </div>
  `).join('');
}

/* ── Attendance ── */
function loadAttendancePanelOpts() {
  const sel = document.getElementById('attClassSel');
  if (sel) {
    const selected = sel.value;
    const classes = [...new Set(_attendanceScopes.map(scope => scope.class))];
    sel.innerHTML = '<option value="">Select Class</option>' + classes.map(c => {
      const safe = escapeAttendanceText(c);
      return `<option value="${safe}">${safe}</option>`;
    }).join('');
    if (classes.includes(selected)) sel.value = selected;
    window.updateAttendanceYears();
  }
  if (!_attendanceScopes.length) {
    const list = document.getElementById('attStudentList');
    if (list) list.innerHTML = '<p class="error-state">Attendance is unavailable because no year-specific class assignment is configured.</p>';
    const save = document.getElementById('btnSaveAttendance');
    if (save) save.disabled = true;
  }
}
window.updateAttendanceYears = function() {
  _attRoster = [];
  const saveButton = document.getElementById('btnSaveAttendance');
  if (saveButton) saveButton.disabled = true;
  const cls = document.getElementById('attClassSel')?.value;
  const yearSel = document.getElementById('attAcademicYearSel');
  if (!yearSel) return;
  const selected = yearSel.value;
  const years = [...new Set(_attendanceScopes
    .filter(scope => scope.class === cls)
    .map(scope => scope.academicYear))].sort();
  yearSel.innerHTML = '<option value="">Select Academic Year</option>' + years.map(year => {
    const safe = escapeAttendanceText(year);
    return `<option value="${safe}">${safe}</option>`;
  }).join('');
  if (years.includes(selected)) yearSel.value = selected;
  window.updateAttendanceSubjects();
}
window.updateAttendanceSubjects = function() {
  _attRoster = [];
  const saveButton = document.getElementById('btnSaveAttendance');
  if (saveButton) saveButton.disabled = true;
  const subjectSel = document.getElementById('attSubjectSel');
  if (!subjectSel) return;
  const cls = document.getElementById('attClassSel')?.value;
  const academicYear = document.getElementById('attAcademicYearSel')?.value;
  const scope = _attendanceScopes.find(item => item.class === cls && item.academicYear === academicYear);
  const selected = subjectSel.value;
  const subjects = scope
    ? [...(scope.isClassTeacher ? [{ id: 'General', label: 'Class attendance' }] : []), ...scope.subjects]
    : [];
  subjectSel.innerHTML = '<option value="">Select Subject</option>' + subjects.map(subject =>
    `<option value="${escapeAttendanceText(subject.id)}">${escapeAttendanceText(subject.label)}</option>`
  ).join('');
  if (subjects.some(subject => subject.id === selected)) subjectSel.value = selected;
}
window.loadClassRosterForAttendance = async function() {
  _attRoster = [];
  _attendanceNeedsReview = false;
  _attendanceCurrentReloaded = false;
  document.getElementById('btnSaveAttendance').disabled = true;
  const cls = document.getElementById('attClassSel').value;
  const academicYear = document.getElementById('attAcademicYearSel').value;
  const subject = document.getElementById('attSubjectSel').value;
  const dt = document.getElementById('attDateSel').value;
  if (!cls || !academicYear || !subject || !dt) {
    _attRoster = [];
    document.getElementById('btnSaveAttendance').disabled = true;
    const list = document.getElementById('attStudentList');
    if (list) list.textContent = 'Select an assigned class, academic year, subject, and date.';
    return;
  }
  if (!_attendanceScopes.some(scope => scope.class === cls && scope.academicYear === academicYear)) {
    const list = document.getElementById('attStudentList');
    if (list) list.textContent = 'This class and academic year are not assigned to your account.';
    document.getElementById('btnSaveAttendance').disabled = true;
    return;
  }
  const activeScope = _attendanceScopes.find(scope => scope.class === cls && scope.academicYear === academicYear);
  const permittedSubjects = [
    ...(activeScope.isClassTeacher ? [{ id: 'General' }] : []),
    ...activeScope.subjects,
  ];
  if (!permittedSubjects.some(item => item.id === subject)) {
    const list = document.getElementById('attStudentList');
    if (list) list.textContent = 'This subject is not assigned to your account for this class and academic year.';
    return;
  }
  
  cspSetVisibility(document.getElementById('attEmptyState'), false);
  cspSetVisibility(document.getElementById('attSummaryWrap'), true, 'block');
  const list = document.getElementById('attStudentList');
  list.innerHTML = '<div class="spinner csp-style-7b66a9f734" ></div>';
  
  try {
    const dateQuery = `date=${encodeURIComponent(dt)}&academicYear=${encodeURIComponent(academicYear)}&subject=${encodeURIComponent(subject)}`;
    const attendanceRes = await apiFetch(`/attendance/class/${encodeURIComponent(cls)}?${dateQuery}`);
    const students = attendanceRes?.success === true && Array.isArray(attendanceRes.data?.students)
      ? attendanceRes.data.students
      : null;
    const records = attendanceRes?.success === true && Array.isArray(attendanceRes.data?.records)
      ? attendanceRes.data.records
      : null;
    if (!students || !records) throw new Error('The class roster or current attendance response was invalid.');
    const byStudent = new Map();
    for (const record of records.filter(item => item.subject === subject)) {
      const studentId = String(record.studentId || record.student?._id || '');
      if (!studentId || byStudent.has(studentId)) {
        throw new Error('Duplicate or invalid attendance records were returned. Contact an administrator before marking.');
      }
      byStudent.set(studentId, record);
    }
    _attRoster = students.map(student => {
      const existing = byStudent.get(String(student._id));
      const statusMap = {
        Present: 'present', Absent: 'absent', Late: 'late',
        'Half-Day': 'half-day', Holiday: 'holiday',
      };
      return {
        id: student._id,
        name: student.name || student.user?.name || 'Student',
        roll: student.rollNumber,
        status: existing ? statusMap[existing.status] : 'present',
        expectedRevision: existing ? existing.revision : null,
        currentStatus: existing ? existing.status : null,
        currentRevision: existing ? existing.revision : null,
      };
    });
    if (_attRoster.some(row => !row.status || (row.expectedRevision !== null && !Number.isSafeInteger(row.expectedRevision)))) {
      _attRoster = [];
      throw new Error('Attendance response is missing a valid status or revision.');
    }
    
    renderAttendanceList();
  } catch(e) {
    _attRoster = [];
    document.getElementById('btnSaveAttendance').disabled = true;
    list.textContent = e.message || 'Attendance roster could not be loaded.';
  }
};

function renderAttendanceList() {
  const list = document.getElementById('attStudentList');
  if (!_attRoster.length) { list.innerHTML = '<div class="empty-state csp-style-52be74ca43" >No students found in this class.</div>'; return; }
  const reviewBanner = _attendanceNeedsReview
    ? `<div class="alert alert-warning" role="status">
        Current saved attendance was reloaded. Your pending edits are preserved below. Compare each saved value with your draft before continuing.
        ${_attendanceCurrentReloaded
          ? `<button class="btn btn-warning btn-sm" ${cspActionAttrs('reviewAndRebaseAttendance', [], 'click', [], [])}>I reviewed the current values; keep my edits</button>`
          : '<span>Current values could not be loaded. Reload attendance before trying again.</span>'}
      </div>`
    : '';
  const statusOptions = [
    ['present', 'P', 'Present'], ['absent', 'A', 'Absent'], ['late', 'L', 'Late'],
    ['half-day', 'H', 'Half Day'], ['holiday', 'Hol', 'Holiday'],
  ];
  list.innerHTML = reviewBanner + _attRoster.map((s, idx) => `
    <div class="att-student-card">
      <div class="att-student-info">
        <div class="att-roll">${escapeAttendanceText(s.roll || '—')}</div>
        <div class="att-name">${escapeAttendanceText(s.name)}</div>
        ${_attendanceNeedsReview
          ? `<div class="att-current-value">Saved: ${escapeAttendanceText(s.currentStatus || 'No record')} · Draft: ${escapeAttendanceText(s.status)}</div>`
          : s.currentStatus ? `<div class="att-current-value">Saved: ${escapeAttendanceText(s.currentStatus)}</div>` : ''}
      </div>
      <div class="att-radio-group">
        ${statusOptions.map(([value, label, title]) =>
          `<button class="att-btn ${value === 'absent' ? 'absent' : value === 'present' ? 'present' : 'late'} ${s.status === value ? 'selected' : ''}" aria-label="${title || label}" ${cspActionAttrs('setAtt', [idx, value], 'click', [], [])} title="${title}">${label}</button>`
        ).join('')}
      </div>
    </div>
  `).join('');
  document.getElementById('btnSaveAttendance').disabled = _attendanceNeedsReview;
  updateAttStats();
}

window.setAtt = function(idx, status) {
  _attRoster[idx].status = status;
  renderAttendanceList(); 
};
window.markAllPresent = function() {
  _attRoster.forEach(s => s.status = 'present');
  renderAttendanceList();
};
window.markAllAbsent = function() {
  _attRoster.forEach(s => s.status = 'absent');
  renderAttendanceList();
};

window.reviewAndRebaseAttendance = function() {
  if (!_attendanceNeedsReview || !_attendanceCurrentReloaded) return;
  if (_attRoster.some(row => row.currentStatus && !Number.isSafeInteger(row.currentRevision))) {
    toast.error('Attendance not ready', 'Current attendance revisions could not be verified. Reload the roster.');
    return;
  }
  _attRoster.forEach(row => {
    row.expectedRevision = row.currentStatus ? row.currentRevision : null;
  });
  _attendanceNeedsReview = false;
  _attendanceCurrentReloaded = false;
  renderAttendanceList();
};

function updateAttStats() {
  const p = _attRoster.filter(s=>s.status==='present').length;
  const a = _attRoster.filter(s=>s.status==='absent').length;
  const l = _attRoster.filter(s=>s.status==='late').length;
  const t = _attRoster.length;
  document.getElementById('attSumP').textContent = p;
  document.getElementById('attSumA').textContent = a;
  document.getElementById('attSumL').textContent = l;
  document.getElementById('attSumT').textContent = t;
  const pct = t>0 ? Math.round(p/t*100) : 0;
  cspSetProgress(document.getElementById('attPctBar'), pct);
  document.getElementById('attPctText').textContent = pct + '% Present';
}

async function refreshAttendanceForReview(className, date, academicYear, subject) {
  _attendanceNeedsReview = true;
  _attendanceCurrentReloaded = false;
  const saveButton = document.getElementById('btnSaveAttendance');
  if (saveButton) saveButton.disabled = true;
  try {
    const response = await apiFetch(
      `/attendance/class/${encodeURIComponent(className)}?date=${encodeURIComponent(date)}&academicYear=${encodeURIComponent(academicYear)}&subject=${encodeURIComponent(subject)}`
    );
    if (response?.success !== true || !Array.isArray(response.data?.records)) {
      throw new Error('Current attendance response was invalid.');
    }
    const currentByStudent = new Map();
    for (const record of response.data.records.filter(item => item.subject === subject)) {
      const studentId = String(record.studentId || record.student?._id || '');
      if (!studentId || currentByStudent.has(studentId) || !Number.isSafeInteger(record.revision)) {
        throw new Error('Current attendance contains duplicate or invalid revisions.');
      }
      currentByStudent.set(studentId, record);
    }
    _attRoster = _attRoster.map(row => {
      const current = currentByStudent.get(String(row.id));
      return {
        ...row,
        currentStatus: current ? current.status : null,
        currentRevision: current ? current.revision : null,
      };
    });
    _attendanceCurrentReloaded = true;
  } catch (_) {
    _attendanceCurrentReloaded = false;
  }
  renderAttendanceList();
  return _attendanceCurrentReloaded;
}

window.saveAttendance = async function() {
  const cls = document.getElementById('attClassSel').value;
  const dt = document.getElementById('attDateSel').value;
  const academicYear = document.getElementById('attAcademicYearSel').value;
  const subject = document.getElementById('attSubjectSel').value;
  const btn = document.getElementById('btnSaveAttendance');
  const scope = _attendanceScopes.find(item => item.class === cls && item.academicYear === academicYear);
  const permittedSubjects = scope
    ? [...(scope.isClassTeacher ? [{ id: 'General' }] : []), ...scope.subjects]
    : [];
  if (_attendanceNeedsReview) {
    toast.error('Review required', 'Compare your pending edits with the reloaded saved values before continuing.');
    return;
  }
  if (!cls || !academicYear || !subject || !dt || !_attRoster.length ||
      !scope || !permittedSubjects.some(item => item.id === subject)) {
    toast.error('Attendance not saved', 'Select an assigned class, academic year, subject, date, and roster.');
    return;
  }
  const statusMap = {
    present: 'Present', absent: 'Absent', late: 'Late',
    'half-day': 'Half-Day', holiday: 'Holiday',
  };
  const attendanceData = _attRoster.map(student => ({
    student: student.id,
    status: statusMap[student.status],
    expectedRevision: student.expectedRevision,
  }));
  setButtonLoading(btn, true);
  try {
    const response = await apiFetch('/attendance/mark', {
      method: 'POST',
      body: JSON.stringify({ class: cls, date: dt, academicYear, subject, attendanceData }),
    });
    if (!response || response.success !== true) throw new Error('Attendance was not confirmed by the server.');
    const committedRecords = response.data?.result?.records;
    const committedByStudent = Array.isArray(committedRecords)
      ? new Map(committedRecords.map(record => [String(record.studentId), record]))
      : new Map();
    const confirmed = committedByStudent.size === _attRoster.length && _attRoster.every(row => {
      const committed = committedByStudent.get(String(row.id));
      const expectedCommittedRevision = row.expectedRevision === null ? 1 : row.expectedRevision + 1;
      return committed && Number.isSafeInteger(committed.revision) &&
        committed.revision === expectedCommittedRevision && committed.status === statusMap[row.status];
    });
    if (!confirmed) {
      const uncertain = new Error('The server response did not confirm every saved attendance record.');
      uncertain.status = 503;
      throw uncertain;
    }
    _attRoster = _attRoster.map(row => {
      const committed = committedByStudent.get(String(row.id));
      return {
        ...row,
        expectedRevision: committed.revision,
        currentRevision: committed.revision,
        currentStatus: committed.status,
      };
    });
    toast.success('Saved', `Attendance for Class ${cls} saved successfully.`);
  } catch(e) {
    if (e.status === 409 || e.status === 0 || e.status >= 500) {
      const reloaded = await refreshAttendanceForReview(cls, dt, academicYear, subject);
      const message = reloaded
        ? 'Current saved values are shown beside your preserved edits. Review them before choosing to keep your edits.'
        : 'The result could not be confirmed. Your edits are preserved; reload attendance before retrying.';
      toast.error('Attendance needs review', `${e.message || 'The save outcome is uncertain.'} ${message}`);
    } else {
      toast.error('Error', e.message || 'Attendance could not be saved.');
    }
  } finally {
    setButtonLoading(btn, false);
    if (_attendanceNeedsReview || !_attRoster.length) btn.disabled = true;
  }
};

/* ── Homework ── */
function loadHomeworkOpts() {
  const sel1 = document.getElementById('hwClassFilter');
  const sel2 = document.getElementById('newHwClass');
  const opts = _assignedClasses.map(c => `<option value="${c}">${c}</option>`).join('');
  if(sel1 && sel1.options.length <= 1) sel1.innerHTML += opts;
  if(sel2 && sel2.options.length === 0) sel2.innerHTML = opts;
  
  loadTeacherHomework();
}
async function loadTeacherHomework() {
  const list = document.getElementById('teacherHomeworkList');
  if (!list) return;
  list.innerHTML = '<div class="spinner"></div>';
  try {
    const response = await apiFetch('/homework');
    const hw = response?.success === true && Array.isArray(response.data) ? response.data : null;
    if (!hw) throw new Error('Homework list response was invalid.');
    if(!hw.length) { setEmptyState(list, 'book', 'No Homework', 'You have not assigned any homework.'); return; }
    
    list.innerHTML = hw.map(h => `
      <div class="card teacher-homework-card" data-homework-card><div class="card-body">
        <div class="csp-style-d49a73d24c">
          <div><span class="badge badge-info">${escapeAttendanceText(h.subject?.name || h.subject || 'General')}</span> <span class="badge badge-secondary csp-style-d0acc76221" >Class ${escapeAttendanceText(h.class || '—')}</span></div>
          <span class="csp-style-3bdae21a61">Due: ${formatDate(h.dueDate)}</span>
        </div>
        <h4 class="csp-style-a1a0dcf46c">${escapeAttendanceText(h.title || 'Untitled homework')}</h4>
        <div class="csp-style-c1bd752291">
          <span class="csp-style-abc2a84190"><i class="fas fa-users csp-style-500708668c" ></i> Submissions</span>
          <button class="btn btn-secondary btn-sm" ${cspActionAttrs('viewHomeworkSubmissions', [String(h._id)], 'click', [1], [])}>View</button>
        </div>
        <div class="homework-submissions" role="status" aria-live="polite"></div>
      </div></div>
    `).join('');
  } catch(e) {
    setEmptyState(list, 'book', 'Could not load homework', escapeAttendanceText(e.message || 'Homework is unavailable.'));
  }
}

window.viewHomeworkSubmissions = async function(homeworkId, button) {
  const card = button?.closest('[data-homework-card]');
  const panel = card?.querySelector('.homework-submissions');
  if (!panel || !homeworkId || button.disabled) return;

  button.disabled = true;
  panel.textContent = 'Loading submissions…';
  try {
    const response = await apiFetch(`/homework/${encodeURIComponent(homeworkId)}`);
    const homework = response?.success === true ? response.data : null;
    if (!homework || !Array.isArray(homework.submissions)) {
      throw new Error('Submission details are not available for this account.');
    }
    if (!homework.submissions.length) {
      panel.textContent = 'No submissions have been received.';
      return;
    }

    panel.innerHTML = `<ul class="homework-submission-list">${homework.submissions.map(submission => {
      const attachments = Array.isArray(submission.attachments)
        ? submission.attachments.map(file => {
          const name = escapeAttendanceText(file?.name || 'Submission link');
          const href = safeHomeworkAttachmentHref(file?.url);
          return href
            ? `<a href="${escapeAttendanceText(href)}" target="_blank" rel="noopener noreferrer">${name}</a>`
            : name;
        }).join(', ')
        : '';
      return `<li><strong>Student ${escapeAttendanceText(submission.studentId || 'unavailable')}</strong>
        <span>${escapeAttendanceText(submission.status || 'pending')}</span>
        ${submission.submittedAt ? `<div>Submitted: ${escapeAttendanceText(formatDate(submission.submittedAt))}</div>` : ''}
        ${submission.content ? `<p>${escapeAttendanceText(submission.content)}</p>` : ''}
        ${attachments ? `<div>Attachments: ${attachments}</div>` : ''}
        ${submission.feedback ? `<div>Feedback: ${escapeAttendanceText(submission.feedback)}</div>` : ''}
      </li>`;
    }).join('')}</ul>`;
  } catch(error) {
    panel.textContent = error.message || 'Submissions could not be loaded.';
  } finally {
    button.disabled = false;
  }
};

function safeHomeworkAttachmentHref(value) {
  if (typeof value !== 'string' || !value.trim()) return '';
  try {
    const parsed = new URL(value, window.location.origin);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) return '';
    return parsed.href;
  } catch (_) {
    return '';
  }
}

window.submitNewHomework = async function() {
  const title = document.getElementById('newHwTitle').value;
  const cls = document.getElementById('newHwClass').value;
  const sub = document.getElementById('newHwSubject').value;
  const due = document.getElementById('newHwDate').value;
  const desc = document.getElementById('newHwDesc').value;
  
  if(!title||!cls||!sub||!due) return toast.warning('Missing', 'Fill all required fields.');
  
  try {
    await apiFetch('/homework', { method: 'POST', body: JSON.stringify({ title, class: cls, subject: sub, dueDate: due, description: desc }) });
    toast.success('Assigned', 'Homework assigned successfully.');
    closeModal('addHomeworkModal');
    loadTeacherHomework();
  } catch(e) { toast.error('Error', e.message); }
};

/* ── Marks ── */
let _marksExams = [];
let _marksRoster = [];
let _marksRosterScope = null;

function clearMarksRoster(message = 'Select filters, then load the roster.') {
  _marksRoster = [];
  _marksRosterScope = null;
  const body = document.getElementById('marksSheetBody');
  const saveButton = document.getElementById('btnSaveMarks');
  if (body) body.innerHTML = `<tr><td colspan="5" class="empty-state">${escapeAttendanceText(message)}</td></tr>`;
  if (saveButton) saveButton.disabled = true;
}

function loadMarksOpts() {
  const sel = document.getElementById('marksClass');
  if (!sel) return;
  const classes = [...new Set(_attendanceScopes
    .filter(scope => Array.isArray(scope.subjects) && scope.subjects.length > 0)
    .map(scope => scope.class))];
  sel.innerHTML = '<option value="">Class</option>' + classes
    .map(className => `<option value="${escapeAttendanceText(className)}">${escapeAttendanceText(className)}</option>`)
    .join('');
  updateMarksAcademicYears();
  if (!classes.length) {
    clearMarksRoster('Marks entry is unavailable because no year-specific subject assignment is configured.');
  }
}

window.updateMarksAcademicYears = function() {
  const className = document.getElementById('marksClass')?.value || '';
  const yearSelect = document.getElementById('marksAcademicYear');
  const examSelect = document.getElementById('marksExam');
  const subjectSelect = document.getElementById('marksSubject');
  const saveButton = document.getElementById('btnSaveMarks');
  if (!yearSelect || !examSelect || !subjectSelect) return;
  clearMarksRoster();

  const years = [...new Set(_attendanceScopes
    .filter(scope => scope.class === className && Array.isArray(scope.subjects) && scope.subjects.length > 0)
    .map(scope => scope.academicYear))].sort();
  yearSelect.innerHTML = '<option value="">Academic year</option>' + years
    .map(year => `<option value="${escapeAttendanceText(year)}">${escapeAttendanceText(year)}</option>`)
    .join('');
  if (years.length === 1) yearSelect.value = years[0];
  examSelect.innerHTML = '<option value="">Exam</option>';
  subjectSelect.innerHTML = '<option value="">Subject</option>';
  _marksExams = [];
  if (saveButton) saveButton.disabled = true;
  if (yearSelect.value) window.updateMarksExamList();
};

window.updateMarksExamList = async function() {
  const className = document.getElementById('marksClass')?.value || '';
  const academicYear = document.getElementById('marksAcademicYear')?.value || '';
  const examSelect = document.getElementById('marksExam');
  const subjectSelect = document.getElementById('marksSubject');
  const saveButton = document.getElementById('btnSaveMarks');
  if (!examSelect || !subjectSelect) return;
  clearMarksRoster();
  _marksExams = [];
  examSelect.title = '';
  examSelect.innerHTML = '<option value="">Loading exams…</option>';
  subjectSelect.innerHTML = '<option value="">Subject</option>';
  if (saveButton) saveButton.disabled = true;
  if (!className || !academicYear || !_attendanceScopes.some(scope =>
    scope.class === className && scope.academicYear === academicYear && scope.subjects?.length)) {
    examSelect.innerHTML = '<option value="">No assigned exam scope</option>';
    return;
  }

  try {
    const response = await apiFetch(`/exams/class/${encodeURIComponent(className)}?academicYear=${encodeURIComponent(academicYear)}`);
    if (response?.success !== true || !Array.isArray(response.data)) {
      throw new Error('Exam response was invalid.');
    }
    const candidateExams = response.data.filter(exam => exam && exam._id && typeof exam.examType === 'string'
      && exam.examType && exam.class === className && exam.academicYear === academicYear
      && Array.isArray(exam.subjects));
    const examTypeCounts = candidateExams.reduce((counts, exam) => {
      counts.set(exam.examType, (counts.get(exam.examType) || 0) + 1);
      return counts;
    }, new Map());
    const ambiguousTypes = [...examTypeCounts].filter(([, count]) => count > 1).map(([type]) => type);
    _marksExams = candidateExams.filter(exam => examTypeCounts.get(exam.examType) === 1);
    if (!_marksExams.length) {
      examSelect.innerHTML = `<option value="">${ambiguousTypes.length ? 'Resolve duplicate exam schedules first' : 'No exams for this class and year'}</option>`;
      if (ambiguousTypes.length) examSelect.title = `Multiple exams share the same marks key: ${escapeAttendanceText(ambiguousTypes.join(', '))}`;
      return;
    }
    examSelect.innerHTML = '<option value="">Exam</option>' + _marksExams.map(exam => {
      const label = `${exam.name || exam.examType || 'Exam'} · ${exam.examType || 'Type unavailable'}`;
      return `<option value="${escapeAttendanceText(exam._id)}">${escapeAttendanceText(label)}</option>`;
    }).join('') + (ambiguousTypes.length
      ? `<option value="" disabled>Duplicate exam type needs schedule review: ${escapeAttendanceText(ambiguousTypes.join(', '))}</option>`
      : '');
  } catch (error) {
    examSelect.innerHTML = '<option value="">Exams unavailable</option>';
    examSelect.title = error.message || 'Exam list could not be loaded.';
    toast.error('Exams unavailable', error.message || 'Exam list could not be loaded.');
  }
};

window.updateMarksSubjectList = function() {
  const examId = document.getElementById('marksExam')?.value;
  const subjectSelect = document.getElementById('marksSubject');
  const maxInput = document.getElementById('marksMax');
  const saveButton = document.getElementById('btnSaveMarks');
  const exam = _marksExams.find(item => String(item._id) === String(examId));
  if (!subjectSelect || !maxInput) return;
  clearMarksRoster();
  subjectSelect.innerHTML = '<option value="">Subject</option>';
  maxInput.value = '';
  maxInput.readOnly = false;
  if (saveButton) saveButton.disabled = true;
  if (!exam) return;

  subjectSelect.innerHTML += exam.subjects.map(entry => {
    const subjectValue = typeof entry?.subject === 'string'
      ? entry.subject
      : entry?.subject?.name || entry?.subject?.code || entry?.subject?._id;
    if (!subjectValue) return '';
    const label = typeof entry.subject === 'object'
      ? entry.subject.name || entry.subject.code || entry.subject._id
      : entry.subject;
    return `<option value="${escapeAttendanceText(subjectValue)}">${escapeAttendanceText(label)}</option>`;
  }).join('');
};

window.updateMarksMaximum = function() {
  const examId = document.getElementById('marksExam')?.value;
  const subjectValue = document.getElementById('marksSubject')?.value;
  const exam = _marksExams.find(item => String(item._id) === String(examId));
  const maxInput = document.getElementById('marksMax');
  const saveButton = document.getElementById('btnSaveMarks');
  const scheduled = exam?.subjects?.find(entry => String(
    typeof entry?.subject === 'object' ? entry.subject.name || entry.subject.code || entry.subject._id : entry?.subject
  ) === String(subjectValue));
  if (!maxInput) return;
  clearMarksRoster();
  const hasScheduledMaximum = Number.isFinite(Number(scheduled?.maxMarks)) && Number(scheduled?.maxMarks) > 0;
  maxInput.value = hasScheduledMaximum ? String(scheduled.maxMarks) : '';
  maxInput.readOnly = hasScheduledMaximum;
  if (saveButton) saveButton.disabled = true;
};
window.loadStudentsForMarks = async function() {
  const cls = document.getElementById('marksClass').value;
  const academicYear = document.getElementById('marksAcademicYear').value;
  const examId = document.getElementById('marksExam').value;
  const exam = _marksExams.find(item => String(item._id) === String(examId));
  const sub = document.getElementById('marksSubject').value;
  const mx = document.getElementById('marksMax').value;
  const tbody = document.getElementById('marksSheetBody');
  _marksRoster = [];
  _marksRosterScope = null;
  document.getElementById('btnSaveMarks').disabled = true;
  
  if(!cls || !academicYear || !exam || !sub || !mx || !Number.isFinite(Number(mx)) || Number(mx) <= 0) {
    return toast.warning('Missing Filters', 'Select an assigned class, academic year, scheduled exam and subject with a valid maximum mark.');
  }
  
  tbody.innerHTML = '<tr><td colspan="5"><div class="spinner"></div></td></tr>';
  
  try {
    const response = await apiFetch(`/students/class/${encodeURIComponent(cls)}?academicYear=${encodeURIComponent(academicYear)}`);
    _marksRoster = response?.success === true && Array.isArray(response.data?.students)
      ? response.data.students
      : null;
    if (!_marksRoster) throw new Error('Class roster response was invalid.');
    if(!_marksRoster.length) { tbody.innerHTML = '<tr><td colspan="5" class="empty-state">No students found.</td></tr>'; return; }
    _marksRosterScope = { class: cls, academicYear, examId, subject: sub };
    
    tbody.innerHTML = _marksRoster.map((s,i) => `
      <tr>
        <td>${escapeAttendanceText(s.rollNumber || '—')}</td>
        <td class="csp-style-6e8bcfac8d">${escapeAttendanceText(s.user?.name || s.name || 'Student')}</td>
        <td><input type="number" class="form-control csp-style-3a06261726" id="mo_${i}" max="${escapeAttendanceText(mx)}" aria-label="Marks for ${escapeAttendanceText(s.user?.name || s.name || 'Student')}" ${cspActionAttrs("calcGrade", [i], "input", [], [])}></td>
        <td><span id="mp_${i}" class="csp-style-3d2508e113">—</span></td>
        <td><span class="badge badge-secondary" id="mg_${i}">—</span></td>
      </tr>
    `).join('');
    document.getElementById('btnSaveMarks').disabled = false;
  } catch(e) {
    _marksRoster = [];
    document.getElementById('btnSaveMarks').disabled = true;
    tbody.innerHTML = `<tr><td colspan="5" class="error-state">${escapeAttendanceText(e.message || 'Student roster could not be loaded.')}</td></tr>`;
  }
};
/*UP Board grading preview — matches backend Marks.js pre-save hook exactly */
window.calcGrade = function(idx) {
  const val    = parseFloat(document.getElementById(`mo_${idx}`).value);
  const mx     = parseFloat(document.getElementById('marksMax').value);
  const badge  = document.getElementById(`mg_${idx}`);
  const pctEl  = document.getElementById(`mp_${idx}`);
  if (isNaN(val) || isNaN(mx) || mx <= 0) {
    badge.textContent = '—'; badge.className = 'badge badge-secondary';
    if (pctEl) pctEl.textContent = '—';
    return;
  }
  const pct = (val / mx) * 100;
  if (pctEl) pctEl.textContent = pct.toFixed(1) + '%';
  //UP Board scale — identical to backend pre-save hook
  let g, cls;
  if      (pct >= 90) { g = 'A1'; cls = 'badge-success'; }
  else if (pct >= 80) { g = 'A2'; cls = 'badge-success'; }
  else if (pct >= 70) { g = 'B1'; cls = 'badge-info'; }
  else if (pct >= 60) { g = 'B2'; cls = 'badge-info'; }
  else if (pct >= 50) { g = 'C1'; cls = 'badge-warning'; }
  else if (pct >= 40) { g = 'C2'; cls = 'badge-warning'; }
  else if (pct >= 33) { g = 'D';  cls = 'badge-secondary'; }
  else                { g = 'E';  cls = 'badge-danger'; }
  badge.textContent = g;
  badge.className   = `badge ${cls}`;
};
window.recalculateAllGrades = function() {
  for (let i = 0; i < _marksRoster.length; i++) calcGrade(i);
};

/* Save marks — the server validates the scheduled exam and recalculates grades. */
window.saveMarks = async function() {
  const btn = document.getElementById('btnSaveMarks');
  const cls = document.getElementById('marksClass').value;
  const academicYear = document.getElementById('marksAcademicYear').value;
  const examId = document.getElementById('marksExam').value;
  const selectedExam = _marksExams.find(item => String(item._id) === String(examId));
  const sub = document.getElementById('marksSubject').value;
  const mx = Number(document.getElementById('marksMax').value);
  if (!cls || !academicYear || !sub || !selectedExam || !selectedExam.examType
    || !Number.isFinite(mx) || mx <= 0 || !_attendanceScopes.some(scope =>
      scope.class === cls && scope.academicYear === academicYear && scope.subjects?.length)
    || !_marksRosterScope || _marksRosterScope.class !== cls || _marksRosterScope.academicYear !== academicYear
    || _marksRosterScope.examId !== examId || _marksRosterScope.subject !== sub) {
    return toast.warning('Missing', 'Select an assigned class, academic year, exam, subject and valid maximum marks.');
  }
  const entries = _marksRoster.map((s, i) => {
    const raw = document.getElementById(`mo_${i}`)?.value;
    if (raw === '' || raw === undefined) return null;
    return { student: s._id, marksObtained: Number(raw) };
  }).filter(Boolean);
  if (!entries.length) return toast.warning('Nothing to Save', 'Enter at least one mark.');
  if (entries.some(entry => !Number.isFinite(entry.marksObtained) || entry.marksObtained < 0 || entry.marksObtained > mx)) {
    return toast.warning('Invalid marks', `Enter a value from 0 to ${mx} for each student.`);
  }
  setButtonLoading(btn, true);
  let saved = 0, errors = 0;
  let firstError = '';
  for (const entry of entries) {
    try {
      await apiFetch('/marks', {
        method: 'POST',
        body: JSON.stringify({
          student: entry.student, class: cls, examType: selectedExam.examType, academicYear,
          subjects: [{ subject: sub, maxMarks: mx, marksObtained: entry.marksObtained }],
        }),
      });
      saved++;
    } catch(e) { errors++; if (!firstError) firstError = e.message || 'One or more marks could not be saved.'; }
  }
  setButtonLoading(btn, false);
  if (errors === 0) toast.success('Marks Saved', `${saved} entries saved. Grades calculated by server.`);
  else toast.warning('Partial Save', `${saved} saved, ${errors} failed. ${firstError}`);
};

/* ── Class Roster ── */
function loadRosterOpts() {
  const sel = document.getElementById('rosterClassSel');
  if(sel && sel.options.length===0) sel.innerHTML = _assignedClasses.map(c => `<option value="${c}">Class ${c}</option>`).join('');
  loadRoster();
}
window.loadRoster = async function() {
  const cls = document.getElementById('rosterClassSel')?.value;
  if(!cls) return;
  const grid = document.getElementById('rosterGrid');
  grid.innerHTML = '<div class="spinner"></div>';
  try {
    const response = await apiFetch(`/students/class/${encodeURIComponent(cls)}`);
    const stds = response?.success === true && Array.isArray(response.data?.students)
      ? response.data.students
      : null;
    if (!stds) throw new Error('Class roster response was invalid.');
    if(!stds.length) { setEmptyState(grid, 'users', 'No Students', ''); return; }
    
    grid.innerHTML = stds.map(s => `
      <div class="card"><div class="card-body csp-style-905008530c" >
        <div class="csp-style-79cdf138e7"><i class="fas fa-user"></i></div>
        <h4 class="csp-style-86bb53a601">${escapeAttendanceText(s.user?.name || s.name || 'Student')}</h4>
        <div class="csp-style-fa9a12a5bf">Roll No. ${escapeAttendanceText(s.rollNumber || '—')} · Adm. ${escapeAttendanceText(s.admissionNumber || '—')}</div>
        <button class="btn btn-ghost btn-sm csp-style-092cb9d6a9" ><i class="fas fa-id-card"></i> View Profile</button>
      </div></div>
    `).join('');
  } catch(e) {
    setEmptyState(grid, 'users', 'Could not load students', escapeAttendanceText(e.message || 'Class roster is unavailable.'));
  }
};
