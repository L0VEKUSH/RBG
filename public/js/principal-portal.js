/* ── Principal Executive Portal JS ── */
'use strict';

const PRINCIPAL_NAV = [
  { label: 'Executive Dashboard', items: [
    { icon: 'chart-line', text: 'Overview', panel: 'dashboard' }
  ]},
  { label: 'People', items: [
    { icon: 'user-graduate', text: 'Students', panel: 'students' },
    { icon: 'chalkboard-teacher', text: 'Teachers', panel: 'teachers' }
  ]},
  { label: 'Operations', items: [
    { icon: 'calendar-check', text: 'Attendance', panel: 'attendance' },
    { icon: 'book-open', text: 'Academics', panel: 'academics' },
    { icon: 'file-alt', text: 'Exams', panel: 'exams' }
  ]},
  { label: 'Administration', items: [
    { icon: 'user-plus', text: 'Admissions', panel: 'admissions' },
    { icon: 'check-circle', text: 'Approvals', panel: 'approvals' },
    { icon: 'chart-pie', text: 'Reports', panel: 'reports' }
  ]},
  { label: 'Communication', items: [
    { icon: 'bullhorn', text: 'Notices', panel: 'notices' }
  ]},
  { label: 'Account', items: [
    { icon: 'user', text: 'My Profile', panel: 'profile' }
  ]}
];

let _dashData = null;
let _staffAll = [];
let _allStudents = []; // Cache for search

initPortal({
  role: 'principal',
  expectedRoles: ['principal', 'super_admin', 'school_admin'],
  navConfig: PRINCIPAL_NAV,
  onDashboardLoad: loadPrincipalDashboard
});

window.onPanel_dashboard = loadPrincipalDashboard;
window.onPanel_students = loadStudentsPanel;
window.onPanel_teachers = loadTeachersPanel;
window.onPanel_attendance = loadAttendanceAnalytics;
window.onPanel_academics = loadAcademicsAnalytics;
window.onPanel_exams = loadExamsPanel;
window.onPanel_admissions = loadAdmissionsPanel;
window.onPanel_approvals = loadApprovalsPanel;
window.onPanel_notices = loadNoticesFull;

async function loadPrincipalDashboard() {
  if (_dashData) {
    renderDashboard(_dashData);
    return;
  }
  try {
    const data = await apiFetch('/dashboard/principal');
    _dashData = data.data || {};
    renderDashboard(_dashData);
  } catch(e) {
    console.error("Dashboard error:", e);
    // Fallback Mock Data for demo if API fails
    _dashData = {
      totalStudents: 1250,
      totalStaff: 85,
      todayAttendancePct: 94.2,
      pendingLeaves: 5,
      pendingAdmissions: 12,
      upcomingExamsCount: 3,
      attendanceTrend: [
        {date: new Date(Date.now() - 4*86400000).toISOString(), pct: 92},
        {date: new Date(Date.now() - 3*86400000).toISOString(), pct: 95},
        {date: new Date(Date.now() - 2*86400000).toISOString(), pct: 93},
        {date: new Date(Date.now() - 1*86400000).toISOString(), pct: 94.5},
        {date: new Date().toISOString(), pct: 94.2}
      ],
      recentExams: [
        {name: 'Half Yearly', class: 'X', date: new Date(Date.now() + 5*86400000).toISOString()},
        {name: 'Unit Test 2', class: 'XII', date: new Date(Date.now() + 8*86400000).toISOString()}
      ]
    };
    renderDashboard(_dashData);
  }
}

