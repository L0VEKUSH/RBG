/* ══════════════════════════════════════════════════════════════
   RBG SCHOOL — portal-core.js v2.0
   Shared JavaScript for ALL role portals
   ══════════════════════════════════════════════════════════════ */

'use strict';

/* ─── 1. API / Auth Core ─────────────────────────────────────── */
const API = '/api/v1';

function getToken()  { return localStorage.getItem('token'); }
function getUser()   { try { return JSON.parse(localStorage.getItem('user') || 'null'); } catch { return null; } }

async function apiFetch(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  const tok = getToken();
  if (tok) headers['Authorization'] = 'Bearer ' + tok;

  let res;
  try {
    res = await fetch(API + path, { ...opts, headers });
  } catch (err) {
    throw { status: 0, message: 'Network error. Check your connection.' };
  }

  if (res.status === 401) {
    clearSession();
    window.location.href = '/portal/login.html';
    throw { status: 401, message: 'Session expired. Please log in again.' };
  }

  let data;
  try { data = await res.json(); } catch { data = {}; }

  if (!res.ok) throw { status: res.status, message: data.message || 'Something went wrong.' };
  return data;
}

function clearSession() {
  localStorage.removeItem('token');
  localStorage.removeItem('user');
}

async function initAuth(expectedRoles) {
  const tok = getToken();
  if (!tok) { window.location.href = '/portal/login.html'; return null; }

  try {
    const data = await apiFetch('/auth/me');
    const user = data.data || data.user;
    localStorage.setItem('user', JSON.stringify(user));

    if (expectedRoles && expectedRoles.length > 0) {
      const role = (user.role || '').toLowerCase();
      const allowed = expectedRoles.map(r => r.toLowerCase());
      if (!allowed.includes(role)) {
        showForbiddenPage(role, expectedRoles);
        return null;
      }
    }
    return user;
  } catch (err) {
    if (err.status === 401) return null; // already redirected
    showNetworkError();
    return null;
  }
}

function logout() {
  confirmAction('Are you sure you want to log out?', () => {
    apiFetch('/auth/logout', { method: 'POST' }).catch(() => {});
    clearSession();
    window.location.href = '/portal/login.html';
  }, 'Log Out', false);
}

/* ─── 2. Dark Mode ───────────────────────────────────────────── */
function initDarkMode() {
  const stored = localStorage.getItem('darkMode');
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const on = stored !== null ? stored === '1' : prefersDark;
  if (on) document.documentElement.classList.add('dark');
  updateThemeIcon();
}

function toggleDarkMode() {
  const on = document.documentElement.classList.toggle('dark');
  localStorage.setItem('darkMode', on ? '1' : '0');
  updateThemeIcon();
}

function updateThemeIcon() {
  const icon = document.getElementById('themeIcon');
  if (!icon) return;
  const dark = document.documentElement.classList.contains('dark');
  icon.className = dark ? 'fas fa-sun' : 'fas fa-moon';
}

function isDark() { return document.documentElement.classList.contains('dark'); }

/* ─── 3. Sidebar & Navigation ─────────────────────────────────── */
let _navBreadcrumbs = {};

function buildSidebar(navConfig, user) {
  const nav = document.getElementById('sidebarNav');
  if (!nav) return;

  let html = '';
  navConfig.forEach(group => {
    if (group.label) {
      html += `<div class="nav-group-label">${group.label}</div>`;
    }
    group.items.forEach(item => {
      _navBreadcrumbs[item.panel] = item.text;
      html += `<div class="nav-link csp-action-target" data-panel="${item.panel}" ${cspActionAttrs("showPanel", ['${item.panel}'], "click", [], [])} role="button" tabindex="0">
        <i class="fas fa-${item.icon}"></i><span>${item.text}</span>
      </div>`;
    });
  });
  nav.innerHTML = html;

  // Populate user info
  const name = user?.name || 'User';
  const role = user?.role || '';
  const initials = getInitials(name);

  ['sidebarAvatar','topbarAvatar'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = initials;
  });
  ['sidebarName','topbarName'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = name;
  });
  const rb = document.getElementById('sidebarRole');
  if (rb) rb.textContent = capitalize(role.replace(/_/g,' '));
}

