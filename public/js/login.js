const API = '/api/v1';

const ROLE_DESTINATIONS = Object.freeze({
  super_admin: '/portal/admin.html',
  school_admin: '/portal/admin.html',
  principal: '/portal/principal.html',
  vice_principal: '/portal/vice_principal.html',
  academic_coordinator: '/portal/academic.html',
  class_teacher: '/portal/teacher.html',
  teacher: '/portal/teacher.html',
  student: '/portal/student.html',
  parent: '/portal/parent.html',
  accountant: '/portal/finance.html',
  librarian: '/portal/library.html',
  admission_officer: '/portal/admissions.html',
  exam_coordinator: '/portal/exam.html',
  transport_admin: '/portal/driver.html',
  driver: '/portal/driver.html',
  receptionist: '/portal/reception.html',
  hr: '/portal/hr.html',
  staff: '/portal/staff.html',
  nurse: '/portal/staff.html'
});

// These lists mirror the role allowlists on the existing portal pages. Elevated
// administrator access to the Principal and Admissions portals is preserved.
const PORTALS = Object.freeze({
  administrator: Object.freeze({
    label: 'Administrator',
    title: 'Administrator sign in',
    description: 'Sign in to the school administration portal.',
    allowedRoles: Object.freeze(['super_admin', 'school_admin']),
    destination: '/portal/admin.html'
  }),
  principal: Object.freeze({
    label: 'Principal',
    title: 'Principal sign in',
    description: 'Sign in to the Principal portal.',
    allowedRoles: Object.freeze(['principal', 'super_admin', 'school_admin']),
    destination: '/portal/principal.html'
  }),
  admission_officer: Object.freeze({
    label: 'Admission Officer',
    title: 'Admission Officer sign in',
    description: 'Sign in to the Admissions portal.',
    allowedRoles: Object.freeze(['admission_officer', 'super_admin', 'school_admin']),
    destination: '/portal/admissions.html'
  }),
  teacher: Object.freeze({
    label: 'Teacher / Class Teacher',
    title: 'Teacher sign in',
    description: 'Sign in to the teaching portal.',
    allowedRoles: Object.freeze(['teacher', 'class_teacher']),
    destination: '/portal/teacher.html'
  }),
  student: Object.freeze({
    label: 'Student',
    title: 'Student sign in',
    description: 'Sign in to the Student portal.',
    allowedRoles: Object.freeze(['student']),
    destination: '/portal/student.html'
  }),
  parent: Object.freeze({
    label: 'Parent',
    title: 'Parent sign in',
    description: 'Sign in to the Parent portal.',
    allowedRoles: Object.freeze(['parent']),
    destination: '/portal/parent.html'
  }),
  other_staff: Object.freeze({
    label: 'Other Staff',
    title: 'Other Staff sign in',
    description: 'Sign in with your assigned staff account. You will be sent to its existing portal.',
    allowedRoles: Object.freeze([
      'vice_principal', 'academic_coordinator', 'accountant', 'librarian',
      'exam_coordinator', 'transport_admin', 'driver', 'receptionist',
      'hr', 'staff', 'nurse'
    ]),
    destination: null
  })
});

const PORTAL_MISMATCH_MESSAGE =
  'These credentials are not authorized for the selected portal. Please choose the correct portal.';
const LOGIN_FAILURE_MESSAGE = 'Unable to sign in. Check the selected portal and your details, then try again.';

function normalizeRole(role) {
  return typeof role === 'string' ? role.trim().toLowerCase() : '';
}

function getPortalDestination(role) {
  const normalizedRole = normalizeRole(role);
  if (!Object.prototype.hasOwnProperty.call(ROLE_DESTINATIONS, normalizedRole)) return null;
  return ROLE_DESTINATIONS[normalizedRole];
}

