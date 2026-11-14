// Workspace source fragment: assembled in app/assets.mjs order.
// Shared scope is retained to preserve existing inline events and function hoisting.
function quadHTML() {
  return (
    '<div class="quadrants">' +
    labels
      .map((l, q) => {
        let a = tasks
          .filter((t) => t.q === q)
          .sort(
            (a, b) =>
              (a.ddl || a.date).localeCompare(b.ddl || b.date) ||
              (b.duration || 0) - (a.duration || 0),
          );
        let open = a.filter((t) => !t.done),
          ddl = open.map((t) => t.ddl || t.date).sort()[0];
        return (
          '<div class="quad q' +
          q +
          '" data-drop-q="' +
          q +
          '"><div class="q-label"><span class="q-mark"></span>' +
          l +
          '<span class="q-index">0' +
          (q + 1) +
          '</span></div><div class="q-count">' +
          open.length +
          '<small>项待办</small></div><div class="q-task-list">' +
          (a
            .map(
              (t) =>
                '<button class="mini-task ' +
                (t.done ? 'done' : '') +
                '" data-task-id="' +
                t.id +
                '" title="拖动可调整象限，点击查看任务" onclick="detail(' +
                t.id +
                ')"><span class="q-task-dot">' +
                (t.done ? '✓' : '↗') +
                '</span><span>' +
                esc(t.title) +
                '</span></button>',
            )
            .join('') || '<p class="q-empty">给重要的事情，留一点空间。</p>') +
          '</div><div class="q-ddl">最近 DDL · ' +
          (ddl ? ddl.slice(5).replace('-', ' / ') : '暂无待办') +
          '</div></div>'
        );
      })
      .join('') +
    '</div>'
  );
}

function render() {
  document
    .querySelectorAll('[data-page]')
    .forEach((b) => b.classList.toggle('active', b.dataset.page === page));
  return StudyPilotRouter.render(page);
}

function weekHTML() {
  let d = new Date(date + 'T12:00:00');
  let day = d.getDay();
  d.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
  return (
    '<div class="week">' +
    Array.from({ length: 7 }, (_, i) => {
      let x = new Date(d);
      x.setDate(x.getDate() + i);
      let key = x.toISOString().slice(0, 10);
      return (
        '<button class="day ' +
        (key === date ? 'active' : '') +
        '" onclick="date=\'' +
        key +
        '\';render()">' +
        ['周一', '周二', '周三', '周四', '周五', '周六', '周日'][i] +
        '<b>' +
        x.getDate() +
        '</b><span class="dot" style="opacity:' +
        (tasks.some((t) => t.date === key) ? 1 : 0) +
        '"></span></button>'
      );
    }).join('') +
    '</div>'
  );
}

function shiftDay(n) {
  let d = new Date(date + 'T12:00:00');
  d.setDate(d.getDate() + n);
  date = d.toISOString().slice(0, 10);
  render();
}

function detail(id) {
  let t = tasks.find((t) => t.id === id);
  modal(
    '<div class="modal-head"><h2>' +
      esc(t.title) +
      '</h2><button onclick="closeModal()">✕</button></div><p>' +
      pill(t.q) +
      '</p><div class="form-grid"><div class="preview-item">安排日期<br><b>' +
      t.date +
      '</b></div><div class="preview-item">' +
      (t.start ? '固定时间<br><b>' + t.start + ' – ' + t.end : '截止日期<br><b>' + t.ddl) +
      '</b></div></div><div class="preview-item">' +
      (t.start
        ? '地点：' + esc(t.location) + '<br>重复：' + esc(t.repeat)
        : '预计时长：' +
          t.duration +
          ' 分钟<br>建议时间：' +
          esc(t.suggest) +
          '<br>能力关联：' +
          esc(abilities[t.ability])) +
      '</div><label class="tiny">修改四象限分类</label>' +
      qSelect(t) +
      '<div class="modal-footer"><button class="secondary" onclick="editTask(' +
      id +
      ')">编辑任务</button><button class="secondary" onclick="removeTask(' +
      id +
      ')">删除任务</button><button class="primary" onclick="completeFromDetail(' +
      id +
      ')">' +
      (t.done ? '标记为未完成' : '标记为已完成') +
      '</button></div>',
  );
}

function removeTask(id) {
  tasks = tasks.filter((t) => t.id !== id);
  save();
  render();
  closeModal();
  toast('任务已删除');
}

function matrix() {
  document.getElementById('content').innerHTML =
    head('把精力，<br>放在值得的事上。', '在四个象限之间，找到自己的行动顺序。', '') +
    '<section class="editorial-quadrants">' +
    quadHTML() +
    '</section>';
}
