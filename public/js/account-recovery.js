const params = new URLSearchParams(window.location.search);
const token = params.get('token');
// Keep bearer credentials out of the address bar, browser history and referrers.
if (token) window.history.replaceState(null, '', window.location.pathname);
const isActivation = window.location.pathname.endsWith('/activate.html');
const endpoint = isActivation ? 'activate' : 'reset-password';

function initializeRecoveryForm() {
  const form = document.getElementById('accountForm');
  const message = document.getElementById('accountMessage');

  if (!token) {
    form.hidden = true;
    message.textContent = 'This link is invalid or incomplete.';
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const password = document.getElementById('password').value;
    const response = await fetch(`/api/v1/auth/${endpoint}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ token, password }),
    });
    const data = await response.json();
    message.textContent = data.message || 'The request could not be completed.';
    if (response.ok) form.hidden = true;
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeRecoveryForm, { once: true });
} else {
  initializeRecoveryForm();
}
