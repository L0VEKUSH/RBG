/* ── Admin Portal JS ── */
'use strict';

const ADMIN_NAV = [
  { label: 'System Admin', items: [
    { icon: 'shield-alt', text: 'Dashboard', panel: 'dashboard' },
    { icon: 'user-graduate', text: 'Student Records', panel: 'students' },
    { icon: 'users-cog', text: 'User Management', panel: 'users' },
    { icon: 'school', text: 'Classes', panel: 'classes' },
    { icon: 'calendar-check', text: 'Academic Years', panel: 'academic-years' },
    { icon: 'file-alt', text: 'Exam Schedules', panel: 'exams' },
    { icon: 'calendar-alt', text: 'Timetable', panel: 'timetable' },
    { icon: 'history', text: 'Audit Logs', panel: 'audit' },
    { icon: 'cogs', text: 'System Settings', panel: 'settings' },
  ]},
  { label: 'Account', items: [
    { icon: 'user', text: 'My Profile', panel: 'profile' }
  ]},
];

function hasPermission(permission) {
  let user = null;
  try {
    user = typeof getUser === 'function' ? getUser() : null;
  } catch (_) {
    return false;
  }
  if (!user) return false;
  if (user.role === 'super_admin') return true;

  const effectivePermissions = new Set(user.role === 'school_admin'
    ? ['students.promote', 'academic-years.view', 'academic-years.manage']
    : []);
  (Array.isArray(user.permissions) ? user.permissions : []).forEach(value => {
    if (typeof value !== 'string') return;
    if (value.startsWith('-')) effectivePermissions.delete(value.slice(1));
    else effectivePermissions.add(value);
  });
  return effectivePermissions.has(permission) || effectivePermissions.has('*');
}
window.hasPermission = hasPermission;

function updatePromotionPermissionVisibility() {
  const button = document.getElementById('openPromotionButton');
  if (!button) return;
  const allowed = hasPermission('students.promote');
  button.hidden = !allowed;
  button.classList.toggle('is-hidden', !allowed);
}
window.updatePromotionPermissionVisibility = updatePromotionPermissionVisibility;

function updateAcademicYearPermissionVisibility() {
  const canView = hasPermission('academic-years.view');
  const canManage = hasPermission('academic-years.manage');
  const panel = document.getElementById('panel-academic-years');
  const navLink = typeof document.querySelector === 'function'
    ? document.querySelector('[data-panel="academic-years"]')
    : null;
  const createButton = document.getElementById('openAcademicYearButton');

  if (panel) {
    panel.hidden = !canView;
    panel.classList.toggle('is-hidden', !canView);
  }
  if (navLink) {
    navLink.hidden = !canView;
    navLink.classList.toggle('is-hidden', !canView);
  }
  if (createButton) {
    createButton.hidden = !canManage;
    createButton.classList.toggle('is-hidden', !canManage);
  }
  if (typeof document.querySelectorAll === 'function') {
    document.querySelectorAll('[data-academic-year-manage]').forEach(element => {
      element.hidden = !canManage;
      element.classList.toggle('is-hidden', !canManage);
    });
  }
}
window.updateAcademicYearPermissionVisibility = updateAcademicYearPermissionVisibility;

const adminPortalInitialization = initPortal({
  role: 'super_admin',
  expectedRoles: ['super_admin', 'school_admin'],
  navConfig: ADMIN_NAV,
  onDashboardLoad: loadAdminDashboard
});
Promise.resolve(adminPortalInitialization).then(() => {
  updatePromotionPermissionVisibility();
  updateAcademicYearPermissionVisibility();
}).catch(() => {
  updatePromotionPermissionVisibility();
  updateAcademicYearPermissionVisibility();
});

window.onPanel_dashboard = () => loadAdminDashboard();
window.onPanel_students = () => window.loadStudentsForTc();
window.onPanel_users = () => loadUsers();
window.onPanel_classes = () => window.loadClasses();
window['onPanel_academic-years'] = async () => {
  await loadAcademicYears();
  populateRolloverYears();
};
window.onPanel_audit = () => loadAuditLogs();
window.onPanel_settings = () => loadSettings();

async function loadAdminDashboard() {
  const grid = document.getElementById('adminStats');
  const auditEl = document.getElementById('dashAudit');
  try {
    const data = await apiFetch('/dashboard/admin');
    const d = data.data || {};
    grid.innerHTML = `
      ${adminStatCard('Students', d.studentCount)}
      ${adminStatCard('Faculty', d.facultyCount)}
      ${adminStatCard('Classes', d.classCount)}
      ${adminStatCard('Admissions Today', d.recentAdmissions)}
    `;
  } catch (error) {
    grid.innerHTML = '<div class="empty-state">Dashboard statistics are unavailable.</div>';
  }
  await Promise.all([loadDashboardAudit(auditEl), loadSystemHealth()]);
}

function adminStatCard(label, value) {
  const rendered = value !== null && value !== undefined && Number.isFinite(Number(value)) ? formatNumber(Number(value)) : 'Unavailable';
  return `<div class="stat-card info"><div class="stat-icon info"><i class="fas fa-chart-bar"></i></div><div class="stat-content"><div class="stat-value">${rendered}</div><div class="stat-label">${label}</div></div></div>`;
}

window.loadStudentsForTc = async function() {
  const className = document.getElementById('tcClassFilter')?.value;
  const tbody = document.getElementById('tcStudentsBody');
  if (!tbody) return;
  if (!className) {
    tbody.textContent = 'Select a class to load its student records.';
    return;
  }
  tbody.innerHTML = '<tr><td colspan="5"><div class="spinner"></div></td></tr>';
  try {
    const response = await apiFetch(`/students/class/${encodeURIComponent(className)}`);
    const students = response?.data?.students;
    if (!response?.success || !Array.isArray(students)) throw new Error('Student records are unavailable.');
    tbody.replaceChildren();
    if (!students.length) {
      const row = document.createElement('tr');
      const cell = document.createElement('td');
      cell.colSpan = 5;
      cell.textContent = 'No active students found in this class.';
      row.appendChild(cell);
      tbody.appendChild(row);
      return;
    }
    students.forEach(student => {
      const row = document.createElement('tr');
      [student.admissionNumber, student.user?.name, student.class, student.academicYear].forEach(value => {
        const cell = document.createElement('td');
        cell.textContent = value || 'Unavailable';
        row.appendChild(cell);
      });
      const action = document.createElement('td');
      if (student.tcIssued) {
        action.textContent = `TC issued${student.tcLastEnrolledDate ? `; last enrolled ${schoolDateInputValue(student.tcLastEnrolledDate)}` : ''}`;
      } else {
        const date = document.createElement('input');
        date.type = 'date';
        date.required = true;
        date.setAttribute('aria-label', `Last enrolled date for ${student.user?.name || student.admissionNumber || 'student'}`);
        action.appendChild(date);
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'btn btn-danger btn-sm';
        button.textContent = 'Issue TC';
        button.setAttribute('data-csp-action-click', 'issueStudentTc');
        button.setAttribute('data-csp-args-click', encodeURIComponent(JSON.stringify([student._id])));
        button.setAttribute('data-csp-elements-click', '0');
        action.appendChild(button);
      }
      row.appendChild(action);
      tbody.appendChild(row);
    });
  } catch (error) {
    tbody.replaceChildren();
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = 5;
    cell.textContent = error.message || 'Student records could not be loaded.';
    row.appendChild(cell);
    tbody.appendChild(row);
  }
};

