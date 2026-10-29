
// Role Specific Logic for teacher.html
const currentUser = JSON.parse(localStorage.getItem('user'));
const token = localStorage.getItem('token');

if (!token || !currentUser) {
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

showPanel('dashboard');
  
async function fetchDashboardData() {
    try {
        const res = await fetch('/api/v1/dashboard/teacher', {
            headers: { 'Authorization': 'Bearer ' + token }
        });
        const data = await res.json();
        if (data.success) {
                        const container = document.getElementById('dashboardStatsContainer') || document.querySelector('.dashboard-grid');
            if (container && data.data.stats) {
                let html = '';
                for (let key in data.data.stats) {
                    html += `<div class="stat-card">
                        <div class="stat-details">
                            <h3>${key.replace(/([A-Z])/g, ' $1').toUpperCase()}</h3>
                            <p>${data.data.stats[key]}</p>
                        </div>
                    </div>`;
                }
                container.innerHTML = html;
            }
        }
    } catch (err) {
        console.error('Failed to fetch dashboard data', err);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    fetchDashboardData();
});

