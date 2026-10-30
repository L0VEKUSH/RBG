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
    { icon: 'edit', text: 'Marks', panel: 'marks' }
  ]},
  { label: 'Misc', items: [
    { icon: 'bell', text: 'Notices', panel: 'notices' },
    { icon: 'sign-out-alt', text: 'Leave', panel: 'leave' }
  ]}
];

let _teacherData = null;
let _assignedClasses = [];
let _attRoster = [];

initPortal({
  role: 'teacher',
  expectedRoles: ['teacher', 'class_teacher'],
  navConfig: TEACHER_NAV,
  onDashboardLoad: loadTeacherDashboard
});

window.onPanel_dashboard = loadTeacherDashboard;
window.onPanel_classes = loadClassesPanel;
window.onPanel_attendance = loadAttendancePanelOpts;
window.onPanel_homework = loadHomeworkOpts;
window.onPanel_marks = loadMarksOpts;
window.onPanel_roster = loadRosterOpts;
window.onPanel_notices = loadNoticesFull;

async function loadTeacherDashboard(user) {
  try {
    const data = await apiFetch('/dashboard/teacher');
    const d = data.data || {};
    _teacherData = d;
    
    _assignedClasses = d.assignedClasses || [];
    if (!document.getElementById('attDateSel').value) {
      document.getElementById('attDateSel').valueAsDate = new Date();
    }
    
    // Today schedule
    const periods = d.todaysSchedule || [];
    document.getElementById('todayClassCount').textContent = `${periods.length} classes`;
    const el = document.getElementById('todaySchedule');
    
    if (!periods.length) {
      setEmptyState(el, 'calendar-day', 'No Classes', 'You have no scheduled classes today.');
    } else {
      const now = new Date();
      el.innerHTML = periods.map(p => {
        const [sh,sm] = (p.startTime||'0:0').split(':').map(Number);
        const [eh,em] = (p.endTime||'0:0').split(':').map(Number);
        const start = new Date(); start.setHours(sh,sm,0);
        const end = new Date(); end.setHours(eh,em,0);
        const isCurrent = now >= start && now <= end;
        return `<div class="schedule-item ${isCurrent?'current':''}">
          <div class="schedule-time">${p.startTime} - ${p.endTime}</div>
          <div class="schedule-details">
            <div class="schedule-subject">${p.subject||'—'}</div>
            <div class="schedule-meta">Class ${p.class||'—'} ${p.room?'· Room '+p.room:''}</div>
            <div class="schedule-actions">
               <button class="btn btn-sm btn-ghost" ${cspActionAttrs("goToAttendance", ['${p.class}'], "click", [], [])}><i class="fas fa-check"></i> Attendance</button>
               <button class="btn btn-sm btn-ghost" ${cspActionAttrs("goToHomework", ['${p.class}'], "click", [], [])}><i class="fas fa-book"></i> Homework</button>
               <button class="btn btn-sm btn-ghost" ${cspActionAttrs("goToStudents", ['${p.class}'], "click", [], [])}><i class="fas fa-users"></i> Students</button>
            </div>
          </div>
        </div>`;
      }).join('');
    }
    
    // Pending Tasks (Attendance)
    const attEl = document.getElementById('dashAttendancePending');
    if (d.attendancePending && d.attendancePending.length) {
      attEl.innerHTML = d.attendancePending.map(c => `
        <div class="csp-style-096172f7ad">
          <div><i class="fas fa-exclamation-circle csp-style-e0a9ce5e24" ></i> <span class="csp-style-6e8bcfac8d">Class ${c}</span></div>
          <button class="btn btn-primary btn-sm" ${cspActionAttrs("goToAttendance", ['${c}'], "click", [], [])}>Mark Now</button>
        </div>
      `).join('');
    } else {
      setEmptyState(attEl, 'check-circle', 'All Caught Up', 'No pending attendance.');
    }

    // Pending Tasks (Homework)
    const hwEl = document.getElementById('dashHomework');
    if (d.homeworkToReview > 0) {
      hwEl.innerHTML = `
        <div class="csp-style-0d33a98b76">
          <div><i class="fas fa-file-signature csp-style-bebff179ce" ></i> <span class="csp-style-6e8bcfac8d">${d.homeworkToReview} submissions to review</span></div>
          <button class="btn btn-secondary btn-sm" ${cspActionAttrs("showPanel", ['homework'], "click", [], [])}>Review</button>
        </div>
      `;
    } else {
      setEmptyState(hwEl, 'check-circle', 'All Caught Up', 'No homework to review.');
    }

    // Upcoming Exams
    const examEl = document.getElementById('dashExams');
    if (d.upcomingExams && d.upcomingExams.length) {
      examEl.innerHTML = d.upcomingExams.slice(0,3).map(ex => `
        <div class="csp-style-86f6692508">
           <div class="csp-style-e1fcb0b8d6">${ex.title}</div>
           <div class="csp-style-3020717a9c">Class ${ex.class} · ${formatDate(ex.date)}</div>
        </div>
      `).join('');
    } else {
      setEmptyState(examEl, 'coffee', 'No Exams', 'No upcoming exams.');
    }
    
  } catch(e) {}
}

