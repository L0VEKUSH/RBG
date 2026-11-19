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
    { icon: 'file-alt', text: 'Exams', panel: 'exams' },
    { icon: 'calendar-alt', text: 'Timetable', panel: 'timetable' }
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
window.onPanel_notices = loadPrincipalNotices;
window.onPanel_reports = loadBasicReportsPanel;

async function loadPrincipalDashboard() {
  try {
    const response = await apiFetch('/dashboard/principal');
    _dashData = response.data || {};
    renderDashboard(_dashData);
    await loadAttendanceSummaryChart('dashAttChart');
  } catch (error) {
    const grid = document.getElementById('principalKpis');
    grid.innerHTML = '<div class="error-state">Principal dashboard data is unavailable.</div>';
    principalChartState('dashAttChart', 'Attendance summary is unavailable.');
    principalChartState('dashApprovalsChart', 'Approval summary is unavailable.');
    document.getElementById('dashExams').textContent = 'Upcoming exam details are unavailable.';
  }
}

function renderDashboard(d) {
  const grid = document.getElementById('principalKpis');
  const metric = value => Number.isFinite(Number(value)) && value !== null && value !== undefined ? formatNumber(Number(value)) : 'Unavailable';
  grid.innerHTML = `
    <div class="stat-card primary"><div class="stat-icon primary"><i class="fas fa-user-graduate"></i></div><div class="stat-content"><div class="stat-value">${metric(d.studentCount)}</div><div class="stat-label">Active Students</div></div></div>
    <div class="stat-card teal"><div class="stat-icon teal"><i class="fas fa-chalkboard-teacher"></i></div><div class="stat-content"><div class="stat-value">${metric(d.facultyCount)}</div><div class="stat-label">Active Faculty</div></div></div>
    <div class="stat-card info"><div class="stat-icon info"><i class="fas fa-calendar-check"></i></div><div class="stat-content"><div class="stat-value">${metric(d.presentStudents)}</div><div class="stat-label">Present Students Today</div></div></div>
    <div class="stat-card warning"><div class="stat-icon warning"><i class="fas fa-clock"></i></div><div class="stat-content"><div class="stat-value">${metric(d.pendingAdmissions)}</div><div class="stat-label">Pending Admissions</div></div></div>
    <div class="stat-card danger"><div class="stat-icon danger"><i class="fas fa-file-alt"></i></div><div class="stat-content"><div class="stat-value">${metric(d.upcomingExams)}</div><div class="stat-label">Upcoming Exams</div></div></div>
  `;
  principalChartState('dashApprovalsChart', 'The dashboard currently reports pending admissions; pending leave totals are not included.');
  const examsEl = document.getElementById('dashExams');
  if (!Array.isArray(d.recentExams)) examsEl.textContent = Number.isFinite(Number(d.upcomingExams))
    ? `${Number(d.upcomingExams)} upcoming exam(s); the dashboard API does not include exam details.`
    : 'Upcoming exam details are unavailable.';
  else if (!d.recentExams.length) setEmptyState(examsEl, 'check-circle', 'No Upcoming Exams', '');
  else examsEl.innerHTML = d.recentExams.slice(0, 3).map(exam => `<div class="csp-style-3dc6424224"><div><div class="csp-style-7829f0a10f">${exam.name || 'Unavailable'}</div><div class="csp-style-3bdae21a61">Class ${exam.class || 'Unavailable'}</div></div><div class="csp-style-a38b6cd4c1">${exam.date ? formatDate(exam.date) : 'Unavailable'}</div></div>`).join('');
  loadVisiblePrincipalNotices('dashNotices', 3);
}

function principalChartState(canvasId, message) {
  const canvas = document.getElementById(canvasId);
  if (!canvas?.parentElement) return;
  canvas.hidden = true;
  let status = document.getElementById(`${canvasId}Status`);
  if (!status) {
    status = document.createElement('div');
    status.id = `${canvasId}Status`;
    status.className = 'empty-state';
    canvas.parentElement.appendChild(status);
  }
  status.textContent = message;
  status.hidden = false;
}

