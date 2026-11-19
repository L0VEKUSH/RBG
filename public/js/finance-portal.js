/* ── Finance Portal JS ── */
'use strict';

const FINANCE_NAV = [
  { label: 'Operations', items: [
    { icon: 'home', text: 'Dashboard', panel: 'dashboard' },
    { icon: 'hand-holding-usd', text: 'Collect Fee', panel: 'collection' },
    { icon: 'exclamation-circle', text: 'Defaulters', panel: 'defaulters' },
  ]},
  { label: 'Analytics', items: [
    { icon: 'chart-pie', text: 'Financial Reports', panel: 'reports' }
  ]},
  { label: 'Communication', items: [
    { icon: 'bullhorn', text: 'Notices', panel: 'notices' },
    { icon: 'calendar', text: 'Events', panel: 'events' }
  ]},
  { label: 'Account', items: [
    { icon: 'user', text: 'My Profile', panel: 'profile' }
  ]},
];

initPortal({
  role: 'accountant',
  expectedRoles: ['accountant', 'super_admin', 'school_admin'],
  navConfig: FINANCE_NAV,
  onDashboardLoad: loadFinanceDashboard
});

window.onPanel_dashboard = loadFinanceDashboard;
window.onPanel_collection = initCollectionPanel;
window.onPanel_defaulters = loadDefaultersOpts;
window.onPanel_reports = initReports;
window.onPanel_notices = loadNoticesFull;
window.onPanel_events = loadEvents;

async function loadFinanceDashboard() {
  const grid = document.getElementById('financeStats');
  const chart = document.getElementById('financeRevChart')?.parentElement;
  const transactions = document.getElementById('dashTxns');
  try {
    await apiFetch('/fees/report');
    grid.innerHTML = '<div class="empty-state">Finance totals are unavailable until the report API provides matching dashboard fields.</div>';
    if (chart) chart.textContent = 'Revenue trend is unavailable.';
    transactions.textContent = 'Recent payment transactions are unavailable.';
  } catch (error) {
    grid.innerHTML = '<div class="error-state">Finance dashboard data could not be loaded.</div>';
    if (chart) chart.textContent = 'Revenue trend is unavailable.';
    transactions.textContent = 'Recent payment transactions are unavailable.';
  }
}
/* ── Fee Collection ── */
function initCollectionPanel() {
  const sel = document.getElementById('collSearchClass');
  if(sel.options.length <= 1) sel.innerHTML += classLevelOptions();
}

window.loadStudentsForCollection = async function() {
  const cls = document.getElementById('collSearchClass').value;
  const sel = document.getElementById('collSearchStudent');
  if(!cls) {
    sel.replaceChildren(new Option('Select a class first', ''));
    sel.disabled = true;
    return;
  }
  
  sel.replaceChildren(new Option('Loading students...', ''));
  sel.disabled = true;
  try {
    const data = await apiFetch(`/students?class=${encodeURIComponent(cls)}&limit=1000`);
    if (!data?.success || !Array.isArray(data.students)) {
      throw { status: -1, message: 'The student list response was unavailable.' };
    }
    const students = data.students;
    if (students.some(student => !student || student._id == null)) {
      throw { status: -1, message: 'The student list response was unavailable.' };
    }
    if (!students.length) {
      sel.replaceChildren(new Option('No students found in this class', ''));
      sel.disabled = true;
      return;
    }
    sel.replaceChildren(
      new Option('Select Student', ''),
      ...students.map(student => new Option(
        `${student.user?.name || 'Student'} (${student.admissionNumber || '—'})`,
        String(student._id)
      ))
    );
    sel.disabled = false;
  } catch(error) {
    const message = error?.status === 403
      ? 'Not authorized to view students'
      : error?.status === 401
        ? 'Session expired; sign in again'
        : error?.status === 0
          ? 'Could not load students; check your connection'
          : 'Student list unavailable';
    sel.replaceChildren(new Option(message, ''));
    sel.disabled = true;
  }
};

let _fcActiveStudent = null;
let _fcStudentFees = [];
let _fcActiveFee = null;
const _fcPendingPaymentAttempts = new Map();
const isKnownAmount = value => typeof value === 'number' && Number.isFinite(value);
const displayKnownAmount = value => isKnownAmount(value) ? formatCurrency(value) : 'Unavailable';
const feeAmountDue = fee => isKnownAmount(fee?.balanceDue) ? Math.max(0, fee.balanceDue) : null;

