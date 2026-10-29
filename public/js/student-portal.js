/* ── Student Portal JS ── */
'use strict';

const STUDENT_NAV = [
  { label: 'Learning', items: [
    { icon: 'home', text: 'Dashboard', panel: 'dashboard' },
    { icon: 'clock', text: 'Timetable', panel: 'timetable' },
    { icon: 'book', text: 'Homework', panel: 'homework' },
    { icon: 'file-alt', text: 'Examinations', panel: 'exams' },
    { icon: 'chart-bar', text: 'My Results', panel: 'results' },
    { icon: 'rupee-sign', text: 'Fee Ledger', panel: 'fees' },
  ]},
  { label: 'School Life', items: [
    { icon: 'calendar-check', text: 'Attendance', panel: 'attendance' },
    { icon: 'book-open', text: 'Library', panel: 'library' },
    { icon: 'bus', text: 'Transport', panel: 'transport' },
    { icon: 'bullhorn', text: 'Notices', panel: 'notices' },
    { icon: 'calendar', text: 'Events', panel: 'events' },
  ]},
  { label: 'Account', items: [
    { icon: 'calendar-minus', text: 'My Leave', panel: 'leave' },
    { icon: 'bell', text: 'Notifications', panel: 'notifications' },
    { icon: 'user', text: 'My Profile', panel: 'profile' },
  ]},
];

let _studentData = null;
let _timetableData = null;
let _homeworkAll = [];
let _bookSearchTimer = null;

initPortal({
  role: 'student',
  expectedRoles: ['student'],
  navConfig: STUDENT_NAV,
  onDashboardLoad: loadStudentDashboard
});

// Register panel loaders
window.onPanel_timetable    = loadTimetable;
window.onPanel_homework     = loadHomework;
window.onPanel_exams        = loadExams;
window.onPanel_results      = loadMyResults;
window.onPanel_attendance   = loadMyAttendance;
window.onPanel_library      = loadMyBooks;
window.onPanel_transport    = loadMyTransport;
window.onPanel_notices      = loadNoticesFull;
window.onPanel_events       = loadEvents;
window.onPanel_leave        = loadMyLeaves;

window.onPanel_fees         = loadMyFees;

/* ── Dashboard ── */
async function loadStudentDashboard(user) {
  // Update welcome banner
  const firstName = user.name?.split(' ')[0] || 'Student';
  const av = document.getElementById('welcomeAvatar');
  if (av) av.textContent = getInitials(user.name);

  // Fetch dashboard data
  try {
    const data = await apiFetch('/dashboard/student');
    const d = data.data || {};
    _studentData = d;

    // Student meta (class, roll)
    const meta = document.getElementById('studentMeta');
    if (meta && d.student) {
      meta.textContent = `Class ${d.student.class || '—'} · Roll No. ${d.student.rollNumber || '—'} · Adm. ${d.student.admissionNumber || '—'}`;
    }

    // Alert banners
    renderAlertBanners(d);

    // Stats
    renderDashboardStats(d);

    // Next Class Widget
    const nextEl = document.getElementById('nextClassWidget');
    if (nextEl) {
        if (d.nextClass) {
            nextEl.innerHTML = `<div class="next-class-highlight">
                <p class="csp-style-2b9640530d">Next Class</p>
                <h3 class="csp-style-6ce1bae5ae">${d.nextClass.subject || '—'}</h3>
                <p class="csp-style-18adc8f2e9"><i class="fas fa-clock"></i> ${d.nextClass.startTime} - ${d.nextClass.endTime} &nbsp;&bull;&nbsp; <i class="fas fa-chalkboard-teacher"></i> ${d.nextClass.teacherName} &nbsp;&bull;&nbsp; <i class="fas fa-map-marker-alt"></i> Room ${d.nextClass.room || '—'}</p>
            </div>`;
        } else {
            nextEl.innerHTML = `<div class="next-class-highlight"><p class="csp-style-6b2a94ea3b">No more classes today! 🎉</p></div>`;
        }
    }

    // Today's timetable snippet
    loadTodayTimetableWidget(d);

    // Homework widget
    loadHomeworkWidget(d);

    // Upcoming exams widget
    loadExamsWidget(d);

    // Recent results widget
    loadResultsWidget(d);

    // Notices widget
    loadRecentNotices('dashNotices', 4);

  } catch (err) {
    document.getElementById('dashStats').innerHTML =
      `<div class="alert-banner warning"><i class="fas fa-exclamation-triangle"></i><div class="alert-banner-content"><strong>Dashboard Unavailable</strong>${err.message}</div></div>`;
  }
}