function schoolDateInputValue(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(date);
  const fields = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${fields.year}-${fields.month}-${fields.day}`;
}

window.issueStudentTc = async function(button, studentId) {
  const lastEnrolledDate = button.closest('tr')?.querySelector('input[type="date"]')?.value;
  if (!lastEnrolledDate) {
    toast.warning('Date required', 'Enter the last day the student was enrolled.');
    return;
  }
  confirmAction(
    `Issue this transfer certificate and deactivate the student with last-enrolled date ${lastEnrolledDate}?`,
    () => submitStudentTc(button, studentId, lastEnrolledDate),
    'Issue TC',
    true
  );
};

async function submitStudentTc(button, studentId, lastEnrolledDate) {
  button.disabled = true;
  try {
    const response = await apiFetch(`/students/${encodeURIComponent(studentId)}/tc`, {
      method: 'POST',
      body: JSON.stringify({ lastEnrolledDate }),
    });
    if (response?.success !== true || response.data?.student?.tcIssued !== true) {
      throw new Error('TC issuance was not confirmed by the server.');
    }
    toast.success('TC issued', 'Transfer certificate issued with the recorded last-enrolled date.');
    await window.loadStudentsForTc();
  } catch (error) {
    toast.error('TC not issued', error.message || 'The transfer certificate could not be issued.');
    button.disabled = false;
  }
}

async function loadDashboardAudit(container) {
  try {
    const response = await apiFetch('/audit-logs?limit=5');
    const logs = Array.isArray(response.data) ? response.data : [];
    if (!logs.length) {
      container.textContent = 'No audit events are available.';
      return;
    }
    container.innerHTML = logs.map((log) => {
      const name = log.user?.name || [log.user?.firstName, log.user?.lastName].filter(Boolean).join(' ') || 'Unknown user';
      const time = log.createdAt ? formatRelativeTime(log.createdAt) : 'Time unavailable';
      return `<div class="csp-style-3dc6424224"><div><span class="badge badge-info">${escapeAdminText(log.action || 'Unknown')}</span> <span class="csp-style-cc48077543">${escapeAdminText(name)}</span></div><div class="csp-style-e5e3caa3d0">${escapeAdminText(log.resource || 'Unknown resource')} · ${escapeAdminText(time)}</div></div>`;
    }).join('');
  } catch (error) {
    container.textContent = 'Audit events are unavailable.';
  }
}

function escapeAdminText(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

async function loadSystemHealth() {
  const apiStatus = document.getElementById('adminApiStatus');
  const dbStatus = document.getElementById('adminDbStatus');
  try {
    const response = await fetch('/health', { credentials: 'same-origin' });
    const health = await response.json();
    apiStatus.textContent = response.ok ? 'Online' : 'Unavailable';
    dbStatus.textContent = health.db === 'connected' ? 'Connected' : 'Disconnected';
  } catch (error) {
    apiStatus.textContent = 'Unavailable';
    dbStatus.textContent = 'Unavailable';
  }
}

/* ── Users ── */
let _adminDirectory = [];
let _adminEditingPerson = null;

async function loadUsers() {
  const tbody = document.getElementById('usersTableBody');
  if (!tbody) return;
  const type = document.getElementById('directoryType')?.value || 'students';
  tbody.innerHTML = '<tr><td colspan="5"><div class="spinner"></div></td></tr>';
  try {
    const response = type === 'teachers'
      ? await apiFetch('/faculty?limit=1000')
      : await apiFetch('/students?limit=1000');
    const rows = type === 'teachers' ? response?.data?.faculty : response?.students;
    if (response?.success !== true || !Array.isArray(rows)) throw new Error('Directory response was invalid.');
    _adminDirectory = rows;
    filterAdminDirectory();
  } catch (error) {
    _adminDirectory = [];
    tbody.innerHTML = `<tr><td colspan="5" class="error-state">${escapeAdminText(error.message || 'Directory could not be loaded.')}</td></tr>`;
  }
}

window.filterAdminDirectory = function() {
  const tbody = document.getElementById('usersTableBody');
  const type = document.getElementById('directoryType')?.value || 'students';
  const query = document.getElementById('userSearch')?.value.trim().toLowerCase() || '';
  const rows = _adminDirectory.filter(item => {
    const user = type === 'teachers' ? item.user || {} : item.user || {};
    const searchable = [user.name, user.email, item.class, item.admissionNumber, item.rollNumber, item.department, item.designation]
      .filter(Boolean).join(' ').toLowerCase();
    return !query || searchable.includes(query);
  });
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="5"><div class="empty-state">No ${type === 'teachers' ? 'teachers' : 'students'} found.</div></td></tr>`;
    return;
  }
  tbody.innerHTML = rows.map(item => {
    const user = item.user || {};
    const typeLabel = type === 'teachers' ? 'teachers' : 'students';
    const classOrDepartment = type === 'teachers' ? item.department : item.class;
    const admissionOrDesignation = type === 'teachers' ? item.designation : item.admissionNumber;
    const identity = cspActionAttrs('editAdminPerson', [typeLabel, String(item._id)]);
    return `<tr>
      <td>${escapeAdminText(user.name || 'Unavailable')}</td>
      <td>${escapeAdminText(user.email || 'Unavailable')}</td>
      <td>${escapeAdminText(classOrDepartment || 'Unavailable')}</td>
      <td>${escapeAdminText(admissionOrDesignation || 'Unavailable')}</td>
      <td><button type="button" class="btn btn-secondary btn-sm" ${identity}>Edit profile</button></td>
    </tr>`;
  }).join('');
};

window.editAdminPerson = function(type, id) {
  const record = _adminDirectory.find(item => String(item._id) === String(id));
  if (!record || !['students', 'teachers'].includes(type)) {
    toast.error('Profile unavailable', 'Reload the directory and try again.');
    return;
  }
  _adminEditingPerson = { type, id };
  const user = record.user || {};
  document.getElementById('personEditTitle').textContent = type === 'teachers' ? 'Edit teacher profile' : 'Edit student profile';
  document.getElementById('personName').value = user.name || '';
  document.getElementById('personEmail').value = user.email || '';
  document.getElementById('personPhone').value = user.phone || '';
  cspSetVisibility(document.getElementById('studentEditFields'), type === 'students', 'block');
  cspSetVisibility(document.getElementById('teacherEditFields'), type === 'teachers', 'block');
  if (type === 'students') {
    document.getElementById('personRollNumber').value = record.rollNumber || '';
  } else {
    document.getElementById('personDepartment').value = record.department || 'General';
    document.getElementById('personDesignation').value = record.designation || 'Teacher';
    document.getElementById('personJoiningDate').value = record.joiningDate ? schoolDateInputValue(record.joiningDate) : '';
  }
  openModal('personEditModal');
};

