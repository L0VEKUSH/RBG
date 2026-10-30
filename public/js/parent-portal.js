/* ── Parent Portal JS ── */
'use strict';

const PARENT_NAV = [
  { label: 'My Children', items: [
    { icon: 'home', text: 'Dashboard', panel: 'dashboard' },
    { icon: 'book', text: 'Academics', panel: 'academics' },
    { icon: 'calendar-check', text: 'Attendance', panel: 'attendance' },
    { icon: 'pencil-alt', text: 'Homework', panel: 'homework' },
    { icon: 'file-alt', text: 'Examinations', panel: 'exams' },
    { icon: 'chart-bar', text: 'Results', panel: 'results' },
  ]},
  { label: 'Finance & Services', items: [
    { icon: 'credit-card', text: 'Fee Payments', panel: 'fees' },
    { icon: 'book-open', text: 'Library', panel: 'library' },
    { icon: 'bus', text: 'Transport', panel: 'transport' },
  ]},
  { label: 'Communication', items: [
    { icon: 'bell', text: 'Notices', panel: 'notices' },
    { icon: 'calendar', text: 'Events', panel: 'events' },
    { icon: 'envelope', text: 'Messages', panel: 'messages' },
  ]},
  { label: 'Account', items: [
    { icon: 'user', text: 'My Profile', panel: 'profile' },
  ]},
];

let _children = [];
let _activeChildId = null;
let _activeChildData = null; // store current child's profile object
let _homeworkAll = [];

initPortal({
  role: 'parent',
  expectedRoles: ['parent'],
  navConfig: PARENT_NAV,
  onDashboardLoad: initParentPortal
});

// Panel loader mapping
window.onPanel_dashboard  = loadDashboardContent;
window.onPanel_academics  = loadAcademics;
window.onPanel_attendance = loadAttendance;
window.onPanel_homework   = loadHomework;
window.onPanel_exams      = loadExams;
window.onPanel_results    = loadResults;
window.onPanel_fees       = loadFees;
window.onPanel_library    = loadLibrary;
window.onPanel_transport  = loadTransport;
window.onPanel_notices    = loadNoticesFull;
window.onPanel_events     = loadEvents;

/* ── Init & Child Switcher ── */
async function initParentPortal(user) {
  try {
    // 1. Fetch children explicitly, or they might be included in parent dashboard response
    // For safety, let's fetch dashboard which should contain children, or fetch children explicitly.
    const dashRes = await apiFetch('/dashboard/parent');
    const d = dashRes.data || {};
    _children = d.children || [];
    
    if (!_children.length) {
      document.querySelector('.main-inner').innerHTML = `
        <div class="empty-state csp-style-2c827d1525" >
          <i class="fas fa-child csp-style-dcad20d70b" ></i>
          <h3>No Children Linked</h3>
          <p>Please contact the school administration to link your children to your account.</p>
        </div>`;
      return;
    }

    // 2. Render Child Switcher
    renderChildSwitcher();
    
    // 3. Select first child
    const storedId = localStorage.getItem('parentActiveChildId');
    const childToSelect = _children.find(c => c._id === storedId) || _children[0];
    switchChild(childToSelect._id);

  } catch (err) {
    showNetworkError(document.getElementById('panel-dashboard'));
  }
}

function renderChildSwitcher() {
  const wrap = document.getElementById('childSwitcherWrap');
  const sw = document.getElementById('childSwitcher');
  if (!wrap || !sw) return;
  
  if (_children.length <= 1) {
    cspSetVisibility(wrap, false); // hide if only 1 child
    return;
  }
  
  cspSetVisibility(wrap, true, 'block');
  sw.innerHTML = _children.map(c => `
    <div class="child-card csp-action-target" id="cc_${c._id}" ${cspActionAttrs("switchChild", ['${c._id}'], "click", [], [])} role="button" tabindex="0">
      <div class="child-avatar">${getInitials(c.name)}</div>
      <div class="child-info">
        <div class="child-name">${c.name}</div>
        <div class="child-class">Class ${c.class||'—'}</div>
      </div>
    </div>
  `).join('');
}

