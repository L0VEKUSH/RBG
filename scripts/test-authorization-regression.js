const assert = require('assert');
const { requirePermission, requireAllPermissions, requireRole } = require('../middleware/authorization.middleware');

function mockReq(user) {
  return { user, params: {}, body: {}, query: {} };
}
function mockRes() {
  return {};
}

console.log('Running Authorization Regression Tests...');

// 1. Unauthenticated request rejected
let errReceived = null;
let nextCalled = false;
requirePermission('students.view')(mockReq(null), mockRes(), (err) => {
  if (err) errReceived = err;
  else nextCalled = true;
});
assert(errReceived && errReceived.statusCode === 401, 'Unauthenticated must get 401');

// 2. school_admin role denied permission NOT in its matrix (e.g., marks.enter, fees.collect)
errReceived = null;
nextCalled = false;
requirePermission('marks.enter')(mockReq({ role: 'school_admin' }), mockRes(), (err) => {
  if (err) errReceived = err;
  else nextCalled = true;
});
assert(errReceived && errReceived.statusCode === 403, 'school_admin must be denied marks.enter');

// 3. school_admin granted permission IN its matrix (e.g., students.view)
errReceived = null;
nextCalled = false;
requirePermission('students.view')(mockReq({ role: 'school_admin' }), mockRes(), (err) => {
  if (err) errReceived = err;
  else nextCalled = true;
});
assert(!errReceived && nextCalled, 'school_admin must be allowed students.view');

// 4. super_admin has wildcard access
errReceived = null;
nextCalled = false;
requirePermission('marks.enter')(mockReq({ role: 'super_admin' }), mockRes(), (err) => {
  if (err) errReceived = err;
  else nextCalled = true;
});
assert(!errReceived && nextCalled, 'super_admin must be allowed');

// 5. requireAllPermissions works strictly
errReceived = null;
nextCalled = false;
requireAllPermissions('students.view', 'marks.enter')(mockReq({ role: 'school_admin' }), mockRes(), (err) => {
  if (err) errReceived = err;
  else nextCalled = true;
});
assert(errReceived && errReceived.statusCode === 403, 'requireAllPermissions must fail if any perm is missing');

// 6. User negative override takes precedence over role
errReceived = null;
nextCalled = false;
requirePermission('students.view')(mockReq({ role: 'school_admin', permissions: ['-students.view'] }), mockRes(), (err) => {
  if (err) errReceived = err;
  else nextCalled = true;
});
assert(errReceived && errReceived.statusCode === 403, 'User negative override must deny');

// 7. requireRole legacy alias expansion vs strict checking
errReceived = null;
nextCalled = false;
requireRole('faculty')(mockReq({ role: 'teacher' }), mockRes(), (err) => {
  if (err) errReceived = err;
  else nextCalled = true;
});
assert(!errReceived && nextCalled, 'faculty role requirement should allow teacher');

errReceived = null;
nextCalled = false;
requireRole('teacher')(mockReq({ role: 'student' }), mockRes(), (err) => {
  if (err) errReceived = err;
  else nextCalled = true;
});
assert(errReceived && errReceived.statusCode === 403, 'student must be rejected for teacher-only route');

console.log('✅ All 7 Authorization Regression Tests Passed!');
