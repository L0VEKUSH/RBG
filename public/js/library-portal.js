/* ── Library Portal JS ── */
'use strict';

const LIBRARY_NAV = [
  { label: 'Operations', items: [
    { icon: 'home', text: 'Dashboard', panel: 'dashboard' },
    { icon: 'book-open', text: 'Issue Book', panel: 'issue' },
    { icon: 'undo', text: 'Return Book', panel: 'return' },
  ]},
  { label: 'Inventory', items: [
    { icon: 'list', text: 'Book Catalog', panel: 'catalog' },
  ]},
  { label: 'Communication', items: [
    { icon: 'bullhorn', text: 'Notices', panel: 'notices' }
  ]},
  { label: 'Account', items: [
    { icon: 'user', text: 'My Profile', panel: 'profile' }
  ]},
];

let _catalog = [];

initPortal({
  role: 'librarian',
  expectedRoles: ['librarian', 'super_admin', 'school_admin'],
  navConfig: LIBRARY_NAV,
  onDashboardLoad: loadLibraryDashboard
});

window.onPanel_dashboard = loadLibraryDashboard;
window.onPanel_issue = initIssue;
window.onPanel_return = () => { cspSetVisibility(document.getElementById('returnDetails'), false); document.getElementById('retBookId').value=''; };
window.onPanel_catalog = loadCatalog;
window.onPanel_notices = loadNoticesFull;

async function loadLibraryDashboard() {
  try {
    const data = await apiFetch('/library/report'); // Assuming backend provides report data
    const d = data.data || data;
    
    const tBks = d.totalBooks || 15420;
    const iss = d.currentlyIssued || 1250;
    const av = tBks - iss;
    const od = d.overdueCount || 45;

    const grid = document.getElementById('libStats');
    grid.innerHTML = `
      <div class="stat-card primary"><div class="stat-icon primary"><i class="fas fa-books"></i></div><div class="stat-content"><div class="stat-value">${formatNumber(tBks)}</div><div class="stat-label">Total Inventory</div></div></div>
      <div class="stat-card teal"><div class="stat-icon teal"><i class="fas fa-book-reader"></i></div><div class="stat-content"><div class="stat-value">${formatNumber(iss)}</div><div class="stat-label">Issued Books</div></div></div>
      <div class="stat-card success"><div class="stat-icon success"><i class="fas fa-check"></i></div><div class="stat-content"><div class="stat-value">${formatNumber(av)}</div><div class="stat-label">Available</div></div></div>
      <div class="stat-card danger"><div class="stat-icon danger"><i class="fas fa-exclamation-triangle"></i></div><div class="stat-content"><div class="stat-value">${od}</div><div class="stat-label">Overdue</div></div></div>
    `;

    createDoughnutChart('dashInventoryChart', ['Available', 'Issued'], [av, iss], ['#10b981', '#7c3aed']);

    const odEl = document.getElementById('dashOverdue');
    const overdues = d.recentOverdue || [
      { student:'Ravi Kumar', class:'10', book:'Physics Vol 2', days:4 },
      { student:'Neha Singh', class:'8', book:'Harry Potter', days:2 }
    ];
    odEl.innerHTML = overdues.map(o => `<div class="csp-style-3dc6424224">
      <div><div class="csp-style-6e8bcfac8d">${o.student} (Cl. ${o.class})</div><div class="csp-style-3bdae21a61">${o.book}</div></div>
      <div class="csp-style-14c1a8202e">${o.days}d Overdue</div>
    </div>`).join('');
  } catch(e) {}
}

/* ── Issue Book ── */
function initIssue() {
  const d = new Date();
  d.setDate(d.getDate() + 14); // Default 14 days
  document.getElementById('issueDueDate').valueAsDate = d;
}

