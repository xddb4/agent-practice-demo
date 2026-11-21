// Workspace source fragment: assembled in app/assets.mjs order.
// Shared scope is retained to preserve existing inline events and function hoisting.
let galleryTimelineExpanded = true,
  galleryHoverTimer = 0;

function galleryDays() {
  return Array.from({ length: 7 }, (_, i) => addDays(timelineCenter, i - 3));
}

function galleryGrow(ratio = 0.56, count = 7) {
  let r = Math.max(0.2, Math.min(0.9, ratio));
  return count > 1 ? (r * (count - 1)) / (1 - r) : 1;
}

function galleryPanelContent(key) {
  let items = tasksOn(key),
    fixed = items.filter((t) => t.start).sort((a, b) => a.start.localeCompare(b.start)),
    d = new Date(key + 'T12:00:00');
  return (
    '<div class="gallery-caption-bar"></div><h3 class="gallery-day-title">' +
    (key === today
      ? '今天的节奏'
      : ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()] + '的安排') +
    '</h3><p class="gallery-day-count">' +
    fixed.length +
    ' 项固定安排 · ' +
    items.filter((t) => !t.start).length +
    ' 项灵活任务</p>' +
    (fixed.length
      ? fixed
          .slice(0, 3)
          .map(
            (t) =>
              '<button class="gallery-mini-event q-tone-' +
              t.q +
              '" onclick="inspectTimelineTask(' +
              t.id +
              ')"><span class="event-dot" aria-hidden="true"></span><span><small>' +
              t.start +
              '</small>' +
              esc(t.title) +
              '</span></button>',
          )
          .join('')
      : '<p class="gallery-panel-empty">留一点空白，<br>为今天的可能。</p>') +
    '<button class="gallery-open-day" onclick="chooseGalleryDay(\'' +
    key +
    '\',true)">查看当天时间轴 ↘</button>'
  );
}

function galleryArtwork(key) {
  let day = Math.floor(Date.parse(key + 'T00:00:00Z') / 86400000);
  return '/assets/gallery-floral-' + ((((day % 4) + 4) % 4) + 1) + '.svg';
}

function taskGalleryHTML() {
  let days = galleryDays(),
    active = days.indexOf(date);
  return (
    '<div class="task-gallery" id="task-gallery" aria-label="七天日期手风琴画廊">' +
    days
      .map((key, i) => {
        let d = new Date(key + 'T12:00:00'),
          selected = key === date;
        return (
          '<section class="ag-day-panel ' +
          (key === today ? 'is-today ' : '') +
          (selected ? 'is-active' : '') +
          '" data-gallery-date="' +
          key +
          '" style="--day-art:url(' +
          galleryArtwork(key) +
          ');--panel-grow:' +
          (selected ? galleryGrow() : 1) +
          ';--panel-tilt:' +
          (selected ? 0 : i < active ? 4 : -4) +
          'deg;--art-shift:' +
          Math.max(-12, Math.min(12, (active - i) * 6)) +
          'px;--art-position:' +
          (i / 6) * 100 +
          '%"><div class="gallery-panel-art" aria-hidden="true"></div><div class="gallery-panel-overlay" aria-hidden="true"></div><button class="gallery-date-trigger" data-gallery-select="' +
          key +
          '" aria-expanded="' +
          selected +
          '" aria-haspopup="dialog" aria-label="' +
          key +
          '，' +
          tasksOn(key).length +
          '项任务"><span class="gallery-weekday">' +
          (key === today
            ? '今天'
            : ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()]) +
          '</span><span class="gallery-number">' +
          d.getDate() +
          '</span><span class="gallery-dot" aria-hidden="true"></span></button><span class="gallery-collapsed-count">' +
          tasksOn(key).length +
          ' 项任务</span><div class="gallery-panel-content" ' +
          (selected ? '' : 'inert') +
          '>' +
          galleryPanelContent(key) +
          '</div></section>'
        );
      })
      .join('') +
    '</div>'
  );
}

function rightTaskColumnHTML() {
  return flexibleHTML();
}

function scrollGalleryDayToStart() {
  requestAnimationFrame(() => {
    let sc = document.getElementById('day-scroll');
    if (!sc) return;
    let fixed = tasksOn(date).filter((t) => t.start),
      start = fixed.length ? Math.min(...fixed.map((t) => minutes(t.start))) : 8 * 60;
    sc.scrollTop = Math.max(0, start - 60);
  });
}