function toggleSidebar() {
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebarOverlay');
  if (!sidebar) return;
  sidebar.classList.toggle('open');
  if (overlay) overlay.classList.toggle('visible');
}

function showPanel(panelId) {
  // Hide all
  document.querySelectorAll('.page-section').forEach(s => s.classList.remove('active'));

  // Show target
  const target = document.getElementById('panel-' + panelId);
  if (target) target.classList.add('active');

  // Update nav active state
  document.querySelectorAll('.nav-link').forEach(l => {
    l.classList.toggle('active', l.dataset.panel === panelId);
  });

  // Update breadcrumb
  const bc = document.getElementById('breadcrumb');
  if (bc) bc.textContent = _navBreadcrumbs[panelId] || capitalize(panelId);

  // Close sidebar on mobile
  if (window.innerWidth < 1024) {
    document.getElementById('sidebar')?.classList.remove('open');
    document.getElementById('sidebarOverlay')?.classList.remove('visible');
  }

  // Persist to URL hash
  history.replaceState(null, '', '#' + panelId);

  // Trigger panel-specific load function
  const fn = window['onPanel_' + panelId];
  if (typeof fn === 'function') fn();
}

function initNavigation() {
  const hash = location.hash.replace('#', '');
  const firstPanel = document.querySelector('.nav-link')?.dataset.panel || 'dashboard';
  showPanel(hash || firstPanel);
}

/* ─── 4. Toast Notifications ──────────────────────────────────── */
const TOAST_ICONS = { success: 'check-circle', error: 'exclamation-circle', warning: 'exclamation-triangle', info: 'info-circle' };

function showToast(type, title, message, duration = 3500) {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.innerHTML = `
    <i class="fas fa-${TOAST_ICONS[type] || 'info-circle'} toast-icon"></i>
    <div class="toast-body">
      <div class="toast-title">${title}</div>
      ${message ? `<div class="toast-msg">${message}</div>` : ''}
    </div>
    <button class="toast-close" aria-label="Close notification" ${cspActionAttrs("removeParent", [], "click", [], [])}><i class="fas fa-times"></i></button>
  `;
  container.appendChild(t);
  setTimeout(() => t.remove(), duration);
}

const toast = {
  success: (title, msg)  => showToast('success', title, msg),
  error:   (title, msg)  => showToast('error', title, msg),
  warning: (title, msg)  => showToast('warning', title, msg),
  info:    (title, msg)  => showToast('info', title, msg),
};
window.CSPToasts = toast;

/* ─── 5. Modal System ─────────────────────────────────────────── */
function openModal(id) {
  const overlay = document.getElementById(id);
  if (!overlay) return;
  overlay.classList.add('open');
  const firstInput = overlay.querySelector('input, select, textarea');
  if (firstInput) setTimeout(() => firstInput.focus(), 100);
  document.addEventListener('keydown', _escapeModal);
  overlay.addEventListener('click', _outsideClickClose);
}

function closeModal(id) {
  const overlay = document.getElementById(id);
  if (overlay) overlay.classList.remove('open');
  document.removeEventListener('keydown', _escapeModal);
}

function _escapeModal(e) {
  if (e.key === 'Escape') {
    document.querySelectorAll('.modal-overlay.open').forEach(m => m.classList.remove('open'));
    document.removeEventListener('keydown', _escapeModal);
  }
}

function _outsideClickClose(e) {
  if (e.target === e.currentTarget) {
    e.currentTarget.classList.remove('open');
    e.currentTarget.removeEventListener('click', _outsideClickClose);
  }
}

