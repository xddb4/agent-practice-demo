let abilityScrollCleanup = null;

function abilityScrollProgress(scrollY, start, distance) {
  return distance > 0 ? Math.max(0, Math.min(1, (scrollY - start) / distance)) : 0;
}

function mountAbilityScroll(grid) {
  if (!grid || grid.closest('.ability-scroll')) return;
  const cards = [...grid.querySelectorAll(':scope > .ability')];
  if (!cards.length) return;
  abilityScrollCleanup?.();
  abilityScrollCleanup = null;
  const root = document.createElement('section');
  root.className = 'ability-scroll';
  root.setAttribute('aria-label', '六维能力报告');
  root.style.height = (innerHeight + Math.max(0, cards.length - 1) * Math.min(innerWidth * .8, 960)) + 'px';
  root.innerHTML = '<div class="ability-scroll-pin"><div class="ability-scroll-toolbar"><div><h2>能力画像</h2><p>向下滚动，依次查看每个能力维度</p></div><div class="ability-scroll-controls"><button type="button" class="ability-scroll-prev" aria-label="上一个能力维度">←</button><span class="ability-scroll-count" aria-live="polite" aria-atomic="true"></span><button type="button" class="ability-scroll-next" aria-label="下一个能力维度">→</button></div></div><div class="ability-scroll-viewport" tabindex="0" role="region" aria-label="能力板块，可使用左右方向键切换"></div><div class="ability-scroll-footer"><div class="ability-scroll-progress" aria-hidden="true"><i></i></div><div class="ability-scroll-steps" role="group" aria-label="选择能力维度"></div></div></div>';
  grid.before(root);
  const pin = root.querySelector('.ability-scroll-pin');
  const viewport = root.querySelector('.ability-scroll-viewport');
  const steps = root.querySelector('.ability-scroll-steps');
  const count = root.querySelector('.ability-scroll-count');
  const previous = root.querySelector('.ability-scroll-prev');
  const next = root.querySelector('.ability-scroll-next');
  grid.classList.add('ability-scroll-track');
  viewport.append(grid);
  const nav = cards.map((card, index) => {
    const title = card.querySelector('h3');
    const level = card.querySelector('.level');
    const heading = document.createElement('div');
    heading.className = 'ability-card-heading';
    heading.append(title);
    if (level) heading.append(level);
    const body = document.createElement('div');
    body.className = 'ability-card-body';
    body.append(...card.childNodes);
    card.append(heading, body);
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = title.textContent;
    button.setAttribute('aria-label', '查看' + title.textContent);
    steps.append(button);
    return button;
  });
  const abort = new AbortController();
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  let distance = 0, start = 0, frame = 0, index = -1, lastReduced = null, disposed = false;
  function update() {
    frame = 0;
    if (!root.isConnected) { cleanup(); return; }
    const progress = motion.matches ? 0 : abilityScrollProgress(scrollY, start, distance);
    grid.style.transform = motion.matches ? '' : 'translate3d(' + (-progress * distance) + 'px,0,0)';
    root.style.setProperty('--ability-progress', String(progress));
    const current = Math.round(progress * (cards.length - 1));
    if (index === current && lastReduced === motion.matches) return;
    index = current;
    lastReduced = motion.matches;
    count.textContent = (current + 1) + ' / ' + cards.length;
    previous.disabled = current === 0;
    next.disabled = current === cards.length - 1;
    cards.forEach((card, i) => { card.inert = !motion.matches && i !== current; });
    nav.forEach((button, i) => button.setAttribute('aria-pressed', String(i === current)));
  }
  function queue() { if (!frame && !disposed) frame = requestAnimationFrame(update); }
  function measure() {
    if (disposed || !root.isConnected) return;
    const offset = (document.querySelector('.app-header')?.offsetHeight || 85) + 18;
    root.classList.toggle('is-reduced-motion', motion.matches);
    root.style.setProperty('--ability-pin-top', offset + 'px');
    pin.style.height = motion.matches ? '' : Math.max(360, innerHeight - offset - 24) + 'px';
    // Only resize/content changes measure layout; scrolling updates one composited transform.
    distance = motion.matches ? 0 : Math.max(0, grid.scrollWidth - viewport.clientWidth);
    start = scrollY + root.getBoundingClientRect().top - offset;
    root.style.height = motion.matches ? 'auto' : (pin.offsetHeight + distance) + 'px';
    update();
  }
  function goTo(target) {
    const selected = Math.max(0, Math.min(cards.length - 1, target));
    if (motion.matches) {
      cards[selected].scrollIntoView({block: 'start', behavior: 'auto'});
      return;
    }
    window.scrollTo({top: Math.max(0, start + distance * selected / Math.max(1, cards.length - 1)), behavior: 'smooth'});
  }
  previous.addEventListener('click', () => goTo(index - 1), {signal: abort.signal});
  next.addEventListener('click', () => goTo(index + 1), {signal: abort.signal});
  nav.forEach((button, i) => button.addEventListener('click', () => goTo(i), {signal: abort.signal}));
  viewport.addEventListener('keydown', event => {
    if (event.target !== viewport || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    goTo(event.key === 'Home' ? 0 : event.key === 'End' ? cards.length - 1 : index + (event.key === 'ArrowRight' ? 1 : -1));
  }, {signal: abort.signal});
  window.addEventListener('scroll', queue, {passive: true, signal: abort.signal});
  window.addEventListener('resize', measure, {passive: true, signal: abort.signal});
  motion.addEventListener('change', measure, {signal: abort.signal});
  const resize = new ResizeObserver(measure);
  resize.observe(viewport);
  const changes = new MutationObserver(() => { if (!root.isConnected) cleanup(); });
  changes.observe(document.getElementById('content'), {childList: true});
  function cleanup() {
    if (disposed) return;
    disposed = true;
    abort.abort();
    resize.disconnect();
    changes.disconnect();
    cancelAnimationFrame(frame);
  }
  abilityScrollCleanup = cleanup;
  measure();
}

// The backend renderer and evidence review keep their data flow; only the presentation changes.
(() => {
  const renderReport = report;
  report = async function (...args) {
    const alreadyViewingReport = Boolean(document.querySelector('#content > .ability-scroll'));
    const result = await renderReport.apply(this, args);
    const grid = document.querySelector('#content > .report-grid');
    if (grid) {
      mountAbilityScroll(grid);
      if (!alreadyViewingReport) window.scrollTo({top: 0, behavior: 'auto'});
    }
    return result;
  };
  window.addEventListener('pagehide', () => abilityScrollCleanup?.(), {once: true});
})();
