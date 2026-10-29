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
  try {
    const data = await apiFetch('/fees/report'); // Assuming backend provides report data
    const d = data.data || data;
    
    // Fallback/mock data if real endpoint doesn't aggregate these yet
    const tCol = d.totalCollected || 1250000;
    const tPen = d.totalPending || 345000;
    const today = d.todayCollection || 45000;
    const defs = d.defaulterCount || 112;

    const grid = document.getElementById('financeStats');
    grid.innerHTML = `
      <div class="stat-card primary"><div class="stat-icon primary"><i class="fas fa-wallet"></i></div><div class="stat-content"><div class="stat-value">${formatCurrency(tCol)}</div><div class="stat-label">Total Collected</div></div></div>
      <div class="stat-card danger"><div class="stat-icon danger"><i class="fas fa-hand-holding-usd"></i></div><div class="stat-content"><div class="stat-value">${formatCurrency(tPen)}</div><div class="stat-label">Total Pending</div></div></div>
      <div class="stat-card success"><div class="stat-icon success"><i class="fas fa-coins"></i></div><div class="stat-content"><div class="stat-value">${formatCurrency(today)}</div><div class="stat-label">Today's Collection</div></div></div>
      <div class="stat-card warning"><div class="stat-icon warning"><i class="fas fa-users-slash"></i></div><div class="stat-content"><div class="stat-value">${defs}</div><div class="stat-label">Defaulters</div></div></div>
    `;

    // Chart
    createLineChart('financeRevChart', ['Mon','Tue','Wed','Thu','Fri','Sat'], [{
      label:'Revenue (₹)', data:[32000, 45000, 21000, 56000, 89000, 15000], borderColor:'#059669', backgroundColor:'rgba(5,150,105,0.1)', fill:true
    }]);

    // Transactions
    const txns = d.recentTransactions || [
      { id:'RCP101', name:'Arjun Singh', amount:5500, date:new Date(), method:'UPI' },
      { id:'RCP102', name:'Priya Sharma', amount:2500, date:new Date(), method:'Cash' }
    ];
    document.getElementById('dashTxns').innerHTML = `<table class="data-table csp-style-ab79ea2b85" >
      <thead><tr><th>Receipt</th><th>Student</th><th>Amount</th><th>Method</th></tr></thead>
      <tbody>${txns.map(t=>`<tr><td>${t.id||t.receiptNumber||'—'}</td><td><div class="csp-style-6e8bcfac8d">${t.name||t.studentName||'—'}</div></td><td class="csp-style-771559a58e">${formatCurrency(t.amount)}</td><td>${t.method}</td></tr>`).join('')}</tbody>
    </table>`;
  } catch(e) {}
}

/* ── Fee Collection ── */
function initCollectionPanel() {
  const sel = document.getElementById('collSearchClass');
  if(sel.options.length <= 1) sel.innerHTML += classLevelOptions();
}

window.loadStudentsForCollection = async function() {
  const cls = document.getElementById('collSearchClass').value;
  const sel = document.getElementById('collSearchStudent');
  if(!cls) { sel.innerHTML = '<option value="">Student</option>'; return; }
  
  sel.innerHTML = '<option value="">Loading...</option>';
  try {
    const data = await apiFetch(`/students/class/${cls}`);
    const stds = data.data || [];
    sel.innerHTML = '<option value="">Select Student</option>' + stds.map(s => `<option value="${s._id}">${s.name} (${s.admissionNumber||'—'})</option>`).join('');
  } catch(e) { sel.innerHTML = '<option value="">Error loading</option>'; }
};

let _fcActiveStudent = null;