function getSelectedPortalDestination(portalId, role) {
  if (!Object.prototype.hasOwnProperty.call(PORTALS, portalId)) return null;

  const portal = PORTALS[portalId];
  const normalizedRole = normalizeRole(role);
  if (!portal.allowedRoles.includes(normalizedRole)) return null;

  // The Other Staff choice groups existing portals, but does not create a new
  // destination or allow a role that has no existing route.
  return portal.destination || getPortalDestination(normalizedRole);
}

async function completePortalSignIn({ portalId, user, logout, onAuthorized } = {}) {
  const destination = getSelectedPortalDestination(portalId, user?.role);
  if (!destination) {
    let logoutSucceeded = false;
    if (typeof logout === 'function') {
      try {
        logoutSucceeded = (await logout()) === true;
      } catch (_) {
        // A mismatch remains a denial even if the best-effort cookie logout fails.
      }
    }
    return { authorized: false, destination: null, logoutSucceeded };
  }

  if (typeof onAuthorized === 'function') onAuthorized(destination, user);
  return { authorized: true, destination, logoutSucceeded: null };
}

function redirectUser(role, portalId) {
  const destination = portalId
    ? getSelectedPortalDestination(portalId, role)
    : getPortalDestination(role);
  if (!destination) {
    throw new Error('This account role is not supported for portal sign-in. Contact your school administrator.');
  }
  window.location.href = destination;
  return destination;
}

