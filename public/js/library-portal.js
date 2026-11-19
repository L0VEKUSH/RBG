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

function setLibraryMessage(element, message, state = 'empty-state') {
  if (!element) return;
  if (element.id === 'libStats' || element.id === 'dashOverdue') {
    const messageElement = document.createElement('div');
    messageElement.className = state;
    messageElement.textContent = message;
    element.replaceChildren(messageElement);
    return;
  }
  element.className = state;
  element.textContent = message;
}

function renderLibraryStats(grid, stats) {
  const cards = [
    ['Active titles', stats.totalBooks],
    ['Issued loans', stats.issuedBooks],
  ];
  grid.replaceChildren();
  for (const [label, value] of cards) {
    const card = document.createElement('div');
    card.className = 'stat-card';
    const content = document.createElement('div');
    content.className = 'stat-content';
    const valueElement = document.createElement('div');
    valueElement.className = 'stat-value';
    valueElement.textContent = new Intl.NumberFormat().format(value);
    const labelElement = document.createElement('div');
    labelElement.className = 'stat-label';
    labelElement.textContent = label;
    content.append(valueElement, labelElement);
    card.append(content);
    grid.append(card);
  }
}

initPortal({
  role: 'librarian',
  expectedRoles: ['librarian', 'super_admin', 'school_admin'],
  navConfig: LIBRARY_NAV,
  onDashboardLoad: loadLibraryDashboard
});

window.onPanel_dashboard = loadLibraryDashboard;
window.onPanel_issue = initIssue;
window.onPanel_return = () => { loadReturnLoans(); };
window.onPanel_catalog = loadCatalog;
window.onPanel_notices = loadNoticesFull;

async function loadLibraryDashboard() {
  const grid = document.getElementById('libStats');
  const chart = document.getElementById('dashInventoryChart')?.parentElement;
  const overdue = document.getElementById('dashOverdue');
  try {
    const response = await apiFetch('/library/stats');
    const stats = response?.data;
    if (response?.success !== true || !stats ||
        !Number.isSafeInteger(stats.totalBooks) || stats.totalBooks < 0 ||
        !Number.isSafeInteger(stats.issuedBooks) || stats.issuedBooks < 0) {
      throw new Error('Library statistics response is unavailable.');
    }
    renderLibraryStats(grid, stats);
  } catch (error) {
    setLibraryMessage(grid, error?.message || 'Library dashboard data could not be loaded.', 'error-state');
  }

  if (chart) chart.textContent = 'Inventory breakdown is not provided by the available statistics endpoint.';

  try {
    const response = await apiFetch('/library/overdue');
    if (response?.success !== true || !Array.isArray(response.data)) {
      throw new Error('Overdue loan response is unavailable.');
    }
    const count = response.data.length;
    setLibraryMessage(
      overdue,
      count === 0 ? 'No overdue loans.' : `${new Intl.NumberFormat().format(count)} overdue loan${count === 1 ? '' : 's'}.`
    );
  } catch (error) {
    setLibraryMessage(overdue, error?.message || 'Overdue loan data could not be loaded.', 'error-state');
  }
}

/* ── Issue Book ── */
function initIssue() {
  const d = new Date();
  d.setDate(d.getDate() + 14); // Default 14 days
  document.getElementById('issueDueDate').valueAsDate = d;
}

window.submitIssue = async function() {
  const studentId = document.getElementById('issueStudentId').value.trim();
  const bk = document.getElementById('issueBookId').value.trim();
  const due = document.getElementById('issueDueDate').value;
  const btn = document.getElementById('btnIssueSubmit');

  if(!studentId || !bk || !due) return toast.warning('Missing Data', 'Fill all required fields.');

  setButtonLoading(btn, true);
  try {
    await apiFetch('/library/issue', { method: 'POST', body: JSON.stringify({ bookId: bk, studentId, dueDate: due }) });
    toast.success('Issued', 'Book issued successfully.');
    document.getElementById('issueStudentId').value = '';
    document.getElementById('issueBookId').value = '';
  } catch(e) { toast.error('Error', e.message); }
  finally { setButtonLoading(btn, false); }
};