function showPrincipalChart(canvasId) {
  const canvas = document.getElementById(canvasId);
  if (canvas) canvas.hidden = false;
  const status = document.getElementById(`${canvasId}Status`);
  if (status) status.hidden = true;
}

async function loadAttendanceSummaryChart(canvasId) {
  try {
    const response = await apiFetch('/reports/attendance');
    const rows = Array.isArray(response?.data) ? response.data : [];
    if (response?.success !== true || !rows.length) {
      principalChartState(canvasId, rows.length ? 'Attendance summary is unavailable.' : 'No attendance records are available.');
      return;
    }
    showPrincipalChart(canvasId);
    createBarChart(canvasId, rows.map(row => String(row._id || 'Unknown')),
      [{ label: 'Attendance records', data: rows.map(row => Number(row.count) || 0), backgroundColor: '#4f46e5' }]);
  } catch (error) {
    principalChartState(canvasId, 'Attendance summary is unavailable.');
  }
}

async function loadStudentsPanel() {
    const sel = document.getElementById('studentSearchClass');
    if(sel.options.length <= 1) {
        sel.innerHTML += classLevelOptions(); // from portal-core
    }
    // Fetch all students if not already fetched for client-side search, or let search endpoint handle it.
    // For large schools, search should ideally hit API. Here we will use API.
}