function bindLoginPage() {
  const portalSelection = document.getElementById('portalSelection');
  const loginPanel = document.getElementById('loginPanel');
  const loginForm = document.getElementById('loginForm');
  if (!portalSelection || !loginPanel || !loginForm) return;

  let selectedPortalId = null;
  const loginError = document.getElementById('loginError');
  const loginErrorMessage = document.getElementById('loginErrorMessage');
  const loginButton = document.getElementById('btnLogin');
  const loginButtonLabel = document.getElementById('loginButtonLabel');
  const loginButtonIcon = document.getElementById('loginButtonIcon');
  const passwordInput = document.getElementById('password');
  const passwordToggle = document.getElementById('togglePassword');
  const emailInput = document.getElementById('email');
  const forgotPasswordButton = document.getElementById('forgotPasswordButton');
  const forgotPasswordStatus = document.getElementById('forgotPasswordStatus');

  const showLoginError = (message) => {
    loginErrorMessage.textContent = message;
    loginError.hidden = false;
  };

  const clearLoginError = () => {
    loginError.hidden = true;
    loginErrorMessage.textContent = '';
  };

  const resetPasswordVisibility = () => {
    passwordInput.type = 'password';
    passwordToggle.setAttribute('aria-pressed', 'false');
    passwordToggle.setAttribute('aria-label', 'Show password');
    passwordToggle.querySelector('i').className = 'fas fa-eye';
  };

  const selectPortal = (portalId) => {
    if (!Object.prototype.hasOwnProperty.call(PORTALS, portalId)) return;
    selectedPortalId = portalId;
    const portal = PORTALS[portalId];
    document.getElementById('selectedPortalLabel').textContent = portal.label;
    document.getElementById('loginTitle').textContent = portal.title;
    document.getElementById('loginDescription').textContent = portal.description;
    passwordInput.value = '';
    resetPasswordVisibility();
    clearLoginError();
    forgotPasswordStatus.hidden = true;
    forgotPasswordStatus.textContent = '';
    portalSelection.hidden = true;
    loginPanel.hidden = false;
    emailInput.focus();
  };

  portalSelection.addEventListener('click', (event) => {
    const button = event.target.closest('[data-portal-id]');
    if (button) selectPortal(button.dataset.portalId);
  });

  document.getElementById('backToPortals').addEventListener('click', () => {
    selectedPortalId = null;
    passwordInput.value = '';
    resetPasswordVisibility();
    clearLoginError();
    forgotPasswordStatus.hidden = true;
    forgotPasswordStatus.textContent = '';
    loginPanel.hidden = true;
    portalSelection.hidden = false;
    const firstPortalButton = portalSelection.querySelector('[data-portal-id]');
    if (firstPortalButton) firstPortalButton.focus();
  });

  passwordToggle.addEventListener('click', (event) => {
    const button = event.currentTarget;
    const icon = button.querySelector('i');
    const showPassword = passwordInput.type === 'password';
    passwordInput.type = showPassword ? 'text' : 'password';
    button.setAttribute('aria-pressed', String(showPassword));
    button.setAttribute('aria-label', showPassword ? 'Hide password' : 'Show password');
    icon.className = showPassword ? 'fas fa-eye-slash' : 'fas fa-eye';
  });

  loginForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!selectedPortalId) return;

    clearLoginError();
    loginButton.disabled = true;
    loginForm.setAttribute('aria-busy', 'true');
    loginButtonLabel.textContent = 'Signing in…';
    loginButtonIcon.className = 'fas fa-spinner fa-spin';

    const email = emailInput.value.trim();
    const password = passwordInput.value;

    try {
      const response = await fetch(`${API}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, password })
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok || !data.success) {
        throw new Error(LOGIN_FAILURE_MESSAGE);
      }

      const user = data.data?.user || data.user || data.data;
      const decision = await completePortalSignIn({
        portalId: selectedPortalId,
        user,
        logout: async () => {
          try { localStorage.removeItem('user'); } catch (_) { /* storage is only a UI cache */ }
          const logoutResponse = await fetch(`${API}/auth/logout`, {
            method: 'POST',
            credentials: 'include'
          });
          return logoutResponse.ok;
        },
        onAuthorized: (destination, authorizedUser) => {
          // Cache only non-secret profile data; the JWT remains in the HTTP-only cookie.
          try { localStorage.setItem('user', JSON.stringify(authorizedUser)); } catch (_) { /* optional UI cache */ }
          window.location.href = destination;
        }
      });

      if (!decision.authorized) {
        const logoutNote = decision.logoutSucceeded
          ? ''
          : ' The session could not be cleared; close this page and contact your school administrator.';
        throw new Error(`${PORTAL_MISMATCH_MESSAGE}${logoutNote}`);
      }
    } catch (error) {
      showLoginError(error.message || 'Unable to reach the sign-in service. Please try again.');
      loginButton.disabled = false;
      loginForm.removeAttribute('aria-busy');
      loginButtonLabel.textContent = 'Sign in';
      loginButtonIcon.className = 'fas fa-arrow-right';
    }
  });

  forgotPasswordButton.addEventListener('click', async () => {
    forgotPasswordStatus.hidden = true;
    forgotPasswordStatus.textContent = '';
    if (!emailInput.value.trim() || !emailInput.checkValidity()) {
      forgotPasswordStatus.dataset.state = 'error';
      forgotPasswordStatus.textContent = 'Enter a valid email address above to request password recovery.';
      forgotPasswordStatus.hidden = false;
      emailInput.focus();
      return;
    }

    forgotPasswordButton.disabled = true;
    try {
      const response = await fetch(`${API}/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email: emailInput.value.trim() })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.success) {
        throw new Error('Password recovery is temporarily unavailable. Please try again later.');
      }
      forgotPasswordStatus.dataset.state = 'success';
      forgotPasswordStatus.textContent = data.message ||
        'If an account with that email exists, a password reset link has been sent.';
    } catch (_) {
      forgotPasswordStatus.dataset.state = 'error';
      forgotPasswordStatus.textContent = 'Password recovery is temporarily unavailable. Please try again later.';
    } finally {
      forgotPasswordStatus.hidden = false;
      forgotPasswordButton.disabled = false;
    }
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    ROLE_DESTINATIONS,
    PORTALS,
    PORTAL_MISMATCH_MESSAGE,
    getPortalDestination,
    getSelectedPortalDestination,
    completePortalSignIn,
    redirectUser
  };
}

if (typeof document !== 'undefined') bindLoginPage();