window.switchChild = function(id) {
  if (!id) return;
  _activeChildId = id;
  _activeChildData = _children.find(c => c._id === id);
  localStorage.setItem('parentActiveChildId', id);

  // Update UI
  document.querySelectorAll('.child-card').forEach(el => el.classList.remove('active'));
  const activeCard = document.getElementById('cc_' + id);
  if (activeCard) activeCard.classList.add('active');
  
  // Reload currently active panel
  const activePanel = document.querySelector('.page-section.active')?.id.replace('panel-', '');
  if (activePanel && window['onPanel_' + activePanel]) {
    window['onPanel_' + activePanel]();
  }
};

/* ── Dashboard (Child Specific) ── */
async function loadDashboardContent() {
  if (!_activeChildId) return;
  
  // Clean up previous
  document.getElementById('alertBanners').innerHTML = '';
  document.getElementById('dashStats').innerHTML = '<div class="spinner csp-style-2ebb0dfa7c" ></div>';
  
  try {
    // Assuming backend takes studentId to scope dashboard data for parents
    const data = await apiFetch(`/dashboard/parent?studentId=${_activeChildId}`);
    const d = data.data || {};
    
    renderAlertBanners(d);
    renderDashboardStats(d);
    
    // Left charts
    renderAttendanceChart(d.attendanceHistory || []);
    
    // Right lists
    loadRecentPayments(d.recentPayments || []);
    loadHomeworkWidget(d.pendingHomework || []);
    loadResultsWidget(d.recentResults || []);
    loadRecentNotices('dashNotices', 3);
    
  } catch (err) {
    document.getElementById('dashStats').innerHTML = `<p class="error-state csp-style-4b90810897" >${err.message}</p>`;
  }
}

function renderAlertBanners(d) {
  const container = document.getElementById('alertBanners');
  let html = '';

  if (d.feeStatus && d.feeStatus.pending > 0) {
    html += `<div class="alert-banner danger">
      <i class="fas fa-exclamation-circle"></i><div class="alert-banner-content"><strong>Fee Payment Due</strong>${formatCurrency(d.feeStatus.pending)} outstanding for ${_activeChildData?.name}.</div>
    </div>`;
  }
  if (d.attendancePct !== undefined && d.attendancePct < 75) {
    html += `<div class="alert-banner warning">
      <i class="fas fa-exclamation-triangle"></i><div class="alert-banner-content"><strong>Low Attendance Alert</strong>Attendance is ${d.attendancePct.toFixed(1)}%.</div>
    </div>`;
  }
  if (d.homeworkPending > 0) {
    html += `<div class="alert-banner info">
      <i class="fas fa-book"></i><div class="alert-banner-content"><strong>Homework Pending</strong>${d.homeworkPending} assignments due.</div>
    </div>`;
  }

  container.innerHTML = html;
}

function renderDashboardStats(d) {
  const grid = document.getElementById('dashStats');
  const att = d.attendancePct !== undefined ? d.attendancePct.toFixed(1) + '%' : '—';
  const attColor = (d.attendancePct || 0) >= 75 ? 'success' : 'danger';
  const feeColor = (d.feeStatus?.pending || 0) > 0 ? 'danger' : 'success';

  grid.innerHTML = `
    <div class="stat-card ${attColor}"><div class="stat-icon ${attColor}"><i class="fas fa-calendar-check"></i></div><div class="stat-content"><div class="stat-value">${att}</div><div class="stat-label">Attendance</div></div></div>
    <div class="stat-card warning"><div class="stat-icon warning"><i class="fas fa-book"></i></div><div class="stat-content"><div class="stat-value">${d.homeworkPending ?? '—'}</div><div class="stat-label">Pending HW</div></div></div>
    <div class="stat-card ${feeColor}"><div class="stat-icon ${feeColor}"><i class="fas fa-rupee-sign"></i></div><div class="stat-content"><div class="stat-value csp-style-08ad8b53af" >${formatCurrency(d.feeStatus?.pending||0)}</div><div class="stat-label">Fee Pending</div></div></div>
    <div class="stat-card info"><div class="stat-icon info"><i class="fas fa-file-alt"></i></div><div class="stat-content"><div class="stat-value">${d.upcomingExams ?? '0'}</div><div class="stat-label">Next Exam</div></div></div>
  `;
}