function escapePrincipalStudentText(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

window.searchStudents = async function() {
    const q = document.getElementById('studentSearchQuery').value.trim();
    const cls = document.getElementById('studentSearchClass').value;
    const tbody = document.getElementById('studentTableBody');
    
    if(!q && !cls) {
        toast.info('Search', 'Please enter a search query or select a class.');
        return;
    }

    tbody.innerHTML = '<tr><td colspan="4"><div class="spinner"></div></td></tr>';
    try {
        let endpoint = `/students?limit=1000`;
        if (cls) endpoint = `/students/class/${encodeURIComponent(cls)}`;
        
        const response = await apiFetch(endpoint);
        let std = cls ? response?.data?.students : response?.students;
        if (response?.success !== true || !Array.isArray(std)) {
            throw new Error('Student list response was invalid.');
        }
        
        if (q) {
            const lq = q.toLowerCase();
            std = std.filter(s => 
                ((s.user?.name || s.name || '').toLowerCase().includes(lq)) ||
                (s.admissionNumber && s.admissionNumber.toLowerCase().includes(lq)) ||
                (s.rollNumber && s.rollNumber.toLowerCase().includes(lq))
            );
        }

        if(!std.length) { tbody.innerHTML = `<tr><td colspan="4"><div class="empty-state">No students found matching your criteria.</div></td></tr>`; return; }
        
        tbody.innerHTML = std.map(s => `<tr>
          <td>${escapePrincipalStudentText(s.admissionNumber || '—')}</td>
          <td class="csp-style-6e8bcfac8d">${escapePrincipalStudentText(s.user?.name || s.name || 'Unavailable')}</td>
          <td>${escapePrincipalStudentText(s.class || '—')}</td>
          <td>${escapePrincipalStudentText(s.rollNumber || '—')}</td>
        </tr>`).join('');
    } catch(e) {
        tbody.innerHTML = `<tr><td colspan="4"><div class="error-state">${escapePrincipalStudentText(e.message || 'Student search failed.')}</div></td></tr>`;
    }
}

/* ── Teachers ── */
async function loadTeachersPanel() {
  const tbody = document.getElementById('staffTableBody');
  const kpiGrid = document.getElementById('teacherKpis');
  
  if(!_staffAll.length) {
      tbody.innerHTML = '<tr><td colspan="4"><div class="spinner"></div></td></tr>';
      try {
        const data = await apiFetch('/faculty?limit=1000');
        _staffAll = data?.data?.faculty;
        if (data?.success !== true || !Array.isArray(_staffAll)) throw new Error('Teacher list response was invalid.');
        const departmentSelect = document.getElementById('staffDeptFilter');
        if (departmentSelect) {
          const departments = [...new Set(_staffAll.map(item => item.department).filter(Boolean))].sort();
          departmentSelect.replaceChildren(new Option('All Departments', ''));
          departments.forEach(department => departmentSelect.add(new Option(department, department)));
        }
      } catch(e) { 
        tbody.innerHTML = `<tr><td colspan="4" class="error-state">${escapePrincipalStudentText(e.message || 'Teacher list is unavailable.')}</td></tr>`;
        return;
      }
  }
  
  // Update KPIs
  const total = _staffAll.length;
  const teachingRoles = new Set(['HOD', 'Senior Teacher', 'Teacher', 'PRT', 'TGT', 'PGT']);
  const teaching = _staffAll.filter(s => teachingRoles.has(s.designation)).length;
  const onLeave = 'Unavailable';
  
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
  
  if(q) f = f.filter(s => (s.user?.name || '').toLowerCase().includes(q) || (s.user?.email || '').toLowerCase().includes(q) || s.department?.toLowerCase().includes(q) || s.designation?.toLowerCase().includes(q));
  if(dept) f = f.filter(s => s.department === dept);
  
  const tbody = document.getElementById('staffTableBody');
  if(!f.length) { tbody.innerHTML = `<tr><td colspan="4"><div class="empty-state">No staff found</div></td></tr>`; return; }
  tbody.innerHTML = f.map(s => `<tr>
    <td class="csp-style-6e8bcfac8d"><div class="csp-style-dbcceb15c7"><div class="sidebar-avatar csp-style-3ab6dbbe06" >${escapePrincipalStudentText(getInitials(s.user?.name || ''))}</div>${escapePrincipalStudentText(s.user?.name || 'Unavailable')}</div></td>
    <td><span class="badge badge-info">${escapePrincipalStudentText(s.designation || 'Faculty')}</span></td>
    <td>${escapePrincipalStudentText(s.department || 'Unavailable')}</td>
    <td><span class="badge badge-secondary">${s.isActive === true ? 'Active' : s.isActive === false ? 'Inactive' : 'Unavailable'}</span></td>
  </tr>`).join('');
};

/* ── Attendance Analytics ── */
async function loadAttendanceAnalytics() {
  await loadAttendanceSummaryChart('attendanceTrendChart');
}

async function loadAcademicsAnalytics() {
  try {
    const response = await apiFetch('/reports/marks');
    const rows = Array.isArray(response?.data) ? response.data : [];
    if (response?.success !== true || !rows.length) {
      principalChartState('classPerformanceChart', 'No marks summaries are available.');
      principalChartState('subjectPassChart', 'No marks summaries are available.');
      return;
    }
    const labels = rows.map(row => String(row._id || 'Unknown exam type'));
    showPrincipalChart('classPerformanceChart');
    showPrincipalChart('subjectPassChart');
    createBarChart('classPerformanceChart', labels, [{
      label: 'Average marks (%)', data: rows.map(row => Number(row.avgPercentage) || 0), backgroundColor: '#10b981',
    }], { yScale: { min: 0, max: 100 } });
    createBarChart('subjectPassChart', labels, [
      { label: 'Pass count', data: rows.map(row => Number(row.passCount) || 0), backgroundColor: '#10b981' },
      { label: 'Fail count', data: rows.map(row => Number(row.failCount) || 0), backgroundColor: '#ef4444' },
    ]);
  } catch (error) {
    principalChartState('classPerformanceChart', 'Marks summaries are unavailable.');
    principalChartState('subjectPassChart', 'Marks summaries are unavailable.');
  }
}

async function loadBasicReportsPanel() {
  const attendanceBody = document.getElementById('principalReportAttendance');
  const marksBody = document.getElementById('principalReportMarks');
  if (!attendanceBody || !marksBody) return;
  attendanceBody.innerHTML = '<tr><td colspan="2">Loading…</td></tr>';
  marksBody.innerHTML = '<tr><td colspan="4">Loading…</td></tr>';
  const [attendanceResult, marksResult] = await Promise.allSettled([
    apiFetch('/reports/attendance'),
    apiFetch('/reports/marks'),
  ]);
  if (attendanceResult.status === 'fulfilled' && attendanceResult.value?.success === true && Array.isArray(attendanceResult.value.data)) {
    const rows = attendanceResult.value.data;
    attendanceBody.innerHTML = rows.length
      ? rows.map(row => `<tr><td>${escapePrincipalStudentText(row._id || 'Unknown')}</td><td>${Number(row.count) || 0}</td></tr>`).join('')
      : '<tr><td colspan="2">No attendance records are available.</td></tr>';
  } else attendanceBody.innerHTML = '<tr><td colspan="2" class="error-state">Attendance report is unavailable.</td></tr>';

  if (marksResult.status === 'fulfilled' && marksResult.value?.success === true && Array.isArray(marksResult.value.data)) {
    const rows = marksResult.value.data;
    marksBody.innerHTML = rows.length
      ? rows.map(row => `<tr><td>${escapePrincipalStudentText(row._id || 'Unknown exam type')}</td><td>${Number.isFinite(Number(row.avgPercentage)) ? `${Number(row.avgPercentage).toFixed(1)}%` : 'Unavailable'}</td><td>${Number(row.passCount) || 0}</td><td>${Number(row.failCount) || 0}</td></tr>`).join('')
      : '<tr><td colspan="4">No marks summaries are available.</td></tr>';
  } else marksBody.innerHTML = '<tr><td colspan="4" class="error-state">Marks report is unavailable.</td></tr>';
}

async function loadVisiblePrincipalNotices(containerId, limit = 100) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.textContent = 'Loading notices…';
  try {
    const response = await apiFetch(`/notices?limit=${encodeURIComponent(limit)}`);
    const notices = response?.data?.notices;
    if (response?.success !== true || !Array.isArray(notices)) throw new Error('Notice list response was invalid.');
    container.replaceChildren();
    if (!notices.length) {
      container.textContent = 'No notices visible to this account.';
      return;
    }
    notices.forEach(notice => {
      const card = document.createElement('div');
      card.className = 'csp-style-89405a374f';
      const heading = document.createElement('strong');
      heading.textContent = notice.title || 'Untitled notice';
      const metadata = document.createElement('span');
      metadata.className = 'text-muted';
      metadata.textContent = [notice.type || 'General', notice.publishDate ? formatDate(notice.publishDate) : 'Available now'].join(' · ');
      card.append(heading, document.createTextNode(' '), metadata);
      if (containerId === 'noticesList') {
        const content = document.createElement('p');
        content.textContent = notice.content || '';
        card.appendChild(content);
      }
      container.appendChild(card);
    });
  } catch (error) {
    container.textContent = error.message || 'Notices could not be loaded.';
  }
}

