const ADMISSIONS_NAV = [
    { id: 'dashboard', icon: 'fa-chart-pie', label: 'Dashboard' },
    { id: 'applications', icon: 'fa-folder-open', label: 'Applications' },
    { id: 'profile', icon: 'fa-user-circle', label: 'My Profile' }
];

let dashboardData = null;

const ADMISSION_COUNT_FIELDS = [
    ['statSubmitted', 'Submitted'],
    ['statReview', 'Under_Review'],
    ['statDocVerify', 'Document_Verification'],
    ['statApproved', 'Approved'],
];

function setAdmissionCountState(value) {
    ADMISSION_COUNT_FIELDS.forEach(([elementId]) => {
        const element = document.getElementById(elementId);
        if (element) element.textContent = value;
    });
}

function setRecentApplicationsState(message) {
    const tbody = document.getElementById('recentAppsBody');
    if (!tbody) return;
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = 4;
    cell.className = 'text-center text-muted';
    cell.textContent = message;
    row.appendChild(cell);
    tbody.replaceChildren(row);
}

// Initialize portal
document.addEventListener('DOMContentLoaded', () => {
    initPortal({
        role: 'admission_officer',
        expectedRoles: ['admission_officer', 'super_admin', 'school_admin'],
        navConfig: ADMISSIONS_NAV,
        onDashboardLoad: loadDashboard
    });
});

async function loadDashboard(user) {
    setAdmissionCountState('Loading…');
    setRecentApplicationsState('Loading applications…');
    document.getElementById('welcomeName').textContent = `Welcome, ${user.name}`;
    document.getElementById('topbarAvatar').textContent = user.name.charAt(0).toUpperCase();
    document.getElementById('profileBigAvatar').textContent = user.name.charAt(0).toUpperCase();
    document.getElementById('profileName').textContent = user.name;
    document.getElementById('profileEmail').textContent = user.email;
    document.getElementById('profilePhone').textContent = user.phone || 'Not provided';
    
    try {
        const res = await apiFetch('/dashboard/admissions');
        if (!res?.success || !res.data || typeof res.data !== 'object' || Array.isArray(res.data)) {
            throw new Error('Admission dashboard data is unavailable.');
        }
        dashboardData = res.data;
        renderDashboard();
    } catch (err) {
        dashboardData = null;
        setAdmissionCountState('Unavailable');
        setRecentApplicationsState('Applications could not be loaded.');
        toast.error('Failed to load dashboard', err.message);
    }
}