function renderAlertBanners(d) {
  const container = document.getElementById('alertBanners');
  if (!container) return;
  let html = '';

  if (d.feeStatus && d.feeStatus.pending > 0) {
    html += `<div class="alert-banner danger">
      <i class="fas fa-exclamation-circle"></i>
      <div class="alert-banner-content">
        <strong>Fee Payment Due</strong>
        ${formatCurrency(d.feeStatus.pending)} is outstanding. Please pay at the fee counter.
      </div>
      <button class="alert-dismiss btn-ghost btn-sm" ${cspActionAttrs("removeParent", [], "click", [], [])}><i class="fas fa-times"></i></button>
    </div>`;
  }

  if (d.attendancePct !== undefined && d.attendancePct < 75) {
    html += `<div class="alert-banner warning">
      <i class="fas fa-exclamation-triangle"></i>
      <div class="alert-banner-content">
        <strong>Low Attendance Warning</strong>
        Your attendance is ${d.attendancePct.toFixed(1)}%, which is below the required 75%.
      </div>
      <button class="alert-dismiss btn-ghost btn-sm" ${cspActionAttrs("removeParent", [], "click", [], [])}><i class="fas fa-times"></i></button>
    </div>`;
  }

  if (d.homeworkPending > 0) {
    html += `<div class="alert-banner info">
      <i class="fas fa-book"></i>
      <div class="alert-banner-content">
        <strong>${d.homeworkPending} Homework ${d.homeworkPending > 1 ? 'assignments' : 'assignment'} pending</strong>
        Check the Homework section for details.
      </div>
      <button class="alert-dismiss btn-ghost btn-sm" ${cspActionAttrs("removeParent", [], "click", [], [])}><i class="fas fa-times"></i></button>
    </div>`;
  }

  container.innerHTML = html;
}

function renderDashboardStats(d) {
  const grid = document.getElementById('dashStats');
  if (!grid) return;

  const att = d.attendancePct !== undefined ? d.attendancePct.toFixed(1) + '%' : '—';
  const attColor = (d.attendancePct || 0) >= 75 ? 'success' : 'danger';

  grid.innerHTML = `
    <div class="stat-card ${attColor}">
      <div class="stat-icon ${attColor}"><i class="fas fa-calendar-check"></i></div>
      <div class="stat-content">
        <div class="stat-value">${att}</div>
        <div class="stat-label">This Month's Attendance</div>
      </div>
    </div>
    <div class="stat-card warning">
      <div class="stat-icon warning"><i class="fas fa-book"></i></div>
      <div class="stat-content">
        <div class="stat-value">${d.homeworkPending ?? '—'}</div>
        <div class="stat-label">Homework Pending</div>
      </div>
    </div>
    <div class="stat-card info">
      <div class="stat-icon info"><i class="fas fa-file-alt"></i></div>
      <div class="stat-content">
        <div class="stat-value">${d.upcomingExams ?? '—'}</div>
        <div class="stat-label">Upcoming Exams</div>
      </div>
    </div>
    <div class="stat-card purple">
      <div class="stat-icon purple"><i class="fas fa-book-open"></i></div>
      <div class="stat-content">
        <div class="stat-value">${d.booksIssued ?? '0'}</div>
        <div class="stat-label">Books Issued</div>
      </div>
    </div>
  `;
}

function loadTodayTimetableWidget(d) {
  const el = document.getElementById('todayTimetable');
  const badge = document.getElementById('todayDayBadge');
  const today = getTodayDayName();
  if (badge) badge.textContent = today;

  const periods = (d.todaysSchedule || []);
  if (!periods.length) {
    setEmptyState(el, 'calendar-day', 'No Classes Today', 'Enjoy your free day!');
    return;
  }

  const now = new Date();
  el.innerHTML = `<div class="schedule-list">` + periods.map(p => {
    const [sh, sm] = (p.startTime || '00:00').split(':').map(Number);
    const [eh, em] = (p.endTime || '00:00').split(':').map(Number);
    const isCurrent = now.getHours() >= sh && (now.getHours() < eh || (now.getHours() === eh && now.getMinutes() <= em));
    const isPast = now.getHours() > eh || (now.getHours() === eh && now.getMinutes() > em);
    return `<div class="schedule-item ${isCurrent ? 'current' : isPast ? 'past' : ''}">
      <span class="schedule-time">${p.startTime} – ${p.endTime}</span>
      <span class="schedule-dot"></span>
      <div>
        <div class="schedule-subject">${p.subject || 'Free Period'}</div>
        <div class="schedule-meta">${p.teacherName ? 'By ' + p.teacherName : ''} ${p.room ? '· Room ' + p.room : ''}</div>
      </div>
      ${isCurrent ? '<span class="badge badge-teal csp-style-ca6fc035af" >Now</span>' : ''}
    </div>`;
  }).join('') + `</div>`;
}