async function loadPrincipalNotices() {
  await loadVisiblePrincipalNotices('noticesList', 100);
}

async function loadExamsPanel() {
  const tbody = document.getElementById('examsTableBody');
  tbody.innerHTML = '<tr><td colspan="5"><div class="spinner"></div></td></tr>';
  try {
    const response = await apiFetch('/exams/upcoming');
    const exams = Array.isArray(response.data) ? response.data : [];
    if (!exams.length) { tbody.innerHTML = '<tr><td colspan="5"><div class="empty-state">No upcoming exams.</div></td></tr>'; return; }
    tbody.innerHTML = exams.map(exam => `<tr><td><strong>${exam.title || exam.name || 'Unavailable'}</strong></td><td>${exam.class || 'Unavailable'}</td><td>${formatDate(exam.startDate || exam.date)}</td><td>${formatDate(exam.endDate || exam.date)}</td><td><span class="badge badge-info">Scheduled</span></td></tr>`).join('');
  } catch (error) {
    tbody.innerHTML = '<tr><td colspan="5" class="error-state">Upcoming exams could not be loaded.</td></tr>';
  }
}

/* ── Admissions ── */
async function loadAdmissionsPanel() {
  const tbody = document.getElementById('admissionsTableBody');
  tbody.innerHTML = '<tr><td colspan="4"><div class="empty-state">Admission records are unavailable in this view.</div></td></tr>';
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
    const response = await apiFetch('/leaves/pending');
    const leaves = response.data || response.leaves || [];
    if (!leaves.length) { tbody.innerHTML = '<tr><td colspan="5"><div class="empty-state">No pending leave requests.</div></td></tr>'; return; }
    const isPrincipal = String(getUser()?.role || '').toLowerCase() === 'principal';
    tbody.innerHTML = leaves.map(leave => {
      const rejectButton = isPrincipal ? '' : `<button class="btn btn-danger btn-sm" aria-label="Reject leave request" ${cspActionAttrs("rejectLeave", ['${leave._id}'], "click", [], [])}><i class="fas fa-times"></i></button>`;
      return `<tr><td>${leave.user?.name || 'Unknown'} <div class="csp-style-550aa9233d">${leave.user?.role || ''}</div></td><td>${formatDate(leave.startDate)} to ${formatDate(leave.endDate)}</td><td><span class="badge badge-secondary">${leave.leaveType || 'Leave'}</span></td><td title="${leave.reason || ''}">${leave.reason || 'Unavailable'}</td><td><button class="btn btn-success btn-sm" aria-label="Approve leave request" ${cspActionAttrs("approveLeave", ['${leave._id}'], "click", [], [])}><i class="fas fa-check"></i></button>${rejectButton}</td></tr>`;
    }).join('');
  } catch (error) {
    tbody.innerHTML = '<tr><td colspan="5" class="error-state">Leave requests are unavailable.</td></tr>';
  }
}

