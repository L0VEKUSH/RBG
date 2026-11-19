/* ═══════════════════════════════════════════════════
   RBG SCHOOL — FRONTEND APP JS
   ═══════════════════════════════════════════════════ */

'use strict';

const API_BASE = window.location.origin + '/api/v1';
let currentUser = null;
let allStudents = [], allFaculty = [], allNotices = [];
let chartsInitialized = false;

/* ════════════════ AUTH ════════════════ */

document.getElementById('loginForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;
  if (!email || !password) { showLoginAlert('Please enter email and password.', 'error'); return; }
  setLoginLoading(true);
  try {
    const res = await apiFetch('/auth/login', 'POST', { email, password });
   if (res.success) {
  // login response handled

  currentUser = res.data?.user || res.user;
      if (!currentUser) throw new Error('Authentication error. No user received.');
      localStorage.setItem('cms_user', JSON.stringify(currentUser));
      if (document.getElementById('rememberMe').checked) {
        localStorage.setItem('cms_remember', '1');
      }
      initApp();
    }
  } catch (err) {
    showLoginAlert(err.message || 'Login failed. Please check your credentials.', 'error');
  } finally {
    setLoginLoading(false);
  }
});

function setLoginLoading(loading) {
  document.getElementById('loginBtn').disabled = loading;
  document.getElementById('loginBtnText').textContent = loading ? 'Signing in...' : 'Sign In';
  document.getElementById('loginSpinner').classList.toggle('hidden', !loading);
}

function showLoginAlert(msg, type) {
  const el = document.getElementById('loginAlert');
  el.textContent = msg;
  el.className = `alert-box ${type}`;
  el.classList.remove('hidden');
}

function fillDemo(email, pass) {
  document.getElementById('loginEmail').value = email;
  document.getElementById('loginPassword').value = pass;
}

function togglePass() {
  const inp = document.getElementById('loginPassword');
  const ico = document.getElementById('eyeIcon');
  if (inp.type === 'password') { inp.type = 'text'; ico.className = 'fas fa-eye-slash'; }
  else { inp.type = 'password'; ico.className = 'fas fa-eye'; }
}

async function logout() {
  if (!confirm('Are you sure you want to logout?')) return;
  try {
    const response = await apiFetch('/auth/logout', 'POST');
    if (!response.success) throw new Error('Logout failed. Please try again.');
  } catch (error) {
    showToast(error.message || 'Logout failed. Please try again.', 'error');
    return;
  }
  localStorage.removeItem('cms_user');
  currentUser = null;
  document.getElementById('mainApp').classList.add('hidden');
  document.getElementById('loginPage').classList.remove('hidden');
  showToast('Logged out successfully.', 'success');
}

/* ════════════════ APP INIT ════════════════ */

function initApp() {
  document.getElementById('loginPage').classList.add('hidden');
  document.getElementById('mainApp').classList.remove('hidden');

  setupUserUI();
  setCurrentDate();
  setGreeting();

  // Role-based API loading

  if (currentUser.role === 'admin') {
    loadDashboardData();
    loadStudents();
    loadFaculty();
    loadFeesData();
  }

  if (currentUser.role === 'faculty') {
    loadStudents();
    loadNotices();
    initAttendanceDateDefault();
  }

  if (currentUser.role === 'student') {
    loadNotices();
    initAttendanceDateDefault();
  }

  showSection('dashboard', document.querySelector('.nav-item'));
}

function setupUserUI() {
  if (!currentUser) return;

  const rolePermissions = {
    admin: [
      'dashboard',
      'students',
      'faculty',
      'attendance',
      'marks',
      'fees',
      'notices',
      'reports',
      'settings'
    ],

    faculty: [
      'dashboard',
      'students',
      'attendance',
      'marks',
      'notices'
    ],

    student: [
      'dashboard',
      'attendance',
      'marks',
      'notices'
    ]
  };

  const allowedSections = rolePermissions[currentUser.role] || [];

  // Hide nav items
  document.querySelectorAll('.nav-item').forEach(item => {
    const section = item.dataset.section || cspActionArgs(item, 'click')[0];

    if (!allowedSections.includes(section)) {
      cspSetVisibility(item, false);
    }
  });

  // Hide page sections
  document.querySelectorAll('.page-section').forEach(section => {
    const id = section.id.replace('section-', '');

    if (!allowedSections.includes(id)) {
      cspSetVisibility(section, false);
    }
  });

  // User Info
  const initial = currentUser.name
    ? currentUser.name[0].toUpperCase()
    : 'U';

  document.getElementById('sidebarAvatar').textContent = initial;
  document.getElementById('topbarAvatar').textContent = initial;
  document.getElementById('sidebarName').textContent = currentUser.name;
  document.getElementById('topbarName').textContent =
    currentUser.name.split(' ')[0];

  const roleMap = {
    admin: 'Administrator',
    faculty: 'Faculty',
    student: 'Student'
  };

  document.getElementById('sidebarRole').textContent =
    roleMap[currentUser.role] || currentUser.role;
}
function applyRoleAccess(user) {
    if (!user || !user.role) return;

    const role = user.role.toLowerCase();
   
    // Hide admin-only sections for student
    if (role === "student") {
        hideElement("section-faculty");
        hideElement("section-students");

        hideNav("faculty");
        hideNav("students");

        document.querySelector('.btn-primary[data-csp-action-click="saveAttendance"]')?.remove();
        Array.from(document.querySelectorAll('.btn-primary[data-csp-action-click="openModal"]'))
          .find(button => cspActionArgs(button, 'click')[0] === 'enterMarksModal')?.remove();
    }

    // Faculty restrictions
    if (role === "faculty") {
        hideElement("section-fees");
        hideElement("section-reports");

        hideNav("fees");
        hideNav("reports");
    }
}

function hideElement(id) {
    const el = document.getElementById(id);
    if (el) cspSetVisibility(el, false);
}

function hideNav(section) {
    document.querySelectorAll(".nav-item").forEach(item => {
        if (item.getAttribute("onclick")?.includes(section)) {
            cspSetVisibility(item, false);
        }
    });
}
function setCurrentDate() {
  const now = new Date();
  document.getElementById('currentDate').textContent = now.toLocaleDateString('en-IN', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });
}

function setGreeting() {
  const h = new Date().getHours();
  const greet = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  document.getElementById('dashGreeting').textContent = `${greet}, ${currentUser?.name?.split(' ')[0] || 'User'}! Here's what's happening today.`;
}

/* ════════════════ NAVIGATION ════════════════ */

