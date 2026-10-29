(function () {
  const actionTypes = ['click', 'change', 'input', 'keyup', 'keydown', 'submit'];

  function encodeAttribute(value) {
    return String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  window.cspActionAttrs = function (name, args = [], type = 'click', elementIndexes = [], eventIndexes = []) {
    if (!/^[A-Za-z_$][\w$]*$/.test(name) || !actionTypes.includes(type)) {
      throw new TypeError('Invalid delegated action');
    }
    const attrs = [
      `data-csp-action-${type}="${encodeAttribute(name)}"`,
      `data-csp-args-${type}="${encodeAttribute(encodeURIComponent(JSON.stringify(args)))}"`
    ];
    if (elementIndexes.length) attrs.push(`data-csp-elements-${type}="${elementIndexes.join(',')}"`);
    if (eventIndexes.length) attrs.push(`data-csp-events-${type}="${eventIndexes.join(',')}"`);
    return attrs.join(' ');
  };

  window.cspActionArgs = function (element, type = 'click') {
    const encoded = element.getAttribute(`data-csp-args-${type}`);
    if (!encoded) return [];
    try { return JSON.parse(decodeURIComponent(encoded)); }
    catch (_) { return []; }
  };

  window.cspSetVisibility = function (element, visible, display = '') {
    if (!element) return;
    element.classList.toggle('is-hidden', !visible);
    element.classList.remove('is-visible-block', 'is-visible-flex', 'is-visible-grid');
    if (visible && display) element.classList.add(`is-visible-${display}`);
  };

  window.cspSetProgress = function (element, percentage) {
    if (!element) return;
    for (const name of Array.from(element.classList)) {
      if (name.startsWith('progress-width-')) element.classList.remove(name);
    }
    const width = Math.max(0, Math.min(100, Math.round(Number(percentage) || 0)));
    element.classList.add(`progress-width-${width}`);
  };

  function runAction(name, args, element) {
    switch (name) {
      case 'removeParent': element.parentElement?.remove(); return;
      case 'toggleSiblingDisabled': {
        const field = element.closest('tr')?.querySelector('input[type="number"]');
        if (field) field.disabled = element.checked;
        return;
      }
      case 'goToHash': window.location.hash = args[0]; return;
      case 'navigateLogin': window.location.href = '/portal/login.html'; return;
      case 'reloadPage': window.location.reload(); return;
      case 'showPasswordHelp': window.alert('Please contact your administrator to reset your password.'); return;
      case 'showAlert': window.alert(args[0]); return;
      default:
        if (name.startsWith('toast')) {
          const method = name.slice(5).toLowerCase();
          return window.CSPToasts?.[method]?.(...args);
        }
        if (typeof window[name] === 'function') return window[name](...args);
        console.error(`CSP action is unavailable: ${name}`);
    }
  }

  document.addEventListener('click', event => {
    const pageButton = event.target.closest?.('[data-pagination-container]');
    if (!pageButton) return;
    const { paginationContainer: containerId, paginationDirection, paginationPage } = pageButton.dataset;
    if (typeof window.changePage === 'function') {
      window.changePage(containerId, paginationDirection || Number(paginationPage));
    }
  }, true);

  for (const type of actionTypes) {
    document.addEventListener(type, event => {
      const selector = `[data-csp-action-${type}]`;
      const element = event.target instanceof Element ? event.target.closest(selector) : null;
      if (!element) return;
      const name = element.getAttribute(`data-csp-action-${type}`);
      const args = window.cspActionArgs(element, type);
      const elementIndexes = (element.getAttribute(`data-csp-elements-${type}`) || '').split(',').filter(Boolean).map(Number);
      const eventIndexes = (element.getAttribute(`data-csp-events-${type}`) || '').split(',').filter(Boolean).map(Number);
      for (const index of [...elementIndexes, ...eventIndexes].sort((a, b) => b - a)) {
        args.splice(index, 0, elementIndexes.includes(index) ? element : event);
      }
      runAction(name, args, element);
    });
  }

  document.addEventListener('keydown', event => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const element = event.target.closest?.('[data-csp-action-click][role="button"]');
    if (!element) return;
    event.preventDefault();
    element.click();
  });
})();