async function loadPendingAdmissions() {
  const tbody = document.getElementById('admissionApproveBody');
  tbody.innerHTML = '<tr><td colspan="4"><div class="empty-state">Admission review actions are unavailable in this view.</div></td></tr>';
}

async function submitLeaveDecision(id, status) {
  const label = status === 'Approved' ? 'Approved' : 'Rejected';
  try {
    await apiFetch(`/leaves/${encodeURIComponent(id)}/status`, {
      method: 'PUT',
      body: JSON.stringify({ status }),
    });
    toast.success(label, `Leave request ${status.toLowerCase()}.`);
    await loadPendingLeaves();
  } catch (error) {
    toast.error('Error', error.message || `Leave request could not be ${status.toLowerCase()}.`);
  }
}

window.approveLeave = async function(id) {
  confirmAction('Approve this leave request?', () => submitLeaveDecision(id, 'Approved'));
};
window.rejectLeave = async function(id) {
  if (String(getUser()?.role || '').toLowerCase() === 'principal') {
    toast.error('Not authorized', 'Your role cannot reject leave requests.');
    return;
  }
  confirmAction('Reject this leave request?', () => submitLeaveDecision(id, 'Rejected'), 'Reject', true);
};

/* ── Notices ── */
window.submitNotice = async function() {
  const title = document.getElementById('noticeTitle').value;
  const type = document.getElementById('noticeType').value;
  const pri = document.getElementById('noticePri').value;
  const audience = document.getElementById('noticeAudience').value;
  const content = document.getElementById('noticeContent').value;
  if(!title) return toast.warning('Missing', 'Title is required');
  if(!audience) return toast.warning('Missing', 'Choose who should receive this notice');
  try {
    const response = await apiFetch('/notices', { method: 'POST', body: JSON.stringify({title, type, priority:pri, content, targetAudience:[audience]}) });
    if (response?.success !== true || !response.data?.notice) throw new Error('Notice creation was not confirmed by the server.');
    toast.success('Notice created', 'The notice was accepted by the server.');
    closeModal('addNoticeModal');
    await loadPrincipalNotices();
  } catch(e){ toast.error('Notice not created', e.message || 'The notice could not be created.'); }
};