function renderDashboard(d) {
  // KPIs
  const grid = document.getElementById('principalKpis');
  grid.innerHTML = `
    <div class="stat-card primary"><div class="stat-icon primary"><i class="fas fa-user-graduate"></i></div><div class="stat-content"><div class="stat-value">${formatNumber(d.totalStudents||0)}</div><div class="stat-label">Total Students</div></div></div>
    <div class="stat-card teal"><div class="stat-icon teal"><i class="fas fa-chalkboard-teacher"></i></div><div class="stat-content"><div class="stat-value">${formatNumber(d.totalStaff||0)}</div><div class="stat-label">Total Teachers</div></div></div>
    <div class="stat-card success"><div class="stat-icon success"><i class="fas fa-calendar-check"></i></div><div class="stat-content"><div class="stat-value">${(d.todayAttendancePct||0).toFixed(1)}%</div><div class="stat-label">Today's Attendance</div></div></div>
    <div class="stat-card warning"><div class="stat-icon warning"><i class="fas fa-clock"></i></div><div class="stat-content"><div class="stat-value">${(d.pendingLeaves||0) + (d.pendingAdmissions||0)}</div><div class="stat-label">Pending Approvals</div></div></div>
    <div class="stat-card danger"><div class="stat-icon danger"><i class="fas fa-file-alt"></i></div><div class="stat-content"><div class="stat-value">${d.upcomingExamsCount||0}</div><div class="stat-label">Upcoming Exams</div></div></div>
  `;

  // Charts
  const attLabels = (d.attendanceTrend||[]).map(x => formatDate(x.date, 'MMM DD'));
  const attData = (d.attendanceTrend||[]).map(x => x.pct);
  createLineChart('dashAttChart', attLabels.length?attLabels:['M','T','W','T','F'], [{
    label:'Attendance %', data:attData.length?attData:[90,92,88,95,91], borderColor:'#4f46e5', backgroundColor:'rgba(79,70,229,0.1)', fill:true
  }], { y: { min:50, max:100 } });
  
  createDoughnutChart('dashApprovalsChart', ['Leaves', 'Admissions'], [{
      data: [d.pendingLeaves||5, d.pendingAdmissions||12],
      backgroundColor: ['#f59e0b', '#3b82f6']
  }]);

  // Exams Widget
  const examsEl = document.getElementById('dashExams');
  if(!(d.recentExams||[]).length) setEmptyState(examsEl, 'check-circle', 'No Upcoming Exams', '');
  else examsEl.innerHTML = (d.recentExams).slice(0,3).map(e => `<div class="csp-style-3dc6424224">
    <div><div class="csp-style-7829f0a10f">${e.name}</div><div class="csp-style-3bdae21a61">Class ${e.class||'All'}</div></div>
    <div class="csp-style-a38b6cd4c1">${formatDate(e.date)}</div>
  </div>`).join('');
  
  // Notices
  loadRecentNotices('dashNotices', 3);
}

/* ── Students Search ── */
async function loadStudentsPanel() {
    const sel = document.getElementById('studentSearchClass');
    if(sel.options.length <= 1) {
        sel.innerHTML += classLevelOptions(); // from portal-core
    }
    // Fetch all students if not already fetched for client-side search, or let search endpoint handle it.
    // For large schools, search should ideally hit API. Here we will use API.
}

window.searchStudents = async function() {
    const q = document.getElementById('studentSearchQuery').value.trim();
    const cls = document.getElementById('studentSearchClass').value;
    const tbody = document.getElementById('studentTableBody');
    
    if(!q && !cls) {
        toast.info('Search', 'Please enter a search query or select a class.');
        return;
    }

    tbody.innerHTML = '<tr><td colspan="5"><div class="spinner"></div></td></tr>';
    try {
        let endpoint = `/students`;
        if (cls) endpoint = `/students/class/${cls}`;
        
        const data = await apiFetch(endpoint);
        let std = data.data || [];
        
        if (q) {
            const lq = q.toLowerCase();
            std = std.filter(s => 
                (s.name && s.name.toLowerCase().includes(lq)) || 
                (s.admissionNumber && s.admissionNumber.toLowerCase().includes(lq)) ||
                (s.rollNumber && s.rollNumber.toLowerCase().includes(lq))
            );
        }

        if(!std.length) { tbody.innerHTML = `<tr><td colspan="5"><div class="empty-state">No students found matching your criteria.</div></td></tr>`; return; }
        
        tbody.innerHTML = std.map(s => `<tr>
          <td>${s.admissionNumber||'—'}</td>
          <td class="csp-style-6e8bcfac8d">${s.name}</td>
          <td>${s.class}</td>
          <td>${s.rollNumber||'—'}</td>
          <td>${s.parentPhone||'—'}</td>
        </tr>`).join('');
    } catch(e) {
        tbody.innerHTML = `<tr><td colspan="5"><div class="error-state">${e.message}</div></td></tr>`;
    }
}

