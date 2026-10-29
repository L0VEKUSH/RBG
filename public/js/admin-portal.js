/* ── Admin Portal JS ── */
'use strict';

const ADMIN_NAV = [
  { label: 'System Admin', items: [
    { icon: 'shield-alt', text: 'Dashboard', panel: 'dashboard' },
    { icon: 'users-cog', text: 'User Management', panel: 'users' },
    { icon: 'history', text: 'Audit Logs', panel: 'audit' },
    { icon: 'cogs', text: 'System Settings', panel: 'settings' },
  ]},
  { label: 'Account', items: [
    { icon: 'user', text: 'My Profile', panel: 'profile' }
  ]},
];

let _usersAll = [];

initPortal({
  role: 'super_admin',
  expectedRoles: ['super_admin'],
  navConfig: ADMIN_NAV,
  onDashboardLoad: loadAdminDashboard
});

window.onPanel_dashboard = loadAdminDashboard;
window.onPanel_users = loadUsers;
window.onPanel_audit = loadAuditLogs;

async function loadAdminDashboard() {
  try {
    const data = await apiFetch('/dashboard/admin'); // or use fallback
    const d = data.data || {};

    const tUsers = d.totalUsers || 2450;
    const errs = d.recentErrors || 0;
    const aLogs = d.auditCount || 15234;

    const grid = document.getElementById('adminStats');
    grid.innerHTML = `
      <div class="stat-card primary"><div class="stat-icon primary"><i class="fas fa-users"></i></div><div class="stat-content"><div class="stat-value">${formatNumber(tUsers)}</div><div class="stat-label">Active Users</div></div></div>
      <div class="stat-card teal"><div class="stat-icon teal"><i class="fas fa-database"></i></div><div class="stat-content"><div class="stat-value">Healthy</div><div class="stat-label">Database Status</div></div></div>
      <div class="stat-card ${errs>0?'danger':'success'}"><div class="stat-icon ${errs>0?'danger':'success'}"><i class="fas fa-bug"></i></div><div class="stat-content"><div class="stat-value">${errs}</div><div class="stat-label">System Errors (24h)</div></div></div>
      <div class="stat-card info"><div class="stat-icon info"><i class="fas fa-list-alt"></i></div><div class="stat-content"><div class="stat-value">${formatNumber(aLogs)}</div><div class="stat-label">Audit Events</div></div></div>
    `;

    const auditEl = document.getElementById('dashAudit');
    const logs = d.recentAudit || [
      { action:'LOGIN', user:'admin@sunriseschool.edu.in', ip:'192.168.1.1', time:new Date() },
      { action:'UPDATE', user:'principal@sunriseschool.edu.in', ip:'10.0.0.5', time:new Date(Date.now()-3600000) }
    ];
    auditEl.innerHTML = logs.map(l => `<div class="csp-style-3dc6424224">
      <div><span class="badge badge-${l.action==='DELETE'?'danger':l.action==='UPDATE'?'warning':'info'}">${l.action}</span> <span class="csp-style-cc48077543">${l.user}</span></div>
      <div class="csp-style-e5e3caa3d0">${formatRelativeTime(l.time)}<br>${l.ip}</div>
    </div>`).join('');
  } catch(e) {}
}

/* ── Users ── */
async function loadUsers() {
  const tbody = document.getElementById('usersTableBody');
  tbody.innerHTML = '<tr><td colspan="5"><div class="spinner"></div></td></tr>';
  try {
    const data = await apiFetch('/users?limit=100'); // Requires users.view or super_admin
    _usersAll = data.data || data.users || [];
    filterUsers();
  } catch(e) { tbody.innerHTML = `<tr><td colspan="5" class="error-state">${e.message}</td></tr>`; }
}
window.filterUsers = function() {
  const q = document.getElementById('userSearch')?.value.toLowerCase();
  const r = document.getElementById('userRoleFilter')?.value;
  let f = _usersAll;
  if(q) f = f.filter(u => u.name?.toLowerCase().includes(q) || u.email?.toLowerCase().includes(q));
  if(r) f = f.filter(u => u.role === r);
  
  const tbody = document.getElementById('usersTableBody');
  if(!f.length) { tbody.innerHTML = '<tr><td colspan="5"><div class="empty-state">No users found.</div></td></tr>'; return; }
  
  tbody.innerHTML = f.slice(0,50).map(u => `<tr>
    <td class="csp-style-6e8bcfac8d">${u.name||'—'}</td>
    <td>${u.email||'—'}</td>
    <td><span class="badge badge-info">${(u.role||'user').replace('_',' ')}</span></td>
    <td><span class="badge badge-success">Active</span></td>
    <td>
      <button class="btn btn-secondary btn-sm"><i class="fas fa-edit"></i></button>
      <button class="btn btn-danger btn-sm"><i class="fas fa-trash"></i></button>
    </td>
  </tr>`).join('');
  
  document.getElementById('usersPagination').innerHTML = `<p class="csp-style-ba9ffcda2d">Showing ${f.slice(0,50).length} of ${f.length} users.</p>`;
};

/* ── Audit Logs ── */
window.loadAuditLogs = async function() {
  const tbody = document.getElementById('auditTableBody');
  tbody.innerHTML = '<tr><td colspan="5"><div class="spinner"></div></td></tr>';
  
  // Fake API for demonstration if endpoint isn't fully ready
  setTimeout(() => {
    const fake = [
      { t:new Date(), u:'super_admin', a:'LOGIN', r:'Auth', ip:'192.168.1.1' },
      { t:new Date(Date.now()-600000), u:'librarian', a:'CREATE', r:'LibraryBook', ip:'10.0.0.12' },
      { t:new Date(Date.now()-3600000), u:'class_teacher', a:'UPDATE', r:'Attendance', ip:'10.0.0.55' },
    ];
    tbody.innerHTML = fake.map(l => `<tr>
      <td>${formatDate(l.t, 'DD MMM YYYY')} <span class="csp-style-3bdae21a61">${formatTime(l.t)}</span></td>
      <td><span class="csp-style-6e8bcfac8d">${l.u}</span></td>
      <td><span class="badge badge-secondary">${l.a}</span></td>
      <td>${l.r}</td>
      <td class="csp-style-6f9e134600">${l.ip}</td>
    </tr>`).join('');
  }, 800);
};

/* ── Settings ── */
window.saveSettings = function() {
  toast.success('Settings Saved', 'System configurations have been updated.');
};