window.saveAdminPerson = async function(event) {
  event.preventDefault();
  if (!_adminEditingPerson) return toast.error('Profile unavailable', 'Choose a profile to edit.');
  const { type, id } = _adminEditingPerson;
  const body = {
    name: document.getElementById('personName').value.trim(),
    email: document.getElementById('personEmail').value.trim(),
    phone: document.getElementById('personPhone').value.trim(),
  };
  if (!body.name || !body.email) return toast.warning('Check profile', 'Name and email are required.');
  if (type === 'students') {
    const rollNumber = document.getElementById('personRollNumber').value.trim();
    if (rollNumber && !/^\d+$/.test(rollNumber)) {
      return toast.warning('Check profile', 'Enter a numeric student roll number.');
    }
    if (rollNumber) body.rollNumber = rollNumber;
  } else {
    body.department = document.getElementById('personDepartment').value;
    body.designation = document.getElementById('personDesignation').value;
    const joiningDate = document.getElementById('personJoiningDate').value;
    if (joiningDate) body.joiningDate = joiningDate;
  }
  try {
    const response = await apiFetch(`/${type === 'teachers' ? 'faculty' : 'students'}/${encodeURIComponent(id)}`, {
      method: 'PUT', body: JSON.stringify(body),
    });
    if (response?.success !== true) throw new Error('The profile update was not confirmed by the server.');
    closeModal('personEditModal');
    _adminEditingPerson = null;
    toast.success('Profile saved', 'The profile was updated.');
    await loadUsers();
  } catch (error) {
    toast.error('Update failed', error.message || 'The profile could not be updated.');
  }
};

function setInvitationFieldsEnabled(container, enabled) {
  container?.querySelectorAll('input, select, textarea').forEach((field) => {
    field.disabled = !enabled;
  });
}

window.toggleAdminInvitationFields = function() {
  const role = document.getElementById('inviteRole')?.value;
  const studentSelected = role === 'student';
  const teacherSelected = role === 'teacher';
  cspSetVisibility(document.getElementById('studentInviteFields'), studentSelected, 'block');
  cspSetVisibility(document.getElementById('teacherInviteFields'), teacherSelected, 'block');
  setInvitationFieldsEnabled(document.getElementById('studentInviteFields'), studentSelected);
  setInvitationFieldsEnabled(document.getElementById('teacherInviteFields'), teacherSelected);
};

window.newAdminInvitation = function() {
  const form = document.querySelector('#accountInviteModal form');
  if (!form) return toast.error('Invitation unavailable', 'Reload the page and try again.');
  form.reset();
  document.getElementById('inviteRole').value = 'student';
  window.toggleAdminInvitationFields();
  openModal('accountInviteModal');
};

