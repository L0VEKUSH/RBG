// Role Specific Logic for principal.html
const currentUser = JSON.parse(localStorage.getItem('user'));

if (!currentUser) {
    window.location.href = 'login.html';
}

function showPanel(sectionId) {
    document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
    const activeLink = document.querySelector(`.nav-link[data-panel="${sectionId}"]`);
    if (activeLink) activeLink.classList.add('active');

    document.querySelectorAll('.page-section').forEach(s => s.classList.remove('active'));
    const sec = document.getElementById(`panel-${sectionId}`);
    if (sec) sec.classList.add('active');
}

// Default layout
document.getElementById('userName').textContent = currentUser.name;
document.getElementById('userRole').textContent = currentUser.normalizedRole || currentUser.role;

async function fetchDashboardData() {
    try {
        const res = await fetch('/api/v1/dashboard/principal', {
            credentials: 'include'
        });
        const data = await res.json();
        if (data.success) {
            const stats = data.data.stats;
            // Map the stats to UI elements if they exist
            if (document.getElementById('totalStudents')) document.getElementById('totalStudents').textContent = stats.totalStudents || 0;
            if (document.getElementById('totalTeachers')) document.getElementById('totalTeachers').textContent = stats.totalTeachers || 0;
            if (document.getElementById('totalClasses')) document.getElementById('totalClasses').textContent = stats.totalClasses || 0;
            
            // Build simple demo chart or list if required
            const listContainer = document.getElementById('recentActivityList');
            if (listContainer) {
                listContainer.innerHTML = '<li>Loaded school statistics from API successfully!</li>';
            }
        }
    } catch (err) {
        console.error('Failed to fetch dashboard data', err);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    showPanel('dashboard');
    fetchDashboardData();
});
