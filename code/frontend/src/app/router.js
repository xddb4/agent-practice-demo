/** Page registration. Callbacks resolve final page functions after adapters load. */
const StudyPilotRouter = (() => {
  const pages = new Map([
    ['plan', () => renderPlan()],
    ['matrix', () => matrix()],
    ['report', () => report()],
    ['personal', () => personal()],
    ['recommend', () => recommend()],
  ]);

  function renderPage(name) {
    return (pages.get(name) || pages.get('plan'))();
  }

  function navigate(name) {
    // Keep the existing login gate and render/transition lifecycle.
    if (name === 'personal') return openPersonal();
    page = name;
    return render();
  }

  function bindNavigation(root = document) {
    root.querySelectorAll('[data-page]').forEach((button) => {
      button.onclick = () => navigate(button.dataset.page);
    });
  }

  function register(name, renderPage) {
    if (!name || typeof renderPage !== 'function' || pages.has(name)) {
      throw new Error('A page needs a unique name and a render function.');
    }
    pages.set(name, renderPage);
  }

  return Object.freeze({ render: renderPage, navigate, bindNavigation, register });
})();