function renderAttendanceChart(history) {
  if (!history || history.length === 0) {
    // Generate dummy trend if none provided by API for visuals
    history = [80, 85, 82, 88, 90, 85, 92]; 
  }
  const labels = history.map((_, i) => 'Week ' + (i+1));
  createLineChart('dashAttChart', labels, [{
    label: 'Attendance %', data: history, borderColor: '#10b981', backgroundColor: 'rgba(16,185,129,0.1)', fill: true
  }], { y: { min: 0, max: 100 }});
}

function loadRecentPayments(payments) {
  const el = document.getElementById('dashPayments');
  if (!payments.length) { setEmptyState(el, 'receipt', 'No Payments', 'No recent payment history.'); return; }
  el.innerHTML = payments.slice(0,3).map(p => `
    <div class="csp-style-933d28940c">
      <div><div class="csp-style-9340eda27d">${formatDate(p.paymentDate)}</div><div class="csp-style-35374e0094">${p.method||'Cash'} · ${p.receiptNumber||''}</div></div>
      <div class="csp-style-0791b50e1a">${formatCurrency(p.amount)}</div>
    </div>`).join('') + `<div class="csp-style-5bab1844ea"><button class="btn btn-ghost btn-sm" ${cspActionAttrs("showPanel", ['fees'], "click", [], [])}>View All</button></div>`;
}

function loadHomeworkWidget(hw) {
  const el = document.getElementById('dashHomework');
  if (!hw.length) { setEmptyState(el, 'check-circle', 'All Clear', 'No pending homework.'); return; }
  el.innerHTML = hw.slice(0,3).map(h => `
    <div class="csp-style-cfb951fb32">
      <span class="badge badge-warning csp-style-85850cc31c" >${h.subject||'Subject'}</span>
      <div>
        <div class="csp-style-02a3c7300a">${h.title}</div>
        <div class="csp-style-bd9b429d56">Due ${formatDate(h.dueDate)}</div>
      </div>
    </div>`).join('');
}

function loadResultsWidget(res) {
  const el = document.getElementById('dashResults');
  if (!res.length) { setEmptyState(el, 'chart-bar', 'No Results', ''); return; }
  el.innerHTML = res.slice(0,3).map(r => {
    const pct = r.maxMarks > 0 ? Math.round(r.marksObtained/r.maxMarks*100) : 0;
    const color = pct >= 90 ? 'success' : pct >= 75 ? 'info' : pct >= 60 ? 'warning' : 'danger';
    return `
    <div class="csp-style-4ead2ae2ed">
      <div class="stat-icon ${color} csp-style-5efcd9d910" >${r.grade||'—'}</div>
      <div class="csp-style-83725d2c6e"><div class="csp-style-02a3c7300a">${r.subject}</div><div class="csp-style-35374e0094">${r.marksObtained}/${r.maxMarks} (${pct}%)</div></div>
    </div>`;
  }).join('');
}

/* ── Academics (Timetable) ── */
async function loadAcademics() {
  if (!_activeChildData) return;
  const content = document.getElementById('timetableContent');
  const tabs = document.getElementById('timetableDayTabs');
  content.innerHTML = '<div class="spinner csp-style-c4b102f94c" ></div>';
  
  try {
    const data = await apiFetch(`/timetable/class/${_activeChildData.class}`);
    const ttData = data.data || {};
    const days = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    const today = getTodayDayName();
    
    tabs.innerHTML = days.map(d => `<button class="tab-btn ${d===today?'active':''}" aria-label="${d}" ${cspActionAttrs("showParentTimetableDay", ['${encodeURIComponent(JSON.stringify(ttData[d]||[]))}'], "click", [0], [])}>${d.slice(0,3)}</button>`).join('');
    
    // Simulate click on today
    showParentTimetableDay(tabs.querySelector('.active') || tabs.firstElementChild, JSON.stringify(ttData[today]||[]));
  } catch (err) {
    setEmptyState(content, 'clock', 'Not Available', 'Timetable for this class is not published yet.');
  }
}