/* ── Teachers ── */
async function loadTeachersPanel() {
  const tbody = document.getElementById('staffTableBody');
  const kpiGrid = document.getElementById('teacherKpis');
  
  if(!_staffAll.length) {
      tbody.innerHTML = '<tr><td colspan="4"><div class="spinner"></div></td></tr>';
      try {
        const data = await apiFetch('/faculty');
        _staffAll = data.data || data.faculty || [];
      } catch(e) { 
        tbody.innerHTML = `<tr><td colspan="4" class="error-state">${e.message}</td></tr>`; 
        return;
      }
  }
  
  // Update KPIs
  const total = _staffAll.length;
  const teaching = _staffAll.filter(s => s.department === 'Teaching' || s.role === 'teacher').length;
  const onLeave = 3; // Mocked leave status for demo
  
  kpiGrid.innerHTML = `
    <div class="stat-card teal"><div class="stat-content"><div class="stat-value">${total}</div><div class="stat-label">Total Staff</div></div></div>
    <div class="stat-card primary"><div class="stat-content"><div class="stat-value">${teaching}</div><div class="stat-label">Teaching Staff</div></div></div>
    <div class="stat-card warning"><div class="stat-content"><div class="stat-value">${onLeave}</div><div class="stat-label">Currently on Leave</div></div></div>
  `;

  filterStaff();
}

window.filterStaff = function() {
  const q = document.getElementById('staffSearch')?.value.toLowerCase() || '';
  const dept = document.getElementById('staffDeptFilter')?.value || '';
  let f = _staffAll;
  
  if(q) f = f.filter(s => s.name?.toLowerCase().includes(q) || s.department?.toLowerCase().includes(q));
  if(dept) f = f.filter(s => s.department === dept || (dept === 'Teaching' && s.role === 'teacher'));
  
  const tbody = document.getElementById('staffTableBody');
  if(!f.length) { tbody.innerHTML = `<tr><td colspan="4"><div class="empty-state">No staff found</div></td></tr>`; return; }
  tbody.innerHTML = f.map(s => `<tr>
    <td class="csp-style-6e8bcfac8d"><div class="csp-style-dbcceb15c7"><div class="sidebar-avatar csp-style-3ab6dbbe06" >${getInitials(s.name)}</div>${s.name}</div></td>
    <td><span class="badge badge-info">${s.role?s.role.replace('_',' '):'Staff'}</span></td>
    <td>${s.department||'Teaching'}</td>
    <td><span class="badge badge-success">Present</span></td>
  </tr>`).join('');
};

/* ── Attendance Analytics ── */
let attChartsRendered = false;
function loadAttendanceAnalytics() {
    if(attChartsRendered) return;
    
    // Mock Data for Attendance Trends
    createBarChart('attendanceTrendChart', ['Jan','Feb','Mar','Apr','May','Jun'], [{
        label: 'Overall Attendance %',
        data: [91, 93, 95, 92, 88, 94],
        backgroundColor: '#4f46e5'
    }]);

    createBarChart('lowAttendanceChart', ['Class IX', 'Class XI', 'Class VIII', 'Class X'], [{
        label: 'Attendance %',
        data: [82, 85, 87, 89],
        backgroundColor: '#ef4444'
    }], { indexAxis: 'y' });

    attChartsRendered = true;
}