let _confirmCallback = null;
function confirmAction(message, onConfirm, confirmText = 'Confirm', danger = false) {
  const overlay = document.getElementById('confirmModal');
  if (!overlay) {
    // Fallback to native confirm
    if (window.confirm(message)) onConfirm();
    return;
  }
  document.getElementById('confirmMsg').textContent = message;
  const btn = document.getElementById('confirmOkBtn');
  btn.textContent = confirmText;
  btn.className = `btn ${danger ? 'btn-danger' : 'btn-primary'}`;
  _confirmCallback = onConfirm;
  openModal('confirmModal');
}

function _confirmOk() {
  closeModal('confirmModal');
  if (typeof _confirmCallback === 'function') _confirmCallback();
  _confirmCallback = null;
}

/* ─── 6. Button Loading ───────────────────────────────────────── */
function setButtonLoading(btn, loading) {
  if (!btn) return;
  if (loading) {
    btn._origText = btn.innerHTML;
    btn.disabled = true;
    btn.classList.add('loading');
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Please wait...';
  } else {
    btn.disabled = false;
    btn.classList.remove('loading');
    btn.innerHTML = btn._origText || btn.innerHTML;
  }
}

/* ─── 7. Format Utilities ─────────────────────────────────────── */
function formatDate(date, fmt = 'DD MMM YYYY') {
  if (!date) return '—';
  const d = new Date(date);
  if (isNaN(d)) return '—';
  const day = String(d.getDate()).padStart(2,'0');
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const mon = months[d.getMonth()];
  const year = d.getFullYear();
  if (fmt === 'DD MMM YYYY') return `${day} ${mon} ${year}`;
  if (fmt === 'DD/MM/YYYY') return `${day}/${String(d.getMonth()+1).padStart(2,'0')}/${year}`;
  if (fmt === 'MMM DD') return `${mon} ${day}`;
  return d.toLocaleDateString();
}