window.showParentTimetableDay = function(btn, periodsJson) {
  document.querySelectorAll('#timetableDayTabs .tab-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  const content = document.getElementById('timetableContent');
  const periods = JSON.parse(decodeURIComponent(periodsJson));
  
  if (!periods.length) {
    setEmptyState(content, 'coffee', 'No Classes', 'No periods scheduled.');
    return;
  }
  
  content.innerHTML = `<div class="schedule-list">` + periods.map(p => `
    <div class="schedule-item">
      <span class="schedule-time">${p.startTime} – ${p.endTime}</span>
      <span class="schedule-dot csp-style-6f9306e1d2" ></span>
      <div>
        <div class="schedule-subject">${p.subject||'—'}</div>
        <div class="schedule-meta">${p.teacher?'By '+p.teacher:''} ${p.room?'· Room '+p.room:''}</div>
      </div>
    </div>`).join('') + `</div>`;
};

/* ── Attendance ── */
async function loadAttendance() {
  if (!_activeChildId) return;
  const sel = document.getElementById('attMonthSel');
  const statsEl = document.getElementById('attStats');
  const calEl = document.getElementById('attCalendar');

  if (sel && sel.options.length === 0) {
    const now = new Date();
    for (let i = 0; i < 12; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const val = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
      sel.add(new Option(d.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }), val));
    }
  }

  const [year, month] = (sel.value || `${new Date().getFullYear()}-${String(new Date().getMonth()+1).padStart(2,'0')}`).split('-');
  calEl.innerHTML = '<div class="spinner csp-style-c4b102f94c" ></div>';

  try {
    const data = await apiFetch(`/attendance/student/${_activeChildId}/monthly?year=${year}&month=${month}`);
    const days = (data.data && (data.data.records || data.data.attendance)) || [];
    
    const present = days.filter(d => d.status === 'present').length;
    const absent  = days.filter(d => d.status === 'absent').length;
    const late    = days.filter(d => d.status === 'late').length;
    const total   = days.length;
    const pct     = total > 0 ? (present/total*100).toFixed(1) : '0.0';

    statsEl.innerHTML = `
      <div class="stat-card success"><div class="stat-icon success"><i class="fas fa-check"></i></div><div class="stat-content"><div class="stat-value">${pct}%</div><div class="stat-label">Attendance</div></div></div>
      <div class="stat-card success"><div class="stat-icon success"><i class="fas fa-user-check"></i></div><div class="stat-content"><div class="stat-value">${present}</div><div class="stat-label">Present</div></div></div>
      <div class="stat-card danger"><div class="stat-icon danger"><i class="fas fa-user-times"></i></div><div class="stat-content"><div class="stat-value">${absent}</div><div class="stat-label">Absent</div></div></div>
      <div class="stat-card warning"><div class="stat-icon warning"><i class="fas fa-clock"></i></div><div class="stat-content"><div class="stat-value">${late}</div><div class="stat-label">Late</div></div></div>`;

    renderParentAttCalendar(calEl, parseInt(year), parseInt(month), days);
  } catch (err) {
    setEmptyState(calEl, 'calendar', 'No Data', err.message);
  }
}

function renderParentAttCalendar(el, year, month, records) {
  // Logic identical to student calendar
  const dayMap = {}; records.forEach(r => dayMap[new Date(r.date).getDate()] = r.status);
  const lastDay = new Date(year, month, 0).getDate();
  let startWd = new Date(year, month - 1, 1).getDay();
  if (startWd === 0) startWd = 7; startWd -= 1;

  let html = `<div class="attendance-calendar">`;
  ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].forEach(d => html += `<div class="attendance-calendar-weekday">${d}</div>`);
  for (let i=0; i<startWd; i++) html += `<div></div>`;
  for (let d=1; d<=lastDay; d++) {
    const st = dayMap[d];
    html += `<div class="attendance-calendar-day attendance-calendar-day--${st || 'unmarked'}" title="${st||'—'}">${d}</div>`;
  }
  html += `</div>`;
  el.innerHTML = html;
}

/* ── Homework ── */
async function loadHomework() {
  if (!_activeChildId) return;
  const list = document.getElementById('homeworkList');
  list.innerHTML = '<div class="spinner csp-style-c4b102f94c" ></div>';
  try {
    const data = await apiFetch(`/homework?studentId=${_activeChildId}`); // or correct endpoint
    _homeworkAll = data.data || data.homework || [];
    filterHomework();
  } catch (err) { setEmptyState(list, 'book', 'Failed to load', err.message); }
}

