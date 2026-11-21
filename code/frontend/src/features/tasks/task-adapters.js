const baseMapItem = mapItem;

mapItem = function (x, i) {
  const t = baseMapItem(x, i);
  if (!x.start && !x.date && !x.deadline) t.date = '';
  return t;
};

const baseCommitParsed = commitParsed;

commitParsed = function () {
  if (
    parsed.some(
      (t) =>
        !t.title?.trim() ||
        !/^\d{4}-\d{2}-\d{2}$/.test(t.date) ||
        (t.start && (!t.end || t.start >= t.end)),
    )
  )
    return toast('请补充每项的计划日期，并检查起止时间');
  return baseCommitParsed();
};

const baseTrash = persistTasksAndTrash;

persistTasksAndTrash = function (nextTasks, nextTrash) {
  const previousTasks = tasks,
    previousTrash = taskTrashRecords;
  tasks = nextTasks;
  taskTrashRecords = nextTrash.slice(0, 200);
  if (!save()) {
    tasks = previousTasks;
    taskTrashRecords = previousTrash;
    return false;
  }
  return true;
};
taskTrash = function () {
  return structuredClone(taskTrashRecords);
};

const baseImportCourses = importReviewedCourses;

importReviewedCourses = function () {
  if (courseRows.some((x) => !Number.isInteger(x.day) || x.day < 1 || x.day > 7))
    return toast('请为每门课程选择已核实的星期');
  return baseImportCourses();
};

const originalFlexibleHTML = flexibleHTML;

flexibleHTML = function () {
  const count = tasksOn(date).filter((task) => !task.start).length;
  return originalFlexibleHTML()
    .replace(
      /(<div class="section-label"><span>)[\s\S]*?(<\/span>)/,
      (_, open, close) => open + '灵活代办：' + count + '条' + close,
    )
    .replace(/null 分钟/g, '时长未设置');
};

centerToday = function () {
  clearTimeout(galleryHoverTimer);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const part = (type) => parts.find((p) => p.type === type).value;
  const key = part('year') + '-' + part('month') + '-' + part('day');
  date = key;
  timelineCenter = key;
  timelineMode = 'day';
  galleryTimelineExpanded = true;
  render();
  // 重绘时鼠标可能恰好位于其他日期卡片上，避免悬停立即覆盖今天。
  const holdUntil = Date.now() + 500;
  document.getElementById('task-gallery')?.addEventListener(
    'pointerenter',
    (event) => {
      if (Date.now() < holdUntil) event.stopPropagation();
    },
    true,
  );
};

const renderPlanWithOriginalToolbar = renderPlan;

renderPlan = function () {
  renderPlanWithOriginalToolbar();
  const button = document.querySelector('.time-tools button[onclick="centerToday()"]');
  if (button) {
    button.textContent = '回到今天';
    button.setAttribute('aria-label', '回到今天');
  }
};

const contentObserver = new MutationObserver(() => {
  document.querySelectorAll('.notice').forEach((n) => {
    if (n.textContent.includes('原型使用规则演示'))
      n.textContent = '识别通过 Agent 生成候选，请核对后确认保存。';
  });
  const label = document.querySelector('label[for="e-file"]');
  if (label) label.textContent = '作品附件';
});

contentObserver.observe(document.getElementById('content'), { childList: true, subtree: true });