function renderDashboard() {
    if (!dashboardData) {
        setAdmissionCountState('Unavailable');
        setRecentApplicationsState('Application data is unavailable.');
        return;
    }
    
    // Update stats
    const counts = dashboardData.counts;
    ADMISSION_COUNT_FIELDS.forEach(([elementId, field]) => {
        const element = document.getElementById(elementId);
        if (!element) return;
        const value = counts && typeof counts === 'object' && !Array.isArray(counts) ? counts[field] : undefined;
        element.textContent = Number.isSafeInteger(value) && value >= 0 ? String(value) : 'Unavailable';
    });
    
    // Update recent applications
    const tbody = document.getElementById('recentAppsBody');
    tbody.innerHTML = '';
    
    if (!Array.isArray(dashboardData.recentApplications)) {
        setRecentApplicationsState('Application data is unavailable.');
    } else if (dashboardData.recentApplications.length === 0) {
        setRecentApplicationsState('No recent applications found.');
    } else {
        dashboardData.recentApplications.forEach(app => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><strong>${app.applicationNumber}</strong></td>
                <td>${app.studentName}</td>
                <td>${app.classApplyingFor}</td>
                <td><span class="badge ${getStatusBadge(app.status)}">${app.status.replace('_', ' ')}</span></td>
            `;
            tbody.appendChild(tr);
        });
    }
}

function getStatusBadge(status) {
    switch(status) {
        case 'Approved': case 'Admitted': return 'bg-success';
        case 'Rejected': return 'bg-danger';
        case 'Waitlisted': case 'Document_Verification': return 'bg-warning text-dark';
        case 'Under_Review': return 'bg-info text-dark';
        default: return 'bg-secondary';
    }
}

// Panel load hook for Applications tab
window.onPanel_applications = async function() {
    loadApplications();
};

async function loadApplications() {
    const tbody = document.getElementById('allAppsBody');
    tbody.innerHTML = '<tr><td colspan="6" class="text-center"><div class="spinner mx-auto"></div></td></tr>';
    
    // In a real implementation we would fetch with query params from filters.
    // For now we just fetch from the general endpoint if available.
    try {
        const res = await apiFetch('/admissions');
        if (!res?.success || !Array.isArray(res.data)) throw new Error('Application data is unavailable.');
        tbody.replaceChildren();
        if (res.data.length === 0) {
            const row = document.createElement('tr');
            row.innerHTML = '<td colspan="6" class="text-center text-muted py-4">No applications found matching criteria.</td>';
            tbody.appendChild(row);
            return;
        }

        res.data.forEach(app => {
            const tr = document.createElement('tr');
            const cellValues = [app.applicationNumber, app.studentName, app.classApplyingFor, formatDate(app.appliedDate)];
            cellValues.forEach((value, index) => {
                const td = document.createElement('td');
                if (index === 0) {
                    const strong = document.createElement('strong');
                    strong.textContent = value || 'Unavailable';
                    td.appendChild(strong);
                } else td.textContent = value || 'Unavailable';
                tr.appendChild(td);
            });
            const statusCell = document.createElement('td');
            const badge = document.createElement('span');
            badge.className = `badge ${getStatusBadge(app.status)}`;
            badge.textContent = String(app.status || 'Unknown').replaceAll('_', ' ');
            statusCell.appendChild(badge);
            tr.appendChild(statusCell);

            const actionCell = document.createElement('td');
            const dateInput = document.createElement('input');
            dateInput.type = 'date';
            dateInput.className = 'filter-input';
            dateInput.setAttribute('aria-label', `Enrollment effective date for ${app.studentName || 'applicant'}`);
            dateInput.value = schoolDateInputValue(app.enrollmentEffectiveFrom);
            const approved = app.status === 'Approved';
            const admittedOrClosed = ['Admitted', 'Admitting', 'Rejected'].includes(app.status);

            if (approved && app.enrollmentEffectiveFrom) {
                dateInput.disabled = true;
                actionCell.appendChild(document.createTextNode(`Enrollment: ${dateInput.value || 'Unavailable'} `));
                const enrollButton = document.createElement('button');
                enrollButton.type = 'button';
                enrollButton.className = 'btn btn-sm btn-primary';
                enrollButton.textContent = 'Create student';
                enrollButton.setAttribute('data-csp-action-click', 'admitApplication');
                enrollButton.setAttribute('data-csp-args-click', encodeURIComponent(JSON.stringify([app._id])));
                actionCell.appendChild(enrollButton);
            } else if (!admittedOrClosed) {
                actionCell.appendChild(dateInput);
                const approveButton = document.createElement('button');
                approveButton.type = 'button';
                approveButton.className = 'btn btn-sm btn-primary';
                approveButton.textContent = approved ? 'Save date' : 'Approve';
                approveButton.setAttribute('data-csp-action-click', 'approveAdmission');
                approveButton.setAttribute('data-csp-args-click', encodeURIComponent(JSON.stringify([app._id])));
                approveButton.setAttribute('data-csp-elements-click', '0');
                actionCell.appendChild(approveButton);
            } else {
                actionCell.textContent = 'No action available';
            }
            tr.appendChild(actionCell);
            tbody.appendChild(tr);
        });
    } catch (err) {
        tbody.innerHTML = `<tr><td colspan="6" class="text-center text-danger">Failed to load: ${err.message}</td></tr>`;
    }
}

function schoolDateInputValue(value) {
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(date);
    const fields = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return `${fields.year}-${fields.month}-${fields.day}`;
}

window.approveAdmission = async function(button, id) {
    const enrollmentEffectiveFrom = button.closest('tr')?.querySelector('input[type="date"]')?.value;
    if (!enrollmentEffectiveFrom) {
        toast.warning('Date required', 'Enter the school-local enrollment effective date before approval.');
        return;
    }
    button.disabled = true;
    try {
        const result = await apiFetch(`/admissions/${encodeURIComponent(id)}/status`, {
            method: 'PUT',
            body: JSON.stringify({ status: 'Approved', enrollmentEffectiveFrom }),
        });
        if (result?.success !== true || result.data?.status !== 'Approved') {
            throw new Error('Admission approval was not confirmed by the server.');
        }
        toast.success('Approved', 'Enrollment date saved and admission approved.');
        await loadApplications();
    } catch (error) {
        toast.error('Approval failed', error.message || 'Admission could not be approved.');
        button.disabled = false;
    }
};

window.admitApplication = async function(id) {
    try {
        const result = await apiFetch(`/admissions/${encodeURIComponent(id)}/admit`, { method: 'POST' });
        if (result?.success !== true || !result.data?._id) {
            throw new Error('Student creation was not confirmed by the server.');
        }
        toast.success('Student created', 'The account is awaiting its separate activation step.');
        await loadApplications();
    } catch (error) {
        toast.error('Student creation failed', error.message || 'The student could not be created.');
    }
}