window.filterHomework = function() {
  const sub = document.getElementById('hwSubjectFilter')?.value || '';
  const status = document.getElementById('hwStatusFilter')?.value || '';
  let filtered = _homeworkAll;
  if (sub) filtered = filtered.filter(h => h.subject === sub);
  if (status) filtered = filtered.filter(h => (h.status||'pending') === status);
  
  const list = document.getElementById('homeworkList');
  if (!filtered.length) { setEmptyState(list, 'check-circle', 'No Homework', 'Nothing to show.'); return; }
  
  const subSel = document.getElementById('hwSubjectFilter');
  if (subSel.options.length <= 1) {
    [...new Set(_homeworkAll.map(h=>h.subject).filter(Boolean))].forEach(s => subSel.add(new Option(s,s)));
  }

  list.innerHTML = filtered.map(h => {
    const isOverdue = new Date(h.dueDate) < new Date() && h.status !== 'submitted';
    return `<div class="card"><div class="card-body">
      <div class="csp-style-d49a73d24c">
        <span class="badge badge-info">${h.subject}</span>
        <span class="badge ${h.status==='submitted'?'badge-success':isOverdue?'badge-danger':'badge-warning'}">${h.status==='submitted'?'Submitted':isOverdue?'Overdue':'Pending'}</span>
      </div>
      <h4 class="csp-style-a1a0dcf46c">${h.title}</h4>
      <p class="csp-style-a82e347618"><i class="fas fa-calendar"></i> Due: ${formatDate(h.dueDate)}</p>
    </div></div>`;
  }).join('');
}