function renderFeeRecordOptions() {
  const select = document.getElementById('fcFeeRecord');
  select.replaceChildren(new Option('Select fee record', ''));
  _fcStudentFees.forEach(fee => {
    const balance = feeAmountDue(fee);
    const label = fee.feeStructure?.name || fee.academicYear || 'Fee record';
    const dueText = balance === null ? 'balance unavailable' : formatCurrency(balance);
    const option = new Option(`${label} · ${dueText}`, String(fee._id));
    option.disabled = balance === null || balance <= 0;
    select.add(option);
  });
  const firstPayable = _fcStudentFees.find(fee => {
    const balance = feeAmountDue(fee);
    return balance !== null && balance > 0;
  });
  if (firstPayable) select.value = firstPayable._id;
  window.selectFeeRecord();
}

window.selectFeeRecord = function() {
  const feeId = document.getElementById('fcFeeRecord').value;
  _fcActiveFee = _fcStudentFees.find(fee => String(fee._id) === String(feeId)) || null;
  const due = feeAmountDue(_fcActiveFee);
  document.getElementById('fcTotal').textContent = displayKnownAmount(_fcActiveFee?.totalAmount);
  document.getElementById('fcPaid').textContent = displayKnownAmount(_fcActiveFee?.paidAmount);
  document.getElementById('fcPending').textContent = due === null ? 'Unavailable' : formatCurrency(due);
  const amountInput = document.getElementById('fcAmount');
  const processButton = document.getElementById('btnProcessPayment');
  amountInput.max = due === null ? '' : String(due);
  amountInput.value = due !== null && due > 0 ? String(due) : '';
  processButton.disabled = !_fcActiveFee || due === null || due <= 0;
};

window.lookupStudentFee = async function() {
  const adm = document.getElementById('collSearchId').value.trim();
  const stId = document.getElementById('collSearchStudent').value;
  _fcActiveStudent = null;
  cspSetVisibility(document.getElementById('feeCollectArea'), false);
  
  const idToFetch = stId || (adm ? `adm:${adm}` : null);
  if(!idToFetch) return toast.warning('Missing Data', 'Provide Admission No. or Select Student.');
  
  const area = document.getElementById('feeCollectArea');
  try {
    let studentId = stId;
    if(!studentId && adm) {
      toast.warning('Admission number lookup unavailable', 'Select the student from the class list.');
      return;
    }
    
    const data = await apiFetch(`/fees/student/${studentId}`);
    if (!Array.isArray(data.data)) throw new Error('Fee records are unavailable in the expected format.');
    if (!data.data.length) throw new Error('No fee ledger records were found for this student.');
    _fcStudentFees = data.data;
    const firstRecord = _fcStudentFees.find(fee => fee.student) || _fcStudentFees[0];
    if (!firstRecord.student) throw new Error('Student summary is unavailable for these fee records.');
    _fcActiveStudent = firstRecord.student;
    
    document.getElementById('fcStudentName').textContent = _fcActiveStudent.name || 'Student';
    document.getElementById('fcStudentMeta').textContent = `Class ${_fcActiveStudent.class||'—'} · Adm ${_fcActiveStudent.admissionNumber||'—'}`;
    renderFeeRecordOptions();
    cspSetVisibility(area, true, 'block');
  } catch(e) {
    _fcStudentFees = [];
    _fcActiveFee = null;
    document.getElementById('fcFeeRecord').innerHTML = '<option value="">Fee records unavailable</option>';
    toast.error('Lookup Failed', e.message);
    cspSetVisibility(area, false);
  }
};

function paymentIdempotencyKey(feeId, signature) {
  const storageName = 'rbg-fee-payment-attempts';
  let saved = {};
  try {
    saved = JSON.parse(sessionStorage.getItem(storageName) || '{}');
  } catch (error) { /* in-memory retry protection remains available */ }
  const prior = saved[feeId] || _fcPendingPaymentAttempts.get(feeId);
  if (prior?.signature === signature && typeof prior.key === 'string') return prior.key;
  if (prior) throw new Error('A payment attempt for this fee is unresolved. Retry it with the same values before starting another payment.');
  const key = crypto.randomUUID ? crypto.randomUUID() : Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('');
  const record = { signature, key };
  _fcPendingPaymentAttempts.set(feeId, record);
  saved[feeId] = record;
  try { sessionStorage.setItem(storageName, JSON.stringify(saved)); } catch (error) { /* use the in-memory key */ }
  return key;
}

