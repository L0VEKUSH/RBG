'use strict';
const STAFF_NAV = [
  { label: 'Workplace', items: [
    { icon: 'home', text: 'Dashboard', panel: 'dashboard' }
  ]},
  { label: 'Account', items: [{ icon: 'user', text: 'My Profile', panel: 'profile' }] }
];
initPortal({ role: 'staff', expectedRoles: [], navConfig: STAFF_NAV });
