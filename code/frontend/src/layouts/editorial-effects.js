// Workspace source fragment: assembled in app/assets.mjs order.
// Shared scope is retained to preserve existing inline events and function hoisting.
let editorialRevealObserver = null,
  editorialRevealKey = '',
  editorialScrollPending = false,
  editorialLastScroll = 0;

function decorateEditorialButtons(scope) {
  if (!scope) return;
  scope.querySelectorAll('.primary,.secondary,.auth-submit').forEach((button) => {
    if (button.dataset.editorialButton) return;
    let text = button.textContent.trim();
    if (!text) return;
    button.dataset.editorialButton = 'true';
    let copy = document.createElement('span'),
      first = document.createElement('span'),
      second = document.createElement('span');
    copy.className = 'ref-button-copy';
    first.textContent = text;
    second.textContent = text;
    second.setAttribute('aria-hidden', 'true');
    copy.append(first, second);
    button.replaceChildren(copy);
    button.addEventListener('pointermove', (e) => {
      let b = button.getBoundingClientRect();
      button.style.setProperty(
        '--button-x',
        Math.max(0, Math.min(100, ((e.clientX - b.left) / Math.max(1, b.width)) * 100)) + '%',
      );
    });
  });
}

function revealEditorialContent() {
  let root = document.getElementById('content');
  decorateEditorialButtons(root);
  let key = page + ':' + (page === 'plan' ? date : '');
  if (key === editorialRevealKey) {
    editorialRevealObserver?.disconnect();
    editorialRevealObserver = null;
    return;
  }
  editorialRevealKey = key;
  editorialRevealObserver?.disconnect();
  editorialRevealObserver = null;
  if (
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ||
    typeof IntersectionObserver === 'undefined'
  )
    return;
  let targets = [
    ...root.querySelectorAll(
      '.heading,.gallery-main,.right-task-column,.quad,.rec-layout,.report-grid,.evidence',
    ),
  ];
  editorialRevealObserver = new IntersectionObserver(
    (entries) => {
      for (let entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.remove('is-pending');
        entry.target.classList.add('is-visible');
        editorialRevealObserver?.unobserve(entry.target);
      }
    },
    { threshold: 0.08, rootMargin: '0px 0px -20px 0px' },
  );
  targets.forEach((target, i) => {
    target.style.setProperty('--reveal-delay', Math.min(i * 65, 240) + 'ms');
    target.classList.add('editorial-reveal', 'is-pending');
    editorialRevealObserver.observe(target);
  });
}

const modalBeforeEditorial = modal;

modal = function (html, options) {
  const result = modalBeforeEditorial(html, options);
  decorateEditorialButtons(document.getElementById('modal-root'));
  return result;
};

const renderBeforeEditorial = render;

render = function () {
  renderBeforeEditorial();
  if (activeAccount) revealEditorialContent();
  else {
    editorialRevealObserver?.disconnect();
    editorialRevealObserver = null;
    editorialRevealKey = '';
    document.querySelector('.app-header')?.classList.remove('ref-header-hidden');
  }
};

function showEditorialHeader() {
  document.querySelector('.app-header')?.classList.remove('ref-header-hidden');
}

window.addEventListener('scroll', showEditorialHeader, { passive: true });

document.querySelector('.app-header')?.addEventListener('focusin', showEditorialHeader);

window.addEventListener(
  'pointermove',
  (e) => {
    if (e.clientY < 55) showEditorialHeader();
  },
  { passive: true },
);

window.addEventListener('pagehide', () => editorialRevealObserver?.disconnect());