function updateGalleryLayout(key) {
  let days = galleryDays(),
    active = days.indexOf(key);
  document.querySelectorAll('[data-gallery-date]').forEach((panel, i) => {
    let selected = panel.dataset.galleryDate === key;
    panel.classList.toggle('is-active', selected);
    panel.style.setProperty('--panel-grow', String(selected ? galleryGrow() : 1));
    panel.style.setProperty('--panel-tilt', (selected ? 0 : i < active ? 4 : -4) + 'deg');
    panel.style.setProperty('--art-shift', Math.max(-12, Math.min(12, (active - i) * 6)) + 'px');
    let trigger = panel.querySelector('[data-gallery-select]');
    trigger?.setAttribute('aria-expanded', String(selected));
    let content = panel.querySelector('.gallery-panel-content');
    if (content) content.inert = !selected;
  });
}

function chooseGalleryDay(key, openTimeline = false) {
  if (
    page !== 'plan' ||
    !activeAccount ||
    taskDrag?.active ||
    shredJob ||
    completionTicket?.drag ||
    fabDrag
  )
    return;
  clearTimeout(galleryHoverTimer);
  date = key;
  timelineMode = 'day';
  if (!galleryDays().includes(key)) {
    timelineCenter = key;
    render();
  } else {
    updateGalleryLayout(key);
    document.getElementById('right-task-column').innerHTML = rightTaskColumnHTML();
  }
  if (openTimeline) openGalleryDayPopup();
}

function toggleGalleryTimeline() {
  openGalleryDayPopup();
}

function openGalleryDayPopup() {
  modal(
    '<div class="modal-head"><div><span class="gallery-kicker">A DAY AT A TIME</span><h2>' +
      date.replaceAll('-', ' / ') +
      '</h2></div><button aria-label="关闭当天安排" onclick="closeModal()">✕</button></div><p class="subtitle">滚动查看固定任务，拖动修改时间</p><div id="day-popup-content">' +
      dayFocusHTML() +
      '</div>',
  );
  let dialog = document.querySelector('#modal-root .modal');
  dialog.classList.add('day-popup');
  dialog.setAttribute('aria-label', date + ' 当天固定安排');
  scrollGalleryDayToStart();
  requestAnimationFrame(() =>
    document.getElementById('day-scroll')?.focus({ preventScroll: true }),
  );
}

function bindTaskGallery() {
  let root = document.getElementById('task-gallery');
  let box = root.getBoundingClientRect();
  root.style.setProperty('--gallery-media-width', Math.max(280, box.width * 0.56 * 1.22) + 'px');
  for (let panel of root.querySelectorAll('[data-gallery-date]')) {
    let key = panel.dataset.galleryDate;
    panel.addEventListener('pointerenter', (e) => {
      if (
        e.pointerType !== 'mouse' ||
        taskDrag?.active ||
        shredJob ||
        Date.now() < (window.galleryWheelNavigationUntil || 0)
      )
        return;
      clearTimeout(galleryHoverTimer);
      galleryHoverTimer = setTimeout(() => chooseGalleryDay(key), 90);
    });
    panel.addEventListener('pointerleave', () => clearTimeout(galleryHoverTimer));
    panel.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      chooseGalleryDay(key, true);
    });
    let trigger = panel.querySelector('[data-gallery-select]');
    trigger?.addEventListener('click', () => chooseGalleryDay(key, true));
    trigger?.addEventListener('focus', () => chooseGalleryDay(key));
    trigger?.addEventListener('keydown', (e) => {
      let direction =
        e.key === 'ArrowRight' || e.key === 'ArrowDown'
          ? 1
          : e.key === 'ArrowLeft' || e.key === 'ArrowUp'
            ? -1
            : 0;
      if (!direction) return;
      e.preventDefault();
      let days = galleryDays(),
        next = days[(days.indexOf(key) + direction + 7) % 7];
      chooseGalleryDay(next);
      root.querySelector('[data-gallery-select="' + next + '"]')?.focus();
    });
  }
}

selectTimelineDate = function (key) {
  date = key;
  if (!galleryDays().includes(key)) timelineCenter = key;
  timelineMode = 'day';
  render();
  openGalleryDayPopup();
};

window.addEventListener('resize', () => {
  let root = document.getElementById('task-gallery');
  if (!root || page !== 'plan') return;
  root.style.setProperty(
    '--gallery-media-width',
    Math.max(280, root.getBoundingClientRect().width * 0.56 * 1.22) + 'px',
  );
});