function clearPaymentAttempt(feeId) {
  _fcPendingPaymentAttempts.delete(feeId);
  try {
    const storageName = 'rbg-fee-payment-attempts';
    const saved = JSON.parse(sessionStorage.getItem(storageName) || '{}');
    delete saved[feeId];
    sessionStorage.setItem(storageName, JSON.stringify(saved));
  } catch (error) { /* storage can be unavailable */ }
}

window.processPayment = async function() {
  if(!_fcActiveStudent || !_fcActiveFee) return;
  const amount = parseFloat(document.getElementById('fcAmount').value);
  const method = document.getElementById('fcMethod').value;
  const remarks = document.getElementById('fcRemarks').value;
  const btn = document.getElementById('btnProcessPayment');
  const due = feeAmountDue(_fcActiveFee);
  
  if(!Number.isFinite(amount) || amount <= 0 || !Number.isFinite(due) || amount > due) return toast.warning('Invalid Amount', 'Enter a positive amount no greater than the selected fee balance.');
  const signature = JSON.stringify([_fcActiveFee._id, amount, method, remarks]);
  let idempotencyKey;
  try { idempotencyKey = paymentIdempotencyKey(String(_fcActiveFee._id), signature); }
  catch (error) { return toast.warning('Payment attempt pending', error.message); }
  
  setButtonLoading(btn, true);
  try {
    const response = await apiFetch('/fees/payment', { method: 'POST', body: JSON.stringify({ studentFee: _fcActiveFee._id, amount, method, remarks, idempotencyKey }) });
    if (!response?.success || !response.data?.receiptNumber) throw new Error('The payment API did not confirm a recorded payment.');
    clearPaymentAttempt(String(_fcActiveFee._id));
    toast.success('Payment Successful', `Recorded ${formatCurrency(amount)} via ${method}.`);
    lookupStudentFee(); // refresh
  } catch(e) {
    if (e.status >= 400 && e.status < 500) clearPaymentAttempt(String(_fcActiveFee._id));
    toast.error('Payment Failed', e.message);
  }
  finally { setButtonLoading(btn, false); }
};

/* ── Defaulters ── */
function loadDefaultersOpts() {
  const sel = document.getElementById('defaulterClassFilter');
  if(sel.options.length <= 1) sel.innerHTML += classLevelOptions();
  loadDefaulters();
}
window.loadDefaulters = async function() {
  const cls = document.getElementById('defaulterClassFilter').value;
  const tbody = document.getElementById('defaultersTableBody');
  tbody.innerHTML = '<tr><td colspan="5"><div class="spinner"></div></td></tr>';
  try {
    const response = await apiFetch('/fees/pending');
    let entries = Array.isArray(response.data) ? response.data : [];
    if (cls) entries = entries.filter(entry => String(entry.student?.class) === String(cls));
    if (!entries.length) { tbody.innerHTML = '<tr><td colspan="5"><div class="empty-state">No pending fees found.</div></td></tr>'; return; }
    tbody.innerHTML = entries.map(entry => {
      const student = entry.student || {};
      const pending = isKnownAmount(entry.balanceDue) ? Math.max(0, entry.balanceDue) : null;
      return `<tr><td>${student.admissionNumber || 'Unavailable'}</td><td class="csp-style-6e8bcfac8d">${student.user?.name || 'Unavailable'}</td><td>${student.class || 'Unavailable'}</td><td class="csp-style-03fae85682">${pending === null ? 'Unavailable' : formatCurrency(pending)}</td><td><button class="btn btn-secondary btn-sm" type="button" disabled title="Reminder delivery is unavailable"><i class="fas fa-bell"></i> Remind</button></td></tr>`;
    }).join('');
  } catch (error) {
    tbody.innerHTML = '<tr><td colspan="5" class="error-state">Pending fee data could not be loaded.</td></tr>';
  }
};
/* ── Reports ── */
function initReports() {
  document.getElementById('repFrom').valueAsDate = new Date();
  document.getElementById('repTo').valueAsDate = new Date();
}
window.generateReport = async function() {
  const out = document.getElementById('reportOutput');
  out.innerHTML = '<div class="empty-state"><i class="fas fa-file-excel"></i><h4>Report export unavailable</h4><p>No report download endpoint is connected to this action.</p></div>';
};