window.goToAttendance = function(cls) {
  showPanel('attendance');
  const sel = document.getElementById('attClassSel');
  if(!sel.options.length) {
    sel.innerHTML = '<option value="">Select Class</option>' + _assignedClasses.map(c => `<option value="${c}">${c}</option>`).join('');
  }
  sel.value = cls;
  loadClassRosterForAttendance();
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
  if (sel && sel.options.length === 0) {
    sel.innerHTML = '<option value="">Select Class</option>' + _assignedClasses.map(c => `<option value="${c}">${c}</option>`).join('');
  }
}
window.loadClassRosterForAttendance = async function() {
  const cls = document.getElementById('attClassSel').value;
  const dt = document.getElementById('attDateSel').value;
  if (!cls || !dt) return;
  
  cspSetVisibility(document.getElementById('attEmptyState'), false);
  cspSetVisibility(document.getElementById('attSummaryWrap'), true, 'block');
  const list = document.getElementById('attStudentList');
  list.innerHTML = '<div class="spinner csp-style-7b66a9f734" ></div>';
  document.getElementById('btnSaveAttendance').disabled = true;
  
  try {
    const stuRes = await apiFetch(`/students/class/${cls}`);
    const students = stuRes.data || [];
    
    _attRoster = students.map(s => ({ id: s._id, name: s.name, roll: s.rollNumber, status: 'present' }));
    
    renderAttendanceList();
  } catch(e) { list.innerHTML = `<p class="csp-style-78c88c1078">${e.message}</p>`; }
};

