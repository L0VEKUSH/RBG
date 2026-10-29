const ADMISSIONS_NAV = [
    { id: 'dashboard', icon: 'fa-chart-pie', label: 'Dashboard' },
    { id: 'applications', icon: 'fa-folder-open', label: 'Applications' },
    { id: 'profile', icon: 'fa-user-circle', label: 'My Profile' }
];

let dashboardData = null;

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
    document.getElementById('welcomeName').textContent = `Welcome, ${user.name}`;
    document.getElementById('topbarAvatar').textContent = user.name.charAt(0).toUpperCase();
    document.getElementById('profileBigAvatar').textContent = user.name.charAt(0).toUpperCase();
    document.getElementById('profileName').textContent = user.name;
    document.getElementById('profileEmail').textContent = user.email;
    document.getElementById('profilePhone').textContent = user.phone || 'Not provided';
    
    try {
        const res = await apiFetch('/dashboard/admissions');
        if(res && res.success) {
            dashboardData = res.data;
            renderDashboard();
        }
    } catch (err) {
        toast.error('Failed to load dashboard', err.message);
    }
}

function renderDashboard() {
    if(!dashboardData) return;
    
    // Update stats
    const c = dashboardData.counts || {};
    document.getElementById('statSubmitted').textContent = c.Submitted || 0;
    document.getElementById('statReview').textContent = c.Under_Review || 0;
    document.getElementById('statDocVerify').textContent = c.Document_Verification || 0;
    document.getElementById('statApproved').textContent = c.Approved || 0;
    
    // Update recent applications
    const tbody = document.getElementById('recentAppsBody');
    tbody.innerHTML = '';
    
    if(!dashboardData.recentApplications || dashboardData.recentApplications.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" class="text-center text-muted">No recent applications found</td></tr>';
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
        if(res && res.success) {
            tbody.innerHTML = '';
            const apps = res.data;
            
            if(apps.length === 0) {
                tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted py-4">No applications found matching criteria.</td></tr>';
                return;
            }
            
            apps.forEach(app => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td><strong>${app.applicationNumber}</strong></td>
                    <td>${app.studentName}</td>
                    <td>${app.classApplyingFor}</td>
                    <td>${formatDate(app.appliedDate)}</td>
                    <td><span class="badge ${getStatusBadge(app.status)}">${app.status.replace('_', ' ')}</span></td>
                    <td>
                        <button class="btn btn-sm btn-outline" ${cspActionAttrs("viewApplication", ['${app._id}'], "click", [], [])}>Review</button>
                    </td>
                `;
                tbody.appendChild(tr);
            });
        }
    } catch (err) {
        tbody.innerHTML = `<tr><td colspan="6" class="text-center text-danger">Failed to load: ${err.message}</td></tr>`;
    }
}

function viewApplication(id) {
    toast.info('Feature Integration', `Application review view for ${id} requires backend detail API.`);
}
