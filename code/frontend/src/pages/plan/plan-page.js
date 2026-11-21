function exampleTasks() {
  let stamp = -100;
  return [
    {
      id: stamp,
      title: '课程学习 · 数据结构',
      date: today,
      start: '08:30',
      end: '10:00',
      location: '教学楼 A302',
      repeat: '不重复',
      q: 1,
      done: false,
    },
    {
      id: stamp - 1,
      title: '科研小组 · 阶段汇报',
      date: today,
      start: '14:00',
      end: '15:30',
      location: '图书馆研讨室',
      repeat: '不重复',
      q: 0,
      done: false,
    },
    {
      id: stamp - 2,
      title: '提交实验报告',
      date: today,
      ddl: today,
      duration: 90,
      suggest: '10:30 – 12:00',
      ability: 2,
      standard: '补齐对照实验与误差分析',
      q: 0,
      done: false,
    },
    {
      id: stamp - 3,
      title: '阅读两篇相关文献',
      date: today,
      ddl: addDays(today, 3),
      duration: 60,
      suggest: '晚间专注时段',
      ability: 4,
      standard: '整理研究问题与引用出处',
      q: 1,
      done: false,
    },
    {
      id: stamp - 4,
      title: '学院事务 · 材料核对',
      date: addDays(today, 1),
      start: '12:30',
      end: '13:00',
      location: '线上',
      repeat: '不重复',
      q: 2,
      done: false,
    },
    {
      id: stamp - 5,
      title: '整理资料与桌面',
      date: addDays(today, 2),
      start: '17:00',
      end: '17:45',
      location: '自习室',
      repeat: '不重复',
      q: 3,
      done: false,
    },
    {
      id: stamp - 6,
      title: '研究选题 · 导师交流',
      date: addDays(today, -1),
      start: '10:00',
      end: '11:00',
      location: '办公室',
      repeat: '不重复',
      q: 1,
      done: false,
    },
  ];
}

function timelineTasks() {
  if (demoPreview) return exampleTasks();
  const expiryDay = taskExpiryDay();
  return tasks.filter((task) => !taskExpired(task, expiryDay));
}

function tasksOn(key) {
  return timelineTasks().filter(
    (t) =>
      t.date === key ||
      ((t.repeat === '每周' || t.repeat === '每周六') &&
        t.date < key &&
        new Date(t.date + 'T12:00:00').getDay() === new Date(key + 'T12:00:00').getDay()),
  );
}