function renderAttendanceList() {
  const list = document.getElementById('attStudentList');
  if (!_attRoster.length) { list.innerHTML = '<div class="empty-state csp-style-52be74ca43" >No students found in this class.</div>'; return; }
  
  list.innerHTML = _attRoster.map((s, idx) => `
    <div class="att-student-card">
      <div class="att-student-info">
        <div class="att-roll">${s.roll||'—'}</div>
        <div class="att-name">${s.name}</div>
      </div>
      <div class="att-radio-group">
        <button class="att-btn present ${s.status==='present'?'selected':''}" ${cspActionAttrs("setAtt", [idx, 'present'], "click", [], [])} title="Present">P</button>
        <button class="att-btn absent ${s.status==='absent'?'selected':''}" ${cspActionAttrs("setAtt", [idx, 'absent'], "click", [], [])} title="Absent">A</button>
        <button class="att-btn late ${s.status==='late'?'selected':''}" ${cspActionAttrs("setAtt", [idx, 'late'], "click", [], [])} title="Late">L</button>
      </div>
    </div>
  `).join('');
  
  document.getElementById('btnSaveAttendance').disabled = false;
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

window.saveAttendance = async function() {
  const cls = document.getElementById('attClassSel').value;
  const dt = document.getElementById('attDateSel').value;
  const btn = document.getElementById('btnSaveAttendance');
  
  const records = _attRoster.map(s => ({ student: s.id, status: s.status }));
  setButtonLoading(btn, true);
  try {
    await apiFetch('/attendance/mark', { method: 'POST', body: JSON.stringify({ class: cls, date: dt, records }) });
    toast.success('Saved', `Attendance for Class ${cls} saved successfully.`);
  } catch(e) { toast.error('Error', e.message); }
  finally { setButtonLoading(btn, false); }
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
  list.innerHTML = '<div class="spinner"></div>';
  try {
    const data = await apiFetch('/homework');
    const hw = data.data || [];
    if(!hw.length) { setEmptyState(list, 'book', 'No Homework', 'You have not assigned any homework.'); return; }
    
    list.innerHTML = hw.map(h => `
      <div class="card"><div class="card-body">
        <div class="csp-style-d49a73d24c">
          <div><span class="badge badge-info">${h.subject}</span> <span class="badge badge-secondary csp-style-d0acc76221" >Class ${h.class}</span></div>
          <span class="csp-style-3bdae21a61">Due: ${formatDate(h.dueDate)}</span>
        </div>
        <h4 class="csp-style-a1a0dcf46c">${h.title}</h4>
        <div class="csp-style-c1bd752291">
          <span class="csp-style-abc2a84190"><i class="fas fa-users csp-style-500708668c" ></i> Submissions</span>
          <button class="btn btn-secondary btn-sm">View</button>
        </div>
      </div></div>
    `).join('');
  } catch(e) {}
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
function loadMarksOpts() {
  const sel = document.getElementById('marksClass');
  if(sel && sel.options.length <= 1) sel.innerHTML += _assignedClasses.map(c => `<option value="${c}">${c}</option>`).join('');
}
window.updateMarksSubjectList = function() {
  document.getElementById('marksSubject').innerHTML = '<option value="">Subject</option><option value="Math">Math</option><option value="Science">Science</option><option value="English">English</option>';
};
let _marksRoster = [];
window.loadStudentsForMarks = async function() {
  const cls = document.getElementById('marksClass').value;
  const sub = document.getElementById('marksSubject').value;
  const ex = document.getElementById('marksExam').value;
  const mx = document.getElementById('marksMax').value;
  
  if(!cls||!sub||!ex||!mx) return toast.warning('Missing Filters', 'Select all filters to load sheet.');
  
  const tbody = document.getElementById('marksSheetBody');
  tbody.innerHTML = '<tr><td colspan="5"><div class="spinner"></div></td></tr>';
  
  try {
    const data = await apiFetch(`/students/class/${cls}`);
    _marksRoster = data.data || [];
    if(!_marksRoster.length) { tbody.innerHTML = '<tr><td colspan="5" class="empty-state">No students found.</td></tr>'; return; }
    
    tbody.innerHTML = _marksRoster.map((s,i) => `
      <tr>
        <td>${s.rollNumber||'—'}</td>
        <td class="csp-style-6e8bcfac8d">${s.name}</td>
        <td><input type="number" class="form-control csp-style-3a06261726" id="mo_${i}" max="${mx}" aria-label="Marks for ${s.name}" ${cspActionAttrs("calcGrade", [i], "input", [], [])}></td>
        <td><span id="mp_${i}" class="csp-style-3d2508e113">—</span></td>
        <td><span class="badge badge-secondary" id="mg_${i}">—</span></td>
      </tr>
    `).join('');
    document.getElementById('btnSaveMarks').disabled = false;
  } catch(e) {}
};
/* CBSE grading preview — matches backend Marks.js pre-save hook exactly */
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
  // CBSE scale — identical to backend pre-save hook
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

/* Save marks — POSTs to real API; backend re-calculates authoritative grade */
window.saveMarks = async function() {
  const btn = document.getElementById('btnSaveMarks');
  const cls = document.getElementById('marksClass').value;
  const sub = document.getElementById('marksSubject').value;
  const ex  = document.getElementById('marksExam').value;
  const mx  = parseFloat(document.getElementById('marksMax').value) || 100;
  if (!cls || !sub || !ex) return toast.warning('Missing', 'Select class, subject and exam first.');
  const entries = _marksRoster.map((s, i) => {
    const raw = document.getElementById(`mo_${i}`)?.value;
    if (raw === '' || raw === undefined) return null;
    return { student: s._id, marksObtained: parseFloat(raw) };
  }).filter(Boolean);
  if (!entries.length) return toast.warning('Nothing to Save', 'Enter at least one mark.');
  setButtonLoading(btn, true);
  let saved = 0, errors = 0;
  const ay = new Date().getFullYear() + '-' + (new Date().getFullYear() + 1);
  for (const entry of entries) {
    try {
      await apiFetch('/marks', {
        method: 'POST',
        body: JSON.stringify({
          student: entry.student, class: cls, examType: ex, academicYear: ay,
          subjects: [{ subject: sub, maxMarks: mx, marksObtained: entry.marksObtained }],
        }),
      });
      saved++;
    } catch(e) { errors++; }
  }
  setButtonLoading(btn, false);
  if (errors === 0) toast.success('Marks Saved', `${saved} entries saved. Grades calculated by server.`);
  else toast.warning('Partial Save', `${saved} saved, ${errors} failed.`);
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
    const data = await apiFetch(`/students/class/${cls}`);
    const stds = data.data || [];
    if(!stds.length) { setEmptyState(grid, 'users', 'No Students', ''); return; }
    
    grid.innerHTML = stds.map(s => `
      <div class="card"><div class="card-body csp-style-905008530c" >
        <div class="csp-style-79cdf138e7"><i class="fas fa-user"></i></div>
        <h4 class="csp-style-86bb53a601">${s.name}</h4>
        <div class="csp-style-fa9a12a5bf">Roll No. ${s.rollNumber||'—'} · Adm. ${s.admissionNumber||'—'}</div>
        <button class="btn btn-ghost btn-sm csp-style-092cb9d6a9" ><i class="fas fa-id-card"></i> View Profile</button>
      </div></div>
    `).join('');
  } catch(e) {}
};
