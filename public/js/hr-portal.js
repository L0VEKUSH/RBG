'use strict';
const HR_NAV = [
  { label: 'Human Resources', items: [
    { icon: 'home', text: 'Dashboard', panel: 'dashboard' },
    { icon: 'money-check-alt', text: 'Payroll', panel: 'payroll' }
  ]},
  { label: 'Account', items: [{ icon: 'user', text: 'My Profile', panel: 'profile' }] }
];
initPortal({ role: 'hr_manager', expectedRoles: ['hr_manager', 'super_admin'], navConfig: HR_NAV });
