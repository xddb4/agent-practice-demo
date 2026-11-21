function taskDetailBodyHTML(task) {
  return (
    '<div class="form-grid"><div class="preview-item">安排日期<br><b>' +
    esc(task.date || '未设置') +
    '</b></div><div class="preview-item">' +
    (task.start
      ? '固定时间<br><b>' + esc(task.start + ' – ' + task.end)
      : '截止日期<br><b>' + esc(task.ddl || '未设置')) +
    '</b></div></div><div class="preview-item">' +
    (task.start
      ? '地点：' + esc(task.location || '未设置') + '<br>重复：' + esc(task.repeat || '不重复')
      : '预计时长：' +
        (task.duration ? esc(task.duration) + ' 分钟' : '未设置') +
        '<br>建议时间：' +
        esc(task.suggest || '未设置') +
        '<br>能力关联：' +
        esc(abilities[task.ability] || '未判断')) +
    '</div>' +
    (task.description
      ? '<section class="preview-item"><b>执行说明</b><p class="task-description">' +
        esc(task.description) +
        '</p></section>'
      : '') +
    '<div class="task-detail-quadrant">' +
    pill(task.q) +
    '</div>'
  );
}

detail = function (id) {
  const task = tasks.find((item) => item.id === id);
  if (!task) return toast('任务不存在');
  modal(
    '<div class="modal-head"><h2>' +
      esc(task.title) +
      '</h2><button onclick="closeModal()" aria-label="关闭任务详情">✕</button></div>' +
      taskDetailBodyHTML(task) +
      '<div class="modal-footer"><button class="secondary" onclick="editTask(' +
      id +
      ')">编辑任务</button><button class="secondary" onclick="removeTask(' +
      id +
      ')">删除任务</button><button class="primary" onclick="completeFromDetail(' +
      id +
      ')">' +
      (task.done ? '标记为未完成' : '标记为已完成') +
      '</button></div>',
  );
};