function formatTime(date) {
  const d = new Date(date);
  if (isNaN(d)) return '';
  let h = d.getHours(), m = d.getMinutes();
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${String(m).padStart(2,'0')} ${ampm}`;
}

function formatRelativeTime(date) {
  const d = new Date(date);
  const now = new Date();
  const diff = Math.floor((now - d) / 1000);
  if (diff < 60) return 'Just now';
  if (diff < 3600) return `${Math.floor(diff/60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff/3600)}h ago`;
  if (diff < 172800) return 'Yesterday';
  if (diff < 604800) return `${Math.floor(diff/86400)}d ago`;
  return formatDate(date, 'DD MMM YYYY');
}

function formatCurrency(amount) {
  if (amount === null || amount === undefined) return '—';
  return '₹' + Number(amount).toLocaleString('en-IN');
}

function formatNumber(n) {
  if (n >= 1e6) return (n/1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n/1e3).toFixed(1) + 'K';
  return String(n);
}

function getInitials(name) {
  if (!name) return '?';
  return name.split(' ').slice(0,2).map(p => p[0]).join('').toUpperCase();
}

function capitalize(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function formatPercent(num, total) {
  if (!total || total === 0) return '0%';
  return (num / total * 100).toFixed(1) + '%';
}

function daysUntil(dateStr) {
  const d = new Date(dateStr);
  const now = new Date();
  now.setHours(0,0,0,0);
  d.setHours(0,0,0,0);
  const diff = Math.ceil((d - now) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff < 0) return `${Math.abs(diff)}d ago`;
  return `In ${diff} days`;
}

function getTodayDayName() {
  return ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][new Date().getDay()];
}

/* ─── 8. Class Level Helpers ──────────────────────────────────── */
const CLASS_LEVELS = ['Pre-Nursery','Nursery','LKG','UKG','1','2','3','4','5','6','7','8','9','10','11','12'];

function classLevelOptions(selected = '') {
  return CLASS_LEVELS.map(c =>
    `<option value="${c}" ${c === selected ? 'selected' : ''}>${c === '1' || isNaN(c) ? c : 'Class ' + c}</option>`
  ).join('');
}

/* ─── 9. Chart Helpers ────────────────────────────────────────── */
function getChartDefaults() {
  const dark = isDark();
  return {
    textColor: dark ? '#94a3b8' : '#64748b',
    gridColor: dark ? 'rgba(255,255,255,.08)' : 'rgba(0,0,0,.07)',
    font: { family: 'Inter, sans-serif', size: 12 },
  };
}

const _charts = {};

function createLineChart(id, labels, datasets, opts = {}) {
  const ctx = document.getElementById(id);
  if (!ctx) return;
  if (_charts[id]) _charts[id].destroy();
  const def = getChartDefaults();
  _charts[id] = new Chart(ctx, {
    type: 'line',
    data: { labels, datasets: datasets.map(ds => ({
      tension: .4, fill: false, pointRadius: 3, borderWidth: 2.5, ...ds
    }))},
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { labels: { color: def.textColor, font: def.font } }, ...opts.plugins },
      scales: {
        x: { ticks: { color: def.textColor, font: def.font }, grid: { color: def.gridColor }, ...opts.xScale },
        y: { ticks: { color: def.textColor, font: def.font }, grid: { color: def.gridColor }, ...opts.yScale },
      },
      ...opts
    }
  });
  return _charts[id];
}

function createBarChart(id, labels, datasets, opts = {}) {
  const ctx = document.getElementById(id);
  if (!ctx) return;
  if (_charts[id]) _charts[id].destroy();
  const def = getChartDefaults();
  _charts[id] = new Chart(ctx, {
    type: 'bar',
    data: { labels, datasets: datasets.map(ds => ({
      borderRadius: 6, borderSkipped: false, ...ds
    }))},
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { labels: { color: def.textColor, font: def.font } }, ...opts.plugins },
      scales: {
        x: { ticks: { color: def.textColor, font: def.font }, grid: { display: false }, ...opts.xScale },
        y: { ticks: { color: def.textColor, font: def.font }, grid: { color: def.gridColor }, ...opts.yScale },
      },
      ...opts
    }
  });
  return _charts[id];
}

function createDoughnutChart(id, labels, data, colors, opts = {}) {
  const ctx = document.getElementById(id);
  if (!ctx) return;
  if (_charts[id]) _charts[id].destroy();
  const def = getChartDefaults();
  _charts[id] = new Chart(ctx, {
    type: 'doughnut',
    data: { labels, datasets: [{ data, backgroundColor: colors, borderWidth: 2 }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      cutout: '65%',
      plugins: { legend: { position: 'bottom', labels: { color: def.textColor, font: def.font, padding: 16 } }, ...opts.plugins },
      ...opts
    }
  });
  return _charts[id];
}

/* ─── 10. DateTime Display ────────────────────────────────────── */
function updateDateTime() {
  const now = new Date();
  const h = now.getHours();
  const greeting = h < 12 ? 'Good Morning' : h < 17 ? 'Good Afternoon' : 'Good Evening';
  const user = getUser();
  const firstName = user?.name?.split(' ')[0] || '';

  const el = document.getElementById('dashGreeting');
  if (el) el.textContent = `${greeting}${firstName ? ', ' + firstName : ''}! 👋`;

  const de = document.getElementById('dashDate');
  if (de) {
    de.textContent = now.toLocaleDateString('en-IN', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    });
  }
}

/* ─── 11. Error Pages ─────────────────────────────────────────── */
function showForbiddenPage(actualRole, requiredRoles) {
  const mc = document.querySelector('.main-content');
  if (!mc) return;
  mc.innerHTML = `<div class="main-inner csp-style-a2f93d3000" >
    <div class="error-state forbidden csp-style-df5afa5a85" >
      <i class="fas fa-ban csp-style-a3a898ee86" ></i>
      <h3>Access Denied</h3>
      <p>This portal is not available for the <strong>${capitalize(actualRole.replace(/_/g,' '))}</strong> role.</p>
      <p class="csp-style-2014417cc3">Required: ${requiredRoles.join(', ')}</p>
      <button class="btn btn-primary csp-style-80dfcf9181"  ${cspActionAttrs("navigateLogin", [], "click", [], [])}>
        <i class="fas fa-arrow-left"></i> Back to Login
      </button>
    </div>
  </div>`;
}

function showNetworkError(panelEl) {
  const html = `<div class="error-state csp-style-cb6a37b76a" >
    <i class="fas fa-wifi csp-style-6235a345f9" ></i>
    <h3>Connection Error</h3>
    <p>Unable to reach the server. Please check your network.</p>
    <button class="btn btn-secondary csp-style-66e6b652a6"  ${cspActionAttrs("reloadPage", [], "click", [], [])}>
      <i class="fas fa-redo"></i> Retry
    </button>
  </div>`;
  if (panelEl) panelEl.innerHTML = html;
}

function setEmptyState(el, icon, title, message, action = '') {
  el.innerHTML = `<div class="empty-state">
    <i class="fas fa-${icon}"></i>
    <h4>${title}</h4>
    <p>${message}</p>
    ${action ? `<div class="empty-action">${action}</div>` : ''}
  </div>`;
}

/* ─── 12. Pagination ──────────────────────────────────────────── */
function renderPagination(containerId, total, page, limit, onPageChange) {
  const el = document.getElementById(containerId);
  if (!el) return;
  const pages = Math.ceil(total / limit);
  if (pages <= 1) { el.innerHTML = ''; return; }

  if (!el.dataset.paginationBound) {
    el.addEventListener('click', event => {
      const button = event.target.closest('[data-pager-page]');
      if (!button || !el.contains(button) || button.disabled) return;
      el._onPageChange?.(Number(button.dataset.pagerPage));
    });
    el.dataset.paginationBound = 'true';
  }
  el._onPageChange = onPageChange;

  let html = `<button type="button" class="page-btn" data-pager-page="${page-1}" aria-label="Previous page" ${page<=1?'disabled':''}><i class="fas fa-chevron-left" aria-hidden="true"></i></button>`;
  for (let i = 1; i <= pages; i++) {
    if (pages > 7 && Math.abs(i - page) > 2 && i !== 1 && i !== pages) {
      if (i === 2 || i === pages-1) html += `<span class="pagination-ellipsis">…</span>`;
      continue;
    }
    html += `<button type="button" class="page-btn ${i===page?'active':''}" data-pager-page="${i}" aria-label="Page ${i}" aria-current="${i===page?'page':'false'}">${i}</button>`;
  }
  html += `<button type="button" class="page-btn" data-pager-page="${page+1}" aria-label="Next page" ${page>=pages?'disabled':''}><i class="fas fa-chevron-right" aria-hidden="true"></i></button>`;
  el.innerHTML = html;
}

/* ─── 13. Profile Panel ───────────────────────────────────────── */
function renderProfilePanel(user) {
  const card = document.getElementById('profileCard');
  if (!card || !user) return;
  card.innerHTML = `
    <div class="card-body csp-style-f4f35127ef" >
      <div class="profile-big-avatar">${getInitials(user.name)}</div>
      <h3 class="csp-style-8a008742af">${user.name}</h3>
      <span class="badge badge-primary csp-style-e2f84b1e23" >${capitalize((user.role||'').replace(/_/g,' '))}</span>
    </div>
    <div class="card-body csp-style-9953b932b0" >
      <div class="profile-meta">
        <div class="profile-meta-item"><span class="meta-label">Email</span><span>${user.email||'—'}</span></div>
        <div class="profile-meta-item"><span class="meta-label">Phone</span><span>${user.phone||'—'}</span></div>
        <div class="profile-meta-item"><span class="meta-label">Gender</span><span>${capitalize(user.gender||'—')}</span></div>
        <div class="profile-meta-item"><span class="meta-label">Member Since</span><span>${formatDate(user.createdAt)}</span></div>
      </div>
    </div>
    <div class="card-body csp-style-9953b932b0" >
      <h4 class="csp-style-68f37cd999">Update Profile</h4>
      <div class="form-grid csp-style-9430410d62" >
        <div class="form-group"><label for="profileName">Name</label><input class="form-control" id="profileName" autocomplete="name" value="${user.name||''}"></div>
        <div class="form-group"><label for="profilePhone">Phone</label><input class="form-control" id="profilePhone" autocomplete="tel" value="${user.phone||''}"></div>
      </div>
      <button class="btn btn-primary btn-sm" ${cspActionAttrs("updateProfileInfo", [], "click", [], [])}><i class="fas fa-save"></i> Update</button>
    </div>
    <div class="card-body csp-style-9953b932b0" >
      <h4 class="csp-style-68f37cd999">Change Password</h4>
      <div class="form-grid csp-style-7d60fe7df3" >
        <div class="form-group"><label for="pwCurrent">Current Password</label><input type="password" class="form-control" id="pwCurrent" autocomplete="current-password"></div>
        <div class="form-group"><label for="pwNew">New Password</label><input type="password" class="form-control" id="pwNew" autocomplete="new-password"></div>
        <div class="form-group"><label for="pwConfirm">Confirm</label><input type="password" class="form-control" id="pwConfirm" autocomplete="new-password"></div>
      </div>
      <button class="btn btn-secondary btn-sm" ${cspActionAttrs("changePasswordAction", [], "click", [], [])}><i class="fas fa-lock"></i> Change Password</button>
    </div>
  `;
}

async function updateProfileInfo() {
  const name = document.getElementById('profileName')?.value.trim();
  const phone = document.getElementById('profilePhone')?.value.trim();
  if (!name) return toast.warning('Required', 'Name cannot be empty.');
  try {
    const res = await apiFetch('/auth/update-profile', {
      method: 'PUT', body: JSON.stringify({ name, phone })
    });
    const user = getUser();
    if (user) { user.name = name; user.phone = phone; localStorage.setItem('user', JSON.stringify(user)); }
    toast.success('Profile Updated', 'Your information has been saved.');
  } catch(e) { toast.error('Update Failed', e.message); }
}

async function changePasswordAction() {
  const cur = document.getElementById('pwCurrent')?.value;
  const nw  = document.getElementById('pwNew')?.value;
  const cf  = document.getElementById('pwConfirm')?.value;
  if (!cur || !nw || !cf) return toast.warning('Required', 'All password fields are required.');
  if (nw !== cf) return toast.warning('Mismatch', 'New password and confirm password do not match.');
  if (nw.length < 8) return toast.warning('Too Short', 'Password must be at least 8 characters.');
  try {
    await apiFetch('/auth/change-password', {
      method: 'PUT', body: JSON.stringify({ currentPassword: cur, newPassword: nw })
    });
    toast.success('Password Changed', 'Your password has been updated.');
    ['pwCurrent','pwNew','pwConfirm'].forEach(id => { const el = document.getElementById(id); if(el) el.value=''; });
  } catch(e) { toast.error('Failed', e.message); }
}

/* ─── 14. Notifications ───────────────────────────────────────── */
async function loadNotifications() {
  try {
    const data = await apiFetch('/notifications?limit=20');
    const items = data.data || data.notifications || [];
    const unread = items.filter(n => !n.isRead).length;
    const dot = document.getElementById('notifDot');
    cspSetVisibility(dot, unread > 0, 'block');
    const list = document.getElementById('notificationsList');
    if (!list) return;
    if (!items.length) {
      setEmptyState(list, 'bell', 'No Notifications', 'You\'re all caught up!');
    } else {
      list.innerHTML = items.map(n => `
        <div class="timeline-item csp-style-a9e2a8513a" >
          <div class="csp-style-64b7d3a81b">${n.title||'Notification'}</div>
          <div class="csp-style-b4daad70a5">${n.message||''} · ${formatRelativeTime(n.createdAt)}</div>
        </div>`).join('');
    }
  } catch { /* notifications are optional */ }
}

/* ─── 15. Global Search ───────────────────────────────────────── */
function handleGlobalSearch(e) {
  if (e.key === 'Enter') {
    const q = e.target.value.trim();
    if (q.length < 2) return;
    toast.info('Search', `Searching for "${q}"...`);
  }
}

/* ─── 16. Notices Loader ──────────────────────────────────────── */
async function loadRecentNotices(containerId, limit = 5) {
  const el = document.getElementById(containerId);
  if (!el) return;
  try {
    const data = await apiFetch(`/notices?limit=${limit}`);
    const notices = data.data || data.notices || [];
    if (!notices.length) {
      setEmptyState(el, 'clipboard-list', 'No Notices', 'No notices have been posted.');
      return;
    }
    el.innerHTML = notices.map(n => `
      <div class="csp-style-89405a374f">
        <div class="csp-style-c5f378391d">
          <span class="badge badge-${noticeBadge(n.priority)} csp-style-85850cc31c" >${n.type||'General'}</span>
          <div>
            <div class="csp-style-02a3c7300a">${n.title}</div>
            <div class="csp-style-d7adc3fe9e">${formatDate(n.createdAt)}</div>
          </div>
        </div>
      </div>`).join('');
  } catch { el.innerHTML = '<p class="empty-state csp-style-90fd3e673b" >Could not load notices.</p>'; }
}

function noticeBadge(priority) {
  return { High:'danger', Urgent:'danger', Low:'secondary', Medium:'info' }[priority] || 'info';
}

/* ─── 17. Confirm Modal HTML (must be in every portal) ──────── */
const CONFIRM_MODAL_HTML = `
<div class="modal-overlay" id="confirmModal">
  <div class="modal modal-sm">
    <div class="modal-header"><h3><i class="fas fa-question-circle"></i> Confirm</h3></div>
    <div class="modal-body"><p id="confirmMsg">Are you sure?</p></div>
    <div class="modal-footer">
      <button class="btn btn-secondary" ${cspActionAttrs("closeModal", ['confirmModal'], "click", [], [])}>Cancel</button>
      <button class="btn btn-primary" id="confirmOkBtn" ${cspActionAttrs("_confirmOk", [], "click", [], [])}>Confirm</button>
    </div>
  </div>
</div>`;

function injectConfirmModal() {
  if (!document.getElementById('confirmModal')) {
    document.body.insertAdjacentHTML('beforeend', CONFIRM_MODAL_HTML);
  }
}

/* ─── 18. Master Init ─────────────────────────────────────────── */
async function initPortal(config) {
  /*
    config = {
      role: 'student',
      expectedRoles: ['student'],
      navConfig: [{ label: 'Learning', items: [{icon:'home', text:'Dashboard', panel:'dashboard'}] }],
      onDashboardLoad: async function(user) { ... }
    }
  */
  initDarkMode();
  injectConfirmModal();

  const user = await initAuth(config.expectedRoles);
  if (!user) return;

  buildSidebar(config.navConfig, user);
  initNavigation();
  updateDateTime();
  setInterval(updateDateTime, 60000);
  renderProfilePanel(user);
  loadNotifications();

  // Call role-specific dashboard loader
  if (typeof config.onDashboardLoad === 'function') {
    try {
      await config.onDashboardLoad(user);
    } catch (err) {
      console.error('Dashboard load error:', err);
    }
  }
}
