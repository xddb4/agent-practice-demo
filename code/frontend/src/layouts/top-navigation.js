// Workspace source fragment: assembled in app/assets.mjs order.
// Shared scope is retained to preserve existing inline events and function hoisting.
let topNavEngine = null,
  topNavScheduled = false;

function updateTopNavigation() {
  let buttons = [...document.querySelectorAll('#app-nav-list [data-page]')],
    current = buttons.findIndex((b) => b.dataset.page === (page === 'recommend' ? 'matrix' : page));
  for (let [i, b] of buttons.entries()) {
    b.classList.toggle('active', i === current);
    let item = b.closest('[data-gooey-index]');
    if (i === current) {
      b.setAttribute('aria-current', 'page');
      item?.setAttribute('data-active', '');
    } else {
      b.removeAttribute('aria-current');
      item?.removeAttribute('data-active');
    }
  }
  let profile = document.getElementById('header-profile');
  if (page === 'personal' || page === 'report') profile.setAttribute('aria-current', 'page');
  else profile.removeAttribute('aria-current');
  let dateText = document.querySelector('.header-date');
  if (dateText)
    dateText.textContent = new Date().toLocaleDateString('zh-CN', {
      month: 'long',
      day: 'numeric',
      weekday: 'long',
    });
  if (topNavEngine) {
    topNavEngine.go(current);
    return;
  }
  if (topNavScheduled) return;
  topNavScheduled = true;
  requestAnimationFrame(() => {
    topNavScheduled = false;
    if (!activeAccount) return;
    let selected = [...document.querySelectorAll('#app-nav-list [data-page]')].findIndex(
      (b) => b.dataset.page === (page === 'recommend' ? 'matrix' : page),
    );
    if (!topNavEngine) {
      try {
        topNavEngine =
          window.mountStudyGooey?.(
            {
              stage: document.getElementById('app-nav-stage'),
              canvas: document.getElementById('app-nav-canvas'),
              list: document.getElementById('app-nav-list'),
              overlay: document.getElementById('app-nav-overlay'),
              fallback: document.getElementById('app-nav-fallback'),
            },
            selected,
          ) || null;
      } catch {
        topNavEngine = null;
        let b = document.querySelector('#app-nav-list [aria-current="page"]');
        if (b) {
          b.style.background = '#7d849b';
          b.style.color = '#fff';
        }
      }
    } else topNavEngine.go(selected);
  });
}

const renderBeforeTopNavigation = render;

render = function () {
  renderBeforeTopNavigation();
  if (activeAccount) updateTopNavigation();
  else {
    topNavEngine?.dispose();
    topNavEngine = null;
  }
};

document.getElementById('app-nav-list').addEventListener('keydown', (e) => {
  let buttons = [...document.querySelectorAll('#app-nav-list [data-page]')],
    i = buttons.indexOf(e.target);
  if (i < 0) return;
  let j =
    e.key === 'ArrowRight'
      ? (i + 1) % buttons.length
      : e.key === 'ArrowLeft'
        ? (i + buttons.length - 1) % buttons.length
        : e.key === 'Home'
          ? 0
          : e.key === 'End'
            ? buttons.length - 1
            : -1;
  if (j >= 0) {
    e.preventDefault();
    buttons[j].focus();
  }
});

window.addEventListener('pagehide', () => {
  topNavEngine?.dispose();
  topNavEngine = null;
});
