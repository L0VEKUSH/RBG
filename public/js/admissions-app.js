
// Role Specific Logic for admissions.html
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

showPanel('dashboard');
  
