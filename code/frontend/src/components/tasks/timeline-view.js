// 日计划、四象限和推荐统一读取tasks，不另存四套任务数组。
const tasksOnWithStoredDates = typeof tasksOn === 'function' ? tasksOn : () => [];
tasksOn = function (key) {
  const direct = tasksOnWithStoredDates(key),
    ids = new Set(direct.map((task) => task.id));
  return direct.concat(
    timelineTasks().filter(
      (task) =>
        !task.start &&
        !ids.has(task.id) &&
        (task.suggested_sessions || []).some((slot) => slot.start?.slice(0, 10) === key),
    ),
  );
};
function nextWeekCourseGhosts(list, key) {
  const nextDate = addDays(key, 7);
  return list
    .filter((task) => {
      if (task.date !== nextDate || !task.start || !task.end) return false;
      const repeat = /^第 (\d+) 周 · (单周|双周)$/.exec(task.repeat || '');
      return repeat && Number(repeat[1]) - 1 >= (task.course_from_week ?? 1);
    })
    .map((task) => ({ ...task, ghost: true }));
}
function timelineHoursHTML() {
  return Array.from(
    { length: 24 },
    (_, hour) =>
      '<div class="hour-line" style="top:' +
      hour * 60 +
      'px"><span>' +
      String(hour).padStart(2, '0') +
      ':00</span></div>',
  ).join('');
}
function timelineBlocksHTML(events, interactive = false) {
  return layoutEvents(events)
    .map((task) => {
      const clickable = interactive && !task.ghost;
      const duration = minutes(task.end) - minutes(task.start);
      const tag = clickable ? 'button' : 'div';
      const name =
        task.title +
        ' ' +
        task.start +
        '至' +
        task.end +
        (task.ghost ? ' · 本周不上课，下周上课' : '');
      const style =
        'top:' +
        minutes(task.start) +
        'px;height:' +
        Math.max(23, duration) +
        'px;left:calc(' +
        (task.lane / task.columns) * 100 +
        '% + 3px);width:calc(' +
        100 / task.columns +
        '% - 7px)';
      return (
        '<' +
        tag +
        ' class="scheduled-event q-tone-' +
        task.q +
        (task.done && !task.ghost ? ' is-done' : '') +
        (task.ghost ? ' course-ghost' : '') +
        (duration < 60 ? ' is-compact' : '') +
        '" title="' +
        esc(name) +
        '" ' +
        (clickable
          ? (!demoPreview ? 'data-task-id="' + task.id + '" ' : '') +
            'onclick="inspectTimelineTask(' +
            task.id +
            ')" aria-label="' +
            esc(name) +
            '" '
          : '') +
        'style="' +
        style +
        '"><b>' +
        esc(task.title) +
        '</b><small>' +
        esc(task.start + ' – ' + task.end) +
        '</small><small>' +
        esc(task.ghost ? '本周不上课 · 下周上课' : task.location || '') +
        '</small></' +
        tag +
        '>'
      );
    })
    .join('');
}
if (typeof dayFocusHTML === 'function')
  dayFocusHTML = function () {
    const actual = tasksOn(date).filter((task) => task.start);
    const ghosts = demoPreview ? [] : nextWeekCourseGhosts(tasks, date);
    const blocks = timelineBlocksHTML(actual.concat(ghosts), true);
    return (
      '<div class="day-focus"><div class="day-focus-head"><b id="day-focus-title" tabindex="-1">' +
      esc(date.replaceAll('-', ' / ')) +
      ' · 当日安排</b></div><div class="day-scroll" id="day-scroll" data-date="' +
      esc(date) +
      '" tabindex="0" aria-label="当天24小时时间轴，上下滚动查看"><div class="hours-canvas">' +
      timelineHoursHTML() +
      blocks +
      (!blocks
        ? '<div class="day-empty">这一天还没有固定安排。点击圆形加号即可添加日程。</div>'
        : '') +
      '</div></div></div>'
    );
  };