function loadHomeworkWidget(d) {
  const el = document.getElementById('dashHomework');
  const hw = (d.pendingHomework || []).slice(0, 5);
  if (!hw.length) {
    setEmptyState(el, 'check-circle', 'All caught up!', 'No pending homework. Keep it up! 🎉');
    return;
  }
  el.innerHTML = hw.map(h => {
    const due = new Date(h.dueDate);
    const isOverdue = due < new Date();
    return `<div class="csp-style-cfb951fb32">
      <span class="badge ${isOverdue ? 'badge-danger' : 'badge-warning'} csp-style-85850cc31c" >${h.subject||'General'}</span>
      <div class="csp-style-286372957b">
        <div class="csp-style-497b459502">${h.title}</div>
      <div class="homework-due-date ${isOverdue ? 'text-danger' : 'text-muted'}">${isOverdue ? '⚠ Overdue · ' : ''}Due ${formatDate(h.dueDate)}</div>
      </div>
    </div>`;
  }).join('') + `<div class="csp-style-7781fa7669"><button class="btn btn-ghost btn-sm" ${cspActionAttrs("showPanel", ['homework'], "click", [], [])}>View All <i class="fas fa-arrow-right"></i></button></div>`;
}

function loadExamsWidget(d) {
  const el = document.getElementById('dashExams');
  const exams = (d.upcomingExamsList || []).slice(0, 3);
  if (!exams.length) {
    setEmptyState(el, 'file-alt', 'No Upcoming Exams', 'Sit back and relax!');
    return;
  }
  el.innerHTML = exams.map(ex => `
    <div class="csp-style-4ead2ae2ed">
      <div class="csp-style-1ea921a288">
        <div class="csp-style-8f21177085">${new Date(ex.date).getDate()}</div>
        <div class="csp-style-269e5f225a">${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][new Date(ex.date).getMonth()]}</div>
      </div>
      <div>
        <div class="csp-style-57fea97081">${ex.subject||ex.name}</div>
        <div class="csp-style-35374e0094">${ex.examType||''} · ${daysUntil(ex.date)}</div>
      </div>
    </div>`).join('');
}

function loadResultsWidget(d) {
  const el = document.getElementById('dashResults');
  const results = (d.recentResults || []).slice(0, 3);
  if (!results.length) {
    setEmptyState(el, 'chart-bar', 'No Results Yet', 'Results will appear here after exams.');
    return;
  }
  el.innerHTML = results.map(r => {
    const pct = r.maxMarks > 0 ? Math.round(r.marksObtained / r.maxMarks * 100) : 0;
    const gradeColor = pct >= 90 ? 'success' : pct >= 75 ? 'info' : pct >= 60 ? 'warning' : 'danger';
    return `<div class="csp-style-4ead2ae2ed">
      <div class="stat-icon ${gradeColor} csp-style-5efcd9d910" >${r.grade||'—'}</div>
      <div class="csp-style-83725d2c6e">
        <div class="csp-style-02a3c7300a">${r.subject}</div>
        <div class="csp-style-35374e0094">${r.marksObtained}/${r.maxMarks} · ${pct}%</div>
      </div>
    </div>`;
  }).join('');
}

/* ── Timetable ── */
async function loadTimetable() {
  const content = document.getElementById('timetableContent');
  const tabs = document.getElementById('timetableDayTabs');
  if (!content) return;
  content.innerHTML = '<div class="spinner csp-style-c4b102f94c" ></div>';

  try {
    const data = await apiFetch('/timetable/my-timetable');
    _timetableData = data.data || {};
    const days = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    const today = getTodayDayName();

    // Build day tabs
    tabs.innerHTML = days.map(d =>
      `<button class="tab-btn ${d===today?'active':''}" ${cspActionAttrs("showTimetableDay", ['${d}'], "click", [1], [])}>${d.slice(0,3)}</button>`
    ).join('');

    showTimetableDay(today, tabs.querySelector('.active'));
  } catch (err) {
    setEmptyState(content, 'clock', 'Timetable Unavailable', err.message);
  }
}