function minutes(t) {
  let [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

function legendHTML() {
  return (
    '<div class="time-legend">' +
    labels.map((x, q) => '<span class="q-tone-' + q + '"><i></i>' + x + '</span>').join('') +
    '</div>'
  );
}

function showWeek() {
  timelineMode = 'week';
  render();
}

function centerToday() {
  timelineCenter = today;
  date = today;
  timelineMode = 'week';
  render();
}

function moveRange(n) {
  timelineCenter = addDays(timelineCenter, n);
  render();
}

function selectTimelineDate(key) {
  date = key;
  timelineMode = 'day';
  render();
  requestAnimationFrame(() => {
    let rail = document.getElementById('date-rail');
    if (rail) {
      let selected = rail.querySelector('.selected');
      if (selected)
        rail.scrollLeft =
          selected.offsetLeft - rail.offsetLeft - (rail.clientWidth - selected.offsetWidth) / 2;
    }
    let sc = document.getElementById('day-scroll');
    let fixed = tasksOn(date).filter((t) => t.start);
    let start = fixed.length ? Math.min(...fixed.map((t) => minutes(t.start))) : 8 * 60;
    if (sc) sc.scrollTop = Math.max(0, start - 60);
    document.getElementById('day-focus-title')?.focus({ preventScroll: true });
  });
}

function toggleExamplePreview() {
  demoPreview = !demoPreview;
  timelineCenter = today;
  date = today;
  timelineMode = 'week';
  render();
}

function inspectTimelineTask(id) {
  if (!demoPreview) return detail(id);
  let t = exampleTasks().find((x) => x.id === id);
  modal(
    '<div class="modal-head"><h2>' +
      esc(t.title) +
      '</h2><button onclick="closeModal()">✕</button></div><p>' +
      pill(t.q) +
      '</p><p>' +
      (t.start
        ? t.date + ' ' + t.start + ' – ' + t.end
        : '预计 ' + t.duration + ' 分钟 · ' + esc(t.standard)) +
      '</p><p class="tiny">案例预览，尚未加入你的计划。</p><div class="modal-footer"><button class="primary" onclick="useExample(' +
      id +
      ')">添加到我的计划</button></div>',
  );
}

function useExample(id) {
  let t = exampleTasks().find((x) => x.id === id);
  if (tasks.some((x) => x.exampleKey === t.id && x.date === t.date)) return toast('该案例已添加');
  parsed = [{ ...t, id: Date.now(), exampleKey: t.id }];
  demoPreview = false;
  timelineMode = 'day';
  commitParsed();
}

function exampleHTML() {
  let list = exampleTasks().slice(0, 4);
  return (
    '<section class="example-section"><div class="example-header"><h3>从一个小任务开始</h3><button class="tiny" onclick="toggleExamplePreview()">' +
    (demoPreview ? '退出案例预览' : '预览时间轴案例 →') +
    '</button></div><div class="example-list">' +
    list
      .map(
        (t) =>
          '<div class="example-item"><b>' +
          esc(t.title) +
          '</b><p>' +
          labels[t.q] +
          ' · ' +
          (t.start ? t.start + ' – ' + t.end : t.duration + ' 分钟') +
          '</p><button onclick="useExample(' +
          t.id +
          ')">＋ 添加此案例</button></div>',
      )
      .join('') +
    '</div></section>'
  );
}

function dateRailHTML() {
  return (
    '<div class="date-rail" id="date-rail" tabindex="0" aria-label="七天时间轴，可横向滚动">' +
    Array.from({ length: 7 }, (_, i) => {
      let key = addDays(timelineCenter, i - 3),
        d = new Date(key + 'T12:00:00'),
        a = tasksOn(key),
        fixed = a.filter((t) => t.start);
      return (
        '<button class="date-card ' +
        (key === today ? 'is-today ' : '') +
        (timelineMode === 'day' && key === date ? 'selected' : '') +
        '" aria-label="' +
        key +
        '，' +
        a.length +
        '项任务，展开当天安排" aria-pressed="' +
        (timelineMode === 'day' && key === date) +
        '" onclick="selectTimelineDate(\'' +
        key +
        '\')"><span class="weekday">' +
        (key === today
          ? '今天'
          : ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()]) +
        '</span><strong>' +
        d.getDate() +
        '</strong><span class="day-count">' +
        a.length +
        ' 项任务</span><div class="mini-day">' +
        fixed
          .map(
            (t) =>
              '<span class="mini-event q-tone-' +
              t.q +
              '" title="' +
              esc(t.title) +
              '" style="top:' +
              minutes(t.start) / 7.5 +
              'px;height:' +
              Math.max(5, (minutes(t.end) - minutes(t.start)) / 7.5) +
              'px"></span>',
          )
          .join('') +
        '</div><div class="mini-caption">' +
        (fixed.length ? fixed.length + ' 项固定安排' : '自由安排') +
        '</div></button>'
      );
    }).join('') +
    '</div>'
  );
}

function layoutEvents(list) {
  let sorted = list
    .slice()
    .sort((a, b) => minutes(a.start) - minutes(b.start) || minutes(b.end) - minutes(a.end));
  let out = [],
    group = [],
    until = -1;
  function finish() {
    let ends = [];
    for (let t of group) {
      let lane = ends.findIndex((x) => x <= minutes(t.start));
      if (lane < 0) lane = ends.length;
      ends[lane] = minutes(t.end);
      out.push({ ...t, lane, groupId: out.length - group.length });
    }
    let members = out.slice(-group.length);
    members.forEach((t) => (t.columns = ends.length));
    group = [];
  }
  for (let t of sorted) {
    if (group.length && minutes(t.start) >= until) {
      finish();
      until = -1;
    }
    group.push(t);
    until = Math.max(until, minutes(t.end));
  }
  if (group.length) finish();
  return out;
}

function dayFocusHTML() {
  let fixed = layoutEvents(tasksOn(date).filter((t) => t.start));
  return (
    '<div class="day-focus"><div class="day-focus-head"><b id="day-focus-title" tabindex="-1">' +
    date.replaceAll('-', ' / ') +
    ' · 当日安排</b></div><div class="day-scroll" id="day-scroll" data-date="' +
    date +
    '" tabindex="0" aria-label="当天24小时时间轴，上下滚动查看"><div class="hours-canvas">' +
    Array.from(
      { length: 24 },
      (_, h) =>
        '<div class="hour-line" style="top:' +
        h * 60 +
        'px"><span>' +
        String(h).padStart(2, '0') +
        ':00</span></div>',
    ).join('') +
    fixed
      .map(
        (t) =>
          '<button ' +
          (demoPreview ? '' : 'data-task-id="' + t.id + '"') +
          ' class="scheduled-event q-tone-' +
          t.q +
          (t.done ? ' is-done' : '') +
          '" aria-label="' +
          esc(t.title) +
          ' ' +
          t.start +
          '至' +
          t.end +
          ' ' +
          labels[t.q] +
          '" style="top:' +
          minutes(t.start) +
          'px;height:' +
          Math.max(23, minutes(t.end) - minutes(t.start)) +
          'px;left:calc(' +
          (t.lane / t.columns) * 100 +
          '% + 3px);width:calc(' +
          100 / t.columns +
          '% - 7px)" onclick="inspectTimelineTask(' +
          t.id +
          ')"><b>' +
          esc(t.title) +
          '</b><small>' +
          t.start +
          ' – ' +
          t.end +
          '</small><small>' +
          esc(t.location || '') +
          '</small></button>',
      )
      .join('') +
    (!fixed.length
      ? '<div class="day-empty">这一天还没有固定安排。点击圆形加号即可添加日程。</div>'
      : '') +
    '</div></div></div>'
  );
}

function flexibleHTML() {
  let list = tasksOn(date)
    .filter((t) => !t.start)
    .sort(
      (a, b) =>
        (a.ddl || a.date).localeCompare(b.ddl || b.date) || a.q - b.q || b.duration - a.duration,
    );
  return (
    '<div class="tasks shredder" id="task-shredder"><div class="section-label"><span>☷　灵活待办 <small>' +
    date.slice(5).replace('-', ' / ') +
    '</small></span></div><div class="shred-list" id="shred-list">' +
    list
      .map(
        (t) =>
          '<div class="task-row ' +
          (t.done ? 'done' : '') +
          '" ' +
          (demoPreview ? '' : 'data-task-id="' + t.id + '"') +
          '>' +
          (demoPreview
            ? '<span class="pill">案例</span>'
            : '<button class="check" aria-label="切换完成状态" onclick="toggle(' +
              t.id +
              ')">' +
              (t.done ? '✓' : '') +
              '</button>') +
          (!demoPreview
            ? '<button class="drag-handle" aria-label="拖动任务，也可点击后在详情中编辑" title="拖到右侧改分类，拖到底端松手删除">⠿</button>'
            : '') +
          '<div class="task-info"><button class="task-name" style="padding:0;text-align:left" onclick="inspectTimelineTask(' +
          t.id +
          ')">' +
          esc(t.title) +
          '</button><div class="task-meta">⚑ ' +
          esc(t.ddl || t.date) +
          '　·　' +
          t.duration +
          ' 分钟</div><div class="task-end">' +
          esc(t.suggest) +
          ' · ' +
          esc(abilities[t.ability]) +
          '</div></div>' +
          (demoPreview ? pill(t.q) : qSelect(t)) +
          '</div>',
      )
      .join('') +
    (!list.length ? '<div class="empty">还没有灵活待办，点击圆形加号开始安排。</div>' : '') +
    '</div>' +
    shredDropHTML() +
    '<div class="shred-footer"><button class="tiny" onclick="showDeletedTasks()">最近删除</button></div></div>'
  );
}

function bindTimelineScroll() {
  let rail = document.getElementById('date-rail');
  if (rail) {
    rail.addEventListener(
      'wheel',
      (e) => {
        if (e.ctrlKey || e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
        let room =
          e.deltaY > 0
            ? rail.scrollLeft < rail.scrollWidth - rail.clientWidth - 1
            : rail.scrollLeft > 0;
        if (room) {
          e.preventDefault();
          rail.scrollLeft += e.deltaY;
        }
      },
      { passive: false },
    );
    if (timelineMode === 'week')
      requestAnimationFrame(() => {
        let c = rail.children[3];
        if (c)
          rail.scrollLeft = c.offsetLeft - rail.offsetLeft - (rail.clientWidth - c.offsetWidth) / 2;
      });
  }
}

function renderPlan() {
  clearTimeout(galleryHoverTimer);
  let previous = document.getElementById('day-scroll'),
    oldDate = previous?.dataset?.date,
    oldScroll = previous?.scrollTop;
  let days = galleryDays();
  if (!days.includes(date)) date = timelineCenter;
  timelineMode = 'day';
  let start = days[0],
    end = days[6];
  document.getElementById('content').innerHTML =
    '<div class="heading plan-heading"><div><h1>' +
    esc(currentMotto()) +
    '</h1></div><div style="display:flex;gap:9px"><button class="secondary calendar-entry" onclick="calendar()" aria-label="打开日历" title="日历"><svg class="ui-symbol" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4m10-4v4M3 11h18m-13 4h2m4 0h2m-8 3h2"/></svg></button></div></div><div class="workspace gallery-workspace"><section class="panel gallery-main"><div class="time-toolbar"><div><h2>任务画廊 ' +
    (demoPreview ? '<span class="preview-label">案例预览</span>' : '') +
    '</h2></div><div class="time-tools"><button class="circle-btn" aria-label="前七天" onclick="moveRange(-7)">' +
    uiSymbol('previous') +
    '</button><button class="tiny" onclick="centerToday()">今天</button><button class="circle-btn" aria-label="后七天" onclick="moveRange(7)">' +
    uiSymbol('next') +
    '</button></div></div><div class="gallery-range"><span>' +
    start.replaceAll('-', ' / ') +
    ' — ' +
    end.replaceAll('-', ' / ') +
    '</span><span>悬停展开 · 点击查看当天</span></div>' +
    taskGalleryHTML() +
    '</section><aside class="right-task-column" id="right-task-column" aria-label="所选日期的灵活任务">' +
    rightTaskColumnHTML() +
    '</aside></div>';
  bindTaskGallery();
  let topDate = document.querySelector('.date-top');
  if (topDate)
    topDate.textContent = new Date().toLocaleDateString('zh-CN', {
      month: 'long',
      day: 'numeric',
      weekday: 'long',
    });
}
