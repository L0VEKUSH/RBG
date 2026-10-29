'use strict';
const EXAM_NAV = [
  { label: 'Examinations', items: [
    { icon: 'home', text: 'Dashboard', panel: 'dashboard' },
    { icon: 'calendar-alt', text: 'Exam Schedule', panel: 'schedule' },
    { icon: 'chart-bar', text: 'Results', panel: 'results' },
  ]},
  { label: 'Account', items: [{ icon: 'user', text: 'My Profile', panel: 'profile' }] }
];
initPortal({ role: 'exam_officer', expectedRoles: ['exam_officer', 'super_admin'], navConfig: EXAM_NAV });