window.showTimetableDay = function(day, btn) {
  if (btn) {
    document.querySelectorAll('#timetableDayTabs .tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  }
  const content = document.getElementById('timetableContent');
  const periods = (_timetableData[day] || []);
  if (!periods.length) {
    setEmptyState(content, 'coffee', 'No Classes', `No periods scheduled for ${day}.`);
    return;
  }

  const now = new Date();
  const isToday = day === getTodayDayName();

  content.innerHTML = `<div class="schedule-list">` + periods.map(p => {
    const [sh] = (p.startTime||'0:0').split(':').map(Number);
    const [eh] = (p.endTime||'0:0').split(':').map(Number);
    const isCurrent = isToday && now.getHours() >= sh && now.getHours() < eh;
    const isPast = isToday && now.getHours() >= eh;
    return `<div class="schedule-item ${isCurrent?'current':isPast?'past':''}">
      <span class="schedule-time">${p.startTime} – ${p.endTime}</span>
      <span class="schedule-dot"></span>
      <div>
        <div class="schedule-subject">${p.subject||'—'}</div>
        <div class="schedule-meta">${p.teacher?'By '+p.teacher:''} ${p.room?'· Room '+p.room:''}</div>
      </div>
      ${isCurrent ? '<span class="badge badge-teal csp-style-ca6fc035af" >Now</span>' : ''}
    </div>`;
  }).join('') + `</div>`;
};

/* ── Homework ── */
async function loadHomework() {
  const list = document.getElementById('homeworkList');
  if (!list) return;
  list.innerHTML = '<div class="skeleton-card"></div><div class="skeleton-card"></div><div class="skeleton-card"></div>';

  try {
    const data = await apiFetch('/homework/my-homework');
    _homeworkAll = data.data || data.homework || [];
    renderHomeworkList(_homeworkAll);
  } catch (err) {
    setEmptyState(list, 'book', 'Could not load homework', err.message);
  }
}

function filterHomework() {
  const sub = document.getElementById('hwSubjectFilter')?.value || '';
  const status = document.getElementById('hwStatusFilter')?.value || '';
  let filtered = _homeworkAll;
  if (sub)    filtered = filtered.filter(h => h.subject === sub);
  if (status) filtered = filtered.filter(h => (h.status||'pending') === status);
  renderHomeworkList(filtered);
}

function renderHomeworkList(items) {
  const list = document.getElementById('homeworkList');
  if (!items.length) {
    setEmptyState(list, 'check-circle', 'No Homework Found', 'Enjoy your free time! 📚');
    return;
  }

  // Populate subject filter
  const subjects = [...new Set(items.map(h=>h.subject).filter(Boolean))];
  const subSel = document.getElementById('hwSubjectFilter');
  if (subSel && subSel.options.length <= 1) {
    subjects.forEach(s => { const o = new Option(s,s); subSel.add(o); });
  }

  list.innerHTML = items.map(h => {
    const isOverdue = new Date(h.dueDate) < new Date() && (h.status||'pending') === 'pending';
    const statusCls = h.status === 'submitted' ? 'badge-success' : isOverdue ? 'badge-danger' : 'badge-warning';
    const statusText = h.status === 'submitted' ? 'Submitted' : isOverdue ? 'Overdue' : 'Pending';
    return `<div class="card homework-card">
      <div class="card-body">
        <div class="csp-style-407bb517cb">
          <div>
            <span class="badge badge-info csp-style-2867b51660" >${h.subject||'General'}</span>
            <h4 class="csp-style-a1a0dcf46c">${h.title}</h4>
            ${h.description ? `<p class="csp-style-3e5a7aab34">${h.description}</p>` : ''}
          </div>
          <span class="badge ${statusCls}">${statusText}</span>
        </div>
        <div class="csp-style-38befa3929">
          <div class="homework-due-date ${isOverdue ? 'text-danger' : 'text-muted'}">
            <i class="fas fa-calendar-day"></i> Due: ${formatDate(h.dueDate)}
            ${h.teacher ? ` · <i class="fas fa-chalkboard-teacher"></i> ${h.teacher}` : ''}
          </div>
          ${(h.status||'pending') === 'pending' ? `<button class="btn btn-primary btn-sm" ${cspActionAttrs("submitHomework", ['${h._id}'], "click", [], [])}><i class="fas fa-upload"></i> Submit</button>` : ''}
        </div>
      </div>
    </div>`;
  }).join('');
}

window.submitHomework = async function(id) {
  toast.info('Submission', 'Homework submission is being processed...');
  try {
    await apiFetch(`/homework/${id}/submit`, { method: 'PATCH' });
    toast.success('Submitted!', 'Your homework has been marked as submitted.');
    loadHomework();
  } catch (err) {
    toast.error('Failed', err.message);
  }
};

/* ── Exams ── */
async function loadExams() {
  const upEl = document.getElementById('upcomingExamsList');
  const pastEl = document.getElementById('pastExamsList');
  upEl.innerHTML = '<div class="spinner csp-style-c4b102f94c" ></div>';

  try {
    const data = await apiFetch('/exams/upcoming');
    const all = data.data || data.exams || [];
    const now = new Date();
    const upcoming = all.filter(e => new Date(e.date) >= now);
    const past = all.filter(e => new Date(e.date) < now);

    renderExamList(upEl, upcoming, false);
    renderExamList(pastEl, past, true);
  } catch (err) {
    setEmptyState(upEl, 'file-alt', 'Could not load exams', err.message);
  }
}

function renderExamList(el, items, isPast) {
  if (!items.length) {
    setEmptyState(el, 'check-circle', isPast ? 'No Past Exams' : 'No Upcoming Exams', isPast ? '' : 'Great! No exams coming up.');
    return;
  }
  el.innerHTML = items.map(ex => {
    const d = daysUntil(ex.date);
    return `<div class="card">
      <div class="card-body csp-style-08b2dfc6e6" >
        <div class="csp-style-707acca9c9">
          <div class="csp-style-a8f751c918">${new Date(ex.date).getDate()}</div>
          <div class="csp-style-a46b5f5398">${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][new Date(ex.date).getMonth()]}</div>
        </div>
        <div class="csp-style-83725d2c6e">
          <div class="csp-style-a1a0dcf46c">${ex.subject||ex.name}</div>
          <div class="csp-style-d8d87b1b9d">
            ${ex.examType||''} ${ex.examType&&ex.syllabus?' · ':''} ${ex.syllabus||''}
          </div>
        </div>
        ${!isPast ? `<span class="badge badge-info">${d}</span>` : `<span class="badge badge-secondary">Done</span>`}
      </div>
    </div>`;
  }).join('');
}

window.switchExamTab = function(tab, btn) {
  document.querySelectorAll('#panel-exams .tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('#panel-exams .tab-panel').forEach(p => p.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('exams-' + tab)?.classList.add('active');
};

/* ── Results ── */
async function loadMyResults() {
  const el = document.getElementById('resultsContent');
  if (!el) return;
  el.innerHTML = '<div class="spinner csp-style-c4b102f94c" ></div>';

  const examType = document.getElementById('resultExamFilter')?.value || '';
  try {
    const data = await apiFetch('/marks/my-marks' + (examType ? `?examType=${encodeURIComponent(examType)}` : ''));
    const marks = data.data || data.marks || [];

    if (!marks.length) {
      setEmptyState(el, 'chart-bar', 'No Results Yet', 'Results will be published here after exams are assessed.');
      return;
    }

    const total = marks.reduce((s, m) => s + (m.maxMarks||0), 0);
    const obtained = marks.reduce((s, m) => s + (m.marksObtained||0), 0);
    const pct = total > 0 ? (obtained/total*100).toFixed(1) : 0;

    el.innerHTML = `
      <div class="stat-card primary csp-style-e7e3e005bf" >
        <div class="stat-icon primary"><i class="fas fa-trophy"></i></div>
        <div class="stat-content">
          <div class="stat-value">${pct}%</div>
          <div class="stat-label">Overall · ${obtained}/${total} marks</div>
        </div>
      </div>
      <div class="card">
        <div class="table-wrapper">
          <table class="data-table">
            <thead><tr><th>Subject</th><th>Max Marks</th><th>Obtained</th><th>Percentage</th><th>Grade</th></tr></thead>
            <tbody>${marks.map(m => {
              const p = m.maxMarks > 0 ? (m.marksObtained/m.maxMarks*100).toFixed(1) : '0.0';
              const g = m.grade || getGrade(parseFloat(p));
              const gcls = parseFloat(p) >= 90 ? 'badge-success' : parseFloat(p) >= 75 ? 'badge-info' : parseFloat(p) >= 60 ? 'badge-warning' : 'badge-danger';
              return `<tr>
                <td class="csp-style-6e8bcfac8d">${m.subject||'—'}</td>
                <td>${m.maxMarks}</td>
                <td class="csp-style-c6fa01b3f1">${m.marksObtained}</td>
                <td>${p}%</td>
                <td><span class="badge ${gcls}">${g}</span></td>
              </tr>`;
            }).join('')}</tbody>
          </table>
        </div>
      </div>`;
  } catch (err) {
    setEmptyState(el, 'chart-bar', 'Could not load results', err.message);
  }
}

function getGrade(pct) {
  if (pct >= 90) return 'A+';
  if (pct >= 80) return 'A';
  if (pct >= 70) return 'B+';
  if (pct >= 60) return 'B';
  if (pct >= 50) return 'C';
  return 'F';
}

/* ── Attendance ── */
async function loadMyAttendance() {
  const sel = document.getElementById('attMonthSel');
  const statsEl = document.getElementById('attStats');
  const calEl = document.getElementById('attCalendar');

  // Populate month selector if empty
  if (sel && sel.options.length === 0) {
    const now = new Date();
    for (let i = 0; i < 12; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const val = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
      const label = d.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
      sel.add(new Option(label, val));
    }
  }

  const [year, month] = (sel?.value || `${new Date().getFullYear()}-${String(new Date().getMonth()+1).padStart(2,'0')}`).split('-').map(Number);
  calEl.innerHTML = '<div class="spinner csp-style-c4b102f94c" ></div>';

  try {
    const data = await apiFetch(`/attendance/my-monthly?year=${year}&month=${month}`);
    const rec = data.data || {};
    const days = rec.records || rec.attendance || [];

    // Stats
    const present = days.filter(d => d.status === 'present').length;
    const absent  = days.filter(d => d.status === 'absent').length;
    const late    = days.filter(d => d.status === 'late').length;
    const total   = days.length;
    const pct     = total > 0 ? (present/total*100).toFixed(1) : '—';

    statsEl.innerHTML = `
      <div class="stat-card success"><div class="stat-icon success"><i class="fas fa-check"></i></div><div class="stat-content"><div class="stat-value">${pct}%</div><div class="stat-label">Attendance</div></div></div>
      <div class="stat-card success"><div class="stat-icon success"><i class="fas fa-user-check"></i></div><div class="stat-content"><div class="stat-value">${present}</div><div class="stat-label">Present</div></div></div>
      <div class="stat-card danger"><div class="stat-icon danger"><i class="fas fa-user-times"></i></div><div class="stat-content"><div class="stat-value">${absent}</div><div class="stat-label">Absent</div></div></div>
      <div class="stat-card warning"><div class="stat-icon warning"><i class="fas fa-clock"></i></div><div class="stat-content"><div class="stat-value">${late}</div><div class="stat-label">Late</div></div></div>`;

    // Calendar grid
    renderAttCalendar(calEl, year, month, days);

  } catch (err) {
    setEmptyState(calEl, 'calendar', 'Attendance data unavailable', err.message);
    statsEl.innerHTML = '';
  }
}

function renderAttCalendar(el, year, month, records) {
  const dayMap = {};
  records.forEach(r => {
    const d = new Date(r.date);
    dayMap[d.getDate()] = r.status;
  });

  const first = new Date(year, month - 1, 1);
  const lastDay = new Date(year, month, 0).getDate();
  let startWd = first.getDay(); // 0=Sun
  if (startWd === 0) startWd = 7; // treat Sunday as 7 for Mon-start calendar
  startWd -= 1; // 0-indexed from Monday


  let html = `<div class="attendance-calendar">`;
  ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].forEach(d =>
    html += `<div class="attendance-calendar-weekday">${d}</div>`
  );
  for (let i = 0; i < startWd; i++) html += `<div></div>`;
  for (let d = 1; d <= lastDay; d++) {
    const st = dayMap[d];
    html += `<div class="attendance-calendar-day attendance-calendar-day--${st || 'unmarked'}" title="${st||'—'}">${d}</div>`;
  }
  html += `</div>
    <div class="attendance-calendar-legend">
      <span><span class="attendance-calendar-key attendance-calendar-key--present"></span>Present</span>
      <span><span class="attendance-calendar-key attendance-calendar-key--absent"></span>Absent</span>
      <span><span class="attendance-calendar-key attendance-calendar-key--late"></span>Late</span>
    </div>`;
  el.innerHTML = html;
}

/* ── Library ── */
async function loadMyBooks() {
  const el = document.getElementById('myBooksContent');
  if (!el) return;
  el.innerHTML = '<div class="spinner csp-style-cbac136be3" ></div>';

  try {
    const data = await apiFetch('/library/my-books');
    const books = data.data || data.books || [];

    if (!books.length) {
      setEmptyState(el, 'book-open', 'No Books Issued', 'You have no books currently issued from the library.');
      return;
    }

    el.innerHTML = `<h4 class="csp-style-68f37cd999">My Issued Books (${books.length})</h4>
      <div class="card">
        <div class="table-wrapper">
          <table class="data-table">
            <thead><tr><th>Book Title</th><th>Author</th><th>Issued On</th><th>Due Date</th><th>Status</th></tr></thead>
            <tbody>${books.map(b => {
              const isOverdue = new Date(b.dueDate) < new Date();
              const daysOverdue = isOverdue ? Math.floor((new Date() - new Date(b.dueDate))/86400000) : 0;
              return `<tr>
                <td class="csp-style-6e8bcfac8d">${b.book?.title || b.title || '—'}</td>
                <td>${b.book?.author || b.author || '—'}</td>
                <td>${formatDate(b.issuedDate || b.createdAt)}</td>
                <td>${formatDate(b.dueDate)}</td>
                <td>${isOverdue
                  ? `<span class="badge badge-danger">Overdue ${daysOverdue}d</span>`
                  : `<span class="badge badge-success">Active</span>`}</td>
              </tr>`;
            }).join('')}</tbody>
          </table>
        </div>
      </div>`;
  } catch (err) {
    setEmptyState(el, 'book-open', 'Library data unavailable', err.message);
  }
}

function searchBooksDebounced() {
  clearTimeout(_bookSearchTimer);
  _bookSearchTimer = setTimeout(searchBooks, 400);
}

async function searchBooks() {
  const q = document.getElementById('bookSearchInput')?.value.trim();
  const el = document.getElementById('bookSearchResults');
  if (!el) return;
  if (!q || q.length < 2) { el.innerHTML = ''; return; }

  el.innerHTML = '<div class="spinner csp-style-2ebb0dfa7c" ></div>';
  try {
    const data = await apiFetch(`/library/books?search=${encodeURIComponent(q)}&limit=10`);
    const books = data.data || data.books || [];
    if (!books.length) { setEmptyState(el, 'search', 'No Books Found', `No books matching "${q}".`); return; }

    el.innerHTML = `<div class="card"><div class="table-wrapper"><table class="data-table">
      <thead><tr><th>Title</th><th>Author</th><th>Category</th><th>Available</th></tr></thead>
      <tbody>${books.map(b => `<tr>
        <td class="csp-style-6e8bcfac8d">${b.title}</td>
        <td>${b.author||'—'}</td>
        <td>${b.category||'—'}</td>
        <td>${b.availableCopies > 0
          ? `<span class="badge badge-success">${b.availableCopies} available</span>`
          : `<span class="badge badge-danger">Not available</span>`}</td>
      </tr>`).join('')}</tbody>
    </table></div></div>`;
  } catch (err) {
    el.innerHTML = `<p class="csp-style-f3dff4b30f">${err.message}</p>`;
  }
}

/* ── Transport ── */
async function loadMyTransport() {
  const el = document.getElementById('transportContent');
  if (!el) return;
  el.innerHTML = '<div class="spinner csp-style-c4b102f94c" ></div>';

  try {
    const data = await apiFetch('/transport/my-transport');
    const t = data.data || data.transport;
    if (!t) { setEmptyState(el, 'bus', 'No Transport Assigned', 'You are not assigned to any school bus route.'); return; }

    el.innerHTML = `<div class="csp-style-89c25a0344">
      <div class="stat-card info">
        <div class="stat-icon info"><i class="fas fa-bus"></i></div>
        <div class="stat-content"><div class="stat-value">${t.busNumber||'—'}</div><div class="stat-label">Bus Number</div></div>
      </div>
      <div class="stat-card primary">
        <div class="stat-icon primary"><i class="fas fa-route"></i></div>
        <div class="stat-content"><div class="stat-value">${t.route?.name||t.routeName||'—'}</div><div class="stat-label">Route</div></div>
      </div>
      <div class="stat-card teal">
        <div class="stat-icon teal"><i class="fas fa-map-marker-alt"></i></div>
        <div class="stat-content"><div class="stat-value">${t.pickupStop||t.stop||'—'}</div><div class="stat-label">Pickup Stop</div></div>
      </div>
      <div class="stat-card warning">
        <div class="stat-icon warning"><i class="fas fa-clock"></i></div>
        <div class="stat-content"><div class="stat-value">${t.pickupTime||'—'}</div><div class="stat-label">Pickup Time</div></div>
      </div>
    </div>
    ${t.driver ? `<div class="card csp-style-66e6b652a6" ><div class="card-body"><h4 class="csp-style-ce14cdaf2d">Driver Details</h4>
    <p><i class="fas fa-user csp-style-bb6cacc0ad" ></i> ${t.driver.name||t.driverName||'—'}</p>
    <p class="csp-style-4cb9fdd117"><i class="fas fa-phone csp-style-bb6cacc0ad" ></i> ${t.driver.phone||t.driverPhone||'—'}</p>
    </div></div>` : ''}`;
  } catch (err) {
    setEmptyState(el, 'bus', 'Transport data unavailable', err.message);
  }
}

/* ── Notices ── */
async function loadNoticesFull() {
  const el = document.getElementById('noticesList');
  if (!el) return;
  el.innerHTML = '<div class="skeleton-card"></div><div class="skeleton-card"></div>';
  const type = document.getElementById('noticeTypeFilter')?.value || '';

  try {
    const data = await apiFetch(`/notices?limit=30${type ? '&type='+encodeURIComponent(type) : ''}`);
    const notices = data.data || data.notices || [];

    if (!notices.length) { setEmptyState(el, 'bullhorn', 'No Notices', 'No notices have been posted.'); return; }

    el.innerHTML = notices.map(n => {
      const pBadge = { High:'danger', Urgent:'danger', Low:'secondary', Medium:'info' }[n.priority] || 'info';
      return `<div class="card">
        <div class="card-body">
          <div class="csp-style-fbcd02feea">
            <span class="badge badge-${pBadge}">${n.type||'General'}</span>
            ${n.priority === 'High' || n.priority === 'Urgent' ? '<span class="badge badge-danger">Urgent</span>' : ''}
          </div>
          <h4 class="csp-style-fb324771ea">${n.title}</h4>
          <p class="csp-style-959c8e995c">${n.content||''}</p>
          <p class="csp-style-7465dab738"><i class="fas fa-calendar"></i> ${formatDate(n.createdAt)}</p>
        </div>
      </div>`;
    }).join('');
  } catch (err) {
    setEmptyState(el, 'bullhorn', 'Could not load notices', err.message);
  }
}

/* ── Events ── */
async function loadEvents() {
  const el = document.getElementById('eventsList');
  if (!el) return;
  el.innerHTML = '<div class="skeleton-card"></div><div class="skeleton-card"></div>';
  try {
    const data = await apiFetch('/events?limit=20');
    const events = data.data || data.events || [];
    if (!events.length) { setEmptyState(el, 'calendar', 'No Upcoming Events', 'Check back later for events.'); return; }
    el.innerHTML = events.map(ev => `
      <div class="card">
        <div class="card-body">
          <div class="csp-style-454ef66de1">
            <div class="csp-style-25414abebd">
              <div class="csp-style-34ef9b68d3">${new Date(ev.date||ev.startDate).getDate()}</div>
              <div class="csp-style-269e5f225a">${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][new Date(ev.date||ev.startDate).getMonth()]}</div>
            </div>
            <div>
              <h4 class="csp-style-2c632898ef">${ev.title}</h4>
              <p class="csp-style-d8d87b1b9d">${ev.description||''}</p>
              ${ev.location ? `<p class="csp-style-cb16392b3b"><i class="fas fa-map-marker-alt"></i> ${ev.location}</p>` : ''}
            </div>
          </div>
        </div>
      </div>`).join('');
  } catch (err) {
    setEmptyState(el, 'calendar', 'Could not load events', err.message);
  }
}

/* ── Leave ── */
async function loadMyLeaves() {
  const tbody = document.getElementById('leaveTableBody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="6"><div class="spinner csp-style-cbac136be3" ></div></td></tr>';
  try {
    const data = await apiFetch('/leaves/my-leaves');
    const leaves = data.data || data.leaves || [];
    if (!leaves.length) {
      tbody.innerHTML = `<tr><td colspan="6"><div class="empty-state"><i class="fas fa-calendar-minus"></i><h4>No Leave Requests</h4><p>You haven't applied for any leave.</p></div></td></tr>`;
      return;
    }
    tbody.innerHTML = leaves.map(l => {
      const sc = { Approved:'badge-success', Rejected:'badge-danger', Pending:'badge-warning' }[l.status] || 'badge-secondary';
      return `<tr>
        <td>${formatDate(l.fromDate)}</td>
        <td>${formatDate(l.toDate)}</td>
        <td>${l.leaveType||'—'}</td>
        <td class="csp-style-749cb1d3cf">${l.reason||'—'}</td>
        <td><span class="badge ${sc}">${l.status||'Pending'}</span></td>
        <td>${formatDate(l.createdAt)}</td>
      </tr>`;
    }).join('');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="6" class="csp-style-650c81a9d9">${err.message}</td></tr>`;
  }
}

async function submitLeaveApplication() {
  const fromDate = document.getElementById('leaveFrom')?.value;
  const toDate   = document.getElementById('leaveTo')?.value;
  const leaveType = document.getElementById('leaveType')?.value;
  const reason   = document.getElementById('leaveReason')?.value.trim();
  const btn = document.getElementById('submitLeaveBtn');

  if (!fromDate || !toDate || !reason) return toast.warning('Required', 'Please fill all required fields.');
  if (new Date(toDate) < new Date(fromDate)) return toast.warning('Invalid Dates', 'To date must be after from date.');

  setButtonLoading(btn, true);
  try {
    await apiFetch('/leaves', { method: 'POST', body: JSON.stringify({ fromDate, toDate, leaveType, reason }) });
    toast.success('Leave Applied', 'Your leave request has been submitted for approval.');
    closeModal('applyLeaveModal');
    document.getElementById('leaveFrom').value = '';
    document.getElementById('leaveTo').value = '';
    document.getElementById('leaveReason').value = '';
    loadMyLeaves();
  } catch (err) {
    toast.error('Submission Failed', err.message);
  } finally {
    setButtonLoading(btn, false);
  }
}

async function loadMyFees() {
  const el = document.getElementById('feesContent');
  if (!el) return;
  el.innerHTML = '<div class="spinner csp-style-c4b102f94c" ></div>';
  try {
    const data = await apiFetch('/fees/my-fees');
    const fees = data.data || [];
    if (!fees.length) {
      setEmptyState(el, 'check-circle', 'All Clear!', 'No fees are currently due.');
      return;
    }
    el.innerHTML = `<div class="card"><div class="table-wrapper"><table class="data-table"><thead><tr><th>Fee Type</th><th>Amount</th><th>Status</th><th>Due Date</th></tr></thead><tbody>${fees.map(f => `<tr><td class="csp-style-6e8bcfac8d">${f.feeType || '—'}</td><td>${formatCurrency(f.amount || 0)}</td><td><span class="badge ${f.status === 'Paid' ? 'badge-success' : 'badge-danger'}">${f.status || 'Pending'}</span></td><td>${formatDate(f.dueDate)}</td></tr>`).join('')}</tbody></table></div></div>`;
  } catch (err) {
    setEmptyState(el, 'rupee-sign', 'Could not load fees', err.message);
  }
}