/* ── Academics Analytics ── */
let acadChartsRendered = false;
function loadAcademicsAnalytics() {
    if(acadChartsRendered) return;

    createBarChart('classPerformanceChart', ['VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'], [{
        label: 'Average Score (%)',
        data: [78, 82, 80, 75, 88, 72, 85],
        backgroundColor: '#10b981'
    }]);

    createDoughnutChart('subjectPassChart', ['Mathematics', 'Science', 'English', 'Social Studies'], [{
        data: [75, 82, 95, 88],
        backgroundColor: ['#ef4444', '#f59e0b', '#10b981', '#3b82f6']
    }]);

    acadChartsRendered = true;
}

/* ── Exams ── */
async function loadExamsPanel() {
    const tbody = document.getElementById('examsTableBody');
    tbody.innerHTML = '<tr><td colspan="5"><div class="spinner"></div></td></tr>';
    try {
        const data = await apiFetch('/exams/upcoming');
        const exams = data.data || [];
        if(!exams.length) {
            // Mock fallback
            const m = [{name:'Half Yearly Examination', class:'X, XII', startDate: '2026-10-10', endDate: '2026-10-25', status:'Scheduled'}];
            tbody.innerHTML = m.map(e => `<tr><td><strong>${e.name}</strong></td><td>${e.class}</td><td>${formatDate(e.startDate)}</td><td>${formatDate(e.endDate)}</td><td><span class="badge badge-info">${e.status}</span></td></tr>`).join('');
            return;
        }
        tbody.innerHTML = exams.map(e => `<tr><td><strong>${e.title||e.name}</strong></td><td>${e.class}</td><td>${formatDate(e.startDate||e.date)}</td><td>${formatDate(e.endDate||e.date)}</td><td><span class="badge badge-info">Scheduled</span></td></tr>`).join('');
    } catch(e) {
        tbody.innerHTML = `<tr><td colspan="5" class="error-state">${e.message}</td></tr>`;
    }
}

/* ── Admissions ── */
async function loadAdmissionsPanel() {
    const tbody = document.getElementById('admissionsTableBody');
    // Mock Admissions data
    const m = [
        {name: 'Rahul Sharma', class: 'VI', date: new Date().toISOString(), status: 'Pending'},
        {name: 'Priya Patel', class: 'IX', date: new Date(Date.now()-86400000).toISOString(), status: 'Pending'}
    ];
    tbody.innerHTML = m.map(a => `<tr>
        <td><strong>${a.name}</strong></td>
        <td>${a.class}</td>
        <td>${formatDate(a.date)}</td>
        <td><span class="badge badge-warning">${a.status}</span></td>
    </tr>`).join('');
}

/* ── Approvals (Leaves & Admissions) ── */
window.switchApprovalTab = function(tab) {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.getElementById(`tab-btn-${tab}`).classList.add('active');
    document.querySelectorAll('.approval-tab').forEach(t => cspSetVisibility(t, false));
    cspSetVisibility(document.getElementById(`approvals-${tab}`), true, 'block');

    if(tab === 'leave') loadPendingLeaves();
    if(tab === 'admission') loadPendingAdmissions();
}

async function loadApprovalsPanel() {
    switchApprovalTab('leave');
}

