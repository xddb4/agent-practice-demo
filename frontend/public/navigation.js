// Scrolling, overflow affordances, and the persistent header share one lifecycle.
(() => {
  const content = document.getElementById('content');
  if (!content) return;
  const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const behavior = () => reducedMotion() ? 'auto' : 'smooth';
  let quadrantRoot = null, galleryRoot = null, disposeQuadrants, disposeGallery;
  let refreshFrame = 0, nextWheelAt = 0, lastWheelAt = 0, wheelAmount = 0;

  const header = document.querySelector('.app-header');
  if (header) {
    const fade = document.createElement('div');
    fade.className = 'header-content-fade';
    fade.setAttribute('aria-hidden', 'true');
    fade.innerHTML = '<div class="header-background"></div>';
    header.prepend(fade);
  }
  function measureHeader() {
    document.documentElement.style.setProperty('--header-height', (header?.offsetHeight || 85) + 'px');
    header?.classList.remove('ref-header-hidden');
  }
  const headerObserver = new ResizeObserver(measureHeader);
  if (header) headerObserver.observe(header);
  measureHeader();

  function bindQuadrants(root) {
    const abort = new AbortController();
    const updates = [];
    const observer = new ResizeObserver(() => updates.forEach(update => update()));
    root.querySelectorAll('.q-task-list').forEach(list => {
      const shell = document.createElement('div');
      shell.className = 'quad-list-shell';
      list.before(shell);
      shell.append(list);
      list.tabIndex = 0;
      list.setAttribute('role', 'region');
      list.setAttribute('aria-label', (list.closest('.quad').querySelector('.q-label')?.textContent.trim() || '象限') + '任务列表');
      const more = document.createElement('button');
      more.className = 'q-more-tasks';
      more.type = 'button';
      more.setAttribute('aria-label', '向下查看更多任务');
      more.innerHTML = '<svg width="22" height="15" viewBox="0 0 24 16" fill="none" aria-hidden="true"><path d="m5 4 7 7 7-7" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      shell.append(more);
      function update() {
        const hasMore = list.scrollHeight - list.clientHeight - list.scrollTop > 2;
        more.hidden = !hasMore;
        if (!hasMore && document.activeElement === more) list.focus({preventScroll: true});
      }
      more.addEventListener('click', () => list.scrollBy({top: Math.max(100, list.clientHeight * .75), behavior: behavior()}), {signal: abort.signal});
      list.addEventListener('scroll', update, {passive: true, signal: abort.signal});
      observer.observe(list);
      if (list.firstElementChild) observer.observe(list.firstElementChild);
      updates.push(update);
      update();
    });
    return () => { abort.abort(); observer.disconnect(); };
  }

  function alignGallery(root) {
    if (!root?.isConnected) return;
    const box = root.getBoundingClientRect();
    const headerHeight = header?.offsetHeight || 85;
    const desired = Math.max(0, window.scrollY + box.top - headerHeight - 26);
    const limit = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
    const top = Math.min(desired, limit);
    if (Math.abs(window.scrollY - top) > 12) window.scrollTo({top, behavior: behavior()});
  }
  function bindGallery(root) {
    const abort = new AbortController();
    root.tabIndex = 0;
    root.setAttribute('aria-label', '每日任务画廊，使用滚轮切换日期');
    root.addEventListener('focusin', () => alignGallery(root), {signal: abort.signal});
    root.addEventListener('wheel', event => {
      if (event.ctrlKey || event.metaKey || event.altKey || event.target.closest('input,textarea,select,[contenteditable="true"]')) return;
      if (typeof page === 'undefined' || page !== 'plan' || taskDrag?.active || shredJob || completionTicket?.drag || fabDrag) return;
      const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
      if (!delta) return;
      event.preventDefault();
      alignGallery(root);
      const now = performance.now();
      if (now < nextWheelAt) return;
      if (now - lastWheelAt > 180 || Math.sign(wheelAmount) !== Math.sign(delta)) wheelAmount = 0;
      lastWheelAt = now;
      wheelAmount += delta * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? window.innerHeight : 1);
      if (Math.abs(wheelAmount) < 48) return;
      const direction = Math.sign(wheelAmount);
      wheelAmount = 0;
      nextWheelAt = now + 420;
      clearTimeout(galleryHoverTimer);
      window.galleryWheelNavigationUntil = Date.now() + 650;
      chooseGalleryDay(addDays(date, direction));
      alignGallery(document.querySelector('.gallery-main'));
    }, {passive: false, signal: abort.signal});
    return () => abort.abort();
  }

  function refresh() {
    refreshFrame = 0;
    const quadrants = content.querySelector('.quadrants');
    if (quadrants !== quadrantRoot) {
      disposeQuadrants?.();
      quadrantRoot = quadrants;
      disposeQuadrants = quadrants ? bindQuadrants(quadrants) : null;
    }
    const gallery = content.querySelector('.gallery-main');
    if (gallery !== galleryRoot) {
      disposeGallery?.();
      galleryRoot = gallery;
      disposeGallery = gallery ? bindGallery(gallery) : null;
    }
  }
  const changes = new MutationObserver(() => { if (!refreshFrame) refreshFrame = requestAnimationFrame(refresh); });
  changes.observe(content, {childList: true, subtree: true});
  refresh();
  window.addEventListener('pagehide', () => {
    changes.disconnect();
    headerObserver.disconnect();
    disposeQuadrants?.();
    disposeGallery?.();
    cancelAnimationFrame(refreshFrame);
  }, {once: true});
})();
