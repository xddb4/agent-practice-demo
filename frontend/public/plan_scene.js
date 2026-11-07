// A quiet first screen, followed by the existing date gallery. Task data stays shared.
(() => {
  const content = document.getElementById('content');
  if (!content || typeof renderPlan !== 'function') return;
  const original = renderPlan;
  let scene = null, dispose = null;
  const clamp = value => Math.max(0, Math.min(1, value));

  function todayTasks() {
    const scheduled = tasksOn(today).filter(task => !task.done);
    const flexible = flexibleGroups(timelineTasks(), today).current;
    return [...new Map([...scheduled, ...flexible].map(task => [String(task.id), task])).values()]
      .sort((a, b) => a.start && b.start ? a.start.localeCompare(b.start) : a.start ? -1 : b.start ? 1 : taskPriority(a, b));
  }

  function mount(resuming, savedScroll) {
    const heading = content.querySelector('.plan-heading');
    const workspace = content.querySelector('.gallery-workspace');
    if (!heading || !workspace) return;
    const motto = heading.querySelector('h1');
    const calendar = heading.querySelector('button');
    const root = document.createElement('section');
    root.className = 'plan-scene' + (resuming ? ' is-resuming' : '');
    root.innerHTML = '<section class="plan-intro" aria-label="今天的计划"><div class="plan-motto-slot"></div><section class="plan-today" aria-label="今日任务"><div class="plan-today-head"><h2>今日任务</h2><span></span></div><p class="plan-today-date"></p><div class="plan-today-list"></div></section></section>';
    heading.replaceWith(root);
    root.append(workspace);
    scene = root;
    content.classList.add('plan-content');
    const slot = root.querySelector('.plan-motto-slot');
    const sizer = motto.cloneNode(true);
    sizer.className = 'plan-motto-sizer';
    sizer.setAttribute('aria-hidden', 'true');
    motto.className = 'plan-motto';
    const dock = document.createElement('div');
    dock.className = 'plan-motto-dock';
    dock.textContent = motto.textContent;
    dock.setAttribute('aria-hidden', 'true');
    slot.append(sizer, motto, dock);
    workspace.querySelector('.gallery-range > span:nth-child(2)')?.remove();
    if (calendar) workspace.querySelector('.time-tools').prepend(calendar);
    const list = root.querySelector('.plan-today-list');
    const items = todayTasks();
    root.querySelector('.plan-today-head span').textContent = items.length + ' 项待办';
    root.querySelector('.plan-today-date').textContent = today.replaceAll('-', ' / ');
    if (!items.length) list.innerHTML = '<p class="plan-today-empty">今天留有空白，<br>也留有新的可能。</p>';
    items.forEach(task => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'plan-today-task';
      const time = document.createElement('span');
      time.className = 'plan-today-time';
      time.textContent = task.start || '灵活';
      const title = document.createElement('span');
      title.textContent = task.title;
      button.append(time, title);
      button.addEventListener('click', () => inspectTimelineTask(task.id));
      list.append(button);
    });
    const abort = new AbortController();
    const intro = root.querySelector('.plan-intro');
    const todayCard = root.querySelector('.plan-today');
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    let frame = 0, originX = 0, originY = 0, targetY = 0, scale = 1, distance = 1;
    function update() {
      frame = 0;
      if (!root.isConnected) return;
      const progress = clamp(window.scrollY / distance);
      const eased = progress * progress * (3 - 2 * progress);
      const size = 1 + (scale - 1) * eased;
      motto.style.transform = `translate3d(${originX}px,${originY + (targetY - originY) * eased}px,0) scale(${size})`;
      motto.style.opacity = String(1 - clamp((progress - .45) / .3));
      dock.style.opacity = String(clamp((progress - .55) / .3));
      todayCard.style.opacity = String(1 - clamp(progress * 1.6));
      todayCard.style.transform = reduced ? '' : `translateY(${-progress * 32}px)`;
      todayCard.inert = progress > .65;
      const visible = progress > .72;
      workspace.inert = !visible;
      workspace.style.visibility = visible ? 'visible' : 'hidden';
      workspace.style.opacity = String(clamp((progress - .72) / .28));
      workspace.style.transform = reduced ? '' : `translateY(${(1 - eased) * 24}px)`;
      root.classList.toggle('is-gallery-view', progress >= .98);
    }
    function schedule() { if (!frame) frame = requestAnimationFrame(update); }
    function measure() {
      const box = sizer.getBoundingClientRect();
      const headerHeight = document.querySelector('.app-header')?.offsetHeight || 88;
      originX = box.left;
      originY = box.top + window.scrollY;
      targetY = headerHeight + 14;
      scale = Math.min(1, 19 / parseFloat(getComputedStyle(sizer).fontSize));
      distance = Math.max(1, intro.offsetHeight * .78);
      motto.style.width = box.width + 'px';
      workspace.style.left = content.getBoundingClientRect().left + parseFloat(getComputedStyle(content).paddingLeft) + 'px';
      workspace.style.width = intro.getBoundingClientRect().width + 'px';
      dock.style.left = originX + 'px';
      dock.style.top = targetY + 'px';
      const dockFont = Math.min(19, (innerWidth - originX * 2) / Math.max(1, Array.from(dock.textContent).length * 1.06));
      dock.style.fontSize = dockFont + 'px';
      const space = Math.ceil(dockFont * 1.6 + 28);
      root.dataset.mottoSpace = String(space);
      root.style.setProperty('--plan-motto-space', space + 'px');
      update();
    }
    const resize = new ResizeObserver(measure);
    resize.observe(intro);
    resize.observe(sizer);
    window.addEventListener('scroll', schedule, {passive: true, signal: abort.signal});
    window.addEventListener('resize', measure, {passive: true, signal: abort.signal});
    // Date selection rerenders the gallery; retain the narrative's position in that case.
    window.scrollTo({top: resuming ? savedScroll : 0, behavior: 'instant'});
    measure();
    dispose = () => { abort.abort(); resize.disconnect(); cancelAnimationFrame(frame); };
  }

  renderPlan = function(...args) {
    const resuming = !!scene?.isConnected;
    const savedScroll = resuming ? window.scrollY : 0;
    dispose?.();
    dispose = null;
    original.apply(this, args);
    mount(resuming, savedScroll);
  };
  const observer = new MutationObserver(() => {
    if (scene && !scene.isConnected) {
      dispose?.(); dispose = null; scene = null;
      content.classList.remove('plan-content');
    }
  });
  observer.observe(content, {childList: true});
  if (content.querySelector('.plan-heading')) mount(false, 0);
  window.addEventListener('pagehide', () => { dispose?.(); observer.disconnect(); }, {once: true});
})();