function showSection(name, el) {
  document.querySelectorAll('.page-section').forEach(s => s.classList.remove('active'));
  const target = document.getElementById(`section-${name}`);
  if (target) target.classList.add('active');

  document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
  if (el) el.classList.add('active');

  document.getElementById('breadcrumbSection').textContent = name.charAt(0).toUpperCase() + name.slice(1).replace(/-/g, ' ');

  if (name === 'dashboard' && !chartsInitialized) initCharts();
  if (name === 'attendance') initAttendanceCharts();
  if (name === 'marks') initMarksCharts();
}

function toggleSidebar() {
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebarOverlay');
  sidebar.classList.toggle('open');
  overlay.classList.toggle('visible');
}

/* ════════════════ API HELPER ════════════════ */

async function apiFetch(endpoint, method = 'GET', body = null) {
  const headers = {
    'Content-Type': 'application/json'
  };

  const config = {
    method,
    headers,
    credentials: 'include'
  };

  if (body) {
    config.body = JSON.stringify(body);
  }

  const res = await fetch(`${API_BASE}${endpoint}`, config);

  const data = await res.json();

  

  if (res.status === 401) {
    logout();
    throw new Error('Session expired. Please login again.');
  }

  if (!data.success) {
    throw new Error(data.message || 'Request failed');
  }

  return data;
}

/* ════════════════ DASHBOARD ════════════════ */

async function loadDashboardData() {
  try {
    const stats = await apiFetch('/students/stats');
    if (stats.data?.stats?.total) {
      document.getElementById('statStudents').textContent = stats.data.stats.total.toLocaleString('en-IN');
      document.getElementById('studentCountBadge').textContent = stats.data.stats.total;
    }
  } catch (_) {
    // Use placeholder data if API not connected
    document.getElementById('statStudents').textContent = '2,540';
    document.getElementById('studentCountBadge').textContent = '2540';
  }
}

/* ════════════════ CHARTS ════════════════ */

function initCharts() {
  chartsInitialized = true;
  const chartDefaults = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { labels: { font: { family: 'Inter', size: 11 } } } },
  };

  // Enrollment Chart
  const enrollCtx = document.getElementById('enrollmentChart');
  if (enrollCtx) {
    new Chart(enrollCtx, {
      type: 'bar',
      data: {
        labels: ['I','II','III','IV','V','VI','VII','VIII','IX','X','XI','XII'],
        datasets: [
          { label: 'Boys', data: [110,105,98,102,108,95,100,88,90,85,72,65], backgroundColor: 'rgba(79,70,229,0.75)', borderRadius: 6 },
          { label: 'Girls', data: [105,100,102,98,95,92,88,85,82,80,68,60], backgroundColor: 'rgba(236,72,153,0.65)', borderRadius: 6 },
        ],
      },
      options: { ...chartDefaults, scales: { x: { grid: { display: false } }, y: { grid: { color: '#f1f5f9' } } } },
    });
  }

  // Attendance Chart
  const attCtx = document.getElementById('attendanceChart');
  if (attCtx) {
    new Chart(attCtx, {
      type: 'line',
      data: {
        labels: ['Mon','Tue','Wed','Thu','Fri','Sat'],
        datasets: [{
          label: 'Attendance %',
          data: [93.2, 91.8, 94.1, 90.5, 91.4, 88.0],
          borderColor: 'rgba(16,185,129,1)',
          backgroundColor: 'rgba(16,185,129,0.1)',
          tension: 0.4, fill: true, pointRadius: 5,
          pointBackgroundColor: 'rgba(16,185,129,1)',
        }],
      },
      options: { ...chartDefaults, scales: { y: { min: 80, max: 100, grid: { color: '#f1f5f9' } }, x: { grid: { display: false } } } },
    });
  }
}

function initAttendanceCharts() {
  const ctx1 = document.getElementById('monthlyAttChart');
  if (ctx1 && !ctx1._chartDestroyed) {
    try { Chart.getChart(ctx1)?.destroy(); } catch(_) {}
    new Chart(ctx1, {
      type: 'line',
      data: {
        labels: ['Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec','Jan','Feb','Mar'],
        datasets: [{
          label: 'Avg Attendance %',
          data: [92,90,null,null,91,93,94,92,91,90,93,91],
          borderColor: 'rgba(79,70,229,1)',
          backgroundColor: 'rgba(79,70,229,.1)',
          tension: 0.4, fill: true,
          spanGaps: false,
        }],
      },
      options: { responsive: true, maintainAspectRatio: false, scales: { y: { min: 75, max: 100 } } },
    });
  }

  const ctx2 = document.getElementById('classAttChart');
  if (ctx2) {
    try { Chart.getChart(ctx2)?.destroy(); } catch(_) {}
    new Chart(ctx2, {
      type: 'bar',
      data: {
        labels: ['I','II','III','IV','V','VI','VII','VIII','IX','X','XI','XII'],
        datasets: [{
          label: '% Attendance',
          data: [95,94,93,92,91,90,89,88,87,86,90,88],
          backgroundColor: 'rgba(79,70,229,.75)',
          borderRadius: 5,
        }],
      },
      options: { responsive: true, maintainAspectRatio: false, scales: { y: { min: 75, max: 100 }, x: { grid: { display: false } } } },
    });
  }
}

