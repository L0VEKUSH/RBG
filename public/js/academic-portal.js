'use strict';
const ACADEMIC_NAV = [
  { label: 'Planning', items: [
    { icon: 'home', text: 'Dashboard', panel: 'dashboard' },
    { icon: 'book', text: 'Curriculum', panel: 'curriculum' }
  ]},
  { label: 'Account', items: [{ icon: 'user', text: 'My Profile', panel: 'profile' }] }
];
initPortal({ role: 'academic_head', expectedRoles: ['academic_head', 'super_admin'], navConfig: ACADEMIC_NAV });