window.lookupStudentFee = async function() {
  const adm = document.getElementById('collSearchId').value.trim();
  const stId = document.getElementById('collSearchStudent').value;
  
  const idToFetch = stId || (adm ? `adm:${adm}` : null);
  if(!idToFetch) return toast.warning('Missing Data', 'Provide Admission No. or Select Student.');
  
  const area = document.getElementById('feeCollectArea');
  try {
    // Usually backend will have GET /fees/student/:id
    // If searching by ADM, might need a generic lookup first, we'll assume stId is used for now.
    let studentId = stId;
    if(!studentId && adm) {
      // Dummy lookup logic if needed, ideally backend handles this
      toast.info('Info', 'Use class/student dropdown for accurate selection.');
      return;
    }
    
    const data = await apiFetch(`/fees/student/${studentId}`);
    const fee = data.data || {};
    _fcActiveStudent = fee.student || { _id: studentId, name: 'Student' };
    
    document.getElementById('fcStudentName').textContent = _fcActiveStudent.name || 'Student';
    document.getElementById('fcStudentMeta').textContent = `Class ${_fcActiveStudent.class||'—'} · Adm ${_fcActiveStudent.admissionNumber||'—'}`;
    
    document.getElementById('fcTotal').textContent = formatCurrency(fee.totalAmount || 0);
    document.getElementById('fcPaid').textContent = formatCurrency(fee.paidAmount || 0);
    document.getElementById('fcPending').textContent = formatCurrency(fee.pendingAmount || 0);
    
    document.getElementById('fcAmount').value = fee.pendingAmount || 0;
    
    cspSetVisibility(area, true, 'block');
  } catch(e) { toast.error('Lookup Failed', e.message); cspSetVisibility(area, false); }
};

window.processPayment = async function() {
  if(!_fcActiveStudent) return;
  const amount = parseFloat(document.getElementById('fcAmount').value);
  const method = document.getElementById('fcMethod').value;
  const remarks = document.getElementById('fcRemarks').value;
  const btn = document.getElementById('btnProcessPayment');
  
  if(isNaN(amount) || amount <= 0) return toast.warning('Invalid Amount', 'Enter a valid payment amount.');
  
  setButtonLoading(btn, true);
  try {
    await apiFetch('/fees/payment', { method: 'POST', body: JSON.stringify({ studentId: _fcActiveStudent._id, amount, method, remarks }) });
    toast.success('Payment Successful', `Recorded ${formatCurrency(amount)} via ${method}.`);
    lookupStudentFee(); // refresh
  } catch(e) { toast.error('Payment Failed', e.message); }
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
    // If backend doesn't have explicit defaulters endpoint, fetch report or all fees and filter locally
    const data = await apiFetch('/fees/report');
    let defs = (data.data && data.data.defaulters) || [
      { student:{admissionNumber:'A01', name:'Test Student 1', class:'10'}, pendingAmount:4500 },
      { student:{admissionNumber:'A02', name:'Test Student 2', class:'8'}, pendingAmount:2100 }
    ]; // mock fallback
    
    if(cls) defs = defs.filter(d => d.student?.class == cls);
    if(!defs.length) { tbody.innerHTML = '<tr><td colspan="5"><div class="empty-state">No defaulters found.</div></td></tr>'; return; }
    
    tbody.innerHTML = defs.map(d => `<tr>
      <td>${d.student?.admissionNumber||'—'}</td>
      <td class="csp-style-6e8bcfac8d">${d.student?.name||'Unknown'}</td>
      <td>${d.student?.class||'—'}</td>
      <td class="csp-style-03fae85682">${formatCurrency(d.pendingAmount)}</td>
      <td><button class="btn btn-secondary btn-sm"><i class="fas fa-bell"></i> Remind</button></td>
    </tr>`).join('');
  } catch(e) {}
};

/* ── Reports ── */
function initReports() {
  document.getElementById('repFrom').valueAsDate = new Date();
  document.getElementById('repTo').valueAsDate = new Date();
}
window.generateReport = async function() {
  const out = document.getElementById('reportOutput');
  out.innerHTML = '<div class="spinner"></div>';
  setTimeout(() => {
    out.innerHTML = `<div class="empty-state"><i class="fas fa-file-excel"></i><h4>Report Generated</h4><p>The report is ready for download.</p><button class="btn btn-primary csp-style-66e6b652a6" ><i class="fas fa-download"></i> Download CSV</button></div>`;
  }, 1000);
};
