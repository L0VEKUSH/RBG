'use strict';
const RECEPTION_NAV = [
  { label: 'Front Desk', items: [
    { icon: 'home', text: 'Dashboard', panel: 'dashboard' },
    { icon: 'id-badge', text: 'Visitor Log', panel: 'visitors' }
  ]},
  { label: 'Account', items: [{ icon: 'user', text: 'My Profile', panel: 'profile' }] }
];
initPortal({ role: 'receptionist', expectedRoles: ['receptionist', 'super_admin'], navConfig: RECEPTION_NAV });