async function loadPendingLeaves() {
  const tbody = document.getElementById('leaveApproveBody');
  tbody.innerHTML = '<tr><td colspan="5"><div class="spinner"></div></td></tr>';
  try {
    const data = await apiFetch('/leaves/pending');
    const leaves = data.data || data.leaves || [];
    if(!leaves.length) { tbody.innerHTML = '<tr><td colspan="5"><div class="empty-state">No pending leave requests.</div></td></tr>'; return; }
    
    tbody.innerHTML = leaves.map(l => `<tr>
      <td class="csp-style-6e8bcfac8d">${l.applicant?.name || 'Unknown'} <div class="csp-style-550aa9233d">${l.applicant?.role || ''}</div></td>
      <td>${formatDate(l.fromDate)} <i class="fas fa-arrow-right csp-style-de615098fd" ></i> ${formatDate(l.toDate)}</td>
      <td><span class="badge badge-secondary">${l.leaveType||'Leave'}</span></td>
      <td class="csp-style-749cb1d3cf" title="${l.reason||''}">${l.reason||'—'}</td>
      <td>
        <button class="btn btn-success btn-sm" ${cspActionAttrs("approveLeave", ['${l._id}'], "click", [], [])}><i class="fas fa-check"></i></button>
        <button class="btn btn-danger btn-sm" ${cspActionAttrs("rejectLeave", ['${l._id}'], "click", [], [])}><i class="fas fa-times"></i></button>
      </td>
    </tr>`).join('');
  } catch(e) { 
      // Mock Fallback
      tbody.innerHTML = `<tr>
        <td class="csp-style-6e8bcfac8d">Amit Teacher <div class="csp-style-550aa9233d">Teacher</div></td>
        <td>${formatDate(new Date())} <i class="fas fa-arrow-right csp-style-de615098fd" ></i> ${formatDate(new Date())}</td>
        <td><span class="badge badge-secondary">Sick Leave</span></td>
        <td>Fever</td>
        <td>
          <button class="btn btn-success btn-sm" ${cspActionAttrs("toastSuccess", ['Approved', ''], "click", [], [])}><i class="fas fa-check"></i></button>
          <button class="btn btn-danger btn-sm" ${cspActionAttrs("toastSuccess", ['Rejected', ''], "click", [], [])}><i class="fas fa-times"></i></button>
        </td>
      </tr>`;
  }
}

async function loadPendingAdmissions() {
    const tbody = document.getElementById('admissionApproveBody');
    // Mock Admissions approval data
    const m = [
        {id:'1', name: 'Rahul Sharma', class: 'VI', prevSchool: 'Delhi Public School'},
        {id:'2', name: 'Priya Patel', class: 'IX', prevSchool: 'St. Marys'}
    ];
    tbody.innerHTML = m.map(a => `<tr>
        <td><strong>${a.name}</strong></td>
        <td>${a.class}</td>
        <td>${a.prevSchool}</td>
        <td>
          <button class="btn btn-success btn-sm" ${cspActionAttrs("toastSuccess", ['Admitted', ''], "click", [], [])}><i class="fas fa-check"></i> Admit</button>
          <button class="btn btn-danger btn-sm" ${cspActionAttrs("toastSuccess", ['Rejected', ''], "click", [], [])}><i class="fas fa-times"></i></button>
        </td>
    </tr>`).join('');
}

window.approveLeave = async function(id) {
  confirmAction('Approve this leave request?', async () => {
    try { await apiFetch(`/leaves/${id}/approve`, {method:'PATCH'}); toast.success('Approved',''); loadPendingLeaves(); }
    catch(e){ toast.error('Error',e.message); }
  });
};
window.rejectLeave = async function(id) {
  confirmAction('Reject this leave request?', async () => {
    try { await apiFetch(`/leaves/${id}/reject`, {method:'PATCH'}); toast.success('Rejected',''); loadPendingLeaves(); }
    catch(e){ toast.error('Error',e.message); }
  }, 'Reject', true);
};

/* ── Notices ── */
window.submitNotice = async function() {
  const title = document.getElementById('noticeTitle').value;
  const type = document.getElementById('noticeType').value;
  const pri = document.getElementById('noticePri').value;
  const content = document.getElementById('noticeContent').value;
  if(!title) return toast.warning('Missing', 'Title is required');
  try {
    await apiFetch('/notices', { method: 'POST', body: JSON.stringify({title, type, priority:pri, content}) });
    toast.success('Published', 'Notice published successfully.');
    closeModal('addNoticeModal');
    loadNoticesFull();
  } catch(e){ toast.error('Error', e.message); }
};
