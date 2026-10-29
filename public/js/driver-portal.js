'use strict';
const DRIVER_NAV = [
  { label: 'Transport', items: [
    { icon: 'map-marked-alt', text: 'My Route', panel: 'dashboard' }
  ]},
  { label: 'Account', items: [{ icon: 'user', text: 'My Profile', panel: 'profile' }] }
];
initPortal({ role: 'driver', expectedRoles: ['driver', 'transport_manager'], navConfig: DRIVER_NAV });
