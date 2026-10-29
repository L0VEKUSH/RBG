'use strict';
const VP_NAV = [
  { label: 'Management', items: [
    { icon: 'home', text: 'Dashboard', panel: 'dashboard' }
  ]},
  { label: 'Account', items: [{ icon: 'user', text: 'My Profile', panel: 'profile' }] }
];
initPortal({ role: 'vice_principal', expectedRoles: ['vice_principal', 'super_admin'], navConfig: VP_NAV });
