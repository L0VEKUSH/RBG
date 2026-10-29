const secondaryPortalConfigs = {
  academic_coordinator: {
    expectedRoles: ['academic_coordinator', 'super_admin'],
    endpoint: '/dashboard/academic',
    stats: [['statClasses', 'classCount'], ['statOngoingExams', 'ongoingExams'], ['statUpcomingExams', 'upcomingExams']]
  },
  driver: {
    expectedRoles: ['driver', 'transport_admin'],
    endpoint: '/dashboard/driver',
    stats: [['statRoute', 'assignedRoute', 'None'], ['statBus', 'busNumber', 'None'], ['statStudents', 'studentsAssigned']]
  },
  exam_coordinator: {
    expectedRoles: ['exam_coordinator', 'super_admin'],
    endpoint: '/dashboard/exams',
    stats: [['statUpcoming', 'upcomingExams'], ['statOngoing', 'ongoingExams'], ['statCompleted', 'completedExams']]
  },
  hr: {
    expectedRoles: ['hr', 'super_admin'],
    endpoint: '/dashboard/hr',
    stats: [['statStaff', 'facultyCount'], ['statLeave', 'onLeaveToday']]
  },
  receptionist: {
    expectedRoles: ['receptionist', 'super_admin'],
    endpoint: '/dashboard/reception',
    stats: [['statVisitors', 'todayVisitors'], ['statEnquiries', 'pendingAdmissions']]
  },
  staff: {
    expectedRoles: ['staff', 'nurse', 'super_admin'],
    stats: []
  },
  vice_principal: {
    expectedRoles: ['vice_principal', 'principal', 'super_admin'],
    endpoint: '/dashboard/vice_principal',
    stats: [['vpStudents', 'studentCount'], ['vpFaculty', 'facultyCount'], ['vpPresent', 'presentStudents']]
  }
};

document.addEventListener('DOMContentLoaded', () => {
  const role = document.body.dataset.role;
  const config = secondaryPortalConfigs[role];
  if (!config) return;

  const navConfig = [
    { id: 'dashboard', icon: role === 'driver' ? 'fa-bus' : 'fa-chart-pie', label: role === 'driver' ? 'My Route' : 'Dashboard' },
    { id: 'profile', icon: 'fa-user-circle', label: 'My Profile' }
  ];

  initPortal({
    role,
    expectedRoles: config.expectedRoles,
    navConfig,
    onDashboardLoad: async user => {
      const firstName = (user.name || 'User').charAt(0);
      document.getElementById('welcomeName').textContent = `Welcome, ${user.name || 'User'}`;
      document.getElementById('topbarAvatar').textContent = firstName;
      document.getElementById('profileBigAvatar').textContent = firstName;
      document.getElementById('profileName').textContent = user.name || 'User';
      if (!config.endpoint) return;
      const response = await apiFetch(config.endpoint);
      if (!response?.success) return;
      for (const [elementId, field, fallback = 0] of config.stats) {
        const element = document.getElementById(elementId);
        if (element) element.textContent = response.data[field] ?? fallback;
      }
    }
  });
});
