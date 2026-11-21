// A quiet first screen, followed by the existing date gallery. Task data stays shared.
(() => {
  function fitPlanMotto(sizer, motto, width, height) {
    sizer.style.fontSize = '';
    const style = getComputedStyle(sizer);
    const maximum = parseFloat(style.fontSize);
    const text = sizer.textContent;
    let size = Math.max(16, maximum * Math.sqrt(24 / Math.max(24, Array.from(text).length)));
    // Explicit line breaks remain intact; fit those lines before allowing extra wrapping.
    if (text.includes('\n')) {
      const context = document.createElement('canvas').getContext('2d');
      if (context) {
        context.font = style.fontWeight + ' ' + maximum + 'px ' + style.fontFamily;
        const longest = Math.max(
          ...text
            .split(/\r?\n/)
            .map(
              (line) =>
                context.measureText(line).width +
                Array.from(line).length * (parseFloat(style.letterSpacing) || 0),
            ),
        );
        if (longest)
          size = Math.max(16, Math.min(size, (maximum * Math.max(1, width - 2)) / longest));
      }
    }
    sizer.style.fontSize = size + 'px';
    while (size > 16 && sizer.getBoundingClientRect().height > height) {
      size = Math.max(16, size - 1);
      sizer.style.fontSize = size + 'px';
    }
    motto.style.fontSize = size + 'px';
  }

  const content = document.getElementById('content');
  if (!content || typeof renderPlan !== 'function') return;
  const original = renderPlan;
  let scene = null,
    dispose = null;
  const clamp = (value) => Math.max(0, Math.min(1, value));

  function todayTasks(includeCompleted = false) {
    const scheduled = tasksOn(today).filter((task) => includeCompleted || !task.done);
    const all = timelineTasks();
    const flexible = includeCompleted
      ? flexibleGroups(
          all.map((task) => ({ ...task, done: false })),
          today,
        ).current.map((task) => all.find((original) => original.id === task.id))
      : flexibleGroups(all, today).current;
    return [
      ...new Map([...scheduled, ...flexible].map((task) => [String(task.id), task])).values(),
    ].sort((a, b) =>
      a.start && b.start
        ? a.start.localeCompare(b.start)
        : a.start
          ? -1
          : b.start
            ? 1
            : taskPriority(a, b),
    );
  }

  function mount(resuming, savedScroll) {
    const heading = content.querySelector('.plan-heading');
    const workspace = content.querySelector('.gallery-workspace');
    if (!heading || !workspace) return;
    const motto = heading.querySelector('h1');
    const calendar = heading.querySelector('button');
    const root = document.createElement('section');
    root.className = 'plan-scene' + (resuming ? ' is-resuming' : '');
    root.innerHTML =
      '<section class="plan-intro" aria-label="今天的计划"><div class="plan-motto-slot"></div><section class="plan-today" aria-label="今日任务"><div class="plan-today-head"><h2>今日任务</h2><span></span></div><p class="plan-today-date"></p><div class="plan-today-list"></div></section></section>';
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
    if (!items.length)
      list.innerHTML = '<p class="plan-today-empty">今天留有空白，<br>也留有新的可能。</p>';
    items.forEach((task) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'plan-today-task';
      const time = document.createElement('span');
      time.className = 'plan-today-time';
      time.textContent = task.start || '灵活';
      const meta = document.createElement('span');
      meta.className = 'plan-today-meta';
      const kind = document.createElement('span');
      kind.className = 'plan-today-kind ' + (task.start ? 'is-fixed' : 'is-flexible');
      kind.textContent = task.start ? '固定' : '灵活';
      time.textContent = task.start
        ? task.start + (task.end ? ' – ' + task.end : '')
        : task.duration
          ? task.duration + ' 分钟'
          : '时间自定';
      meta.append(kind, time);
      const title = document.createElement('span');
      title.className = 'plan-today-title';
      title.textContent = task.title;
      button.append(meta, title);
      button.addEventListener('click', () => inspectTimelineTask(task.id));
      list.append(button);
    });
    const allToday = todayTasks(true);
    const completed = allToday.filter((task) => task.done).length;
    const percent = allToday.length ? Math.round((completed / allToday.length) * 100) : 0;
    const progress = document.createElement('footer');
    progress.className = 'plan-today-progress';
    progress.innerHTML =
      '<div><span>今日完成进度</span><span>' +
      completed +
      ' / ' +
      allToday.length +
      ' 已完成</span></div><progress max="100" value="' +
      percent +
      '" aria-label="今日任务完成进度">' +
      percent +
      '%</progress>';
    root.querySelector('.plan-today').append(progress);
    const abort = new AbortController();
    const intro = root.querySelector('.plan-intro');
    const todayCard = root.querySelector('.plan-today');
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    let frame = 0,
      originX = 0,
      originY = 0,
      targetY = 0,
      scale = 1,
      distance = 1,
      mottoLayoutKey = '';
    function update() {
      frame = 0;
      if (!root.isConnected) return;
      const rawProgress = clamp(window.scrollY / distance);
      const progress = rawProgress >= 0.98 ? 1 : rawProgress;
      const eased = progress * progress * (3 - 2 * progress);
      const size = 1 + (scale - 1) * eased;
      motto.style.transform = `translate3d(${originX}px,${originY + (targetY - originY) * eased}px,0) scale(${size})`;
      motto.style.opacity = String(1 - clamp((progress - 0.45) / 0.3));
      dock.style.opacity = String(clamp((progress - 0.55) / 0.3));
      todayCard.style.opacity = String(1 - clamp(progress * 1.6));
      todayCard.style.transform = reduced ? '' : `translateY(${-progress * 32}px)`;
      todayCard.inert = progress > 0.65;
      const visible = progress > 0.72;
      // Keep wheel events on the page until the fixed gallery has fully faded in.
      workspace.inert = progress < 1;
      workspace.style.visibility = visible ? 'visible' : 'hidden';
      workspace.style.opacity = String(clamp((progress - 0.72) / 0.28));
      workspace.style.transform = reduced ? '' : `translateY(${(1 - eased) * 24}px)`;
      root.classList.toggle('is-gallery-view', progress === 1);
    }
    function schedule() {
      if (!frame) frame = requestAnimationFrame(update);
    }
    function measure() {
      const layoutKey = slot.clientWidth + ':' + innerWidth + ':' + innerHeight;
      if (layoutKey !== mottoLayoutKey) {
        mottoLayoutKey = layoutKey;
        fitPlanMotto(sizer, motto, slot.clientWidth, Math.min(420, innerHeight * 0.45));
      }
      const box = sizer.getBoundingClientRect();
      const headerHeight = document.querySelector('.app-header')?.offsetHeight || 88;
      originX = box.left;
      originY = box.top + window.scrollY;
      targetY = headerHeight + 14;
      scale = Math.min(1, 19 / parseFloat(getComputedStyle(sizer).fontSize));
      distance = Math.max(1, intro.offsetHeight * 0.78);
      root.dataset.galleryScroll = String(distance);
      motto.style.width = box.width + 'px';
      workspace.style.left =
        content.getBoundingClientRect().left +
        parseFloat(getComputedStyle(content).paddingLeft) +
        'px';
      workspace.style.width = intro.getBoundingClientRect().width + 'px';
      // A narrow-screen scroll position must not carry into the fixed desktop columns.
      if (innerWidth > 900) workspace.scrollTop = 0;
      dock.style.left = originX + 'px';
      dock.style.top = targetY + 'px';
      const dockWidth = Math.max(1, innerWidth - originX * 2);
      dock.style.width = dockWidth + 'px';
      const longestLine = Math.max(
        ...dock.textContent.split(/\r?\n/).map((line) => Array.from(line).length),
      );
      const dockFont = Math.min(19, Math.max(12, dockWidth / Math.max(1, longestLine * 1.06)));
      dock.style.fontSize = dockFont + 'px';
      const space = Math.ceil(dock.getBoundingClientRect().height + 28);
      root.dataset.mottoSpace = String(space);
      root.style.setProperty('--plan-motto-space', space + 'px');
      update();
    }
    const resize = new ResizeObserver(measure);
    resize.observe(intro);
    resize.observe(sizer);
    window.addEventListener('scroll', schedule, { passive: true, signal: abort.signal });
    window.addEventListener('resize', measure, { passive: true, signal: abort.signal });
    // Date selection rerenders the gallery; retain the narrative's position in that case.
    window.scrollTo({ top: resuming ? savedScroll : 0, behavior: 'instant' });
    measure();
    dispose = () => {
      abort.abort();
      resize.disconnect();
      cancelAnimationFrame(frame);
    };
  }

  renderPlan = function (...args) {
    const resuming = !!scene?.isConnected;
    const savedScroll = resuming ? window.scrollY : 0;
    dispose?.();
    dispose = null;
    original.apply(this, args);
    mount(resuming, savedScroll);
  };
  const observer = new MutationObserver(() => {
    if (scene && !scene.isConnected) {
      dispose?.();
      dispose = null;
      scene = null;
      content.classList.remove('plan-content');
    }
  });
  observer.observe(content, { childList: true });
  if (content.querySelector('.plan-heading')) mount(false, 0);
  window.addEventListener(
    'pagehide',
    () => {
      dispose?.();
      observer.disconnect();
    },
    { once: true },
  );
})();