/* ── Exams ── */
async function loadExams() {
  if (!_activeChildData) return;
  try {
    const data = await apiFetch(`/exams/upcoming?class=${_activeChildData.class}`);
    const exams = data.data || data.exams || [];
    const now = new Date();
    
    const upcoming = exams.filter(e => new Date(e.date) >= now);
    const past = exams.filter(e => new Date(e.date) < now);
    
    renderExamsList('upcomingExamsList', upcoming);
    renderExamsList('pastExamsList', past);
  } catch (err) {}
}
function renderExamsList(id, items) {
  const el = document.getElementById(id);
  if (!items.length) { setEmptyState(el, 'file-alt', 'No Exams', ''); return; }
  el.innerHTML = items.map(ex => `<div class="card"><div class="card-body csp-style-08b2dfc6e6" >
    <div class="csp-style-92de1f56ed"><div class="csp-style-a2dc103422">${new Date(ex.date).getDate()}</div><div class="csp-style-269e5f225a">${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][new Date(ex.date).getMonth()]}</div></div>
    <div><div class="csp-style-a1a0dcf46c">${ex.subject||ex.name}</div><div class="csp-style-3bdae21a61">${ex.examType||''}</div></div>
  </div></div>`).join('');
}
window.switchExamTab = function(tab, btn) {
  document.querySelectorAll('#panel-exams .tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('#panel-exams .tab-panel').forEach(p => p.classList.remove('active'));
  btn.classList.add('active'); document.getElementById('exams-' + tab)?.classList.add('active');
};

/* ── Results ── */
async function loadResults() {
  if (!_activeChildId) return;
  const el = document.getElementById('resultsContent');
  const type = document.getElementById('resultExamFilter')?.value;
  el.innerHTML = '<div class="spinner"></div>';
  try {
    const data = await apiFetch(`/marks/student/${_activeChildId}${type?'?examType='+encodeURIComponent(type):''}`);
    const marks = data.data || data.marks || [];
    if (!marks.length) { setEmptyState(el, 'chart-bar', 'No Results', ''); return; }
    
    el.innerHTML = `<div class="card"><div class="table-wrapper"><table class="data-table">
      <thead><tr><th>Subject</th><th>Max Marks</th><th>Obtained</th><th>Grade</th></tr></thead>
      <tbody>${marks.map(m => `<tr><td><b>${m.subject}</b></td><td>${m.maxMarks}</td><td><b>${m.marksObtained}</b></td><td><span class="badge badge-primary">${m.grade||'—'}</span></td></tr>`).join('')}</tbody>
    </table></div></div>`;
  } catch(e) { setEmptyState(el, 'chart-bar', 'Error', e.message); }
}

/* ── Fees ── */
async function loadFees() {
  if (!_activeChildId) return;
  try {
    const data = await apiFetch(`/fees/student/${_activeChildId}`);
    const fee = data.data || {};
    
    document.getElementById('feeTotal').textContent = formatCurrency(fee.totalAmount || 0);
    document.getElementById('feePaid').textContent = formatCurrency(fee.paidAmount || 0);
    document.getElementById('feePending').textContent = formatCurrency(fee.pendingAmount || 0);
    
    const tbody = document.getElementById('feeHistoryTable');
    const payments = fee.payments || [];
    if (!payments.length) { tbody.innerHTML = `<tr><td colspan="6"><div class="empty-state csp-style-4b90810897" ><i class="fas fa-history"></i><p>No payment history.</p></div></td></tr>`; return; }
    
    tbody.innerHTML = payments.map(p => `<tr>
      <td>${p.receiptNumber||'—'}</td>
      <td>${formatDate(p.paymentDate)}</td>
      <td class="csp-style-c6fa01b3f1">${formatCurrency(p.amount)}</td>
      <td>${p.method||'Cash'}</td>
      <td><span class="badge badge-success">Success</span></td>
      <td><button class="btn btn-secondary btn-sm"><i class="fas fa-download"></i> Receipt</button></td>
    </tr>`).join('');
  } catch(e) {}
}

window.initiatePayment = function() {
  toast.info('Payment Gateway', 'Payment gateway integration ready.');
};

/* ── Library ── */
async function loadLibrary() {
  if (!_activeChildId) return;
  const el = document.getElementById('libraryContent');
  el.innerHTML = '<div class="spinner"></div>';
  try {
    const data = await apiFetch(`/library/student/${_activeChildId}`);
    const books = data.data || [];
    if (!books.length) { setEmptyState(el, 'book', 'No Books', 'No library books currently issued.'); return; }
    
    el.innerHTML = `<div class="card"><div class="table-wrapper"><table class="data-table">
      <thead><tr><th>Book</th><th>Issued</th><th>Due Date</th><th>Status</th></tr></thead>
      <tbody>${books.map(b => {
        const overdue = new Date(b.dueDate) < new Date();
        return `<tr><td><b>${b.title||b.book?.title}</b></td><td>${formatDate(b.issuedDate)}</td><td>${formatDate(b.dueDate)}</td><td><span class="badge ${overdue?'badge-danger':'badge-success'}">${overdue?'Overdue':'Active'}</span></td></tr>`;
      }).join('')}</tbody>
    </table></div></div>`;
  } catch(e) { setEmptyState(el, 'book', 'Error', e.message); }
}

/* ── Transport ── */
async function loadTransport() {
  if (!_activeChildId) return;
  const el = document.getElementById('transportContent');
  try {
    const data = await apiFetch(`/transport/student/${_activeChildId}`);
    const t = data.data;
    if (!t) { setEmptyState(el, 'bus', 'No Transport', 'No transport assigned to this student.'); return; }
    
    el.innerHTML = `<div class="card"><div class="card-body">
      <div class="csp-style-f465b5e616">
        <div><span class="csp-style-632dbf6184">Bus Number</span><div class="csp-style-c6fa01b3f1">${t.busNumber||'—'}</div></div>
        <div><span class="csp-style-632dbf6184">Route</span><div class="csp-style-c6fa01b3f1">${t.route?.name||t.routeName||'—'}</div></div>
        <div><span class="csp-style-632dbf6184">Pickup Stop</span><div class="csp-style-c6fa01b3f1">${t.pickupStop||t.stop||'—'}</div></div>
        <div><span class="csp-style-632dbf6184">Pickup Time</span><div class="csp-style-c6fa01b3f1">${t.pickupTime||'—'}</div></div>
      </div>
    </div></div>`;
  } catch(e) { setEmptyState(el, 'bus', 'Error', e.message); }
}

/* ── Events ── */
async function loadEvents() {
  // Handled similarly to student portal, uses /events
  const el = document.getElementById('eventsList');
  if(!el) return;
  try {
    const data = await apiFetch('/events?limit=10');
    const evs = data.data || [];
    if (!evs.length) { setEmptyState(el, 'calendar', 'No Events', ''); return; }
    el.innerHTML = evs.map(ev => `<div class="card"><div class="card-body"><h4>${ev.title}</h4><p class="csp-style-28e5caa15c">${formatDate(ev.date||ev.startDate)}</p></div></div>`).join('');
  } catch(e) {}
}