window.submitAdminInvitation = async function(event) {
  event.preventDefault();
  const role = document.getElementById('inviteRole')?.value;
  if (!['student', 'teacher'].includes(role)) {
    return toast.error('Invitation unavailable', 'Choose Student or Teacher.');
  }

  const body = {
    name: document.getElementById('inviteName').value.trim(),
    email: document.getElementById('inviteEmail').value.trim(),
  };
  const phone = document.getElementById('invitePhone').value.trim();
  if (phone) body.phone = phone;

  if (role === 'student') {
    body.gender = document.getElementById('inviteStudentGender').value;
    body.dateOfBirth = document.getElementById('inviteStudentDob').value;
    body.class = document.getElementById('inviteStudentClass').value;
    body.rollNumber = document.getElementById('inviteStudentRoll').value.trim();
    body.academicYear = document.getElementById('inviteStudentYear').value.trim();
    body.enrollmentEffectiveFrom = document.getElementById('inviteEnrollmentDate').value;
    body.father = { name: document.getElementById('inviteFatherName').value.trim() };
    body.mother = { name: document.getElementById('inviteMotherName').value.trim() };
    if (!/^\d+$/.test(body.rollNumber)) {
      return toast.warning('Check student details', 'Enter a numeric roll number.');
    }
    if (!/^\d{4}-\d{4}$/.test(body.academicYear)) {
      return toast.warning('Check student details', 'Enter the academic year as YYYY-YYYY.');
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(body.enrollmentEffectiveFrom)) {
      return toast.warning('Enrollment date required', 'Enter the explicit school enrollment effective date.');
    }
  } else {
    body.department = document.getElementById('inviteTeacherDepartment').value;
    body.designation = document.getElementById('inviteTeacherDesignation').value;
    body.joiningDate = document.getElementById('inviteJoiningDate').value;
  }

  const submitButton = event.submitter || document.querySelector('#accountInviteModal button[type="submit"]');
  if (submitButton) submitButton.disabled = true;
  try {
    const response = await apiFetch(`/invitations/${role === 'student' ? 'students' : 'teachers'}`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
    if (response?.success !== true || !response.data?.profile) {
      throw new Error('The account creation was not confirmed by the server.');
    }

    const invitation = response.data.invitation;
    if (invitation?.accepted !== true) {
      const status = invitation?.status ? ` Current delivery status: ${invitation.status}.` : '';
      toast.warning('Account created; invitation not confirmed', `${response.message || 'The account is inactive.'}${status} Retry this email or contact an administrator.`);
      await loadUsers();
      return;
    }

    toast.success('Account invitation accepted', response.message || 'The activation invitation was accepted by the delivery workflow.');
    closeModal('accountInviteModal');
    document.getElementById('directoryType').value = role === 'teacher' ? 'teachers' : 'students';
    await loadUsers();
  } catch (error) {
    toast.error('Invitation not confirmed', error.message || 'The account invitation could not be completed.');
  } finally {
    if (submitButton) submitButton.disabled = false;
  }
};

let _academicYears = [];
let _editingAcademicYearId = null;
let _academicYearSaveInFlight = false;

function academicYearFormError(message) {
  const error = document.getElementById('academicYearFormError');
  if (!error) return;
  error.textContent = message || '';
  error.hidden = !message;
}

function validAcademicYearDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function validateAcademicYearForm(name, startDate, endDate) {
  const match = /^(\d{4})-(\d{4})$/.exec(name);
  if (!match || Number(match[2]) !== Number(match[1]) + 1) {
    return 'Enter a consecutive academic year in YYYY-YYYY format.';
  }
  if (!validAcademicYearDate(startDate) || !validAcademicYearDate(endDate)) {
    return 'Enter valid start and end dates.';
  }
  if (startDate >= endDate) return 'The start date must be earlier than the end date.';
  return '';
}

function academicYearActionButton(label, action, id, danger = false) {
  return `<button type="button" class="btn ${danger ? 'btn-danger' : 'btn-secondary'} btn-sm" aria-label="${escapeAdminText(label)}" ${cspActionAttrs(action, [String(id)])}>${label}</button>`;
}

window.loadAcademicYears = async function() {
  const tbody = document.getElementById('academicYearsTableBody');
  if (!tbody || !hasPermission('academic-years.view')) return;
  tbody.innerHTML = '<tr><td colspan="6"><div class="spinner"></div></td></tr>';
  try {
    const response = await apiFetch('/academic-years');
    const years = response?.data?.academicYears;
    if (response?.success !== true || !Array.isArray(years)) throw new Error('Academic year list response was invalid.');
    _academicYears = years;
    populateRolloverYears();
    loadSavedAcademicYearRollover();
    if (!_academicYears.length) {
      tbody.innerHTML = '<tr><td colspan="6"><div class="empty-state"><i class="fas fa-calendar-alt"></i><h4>No academic years configured</h4><p>Create an academic year to begin managing school enrollment periods.</p></div></td></tr>';
      return;
    }
    const canManage = hasPermission('academic-years.manage');
    tbody.innerHTML = _academicYears.map(item => {
      const id = String(item._id);
      const actions = canManage
        ? `${academicYearActionButton('Edit', 'editAcademicYear', id)} ${item.isActive === false
          ? academicYearActionButton('Activate', 'activateAcademicYear', id)
          : academicYearActionButton('Deactivate', 'deactivateAcademicYear', id, true)}`
        : '<span class="text-muted">View only</span>';
      return `<tr>
        <td>${escapeAdminText(item.name || 'Unavailable')}</td>
        <td>${escapeAdminText(schoolDateInputValue(item.startDate) || 'Unavailable')}</td>
        <td>${escapeAdminText(schoolDateInputValue(item.endDate) || 'Unavailable')}</td>
        <td><span class="badge ${item.isActive === false ? 'badge-secondary' : 'badge-success'}">${item.isActive === false ? 'Inactive' : 'Active'}</span></td>
        <td>${item.isCurrent ? '<span class="badge badge-info">Current</span>' : '<span class="text-muted">No</span>'}</td>
        <td class="actions-col">${actions}</td>
      </tr>`;
    }).join('');
  } catch (error) {
    _academicYears = [];
    tbody.innerHTML = `<tr><td colspan="6" class="error-state">${escapeAdminText(error.message || 'Academic years could not be loaded.')}</td></tr>`;
  }
};

let _academicYearRollover = null;

function populateRolloverYears() {
  const source = document.getElementById('rolloverSourceYear');
  const destination = document.getElementById('rolloverDestinationYear');
  if (!source || !destination) return;
  const current = _academicYears.find(year => year.isCurrent === true);
  const options = _academicYears.map(year =>
    `<option value="${escapeAdminText(year.name)}">${escapeAdminText(year.name)}${year.isCurrent ? ' (Current)' : ''}</option>`
  ).join('');
  source.innerHTML = options;
  destination.innerHTML = options;
  if (current) {
    source.value = current.name;
    const next = _academicYears.find(year => year.startDate > current.startDate && year.name !== current.name);
    if (next) destination.value = next.name;
  }
}

function rolloverDecisionOptions(decision) {
  const terminal = ['graduate', 'withdraw', 'transfer'];
  const eligible = decision.currentIsActive === true && decision.currentTcIssued !== true;
  const class12 = String(decision.currentClass) === '12';
  const options = [
    ['pending', 'Keep pending', true],
    ['promote', 'Promote to next class', eligible && !class12],
    ['continue', 'Continue in same class', eligible],
    ['graduate', 'Graduate', eligible && class12],
    ['withdraw', 'Withdraw', eligible],
    ['transfer', 'Transfer / issue TC', eligible],
    ['leave_unchanged', 'Leave unchanged (no rollover mutation)', true],
  ];
  return options.map(([value, label, allowed]) =>
    `<option value="${value}" ${decision.action === value ? 'selected' : ''} ${allowed ? '' : 'disabled'}>${label}</option>`
  ).join('');
}

function rolloverReason(decision) {
  if (decision.currentTcIssued === true) {
    return 'TC already issued. Select "Leave unchanged" to confirm no new enrollment without reactivating.';
  }
  if (decision.currentIsActive !== true) {
    return 'Inactive student. Select "Leave unchanged" to preserve inactive status without re-enrollment.';
  }
  if (String(decision.currentClass) === '12') {
    return 'Class 12 is terminal; choose Graduate, Withdraw, Transfer, Leave unchanged, or Pending.';
  }
  return '';
}

function renderRolloverDecisions() {
  const tbody = document.getElementById('rolloverDecisionsBody');
  if (!tbody || !_academicYearRollover) return;
  tbody.innerHTML = _academicYearRollover.decisions.map(decision => {
    const terminal = ['graduate', 'withdraw', 'transfer'].includes(decision.action);
    const reason = decision.result === 'applied' ? 'Applied successfully.' :
      decision.action === 'leave_unchanged' ? 'Explicitly left unchanged; record remains in source year.' :
      rolloverReason(decision);
    return `<tr data-rollover-student="${escapeAdminText(decision.student)}">
      <td>${escapeAdminText(decision.currentClass)}</td>
      <td>${escapeAdminText(decision.currentAcademicYear)}</td>
      <td>${decision.currentTcIssued ? 'TC issued' : decision.currentIsActive ? 'Active' : 'Inactive'}</td>
      <td><select class="form-control rollover-action" aria-label="Rollover decision for ${escapeAdminText(decision.studentName || 'student')}" ${cspActionAttrs('updateRolloverDecision', [String(decision.student)], 'change', [0])}>${rolloverDecisionOptions(decision)}</select></td>
      <td><input class="form-control rollover-effective-date" type="date" aria-label="Effective date for ${escapeAdminText(decision.studentName || 'student')}" value="${escapeAdminText(decision.effectiveDate ? schoolDateInputValue(decision.effectiveDate) : '')}" ${terminal ? '' : 'disabled'}></td>
      <td class="text-muted">${escapeAdminText(reason || 'Explicit administrator decision required.')}</td>
    </tr>`;
  }).join('');
}

async function loadSavedAcademicYearRollover() {
  const source = document.getElementById('rolloverSourceYear')?.value;
  const destination = document.getElementById('rolloverDestinationYear')?.value;
  if (!source || !destination || !hasPermission('academic-years.manage')) return;
  try {
    const response = await apiFetch('/academic-years/rollover');
    const rollovers = Array.isArray(response?.data?.rollovers) ? response.data.rollovers : [];
    const saved = rollovers.find(item =>
      item.sourceAcademicYear === source && item.destinationAcademicYear === destination
    );
    if (saved) {
      _academicYearRollover = saved;
      renderRolloverDecisions();
      const message = document.getElementById('rolloverMessage');
      if (message) message.textContent = 'Saved rollover draft loaded. Review or update its pending decisions.';
    }
  } catch (error) {
    const message = document.getElementById('rolloverMessage');
    if (message) message.textContent = error.message || 'Saved rollover drafts could not be checked.';
  }
}

window.startAcademicYearRollover = async function() {
  if (!hasPermission('academic-years.manage')) return toast.error('Not authorized', 'You do not have permission to execute rollovers.');
  const source = document.getElementById('rolloverSourceYear')?.value;
  const destination = document.getElementById('rolloverDestinationYear')?.value;
  if (!source || !destination || source === destination) {
    return toast.warning('Choose academic years', 'Select different source and destination academic years.');
  }
  try {
    const response = await apiFetch('/academic-years/rollover', {
      method: 'POST', body: JSON.stringify({ sourceAcademicYear: source, destinationAcademicYear: destination }),
    });
    _academicYearRollover = response?.data?.rollover;
    if (!_academicYearRollover) throw new Error('The rollover draft was not returned by the server.');
    renderRolloverDecisions();
    document.getElementById('rolloverMessage').textContent = 'Draft loaded. Save explicit decisions before execution.';
  } catch (error) {
    toast.error('Rollover not loaded', error.message || 'The rollover draft could not be created.');
  }
};

window.updateRolloverDecision = function(select, studentId) {
  const row = select.closest('tr');
  const decision = _academicYearRollover?.decisions.find(item => String(item.student) === String(studentId));
  if (!row || !decision) return;
  decision.action = select.value;
  const date = row.querySelector('.rollover-effective-date');
  const terminal = ['graduate', 'withdraw', 'transfer'].includes(decision.action);
  if (date) {
    date.disabled = !terminal;
    if (!terminal) date.value = '';
    decision.effectiveDate = date.value || undefined;
  }
  renderRolloverDecisions();
};

window.saveRolloverDecisions = async function() {
  if (!_academicYearRollover) return toast.warning('No rollover draft', 'Load students before saving decisions.');
  const expectedRevision = Number.isSafeInteger(_academicYearRollover.revision) ? _academicYearRollover.revision : 0;
  const decisions = _academicYearRollover.decisions.map(decision => {
    const row = document.querySelector(`[data-rollover-student="${decision.student}"]`);
    const action = row?.querySelector('.rollover-action')?.value || decision.action;
    const effectiveDate = row?.querySelector('.rollover-effective-date')?.value || undefined;
    return {
      student: decision.student, action, currentClass: decision.currentClass,
      currentAcademicYear: decision.currentAcademicYear, currentIsActive: decision.currentIsActive,
      currentTcIssued: decision.currentTcIssued, effectiveDate,
    };
  });
  try {
    const response = await apiFetch(`/academic-years/rollover/${encodeURIComponent(_academicYearRollover._id)}/decisions`, {
      method: 'PUT', body: JSON.stringify({ decisions, expectedRevision }),
    });
    _academicYearRollover = response?.data?.rollover;
    renderRolloverDecisions();
    toast.success('Decisions saved', 'Pending decisions were saved without changing student records.');
  } catch (error) {
    if (error.statusCode === 409 || (error.message && /changed since it was loaded|modified or executed/i.test(error.message))) {
      toast.warning('Draft conflict (409)', 'This rollover draft was modified or executed concurrently. Reloading saved draft...');
      await loadSavedAcademicYearRollover();
    } else {
      toast.error('Decisions not saved', error.message || 'The rollover decisions could not be saved.');
    }
  }
};

window.executeAcademicYearRollover = function() {
  if (!_academicYearRollover) return toast.warning('No rollover draft', 'Load and save decisions before execution.');
  if (_academicYearRollover.decisions.some(decision => decision.action === 'pending')) {
    return toast.warning('Decisions incomplete', 'Choose an explicit action for every student before execution.');
  }
  confirmAction(
    'Execute these saved academic-year decisions? Student records and the current-year state will change only after the transaction succeeds.',
    async () => {
      try {
        const response = await apiFetch(`/academic-years/rollover/${encodeURIComponent(_academicYearRollover._id)}/execute`, { method: 'POST' });
        _academicYearRollover = response?.data?.rollover || _academicYearRollover;
        toast.success('Rollover completed', 'All approved decisions were recorded and applied.');
        await loadAcademicYears();
        renderRolloverDecisions();
        const message = document.getElementById('rolloverMessage');
        if (message) message.textContent = 'Rollover completed. The applied decisions remain visible below for review.';
      } catch (error) {
        toast.error('Rollover failed', error.message || 'No rollover changes were confirmed.');
      }
    },
    'Execute rollover',
    true
  );
};

window.openAcademicYearModal = function() {
  if (!hasPermission('academic-years.manage')) {
    toast.error('Not authorized', 'You do not have permission to manage academic years.');
    return;
  }
  _editingAcademicYearId = null;
  document.getElementById('academicYearModalTitle').textContent = 'Add academic year';
  document.getElementById('academicYearName').value = '';
  document.getElementById('academicYearStartDate').value = '';
  document.getElementById('academicYearEndDate').value = '';
  academicYearFormError('');
  openModal('academicYearModal');
};

window.editAcademicYear = function(id) {
  if (!hasPermission('academic-years.manage')) {
    toast.error('Not authorized', 'You do not have permission to manage academic years.');
    return;
  }
  const item = _academicYears.find(record => String(record._id) === String(id));
  if (!item) return toast.error('Academic year unavailable', 'Reload the academic year list and try again.');
  _editingAcademicYearId = String(item._id);
  document.getElementById('academicYearModalTitle').textContent = 'Edit academic year';
  document.getElementById('academicYearName').value = item.name || '';
  document.getElementById('academicYearStartDate').value = schoolDateInputValue(item.startDate);
  document.getElementById('academicYearEndDate').value = schoolDateInputValue(item.endDate);
  academicYearFormError('');
  openModal('academicYearModal');
};

window.saveAcademicYear = async function(event) {
  event.preventDefault();
  if (_academicYearSaveInFlight) return;
  const name = document.getElementById('academicYearName').value.trim();
  const startDate = document.getElementById('academicYearStartDate').value;
  const endDate = document.getElementById('academicYearEndDate').value;
  const validationMessage = validateAcademicYearForm(name, startDate, endDate);
  if (validationMessage) {
    academicYearFormError(validationMessage);
    return;
  }

  _academicYearSaveInFlight = true;
  const button = document.getElementById('academicYearSubmitButton');
  setButtonLoading(button, true);
  academicYearFormError('');
  try {
    const response = await apiFetch(
      _editingAcademicYearId ? `/academic-years/${encodeURIComponent(_editingAcademicYearId)}` : '/academic-years',
      { method: _editingAcademicYearId ? 'PUT' : 'POST', body: JSON.stringify({ name, startDate, endDate }) }
    );
    if (response?.success !== true) throw new Error('The academic year update was not confirmed by the server.');
    closeModal('academicYearModal');
    toast.success(_editingAcademicYearId ? 'Academic year updated' : 'Academic year created', response.message || 'Academic year saved.');
    await loadAcademicYears();
  } catch (error) {
    academicYearFormError(error.message || 'The academic year could not be saved.');
    toast.error('Academic year not saved', error.message || 'The academic year could not be saved.');
  } finally {
    _academicYearSaveInFlight = false;
    setButtonLoading(button, false);
  }
};

async function setAcademicYearActiveState(id, active) {
  if (!hasPermission('academic-years.manage')) {
    toast.error('Not authorized', 'You do not have permission to manage academic years.');
    return;
  }
  try {
    const response = await apiFetch(`/academic-years/${encodeURIComponent(id)}/${active ? 'activate' : 'deactivate'}`, { method: 'PATCH' });
    if (response?.success !== true) throw new Error(`The academic year could not be ${active ? 'activated' : 'deactivated'}.`);
    toast.success(active ? 'Academic year activated' : 'Academic year deactivated', response.message || 'Status updated.');
    await loadAcademicYears();
  } catch (error) {
    toast.error(active ? 'Activation failed' : 'Deactivation failed', error.message || 'The academic year status could not be changed.');
  }
}

window.activateAcademicYear = function(id) {
  confirmAction('Activate this academic year?', () => setAcademicYearActiveState(id, true), 'Activate');
};

window.deactivateAcademicYear = function(id) {
  confirmAction('Deactivate this academic year? The current academic year cannot be deactivated.', () => setAcademicYearActiveState(id, false), 'Deactivate', true);
};

const SCHOOL_CLASS_LEVELS = ['Pre-Nursery', 'Nursery', 'LKG', 'UKG', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'];
let _schoolClasses = [];
let _editingClassId = null;

function classAcademicLevel(name) {
  if (['Pre-Nursery', 'Nursery', 'LKG', 'UKG'].includes(name)) return 'Pre-Primary';
  const grade = Number(name);
  if (grade <= 5) return 'Primary';
  if (grade <= 8) return 'Middle';
  if (grade <= 10) return 'Secondary';
  return 'Senior Secondary';
}

function renderClassLevelPreview() {
  const name = document.getElementById('className')?.value;
  const preview = document.getElementById('classLevelPreview');
  if (preview) preview.textContent = `Academic level: ${classAcademicLevel(name || 'Pre-Nursery')}`;
}
window.previewClassLevel = renderClassLevelPreview;

window.loadClasses = async function() {
  const tbody = document.getElementById('classesTableBody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="5"><div class="spinner"></div></td></tr>';
  try {
    const response = await apiFetch('/classes');
    if (response?.success !== true || !Array.isArray(response.data)) throw new Error('Class list response was invalid.');
    _schoolClasses = response.data;
    if (!_schoolClasses.length) {
      tbody.innerHTML = '<tr><td colspan="5"><div class="empty-state">No classes are configured.</div></td></tr>';
      return;
    }
    tbody.innerHTML = _schoolClasses.map(item => `<tr>
      <td>${escapeAdminText(classDisplayName(item.name))}</td>
      <td>${escapeAdminText(item.academicYear || 'Unavailable')}</td>
      <td>${escapeAdminText(item.academicLevel || 'Unavailable')}</td>
      <td>${item.isActive === false ? 'Inactive' : 'Active'}</td>
      <td><button type="button" class="btn btn-secondary btn-sm" ${cspActionAttrs('editSchoolClass', [String(item._id)])}>Edit</button> <button type="button" class="btn btn-danger btn-sm" ${cspActionAttrs('deleteSchoolClass', [String(item._id)])}>Delete</button></td>
    </tr>`).join('');
  } catch (error) {
    tbody.innerHTML = `<tr><td colspan="5" class="error-state">${escapeAdminText(error.message || 'Classes could not be loaded.')}</td></tr>`;
  }
};

function classDisplayName(name) {
  return ({ 'Pre-Nursery': 'NC (Pre-Nursery)', LKG: 'KG-1 (LKG)', UKG: 'KG-2 (UKG)' })[name] || (Number(name) ? `Class ${name}` : name);
}

window.newSchoolClass = function() {
  _editingClassId = null;
  document.getElementById('classEditTitle').textContent = 'Add class';
  document.getElementById('className').disabled = false;
  document.getElementById('className').value = 'Pre-Nursery';
  document.getElementById('classAcademicYear').value = '';
  renderClassLevelPreview();
  openModal('classEditModal');
};

window.editSchoolClass = function(id) {
  const item = _schoolClasses.find(record => String(record._id) === String(id));
  if (!item) return toast.error('Class unavailable', 'Reload the class list and try again.');
  _editingClassId = String(item._id);
  document.getElementById('classEditTitle').textContent = `Edit ${classDisplayName(item.name)}`;
  document.getElementById('className').value = item.name;
  document.getElementById('className').disabled = true;
  document.getElementById('classAcademicYear').value = item.academicYear || '';
  renderClassLevelPreview();
  openModal('classEditModal');
};

window.saveSchoolClass = async function(event) {
  event.preventDefault();
  const name = document.getElementById('className').value;
  const academicYear = document.getElementById('classAcademicYear').value.trim();
  const match = /^(\d{4})-(\d{4})$/.exec(academicYear);
  if (!SCHOOL_CLASS_LEVELS.includes(name) || !match || Number(match[2]) !== Number(match[1]) + 1) {
    return toast.warning('Check class details', 'Choose a supported class and enter a consecutive school academic year in YYYY-YYYY format.');
  }
  const payload = {
    name,
    academicYear,
    academicLevel: classAcademicLevel(name),
    displayOrder: SCHOOL_CLASS_LEVELS.indexOf(name) + 1,
  };
  try {
    const response = await apiFetch(_editingClassId ? `/classes/${encodeURIComponent(_editingClassId)}` : '/classes', {
      method: _editingClassId ? 'PUT' : 'POST', body: JSON.stringify(payload),
    });
    if (response?.success !== true) throw new Error('The class update was not confirmed by the server.');
    closeModal('classEditModal');
    toast.success('Class saved', 'Class details were saved.');
    await loadClasses();
  } catch (error) {
    toast.error('Class not saved', error.message || 'Class details could not be saved.');
  } finally {
    document.getElementById('className').disabled = false;
  }
};

window.deleteSchoolClass = function(id) {
  const item = _schoolClasses.find(record => String(record._id) === String(id));
  if (!item) return toast.error('Class unavailable', 'Reload the class list and try again.');
  confirmAction(`Delete ${classDisplayName(item.name)} for ${item.academicYear}? This removes the class record.`, async () => {
    try {
      const response = await apiFetch(`/classes/${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (response?.success !== true) throw new Error('Class deletion was not confirmed by the server.');
      toast.success('Class deleted', 'The class record was deleted.');
      await loadClasses();
    } catch (error) {
      toast.error('Delete failed', error.message || 'The class record could not be deleted.');
    }
  }, 'Delete class', true);
};
window.loadAuditLogs = async function() {
  const tbody = document.getElementById('auditTableBody');
  tbody.innerHTML = '<tr><td colspan="5"><div class="spinner"></div></td></tr>';
  const params = new URLSearchParams({ limit: '100' });
  const action = document.getElementById('auditActionFilter')?.value;
  const dateFilter = document.getElementById('auditDateFilter')?.value;
  if (action) params.set('action', action);
  try {
    const response = await apiFetch('/audit-logs?' + params.toString());
    let logs = Array.isArray(response.data) ? response.data : [];
    if (dateFilter) logs = logs.filter(log => log.createdAt && new Date(log.createdAt).toISOString().slice(0, 10) === dateFilter);
    if (!logs.length) {
      tbody.innerHTML = '<tr><td colspan="5"><div class="empty-state">No audit events found.</div></td></tr>';
      return;
    }
    tbody.innerHTML = logs.map(log => {
      const userName = log.user?.name || [log.user?.firstName, log.user?.lastName].filter(Boolean).join(' ') || log.user?._id || 'Unknown user';
      return '<tr><td>' + escapeAdminText(log.createdAt ? formatDate(log.createdAt, 'DD MMM YYYY') : 'Unavailable') + ' <span class="csp-style-3bdae21a61">' + escapeAdminText(log.createdAt ? formatTime(log.createdAt) : '') + '</span></td><td>' + escapeAdminText(userName) + '</td><td><span class="badge badge-secondary">' + escapeAdminText(log.action || 'Unknown') + '</span></td><td>' + escapeAdminText(log.resource || 'Unknown') + '</td><td class="csp-style-6f9e134600">' + escapeAdminText(log.ipAddress || 'Unavailable') + '</td></tr>';
    }).join('');
  } catch (error) {
    tbody.innerHTML = '<tr><td colspan="5" class="error-state">Audit events are unavailable.</td></tr>';
  }
};

const SETTINGS_FIELDS = {
  schoolName: 'setSchoolName',
  contactEmail: 'setContactEmail',
  address: 'setAddress',
  academicYear: 'setAcadYear',
  timezone: 'setTimezone',
  parentPortalEnabled: 'setParentPortalEnabled',
  maintenanceMode: 'setMaintenanceMode'
};
let _settingsLoaded = false;

async function loadSettings() {
  _settingsLoaded = false;
  try {
    const response = await apiFetch('/settings');
    if (!Array.isArray(response.data)) throw new Error('Settings response is invalid.');
    for (const setting of response.data || []) {
      const element = document.getElementById(SETTINGS_FIELDS[setting.key]);
      if (!element) continue;
      if (element.type === 'checkbox') element.checked = setting.value === true;
      else element.value = setting.value ?? '';
    }
    _settingsLoaded = true;
  } catch (error) {
    toast.error('Settings unavailable', 'School settings could not be loaded.');
  }
}

window.saveSettings = async function() {
  if (!_settingsLoaded) {
    toast.error('Save unavailable', 'Load school settings successfully before saving changes.');
    return;
  }
  const settings = Object.entries(SETTINGS_FIELDS).map(([key, id]) => {
    const element = document.getElementById(id);
    return { key, value: element.type === 'checkbox' ? element.checked : element.value.trim() };
  });
  try {
    const response = await apiFetch('/settings/bulk', { method: 'POST', body: JSON.stringify({ settings }) });
    if (!response.success) throw new Error('Settings update was not confirmed by the server.');
    toast.success('Settings Saved', 'School settings were updated.');
  } catch (error) {
    toast.error('Save Failed', error.message || 'School settings could not be updated.');
  }
};

/* ── Bulk Student Promotion ── */

const CANONICAL_CLASS_MAP = Object.freeze({
  'Nursery': 'LKG',
  'LKG': 'UKG',
  'UKG': '1',
  '1': '2', '2': '3', '3': '4', '4': '5', '5': '6',
  '6': '7', '7': '8', '8': '9', '9': '10', '10': '11','11': '12',
});
const PROMOTION_CLASS_LEVELS = new Set(['Nursery', 'LKG', 'UKG', ...Array.from({ length: 12 }, (_, index) => String(index + 1))]);

function isValidPromotionAcademicYear(value) {
  const match = typeof value === 'string' && /^(\d{4})-(\d{4})$/.exec(value);
  return Boolean(match && Number(match[1]) > 0 && Number(match[2]) === Number(match[1]) + 1);
}

function areConsecutivePromotionYears(sourceYear, targetYear) {
  return isValidPromotionAcademicYear(sourceYear) && isValidPromotionAcademicYear(targetYear) &&
    Number(targetYear.slice(0, 4)) === Number(sourceYear.slice(0, 4)) + 1;
}

function isPromotionStudentEligible(student, sourceClass, sourceYear) {
  return Boolean(student && /^[a-f\d]{24}$/i.test(String(student._id || '')) &&
    PROMOTION_CLASS_LEVELS.has(student.class) && student.class === sourceClass &&
    student.academicYear === sourceYear && student.isActive !== false &&
    Object.prototype.hasOwnProperty.call(CANONICAL_CLASS_MAP, sourceClass));
}

let _promoLoadedStudents = [];
let _isPromoting = false;

window.openPromotionModal = function() {
  if (!hasPermission('students.promote')) {
    updatePromotionPermissionVisibility();
    return;
  }
  _promoLoadedStudents = [];
  const filterCls = document.getElementById('promoClassFilter');
  if (filterCls) filterCls.value = '';
  const srcYear = document.getElementById('promoSourceYear');
  if (srcYear) {
    const currentYear = document.getElementById('setAcadYear')?.value || '';
    srcYear.value = currentYear;
  }
  const tgtYear = document.getElementById('promoTargetYear');
  if (tgtYear && srcYear?.value && /^\d{4}-\d{4}$/.test(srcYear.value)) {
    const [start, end] = srcYear.value.split('-').map(Number);
    tgtYear.value = `${start + 1}-${end + 1}`;
  } else if (tgtYear) {
    tgtYear.value = '';
  }
  const resultsCard = document.getElementById('promoResultsCard');
  if (resultsCard) cspSetVisibility(resultsCard, false);
  const tbody = document.getElementById('promoStudentsBody');
  if (tbody) tbody.innerHTML = '<tr><td colspan="6">Choose a class and source academic year above.</td></tr>';
  const summary = document.getElementById('promoSummary');
  if (summary) summary.textContent = 'Select a class and academic year to preview students.';
  const btn = document.getElementById('btnSubmitPromotion');
  if (btn) btn.disabled = true;
  openModal('promotionModal');
};

window.onPromoFilterChange = async function() {
  const cls = document.getElementById('promoClassFilter')?.value;
  const srcYear = document.getElementById('promoSourceYear')?.value.trim();
  const tgtYearInput = document.getElementById('promoTargetYear');
  
  if (srcYear && /^\d{4}-\d{4}$/.test(srcYear) && (!tgtYearInput?.value || tgtYearInput.value === srcYear)) {
    const [start, end] = srcYear.split('-').map(Number);
    if (tgtYearInput) tgtYearInput.value = `${start + 1}-${end + 1}`;
  }

  if (!cls || !isValidPromotionAcademicYear(srcYear)) {
    document.getElementById('promoStudentsBody').innerHTML = '<tr><td colspan="6">Select a source class and a valid source academic year.</td></tr>';
    document.getElementById('promoSummary').textContent = 'Select a class and valid source academic year to preview students.';
    document.getElementById('btnSubmitPromotion').disabled = true;
    _promoLoadedStudents = [];
    return;
  }

  const tbody = document.getElementById('promoStudentsBody');
  tbody.innerHTML = '<tr><td colspan="6"><div class="spinner"></div> Loading students…</td></tr>';
  document.getElementById('btnSubmitPromotion').disabled = true;

  try {
    const query = srcYear ? `?academicYear=${encodeURIComponent(srcYear)}` : '';
    const res = await apiFetch(`/students/class/${encodeURIComponent(cls)}${query}`);
    const students = res.data?.students || [];
    _promoLoadedStudents = students;
    window.updatePromotionPreview();
  } catch (error) {
    _promoLoadedStudents = [];
    tbody.innerHTML = `<tr><td colspan="6" class="error-state">${escapeAdminText(error.message || 'Failed to load students.')}</td></tr>`;
    document.getElementById('promoSummary').textContent = 'Error loading students.';
    document.getElementById('btnSubmitPromotion').disabled = true;
  }
};

window.updatePromotionPreview = function() {
  const tbody = document.getElementById('promoStudentsBody');
  const summary = document.getElementById('promoSummary');
  const btn = document.getElementById('btnSubmitPromotion');
  const selectAll = document.getElementById('promoSelectAll');
  if (!tbody) return;

  const cls = document.getElementById('promoClassFilter')?.value;
  const srcYear = document.getElementById('promoSourceYear')?.value.trim();
  const tgtYear = document.getElementById('promoTargetYear')?.value.trim();

  if (!_promoLoadedStudents.length) {
    tbody.innerHTML = '<tr><td colspan="6"><div class="empty-state">No students found for this class and academic year.</div></td></tr>';
    if (summary) summary.textContent = 'No eligible students.';
    if (btn) btn.disabled = true;
    if (selectAll) selectAll.checked = false;
    return;
  }

  const nextClass = CANONICAL_CLASS_MAP[cls] || null;
  const isTerminal = cls === '12';

  let eligibleCount = 0;

  tbody.innerHTML = _promoLoadedStudents.map(student => {
    const user = student.user || {};
    const studentId = String(student._id);
    let targetClassDisplay = '';
    let statusBadge = '';
    let isEligible = false;

    if (isTerminal) {
      targetClassDisplay = '<em>None (Class 12 is terminal)</em>';
      statusBadge = '<span class="badge badge-warning">Graduating / Terminal</span>';
    } else if (!nextClass) {
      targetClassDisplay = '<em>No next class</em>';
      statusBadge = '<span class="badge badge-danger">Cannot be promoted automatically</span>';
    } else if (!isPromotionStudentEligible(student, cls, srcYear)) {
      targetClassDisplay = '<em>Blocked</em>';
      statusBadge = '<span class="badge badge-danger">Invalid or ineligible student</span>';
    } else if (!areConsecutivePromotionYears(srcYear, tgtYear)) {
      targetClassDisplay = `<strong>Class ${nextClass}</strong>`;
      statusBadge = '<span class="badge badge-warning">Target year must be consecutive</span>';
    } else {
      targetClassDisplay = `<strong>Class ${nextClass}</strong>`;
      statusBadge = '<span class="badge badge-success">Eligible</span>';
      isEligible = true;
      eligibleCount++;
    }

    const disabledAttr = !isEligible ? 'disabled' : '';
    const checkedAttr = isEligible ? 'checked' : '';

    return `<tr>
      <td><input type="checkbox" class="promo-student-cb" aria-label="Select student ${escapeAdminText(user.name || 'Student')} for promotion" value="${escapeAdminText(studentId)}" ${disabledAttr} ${checkedAttr} data-csp-action-change="onPromoCheckChange" data-csp-args-change="%5B%5D"></td>
      <td>${escapeAdminText(student.admissionNumber || '—')}</td>
      <td>${escapeAdminText(user.name || 'Student')}</td>
      <td>${escapeAdminText(classDisplayName(student.class))}</td>
      <td>${targetClassDisplay}</td>
      <td>${statusBadge}</td>
    </tr>`;
  }).join('');

  if (summary) {
    summary.textContent = `${eligibleCount} of ${_promoLoadedStudents.length} student(s) eligible for promotion to Class ${nextClass || '—'}.`;
  }

  window.onPromoCheckChange();
};

window.toggleSelectAllPromo = function() {
  const master = document.getElementById('promoSelectAll');
  const checkboxes = document.querySelectorAll('.promo-student-cb:not(:disabled)');
  checkboxes.forEach(cb => { cb.checked = master.checked; });
  window.onPromoCheckChange();
};

window.onPromoCheckChange = function() {
  const checkboxes = Array.from(document.querySelectorAll('.promo-student-cb:not(:disabled)'));
  const checked = checkboxes.filter(cb => cb.checked);
  const btn = document.getElementById('btnSubmitPromotion');
  const tgtYear = document.getElementById('promoTargetYear')?.value.trim();
  const srcYear = document.getElementById('promoSourceYear')?.value.trim();
  const cls = document.getElementById('promoClassFilter')?.value;
  const isValidYear = areConsecutivePromotionYears(srcYear, tgtYear);

  const master = document.getElementById('promoSelectAll');
  if (master && checkboxes.length) {
    master.checked = checked.length === checkboxes.length;
  }

  if (btn) {
    btn.disabled = _isPromoting || checked.length === 0 || !isValidYear ||
      !hasPermission('students.promote') || !Object.prototype.hasOwnProperty.call(CANONICAL_CLASS_MAP, cls);
  }
};

window.submitPromotion = async function() {
  if (_isPromoting || !hasPermission('students.promote')) {
    updatePromotionPermissionVisibility();
    return;
  }

  const selectedCheckboxes = document.querySelectorAll('.promo-student-cb:checked');
  const srcYear = document.getElementById('promoSourceYear')?.value.trim();
  const tgtYear = document.getElementById('promoTargetYear')?.value.trim();
  const cls = document.getElementById('promoClassFilter')?.value;
  const nextClass = CANONICAL_CLASS_MAP[cls];
  const eligibleIds = new Set(_promoLoadedStudents
    .filter(student => isPromotionStudentEligible(student, cls, srcYear))
    .map(student => String(student._id)));
  const studentIds = Array.from(selectedCheckboxes)
    .filter(cb => !cb.disabled && eligibleIds.has(String(cb.value)))
    .map(cb => String(cb.value));

  if (!areConsecutivePromotionYears(srcYear, tgtYear)) {
    toast.warning('Invalid promotion years', 'The target academic year must be consecutive to the selected source year.');
    return;
  }
  if (!studentIds.length) {
    toast.warning('No students selected', 'Please select at least one eligible student to promote.');
    return;
  }
  if (!nextClass) {
    toast.warning('Class is not eligible', 'This class cannot be automatically promoted.');
    return;
  }

  confirmAction(
    `Promote ${studentIds.length} student(s) from Class ${classDisplayName(cls)} to Class ${nextClass} for academic year ${tgtYear}?`,
    () => executePromotion(studentIds, srcYear, cls, tgtYear),
    'Confirm Promotion',
    false
  );
};

async function executePromotion(studentIds, sourceAcademicYear, sourceClass, newAcademicYear) {
  if (_isPromoting || !hasPermission('students.promote')) return;
  const btn = document.getElementById('btnSubmitPromotion');
  const resultsCard = document.getElementById('promoResultsCard');
  const resultsBody = document.getElementById('promoResultsBody');

  _isPromoting = true;
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Promoting…';
  }

  try {
    const payload = {
      studentIds,
      sourceAcademicYear,
      sourceClass,
      newAcademicYear
    };

    const res = await apiFetch('/students/promote', {
      method: 'POST',
      body: JSON.stringify(payload)
    });

    const promotedStudents = Array.isArray(res?.data?.students) ? res.data.students : [];
    const expectedIds = new Set(studentIds);
    const promotedIds = promotedStudents.map(student => String(student?._id || ''));
    const completeBatch = res?.success === true && Number.isInteger(res.data?.promotedCount) &&
      res.data.promotedCount === studentIds.length && promotedIds.length === studentIds.length &&
      new Set(promotedIds).size === expectedIds.size && promotedIds.every(id => expectedIds.has(id));

    if (completeBatch) {
      const promotedCount = res.data.promotedCount;
      toast.success('Promotion Completed', `${promotedCount} student(s) promoted successfully.`);

      if (resultsCard && resultsBody) {
        resultsBody.innerHTML = `
          <div class="alert alert-success">
            <i class="fas fa-check-circle"></i> <strong>Success!</strong> ${res.message || `${promotedCount} student(s) promoted.`}
          </div>
          <p>The promoted student records have been updated to target academic year <strong>${escapeAdminText(newAcademicYear)}</strong>.</p>
        `;
        cspSetVisibility(resultsCard, true, 'block');
      }

      // Refresh student directory and TC table
      if (typeof window.loadStudentsForTc === 'function') await window.loadStudentsForTc();
      if (typeof window.loadUsers === 'function') await window.loadUsers();

      // Refresh promotion preview
      await window.onPromoFilterChange();
    } else if (res?.success !== true) {
      throw new Error(res?.message || 'Promotion was not confirmed by the server.');
    } else {
      throw new Error('The server did not confirm the full promotion batch. No partial success is reported.');
    }
  } catch (error) {
    toast.error('Promotion Failed', error.message || 'The promotion operation failed.');
    if (resultsCard && resultsBody) {
      resultsBody.innerHTML = `
        <div class="alert alert-danger">
          <i class="fas fa-exclamation-triangle"></i> <strong>Error:</strong> ${escapeAdminText(error.message || 'Operation failed.')}
        </div>
      `;
      cspSetVisibility(resultsCard, true, 'block');
    }
  } finally {
    _isPromoting = false;
    if (btn) {
      btn.innerHTML = '<i class="fas fa-level-up-alt"></i> Promote Selected Students';
    }
    window.onPromoCheckChange();
  }
}