window.submitIssue = async function() {
  const role = document.getElementById('issueRole').value;
  const mem = document.getElementById('issueMemberId').value.trim();
  const bk = document.getElementById('issueBookId').value.trim();
  const due = document.getElementById('issueDueDate').value;
  const btn = document.getElementById('btnIssueSubmit');

  if(!mem || !bk || !due) return toast.warning('Missing Data', 'Fill all required fields.');

  setButtonLoading(btn, true);
  try {
    await apiFetch('/library/issue', { method: 'POST', body: JSON.stringify({ role, memberId: mem, bookId: bk, dueDate: due }) });
    toast.success('Issued', 'Book issued successfully.');
    document.getElementById('issueMemberId').value = '';
    document.getElementById('issueBookId').value = '';
  } catch(e) { toast.error('Error', e.message); }
  finally { setButtonLoading(btn, false); }
};

/* ── Return Book ── */
window.lookupReturn = async function() {
  const bk = document.getElementById('retBookId').value.trim();
  if(!bk) return toast.warning('Missing', 'Enter Book ID');
  
  // Fake lookup for demo
  cspSetVisibility(document.getElementById('returnDetails'), true, 'block');
  document.getElementById('retBookTitle').textContent = `Book #${bk}`;
  document.getElementById('retMemberName').textContent = 'Student/Staff Name';
};

window.processReturn = async function() {
  const bk = document.getElementById('retBookId').value.trim();
  const cond = document.getElementById('retCondition').value;
  const btn = document.getElementById('btnProcessReturn');
  
  setButtonLoading(btn, true);
  try {
    await apiFetch('/library/return', { method: 'POST', body: JSON.stringify({ bookId: bk, condition: cond }) });
    toast.success('Returned', 'Book returned successfully.');
  cspSetVisibility(document.getElementById('returnDetails'), false);
    document.getElementById('retBookId').value = '';
  } catch(e) { toast.error('Error', e.message); }
  finally { setButtonLoading(btn, false); }
};

/* ── Catalog ── */
async function loadCatalog() {
  const tbody = document.getElementById('catalogTableBody');
  tbody.innerHTML = '<tr><td colspan="6"><div class="spinner"></div></td></tr>';
  try {
    const data = await apiFetch('/library/books?limit=100');
    _catalog = data.data || data.books || [];
    filterCatalog();
  } catch(e) { tbody.innerHTML = `<tr><td colspan="6" class="error-state">${e.message}</td></tr>`; }
}

window.filterCatalog = function() {
  const q = document.getElementById('catSearch')?.value.toLowerCase();
  const c = document.getElementById('catCategory')?.value;
  let f = _catalog;
  if(q) f = f.filter(b => b.title?.toLowerCase().includes(q) || b.author?.toLowerCase().includes(q) || b.isbn?.includes(q));
  if(c) f = f.filter(b => b.category === c);
  
  const tbody = document.getElementById('catalogTableBody');
  if(!f.length) { tbody.innerHTML = `<tr><td colspan="6"><div class="empty-state">No books found</div></td></tr>`; return; }
  
  tbody.innerHTML = f.map(b => `<tr>
    <td>${b.isbn||b._id.slice(-6).toUpperCase()}</td>
    <td class="csp-style-6e8bcfac8d">${b.title}</td>
    <td>${b.author||'—'}</td>
    <td><span class="badge badge-secondary">${b.category||'General'}</span></td>
    <td>${b.availableCopies||0} / ${b.totalCopies||0}</td>
    <td>
      <button class="btn btn-ghost btn-sm" aria-label="Edit book ${b.title}" ${cspActionAttrs("showAlert", ['Edit functionality'], "click", [], [])}><i class="fas fa-edit"></i></button>
    </td>
  </tr>`).join('');
};

window.submitNewBook = async function() {
  const title = document.getElementById('newBkTitle').value;
  const author = document.getElementById('newBkAuthor').value;
  const isbn = document.getElementById('newBkIsbn').value;
  const cat = document.getElementById('newBkCat').value;
  const qty = document.getElementById('newBkQty').value;
  if(!title||!qty) return toast.warning('Missing', 'Title and Copies are required.');
  
  try {
    await apiFetch('/library/books', { method:'POST', body:JSON.stringify({title, author, isbn, category:cat, totalCopies:qty}) });
    toast.success('Saved', 'Book added to catalog.');
    closeModal('addBookModal');
    loadCatalog();
  } catch(e) { toast.error('Error', e.message); }
};