function initMarksCharts() {
  const ctx1 = document.getElementById('subjectPerfChart');
  if (ctx1) {
    try { Chart.getChart(ctx1)?.destroy(); } catch(_) {}
    new Chart(ctx1, {
      type: 'bar',
      data: {
        labels: ['Mathematics','Science','English','Hindi','Social Science','Computer'],
        datasets: [
          { label: 'Avg Marks (Class X)', data: [68,72,74,79,71,80], backgroundColor: 'rgba(79,70,229,.75)', borderRadius: 5 },
          { label: 'Avg Marks (Class XII)', data: [72,75,78,81,74,82], backgroundColor: 'rgba(16,185,129,.7)', borderRadius: 5 },
        ],
      },
      options: { responsive: true, maintainAspectRatio: false, scales: { y: { min: 0, max: 100 }, x: { grid: { display: false } } } },
    });
  }

  const ctx2 = document.getElementById('gradeChart');
  if (ctx2) {
    try { Chart.getChart(ctx2)?.destroy(); } catch(_) {}
    new Chart(ctx2, {
      type: 'doughnut',
      data: {
        labels: ['A1 (90-100)','A2 (80-89)','B1 (70-79)','B2 (60-69)','C1 (50-59)','D & Below'],
        datasets: [{
          data: [42, 110, 148, 120, 80, 30],
          backgroundColor: ['#10b981','#3b82f6','#8b5cf6','#f59e0b','#f97316','#ef4444'],
        }],
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right', labels: { font: { size: 10 } } } } },
    });
  }
}

/* ════════════════ STUDENTS ════════════════ */

const demoStudents = [
  { id:'1', admNo:'ADM20250001', name:'Aarav Sharma', class:'XII', section:'A', roll:1, father:'Rajesh Sharma', phone:'9876543210', attendance:97, fees:'Paid', stream:'Science', gender:'male' },
  { id:'2', admNo:'ADM20250002', name:'Priya Nair', class:'XII', section:'B', roll:2, father:'Suresh Nair', phone:'9876543211', attendance:95, fees:'Paid', stream:'Commerce', gender:'female' },
  { id:'3', admNo:'ADM20250003', name:'Rohan Gupta', class:'XI', section:'A', roll:3, father:'Anil Gupta', phone:'9876543212', attendance:88, fees:'Partial', stream:'Science', gender:'male' },
  { id:'4', admNo:'ADM20250004', name:'Sneha Verma', class:'X', section:'C', roll:4, father:'Vijay Verma', phone:'9876543213', attendance:92, fees:'Paid', stream:'N/A', gender:'female' },
  { id:'5', admNo:'ADM20250005', name:'Dev Patel', class:'XII', section:'C', roll:5, father:'Bharat Patel', phone:'9876543214', attendance:85, fees:'Pending', stream:'Science', gender:'male' },
  { id:'6', admNo:'ADM20250006', name:'Ananya Singh', class:'IX', section:'B', roll:6, father:'Ravi Singh', phone:'9876543215', attendance:93, fees:'Paid', stream:'N/A', gender:'female' },
  { id:'7', admNo:'ADM20250007', name:'Kabir Khan', class:'VIII', section:'A', roll:7, father:'Salim Khan', phone:'9876543216', attendance:78, fees:'Partial', stream:'N/A', gender:'male' },
  { id:'8', admNo:'ADM20250008', name:'Ishaan Mehta', class:'XI', section:'B', roll:8, father:'Deepak Mehta', phone:'9876543217', attendance:96, fees:'Paid', stream:'Commerce', gender:'male' },
  { id:'9', admNo:'ADM20250009', name:'Nisha Yadav', class:'X', section:'A', roll:9, father:'Sunil Yadav', phone:'9876543218', attendance:90, fees:'Paid', stream:'N/A', gender:'female' },
  { id:'10', admNo:'ADM20250010', name:'Arjun Mishra', class:'VII', section:'C', roll:10, father:'Rakesh Mishra', phone:'9876543219', attendance:82, fees:'Pending', stream:'N/A', gender:'male' },
  { id:'11', admNo:'ADM20250011', name:'Riya Joshi', class:'VI', section:'A', roll:11, father:'Hemant Joshi', phone:'9876543220', attendance:99, fees:'Paid', stream:'N/A', gender:'female' },
  { id:'12', admNo:'ADM20250012', name:'Vivaan Tiwari', class:'V', section:'B', roll:12, father:'Naveen Tiwari', phone:'9876543221', attendance:87, fees:'Paid', stream:'N/A', gender:'male' },
];

const avatarColors = ['#4f46e5','#10b981','#f59e0b','#ef4444','#8b5cf6','#06b6d4','#ec4899','#3b82f6'];

async function loadStudents() {
  try {
    const res = await apiFetch('/students?limit=50');
    if (res.data?.students?.length){
      allStudents = res.data.students.map(s => ({
        id: s._id,
        admNo: s.admissionNumber,
        name: s.user?.name || '—',
        class: s.class,
                roll: s.rollNumber,
        father: s.father?.name || '—',
        phone: s.user?.phone || s.father?.phone || '—',
        attendance: 90,
        fees: 'Paid',
        stream: s.stream || 'N/A',
        gender: s.user?.gender || 'male',
      }));
    } else { allStudents = demoStudents; }
  } catch (_) { allStudents = demoStudents; }
  renderStudentTable(allStudents);
}

function renderStudentTable(students) {
  const tbody = document.getElementById('studentTableBody');
  document.getElementById('studentTableCount').textContent = `Showing ${students.length} students`;
  if (!students.length) { tbody.innerHTML = `<tr><td colspan="10" class="csp-style-5d13c20c87">No students found</td></tr>`; return; }
  tbody.innerHTML = students.map((s, i) => {
    const attColor = s.attendance >= 90 ? 'badge-success' : s.attendance >= 75 ? 'badge-warning' : 'badge-danger';
    const feeColor = s.fees === 'Paid' ? 'badge-success' : s.fees === 'Partial' ? 'badge-warning' : 'badge-danger';
    return `<tr>
      <td><input type="checkbox" class="studentCheck" aria-label="Select student ${s.name}" /></td>
      <td><code class="csp-style-d69cde6c14">${s.admNo}</code></td>
      <td>
        <div class="student-name-cell">
          <div class="student-avatar avatar-color-${i % avatarColors.length}">${s.name[0]}</div>
          <div><b>${s.name}</b><small>${s.stream !== 'N/A' ? s.stream : ''}</small></div>
        </div>
      </td>
      <td><span class="badge badge-info">Class ${s.class}</span></td>
      <td>${s.roll}</td>
      <td>${s.father}</td>
      <td><i class="fas fa-phone csp-style-1ba970bfda" ></i>${s.phone}</td>
      <td><span class="badge ${attColor}">${s.attendance}%</span></td>
      <td><span class="badge ${feeColor}">${s.fees}</span></td>
      <td>
        <div class="action-btns">
          <button class="act-btn view" title="View" aria-label="View details for ${s.name}" ${cspActionAttrs("viewStudent", ['${s.id}'], "click", [], [])}><i class="fas fa-eye"></i></button>
          <button class="act-btn edit" title="Edit" aria-label="Edit student ${s.name}" ${cspActionAttrs("editStudent", ['${s.id}'], "click", [], [])}><i class="fas fa-edit"></i></button>
          <button class="act-btn delete" title="Delete" aria-label="Delete student ${s.name}" ${cspActionAttrs("confirmDeleteStudent", ['${s.id}', '${s.name}'], "click", [], [])}><i class="fas fa-trash"></i></button>
        </div>
      </td>
    </tr>`;
  }).join('');
  renderPagination(students.length, 12, 'studentPagination');
}

function renderStudentGrid(students) {
  const grid = document.getElementById('studentGridView');
  grid.innerHTML = students.map((s, i) => {
    return `<div class="student-card">
      <div class="sc-avatar avatar-color-${i % avatarColors.length}">${s.name[0]}</div>
      <h4>${s.name}</h4>
      <small>Class ${s.class} | Roll ${s.roll}</small>
      <div class="csp-style-e2f84b1e23"><span class="badge badge-info csp-style-0d6ae56463" >${s.admNo}</span></div>
    </div>`;
  }).join('');
}

function filterStudents() {
  const q = document.getElementById('studentSearch').value.toLowerCase();
  const cls = document.getElementById('filterClass').value;
  const sec = document.getElementById('filterSection').value;
  const filtered = allStudents.filter(s => {
    const matchQ = !q || s.name.toLowerCase().includes(q) || s.admNo.toLowerCase().includes(q);
    const matchC = !cls || `Class ${s.class}` === cls || s.class === cls;
    return matchQ && matchC;
  });
  renderStudentTable(filtered);
}

function setView(view, btn) {
  document.querySelectorAll('.tv-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  const tableView = document.getElementById('studentTableView');
  const gridView = document.getElementById('studentGridView');
  if (view === 'grid') {
    tableView.classList.add('hidden');
    gridView.classList.remove('hidden');
    renderStudentGrid(allStudents);
  } else {
    tableView.classList.remove('hidden');
    gridView.classList.add('hidden');
  }
}
function changePage(containerId, direction) {
    showToast(`Page changed: ${direction}`, "success");
}

function viewStudent(id) {
  const s = allStudents.find(s => s.id === id);
  if (!s) return;
  showToast(`Viewing profile of ${s.name}`, 'success');
}

function editStudent(id) {
  showToast('Opening edit form...', 'success');
}

function confirmDeleteStudent(id, name) {
  if (confirm(`Are you sure you want to deactivate student "${name}"?`)) {
    allStudents = allStudents.filter(s => s.id !== id);
    renderStudentTable(allStudents);
    showToast(`Student "${name}" removed successfully.`, 'success');
  }
}

function toggleAll(masterCb, className) {
  document.querySelectorAll(`.${className}`).forEach(cb => cb.checked = masterCb.checked);
}

function renderPagination(total, perPage, containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const pages = Math.ceil(total / perPage);
  if (pages <= 1) { container.innerHTML = ''; return; }
  let html = `<button type="button" class="page-btn" data-pagination-container="${containerId}" data-pagination-direction="prev" aria-label="Previous page"><i class="fas fa-chevron-left" aria-hidden="true"></i></button>`;
  for (let i = 1; i <= Math.min(pages, 5); i++) {
    html += `<button class="page-btn ${i === 1 ? 'active' : ''}" aria-label="Page ${i}">${i}</button>`;
  }
  if (pages > 5) html += `<span class="pagination-ellipsis">...</span><button type="button" class="page-btn" data-pagination-container="${containerId}" data-pagination-page="${pages}" aria-label="Page ${pages}">${pages}</button>`;
  html += `<button type="button" class="page-btn" data-pagination-container="${containerId}" data-pagination-direction="next" aria-label="Next page"><i class="fas fa-chevron-right" aria-hidden="true"></i></button>`;
  container.innerHTML = html;
}

/* ════════════════ FACULTY ════════════════ */

const demoFaculty = [
  { id:'1', empId:'EMP20240001', name:'Dr. Rajendra Prasad', dept:'Mathematics', desig:'Principal', email:'rajendra@school.edu', phone:'9876543200', exp:25, classes:['XI','XII'], gender:'male' },
  { id:'2', empId:'EMP20240002', name:'Mrs. Sunita Sharma', dept:'Science', desig:'HOD', email:'sunita@school.edu', phone:'9876543201', exp:18, classes:['IX','X','XI'], gender:'female' },
  { id:'3', empId:'EMP20240003', name:'Mr. Amit Verma', dept:'Mathematics', desig:'PGT', email:'amit@school.edu', phone:'9876543202', exp:12, classes:['X','XI','XII'], gender:'male' },
  { id:'4', empId:'EMP20240004', name:'Ms. Rekha Joshi', dept:'English', desig:'TGT', email:'rekha@school.edu', phone:'9876543203', exp:8, classes:['VI','VII','VIII'], gender:'female' },
  { id:'5', empId:'EMP20240005', name:'Mr. Sandeep Kumar', dept:'Physics', desig:'PGT', email:'sandeep@school.edu', phone:'9876543204', exp:15, classes:['XI','XII'], gender:'male' },
  { id:'6', empId:'EMP20240006', name:'Mrs. Priya Mishra', dept:'Chemistry', desig:'PGT', email:'priya.m@school.edu', phone:'9876543205', exp:10, classes:['XI','XII'], gender:'female' },
  { id:'7', empId:'EMP20240007', name:'Mr. Ravi Shankar', dept:'Computer Science', desig:'TGT', email:'ravi@school.edu', phone:'9876543206', exp:7, classes:['IX','X','XI','XII'], gender:'male' },
  { id:'8', empId:'EMP20240008', name:'Mrs. Kavita Singh', dept:'Hindi', desig:'TGT', email:'kavita@school.edu', phone:'9876543207', exp:14, classes:['VI','VII','VIII','IX'], gender:'female' },
];

async function loadFaculty() {
  try {
    const res = await apiFetch('/faculty?limit=20');
    if (res.data?.faculty?.length) {
      allFaculty = res.data.faculty;
    } else { allFaculty = demoFaculty; }
  } catch (_) { allFaculty = demoFaculty; }
  renderFacultyCards(allFaculty);
}

function renderFacultyCards(faculty) {
  const grid = document.getElementById('facultyCardsGrid');
  if (!faculty.length) { grid.innerHTML = '<p class="csp-style-07f15613e8">No faculty found</p>'; return; }
  grid.innerHTML = faculty.map((f, i) => {
    const name = f.user?.name || f.name;
    const email = f.user?.email || f.email;
    const phone = f.user?.phone || f.phone;
    return `<div class="faculty-card">
      <div class="faculty-avatar avatar-color-${i % avatarColors.length}">${name[0]}</div>
      <h3>${name}</h3>
      <div class="designation">${f.designation || f.desig}</div>
      <div class="department">${f.department || f.dept}</div>
      <div class="faculty-meta">
        <span><i class="fas fa-envelope"></i> ${email || '—'}</span>
        <span><i class="fas fa-phone"></i> ${phone || '—'}</span>
      </div>
      <div class="faculty-meta">
        <span><i class="fas fa-briefcase"></i> ${f.experience?.total || f.exp || 0} yrs</span>
        <span><i class="fas fa-id-card"></i> ${f.employeeId || f.empId}</span>
      </div>
      <div class="faculty-actions">
        <button class="btn-sm-secondary" ${cspActionAttrs('showToast', ['Viewing ' + name, 'success'])}><i class="fas fa-eye"></i> View</button>
        <button class="btn-sm-primary" ${cspActionAttrs('showToast', ['Editing ' + name, 'success'])}><i class="fas fa-edit"></i> Edit</button>
      </div>
    </div>`;
  }).join('');
}

function filterFaculty() {
  const q = document.getElementById('facultySearch').value.toLowerCase();
  const dept = document.getElementById('filterDept').value;
  const desig = document.getElementById('filterDesig').value;
  const filtered = allFaculty.filter(f => {
    const name = (f.user?.name || f.name || '').toLowerCase();
    const empId = (f.employeeId || f.empId || '').toLowerCase();
    const matchQ = !q || name.includes(q) || empId.includes(q);
    const matchD = !dept || (f.department || f.dept) === dept;
    const matchDes = !desig || (f.designation || f.desig) === desig;
    return matchQ && matchD && matchDes;
  });
  renderFacultyCards(filtered);
}

/* ════════════════ ATTENDANCE ════════════════ */

function initAttendanceDateDefault() {
  const today = new Date().toISOString().split('T')[0];
  document.getElementById('attDate').value = today;
  document.getElementById('attDate').max = today;
}

function loadAttendanceSheet() {
  const cls = document.getElementById('attClass').value;
  const section = document.getElementById('attSection').value;
  const date = document.getElementById('attDate').value;
  if (!cls || !section || !date) return;

  const classStudents = allStudents.filter(s => s.class === cls || `Class ${s.class}` === cls || s.class === cls.replace('Class ',''));
  const sectionStudents = classStudents.length ? classStudents : generateDemoAttStudents(cls, section);

  document.getElementById('attendanceSummaryBar').classList.remove('hidden');
  renderAttendanceSheet(sectionStudents);
  updateAttendanceSummary();
}

function generateDemoAttStudents(cls, section) {
  const names = ['Aditya Kumar','Bhavna Sharma','Chetan Singh','Divya Patel','Ekta Gupta','Farhan Ali','Gaurav Mishra','Heena Joshi','Ishan Verma','Jyoti Yadav','Karan Mehta','Lakshmi Nair','Manish Tiwari','Neha Srivastava','Omkar Bhat'];
  return names.map((name, i) => ({
    id: `demo-${i}`, admNo: `ADM${String(i+1).padStart(4,'0')}`,
    name, class: cls, section, roll: i+1, gender: i % 2 === 0 ? 'male' : 'female',
  }));
}

function renderAttendanceSheet(students) {
  const container = document.getElementById('attendanceSheet');
  container.innerHTML = `
    <div class="att-table-wrapper">
      <table class="data-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Roll</th>
            <th>Student Name</th>
            <th colspan="4" class="csp-style-905008530c">Attendance Status</th>
            <th>Remarks</th>
          </tr>
        </thead>
        <tbody>
          ${students.map((s, i) => `
            <tr id="att-row-${s.id}">
              <td>${i+1}</td>
              <td>${s.roll}</td>
              <td>
                <div class="student-name-cell">
                  <div class="student-avatar student-avatar--small avatar-color-${i % avatarColors.length}">${s.name[0]}</div>
                  <b>${s.name}</b>
                </div>
              </td>
              <td>
                <div class="att-radio-group">
                  ${['Present','Absent','Late','Half-Day'].map(status => `
                    <input type="radio" class="att-radio" name="att-${s.id}" id="att-${s.id}-${status}" value="${status}" ${status==='Present'?'checked':''} ${cspActionAttrs("updateAttendanceSummary", [], "change", [], [])}>
                    <label class="att-radio-label" for="att-${s.id}-${status}">${status === 'Half-Day' ? '½ Day' : status}</label>
                  `).join('')}
                </div>
              </td>
              <td><input type="text" placeholder="Remarks..." aria-label="Remarks for ${s.name}" class="csp-style-a21c632a2a" /></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>`;
}

function updateAttendanceSummary() {
  const radios = document.querySelectorAll('.att-radio:checked');
  let p=0,a=0,l=0,h=0;
  radios.forEach(r => {
    if(r.value==='Present') p++;
    else if(r.value==='Absent') a++;
    else if(r.value==='Late') l++;
    else if(r.value==='Half-Day') h++;
  });
  const total = p+a+l+h;
  document.getElementById('sumPresent').textContent = p;
  document.getElementById('sumAbsent').textContent = a;
  document.getElementById('sumLate').textContent = l;
  document.getElementById('sumTotal').textContent = total;
  const pct = total ? ((p/total)*100).toFixed(1) : 0;
  cspSetProgress(document.getElementById('attPctFill'), pct);
  document.getElementById('attPctText').textContent = pct + '%';
}

function markAllPresent() {
  document.querySelectorAll('.att-radio[value="Present"]').forEach(r => r.checked = true);
  updateAttendanceSummary();
}

async function saveAttendance() {
  const cls = document.getElementById('attClass').value;
  const section = document.getElementById('attSection').value;
  const date = document.getElementById('attDate').value;
  if (!cls || !section || !date) { showToast('Please select class, section, and date first.', 'error'); return; }
  showToast('Attendance saved successfully!', 'success');
}

/* ════════════════ MARKS ════════════════ */

function switchMarksTab(tab, btn) {
  document.querySelectorAll('.marks-tab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
  document.querySelectorAll('.marks-panel').forEach(p => p.classList.remove('active-panel'));
  const panel = document.getElementById(`marks-${tab}`);
  if (panel) panel.classList.add('active-panel');
  if (tab === 'analytics') initMarksCharts();
  if (tab === 'view') renderResultsTable();
}

function loadMarksSheet() {
  const cls = document.getElementById('marksClass').value;
  const exam = document.getElementById('marksExam').value;
  const subj = document.getElementById('marksSubject').value;
  if (!cls || !exam || !subj) { showToast('Please select class, exam type and subject.', 'error'); return; }

  const students = allStudents.filter(s => s.class === cls || s.class.includes(cls)).slice(0, 10);
  const sheet = document.getElementById('marksSheet');

  if (!students.length) {
    const demoNames = ['Aarav Sharma','Priya Nair','Rohan Gupta','Sneha Verma','Dev Patel','Ananya Singh','Kabir Khan','Nisha Yadav'];
    const demoRows = demoNames.map((name, i) => ({ id: i, roll: i+1, name }));
    sheet.innerHTML = buildMarksTable(demoRows, 100, exam, subj);
    return;
  }
  sheet.innerHTML = buildMarksTable(students.map(s => ({ id: s.id, roll: s.roll, name: s.name })), 100, exam, subj);
}

function buildMarksTable(students, maxMarks, exam, subj) {
  return `
    <div class="csp-style-a06334430d">
      ${exam} — ${subj} (Max Marks: ${maxMarks})
    </div>
    <div class="csp-style-1b1d75452f">
      <table class="data-table">
        <thead>
          <tr>
            <th>Roll No.</th>
            <th>Student Name</th>
            <th>Marks Obtained (/${maxMarks})</th>
            <th>Grade</th>
            <th>Absent</th>
            <th>Remarks</th>
          </tr>
        </thead>
        <tbody>
          ${students.map(s => `
            <tr>
              <td>${s.roll}</td>
              <td><b>${s.name}</b></td>
              <td>
                <input type="number" min="0" max="${maxMarks}" placeholder="—" aria-label="Marks for ${s.name}"
                  class="csp-style-9a8d7f016f"
                  ${cspActionAttrs("calcLiveGrade", [maxMarks], "input", [0], [])}/>
              </td>
              <td class="live-grade-${s.id || s.roll} csp-style-0bd3a158a0" >—</td>
              <td>
                <input type="checkbox" title="Mark as absent" aria-label="Mark ${s.name} as absent" ${cspActionAttrs("toggleSiblingDisabled", [], "change", [0], [])}/>
              </td>
              <td>
                <input type="text" placeholder="Optional" aria-label="Remarks for ${s.name}"
                  class="csp-style-b693b02f32" />
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
    <div class="csp-style-57b856c036">
      <button class="btn-secondary"><i class="fas fa-save"></i> Save as Draft</button>
      <button class="btn-primary" ${cspActionAttrs("showToast", ['Marks submitted successfully!', 'success'], "click", [], [])}><i class="fas fa-check"></i> Submit Marks</button>
    </div>`;
}

function calcLiveGrade(inp, max) {
  const marks = parseFloat(inp.value);
  const cell = inp.closest('tr').querySelectorAll('td')[3];
  if (isNaN(marks) || marks < 0 || marks > max) { cell.textContent = '—'; return; }
  const pct = (marks / max) * 100;
  let grade = '';
  if (pct >= 90) grade = 'A1';
  else if (pct >= 80) grade = 'A2';
  else if (pct >= 70) grade = 'B1';
  else if (pct >= 60) grade = 'B2';
  else if (pct >= 50) grade = 'C1';
  else if (pct >= 40) grade = 'C2';
  else if (pct >= 33) grade = 'D';
  else grade = 'F';
  cell.textContent = grade;
  cell.classList.remove('grade-color-success', 'grade-color-warning', 'grade-color-danger');
  cell.classList.add(pct >= 60 ? 'grade-color-success' : pct >= 33 ? 'grade-color-warning' : 'grade-color-danger');
}

function renderResultsTable() {
  const tbody = document.getElementById('resultsTableBody');
  const results = [
    { rank:1, name:'Aarav Sharma', roll:1, m:98,sc:95,en:97,hi:92,sst:94, total:476, pct:95.2, grade:'A1', result:'Pass' },
    { rank:2, name:'Priya Nair', roll:2, m:92,sc:90,en:95,hi:88,sst:91, total:456, pct:91.2, grade:'A1', result:'Pass' },
    { rank:3, name:'Rohan Gupta', roll:3, m:85,sc:88,en:90,hi:82,sst:86, total:431, pct:86.2, grade:'A2', result:'Pass' },
    { rank:4, name:'Sneha Verma', roll:4, m:78,sc:80,en:85,hi:79,sst:77, total:399, pct:79.8, grade:'B1', result:'Pass' },
    { rank:5, name:'Dev Patel', roll:5, m:72,sc:75,en:78,hi:70,sst:73, total:368, pct:73.6, grade:'B1', result:'Pass' },
  ];
  tbody.innerHTML = results.map(r => `
    <tr>
      <td><span class="rank ${r.rank===1?'gold':r.rank===2?'silver':r.rank===3?'bronze':''}">${r.rank}</span></td>
      <td><b>${r.name}</b></td>
      <td>${r.roll}</td>
      <td>${r.m}</td><td>${r.sc}</td><td>${r.en}</td><td>${r.hi}</td><td>${r.sst}</td>
      <td><b>${r.total}/500</b></td>
      <td><b class="csp-style-b0e08465c2">${r.pct}%</b></td>
      <td><span class="csp-style-0791b50e1a">${r.grade}</span></td>
      <td><span class="badge badge-success">${r.result}</span></td>
    </tr>`).join('');
}

/* ════════════════ NOTICES ════════════════ */

const demoNotices = [
  { id:'1', title:'Annual Sports Day 2025', content:'Annual Sports Day is scheduled on 25th April 2025. All students are requested to participate enthusiastically. Dress code: House colours.', type:'Event', priority:'High', createdBy:{name:'Principal'}, createdAt:new Date(Date.now()-2*3600000), isPinned:true, views:142, targetAudience:['All'] },
  { id:'2', title:'Half-Yearly Examination Schedule', content:'Half-Yearly examinations will commence from 10th May 2025 for Classes IX-XII. Detailed timetable will be shared with class teachers. Students should carry their admit cards.', type:'Exam', priority:'High', createdBy:{name:'Exam Cell'}, createdAt:new Date(Date.now()-24*3600000), isPinned:false, views:320, targetAudience:['Students'] },
  { id:'3', title:'School Holiday – Dr. Ambedkar Jayanti', content:'School will remain closed on 14th April 2025 on account of Dr. B.R. Ambedkar Jayanti. Regular classes will resume on 15th April.', type:'Holiday', priority:'Medium', createdBy:{name:'Admin'}, createdAt:new Date(Date.now()-2*24*3600000), isPinned:false, views:95, targetAudience:['All'] },
  { id:'4', title:'Annual Fee Submission Deadline', content:'This is a reminder that the last date for submission of Annual Fees is 30th April 2025. Late fee of ₹50/day will be charged after the due date. Parents are requested to clear dues immediately.', type:'Fee', priority:'Urgent', createdBy:{name:'Accounts'}, createdAt:new Date(Date.now()-3*24*3600000), isPinned:true, views:288, targetAudience:['Parents','Students'] },
  { id:'5', title:'Parent-Teacher Meeting – Classes I to V', content:'A Parent-Teacher Meeting for Classes I to V is scheduled on 3rd May 2025 from 9 AM to 12 PM. Parents are requested to attend without fail and collect their ward\'s progress reports.', type:'Academic', priority:'High', createdBy:{name:'Vice Principal'}, createdAt:new Date(Date.now()-4*24*3600000), isPinned:false, views:210, targetAudience:['Parents'] },
  { id:'6', title:'Science Exhibition 2025', content:'Inter-school Science Exhibition will be held on 20th April 2025. Students interested in participating may register with their respective Science teachers before 18th April.', type:'Event', priority:'Medium', createdBy:{name:'Science Dept'}, createdAt:new Date(Date.now()-5*24*3600000), isPinned:false, views:175, targetAudience:['Students'] },
];

async function loadNotices() {
  try {
    const res = await apiFetch('/notices?limit=20&sort=-publishDate');
    if (res.data?.notices?.length) {
      allNotices = res.data.notices;
    } else { allNotices = demoNotices; }
  } catch (_) { allNotices = demoNotices; }
  renderNotices(allNotices);
}

function renderNotices(notices) {
  const grid = document.getElementById('noticesGrid');
  if (!notices.length) { grid.innerHTML = '<p class="csp-style-95d16ad8e9">No notices found.</p>'; return; }
  grid.innerHTML = notices.map(n => {
    const type = n.type?.toLowerCase() || 'general';
    const timeAgo = getTimeAgo(n.createdAt || n.publishDate);
    const author = n.createdBy?.name || 'Admin';
    return `<div class="notice-card ${type}" data-type="${n.type}">
      <div class="nc-header">
        <div>
          <div class="nc-title">${n.isPinned ? '<i class="fas fa-thumbtack nc-pin"></i> ' : ''}${n.title}</div>
        </div>
        <div class="csp-style-6ba12cc514">
          <span class="notice-tag ${type}">${n.type}</span>
          <span class="badge ${n.priority==='Urgent'?'badge-danger':n.priority==='High'?'badge-warning':'badge-info'} csp-style-72e48209b3" >${n.priority}</span>
        </div>
      </div>
      <div class="nc-content">${n.content.length > 130 ? n.content.substring(0,130)+'...' : n.content}</div>
      <div class="nc-footer">
        <div class="nc-footer-left">
          <i class="fas fa-user-circle csp-style-b0e08465c2" ></i>
          <span>${author}</span>
          <span>•</span>
          <i class="fas fa-eye csp-style-500708668c" ></i>
          <span>${n.views || 0}</span>
        </div>
        <span>${timeAgo}</span>
      </div>
    </div>`;
  }).join('');
}

function filterNoticeType(type, btn) {
  document.querySelectorAll('.notice-filter-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  if (type === 'all') { renderNotices(allNotices); return; }
  renderNotices(allNotices.filter(n => n.type === type));
}

function getTimeAgo(date) {
  const d = new Date(date);
  const diff = (Date.now() - d) / 1000;
  if (diff < 3600) return `${Math.floor(diff/60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff/3600)} hr ago`;
  return `${Math.floor(diff/86400)} days ago`;
}

/* ════════════════ FEES ════════════════ */

function loadFeesData() {
  const feeData = [
    { admNo:'ADM20250001', name:'Aarav Sharma', cls:'XII-A', total:45000, paid:45000, pending:0, lastPay:'12 Apr 2025', status:'Paid' },
    { admNo:'ADM20250002', name:'Priya Nair', cls:'XII-B', total:45000, paid:45000, pending:0, lastPay:'10 Apr 2025', status:'Paid' },
    { admNo:'ADM20250003', name:'Rohan Gupta', cls:'XI-A', total:42000, paid:21000, pending:21000, lastPay:'15 Mar 2025', status:'Partial' },
    { admNo:'ADM20250004', name:'Sneha Verma', cls:'X-C', total:40000, paid:40000, pending:0, lastPay:'5 Apr 2025', status:'Paid' },
    { admNo:'ADM20250005', name:'Dev Patel', cls:'XII-C', total:45000, paid:0, pending:45000, lastPay:'—', status:'Pending' },
    { admNo:'ADM20250006', name:'Ananya Singh', cls:'IX-B', total:38000, paid:38000, pending:0, lastPay:'1 Apr 2025', status:'Paid' },
    { admNo:'ADM20250007', name:'Kabir Khan', cls:'VIII-A', total:36000, paid:18000, pending:18000, lastPay:'20 Feb 2025', status:'Partial' },
  ];
  const tbody = document.getElementById('feesTableBody');
  if (!tbody) return;
  tbody.innerHTML = feeData.map((f, i) => {
    const badgeCls = f.status === 'Paid' ? 'badge-success' : f.status === 'Partial' ? 'badge-warning' : 'badge-danger';
    return `<tr>
      <td><code class="csp-style-d69cde6c14">${f.admNo}</code></td>
      <td>
        <div class="student-name-cell">
          <div class="student-avatar student-avatar--fee avatar-color-${i % avatarColors.length}">${f.name[0]}</div>
          <b>${f.name}</b>
        </div>
      </td>
      <td>${f.cls}</td>
      <td>₹${f.total.toLocaleString('en-IN')}</td>
      <td class="csp-style-96cc318ece">₹${f.paid.toLocaleString('en-IN')}</td>
      <td class="${f.pending > 0 ? 'fee-pending' : 'fee-settled'}">₹${f.pending.toLocaleString('en-IN')}</td>
      <td>${f.lastPay}</td>
      <td><span class="badge ${badgeCls}">${f.status}</span></td>
      <td>
        <div class="action-btns">
          <button class="act-btn view" aria-label="View receipt for ${f.name}" ${cspActionAttrs("showToast", ['Viewing receipt...', 'success'], "click", [], [])}><i class="fas fa-receipt"></i></button>
          <button class="act-btn edit" aria-label="Record payment for ${f.name}" ${cspActionAttrs("showToast", ['Recording payment...', 'success'], "click", [], [])}><i class="fas fa-plus"></i></button>
        </div>
      </td>
    </tr>`;
  }).join('');
}

/* ════════════════ TIMETABLE ════════════════ */

function loadTimetable(cls) {
  if (!cls) return;
  const container = document.getElementById('timetableContainer');
  const days = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const periods = ['8:00–8:45','8:45–9:30','9:30–10:15','10:15–11:00','Break','11:20–12:05','12:05–12:50','12:50–1:30','Lunch','2:00–2:45','2:45–3:30'];

  const subjectColors = { Mathematics:'#dbeafe', Physics:'#ede9fe', Chemistry:'#fce7f3', Biology:'#d1fae5', English:'#fef3c7', Hindi:'#ccfbf1', 'Social Science':'#fef9c3', Computer:'#e0f2fe', PE:'#fee2e2' };

  const schedule = {
    Monday:    ['Mathematics','Physics','English','Chemistry','','Biology','Hindi','Mathematics','','Computer','PE'],
    Tuesday:   ['English','Mathematics','Physics','Biology','','Hindi','Chemistry','Social Science','','Mathematics','Computer'],
    Wednesday: ['Physics','Chemistry','Mathematics','English','','Social Science','Biology','Computer','','Hindi','Mathematics'],
    Thursday:  ['Biology','English','Hindi','Mathematics','','Computer','Physics','Chemistry','','Social Science','Biology'],
    Friday:    ['Chemistry','Biology','Social Science','Physics','','Mathematics','English','Hindi','','PE','Computer'],
    Saturday:  ['Hindi','Computer','Chemistry','English','','Mathematics','Physics','Biology','','','—'],
  };

  let html = `<div class="csp-style-1b1d75452f"><table class="timetable-table"><thead><tr><th>Period/Day</th>${days.map(d => `<th>${d}</th>`).join('')}</tr></thead><tbody>`;
  periods.forEach((p, i) => {
    if (p === 'Break' || p === 'Lunch') {
      html += `<tr><td><b>${p}</b></td><td colspan="${days.length}" class="tt-break">${p === 'Break' ? '☕ Short Break (15 min)' : '🍱 Lunch Break (30 min)'}</td></tr>`;
    } else {
      html += `<tr><td class="csp-style-a5f15b6d53">${p}</td>`;
      days.forEach(d => {
        const subj = schedule[d]?.[i] || '—';
        if (subj === '—') { html += `<td class="tt-free">Free</td>`; }
        else {
          const subjectClass = `tt-subject-cell--${subj.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
          html += `<td class="tt-subject-cell ${subjectClass}"><div class="tt-cell"><span class="tt-subject">${subj}</span></div></td>`;
        }
      });
      html += `</tr>`;
    }
  });
  html += `</tbody></table></div>`;
  container.innerHTML = html;
}

/* ════════════════ MODALS ════════════════ */

function openModal(id) {
  document.getElementById(id).classList.remove('hidden');
  document.body.classList.add('modal-open');
}

function closeModal(id) {
  document.getElementById(id).classList.add('hidden');
  document.body.classList.remove('modal-open');
}

document.querySelectorAll('.modal-overlay').forEach(overlay => {
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeModal(overlay.id);
  });
});

function submitAddStudent() {
  const name = document.querySelector('#addStudentForm input[type=text]').value;
  if (!name) { showToast('Student name is required!', 'error'); return; }
  const newStudent = {
    id: Date.now().toString(),
    admNo: `ADM${new Date().getFullYear()}${String(allStudents.length + 1).padStart(4, '0')}`,
    name, class: 'IX', section: 'A', roll: allStudents.length + 1,
    father: '—', phone: '—', attendance: 100, fees: 'Pending', stream: 'N/A', gender: 'male',
  };
  allStudents.unshift(newStudent);
  renderStudentTable(allStudents);
  closeModal('addStudentModal');
  showToast(`Student "${name}" added successfully!`, 'success');
}

function submitAddFaculty() {
  const name = document.querySelector('#addFacultyForm input[type=text]').value;
  if (!name) { showToast('Faculty name is required!', 'error'); return; }
  closeModal('addFacultyModal');
  showToast(`Faculty "${name}" added successfully!`, 'success');
}

function submitNotice() {
  const title = document.getElementById('noticeTitle').value;
  const content = document.getElementById('noticeContent').value;
  if (!title || !content) { showToast('Title and content are required!', 'error'); return; }
  const newNotice = {
    id: Date.now().toString(),
    title,
    content,
    type: document.getElementById('noticeType').value,
    priority: document.getElementById('noticePriority').value,
    createdBy: { name: currentUser?.name || 'Admin' },
    createdAt: new Date(),
    isPinned: document.getElementById('noticePinned').checked,
    views: 0,
    targetAudience: [document.getElementById('noticeAudience').value],
  };
  allNotices.unshift(newNotice);
  renderNotices(allNotices);
  closeModal('noticeModal');
  showToast('Notice posted successfully!', 'success');
  document.getElementById('noticeTitle').value = '';
  document.getElementById('noticeContent').value = '';
}

function showForgotModal() {
  const email = prompt('Enter your registered email to reset password:');
  if (email) showToast('Password reset link sent to your email!', 'success');
}

/* ════════════════ TOAST ════════════════ */

let toastTimeout;
function showToast(msg, type = 'success') {
  const toast = document.getElementById('toast');
  const icon = document.getElementById('toastIcon');
  const msgEl = document.getElementById('toastMsg');
  clearTimeout(toastTimeout);
  toast.className = `toast ${type}`;
  icon.className = `fas ${type === 'success' ? 'fa-check-circle' : type === 'error' ? 'fa-times-circle' : 'fa-exclamation-circle'} toast-icon`;
  msgEl.textContent = msg;
  toast.classList.remove('hidden');
  toastTimeout = setTimeout(() => toast.classList.add('hidden'), 3500);
}
function loginSuccess(user) {
   localStorage.setItem("user", JSON.stringify(user));
   applyRoleAccess(user);
   initApp();
}

/* ════════════════ AUTO-LOGIN ════════════════ */

window.addEventListener('DOMContentLoaded', () => {
  const savedUser = localStorage.getItem('cms_user');
  if (savedUser) {
    try {
      currentUser = JSON.parse(savedUser);
      initApp();
    } catch (_) {
      localStorage.removeItem('cms_user');
    }
  }
  if (currentUser) {
  
    applyRoleAccess(currentUser);
}


  // Global search
  document.getElementById('globalSearch')?.addEventListener('input', (e) => {
    const q = e.target.value.trim();
    if (q.length >= 2) {
      const results = allStudents.filter(s => s.name.toLowerCase().includes(q.toLowerCase()));
      if (results.length) {
        showSection('students', document.querySelector('.nav-item:nth-child(2)'));
        renderStudentTable(results);
      }
    }
  });
  

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      document.querySelectorAll('.modal-overlay').forEach(m => m.classList.add('hidden'));
      document.body.classList.remove('modal-open');
    }
  });
});