/* ── Return Book ── */
function setReturnStatus(message, state = 'empty-state') {
  setLibraryMessage(document.getElementById('returnStatus'), message, state);
}

window.onReturnSelectionChange = function() {
  const selection = document.getElementById('returnTransactionId');
  const button = document.getElementById('btnProcessReturn');
  if (button) button.disabled = !selection?.value;
};

window.loadReturnLoans = async function(options = {}) {
  const select = document.getElementById('returnTransactionId');
  const refreshButton = document.getElementById('btnRefreshLoans');
  const returnButton = document.getElementById('btnProcessReturn');
  if (!select) return false;

  const silent = options && options.silent === true;
  const originalRefreshText = refreshButton?.textContent;
  if (refreshButton) {
    refreshButton.disabled = true;
    refreshButton.textContent = 'Loading issued loans…';
  }
  if (returnButton) returnButton.disabled = true;
  select.replaceChildren();
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = 'Select an issued loan';
  select.append(placeholder);
  if (!silent) setReturnStatus('Loading issued loans…');

  try {
    const response = await apiFetch('/library/transactions');
    if (response?.success !== true || !Array.isArray(response.data)) {
      throw new Error('Issued loan records are unavailable.');
    }

    const issuedLoans = response.data.filter(loan => loan && loan.status === 'Issued' && loan._id);
    for (const loan of issuedLoans) {
      const transactionId = String(loan._id);
      const title = loan.book?.title || 'Book details unavailable';
      const student = loan.student?.user?.name || loan.student?.admissionNumber || 'Borrower details unavailable';
      const dueDateValue = loan.dueDate ? new Date(loan.dueDate) : null;
      const dueDate = dueDateValue && Number.isFinite(dueDateValue.getTime())
        ? new Intl.DateTimeFormat().format(dueDateValue)
        : 'date unavailable';
      const option = document.createElement('option');
      option.value = transactionId;
      option.textContent = `${title} — ${student} — due ${dueDate} — loan ${transactionId.slice(-6)}`;
      select.append(option);
    }

    window.onReturnSelectionChange();
    if (!silent) {
      setReturnStatus(issuedLoans.length ? `${issuedLoans.length} issued loan${issuedLoans.length === 1 ? '' : 's'} loaded.` : 'No issued loans are available to return.');
    }
    return true;
  } catch (error) {
    if (!silent) setReturnStatus(error?.message || 'Issued loan records could not be loaded.', 'error-state');
    return false;
  } finally {
    if (refreshButton) {
      refreshButton.disabled = false;
      refreshButton.textContent = originalRefreshText || 'Refresh issued loans';
    }
  }
};

window.processReturn = async function() {
  const select = document.getElementById('returnTransactionId');
  const button = document.getElementById('btnProcessReturn');
  const refreshButton = document.getElementById('btnRefreshLoans');
  const transactionId = select?.value;
  if (!transactionId) {
    setReturnStatus('Select an issued loan before processing a return.', 'error-state');
    return;
  }

  const originalText = button?.textContent;
  if (button) {
    button.disabled = true;
    button.textContent = 'Processing return…';
  }
  if (refreshButton) refreshButton.disabled = true;

  try {
    const response = await apiFetch('/library/return', {
      method: 'POST',
      body: JSON.stringify({ transactionId }),
    });
    if (response?.success !== true || String(response.data?._id) !== String(transactionId) || response.data?.status !== 'Returned') {
      throw new Error('The server did not confirm this loan return.');
    }

    await window.loadReturnLoans({ silent: true });
    setReturnStatus('Return recorded successfully.', 'success-state');
  } catch (error) {
    setReturnStatus(error?.message || 'The return could not be completed.', 'error-state');
  } finally {
    if (button) {
      button.textContent = originalText || 'Return selected loan';
      button.disabled = !select?.value;
    }
    if (refreshButton) refreshButton.disabled = false;
  }
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
      <button class="btn btn-ghost btn-sm" type="button" aria-label="Edit book ${b.title}" disabled title="Book editing is unavailable"><i class="fas fa-edit"></i></button>
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
