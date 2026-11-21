function taskMinuteStamp(value) {
  if (!value || Number.isNaN(Date.parse(value))) return '未记录';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(value));
  const part = (type) => parts.find((item) => item.type === type).value;
  return (
    part('year') +
    '-' +
    part('month') +
    '-' +
    part('day') +
    ' ' +
    part('hour') +
    ':' +
    part('minute')
  );
}

function renderCompletedTasks() {
  const list = tasks
    .filter((task) => task.done && !task.start)
    .sort((a, b) => (b.completed_at || '').localeCompare(a.completed_at || ''));
  modal(
    '<div class="modal-head"><h2>已完成任务（' +
      list.length +
      '）</h2><button onclick="closeModal()" aria-label="关闭已完成任务">✕</button></div><div class="completed-tasks-list">' +
      (list
        .map(
          (task) =>
            '<article class="preview-item"><h3>' +
            esc(task.title) +
            '</h3><dl class="completed-task-times"><div><dt>建立时间</dt><dd>' +
            taskMinuteStamp(task.created_at) +
            '</dd></div><div><dt>完成时间</dt><dd>' +
            taskMinuteStamp(task.completed_at) +
            '</dd></div><div><dt>历时</dt><dd>' +
            (task.elapsed_minutes == null ? '无法计算' : esc(task.elapsed_minutes) + ' 分钟') +
            '</dd></div></dl><div class="modal-footer"><button type="button" class="secondary" onclick="completedTaskAction(' +
            task.id +
            ',false)">重新完成</button><button type="button" class="secondary" onclick="completedTaskAction(' +
            task.id +
            ',true)">删除</button></div></article>',
        )
        .join('') || '<p class="empty">暂无已完成的灵活任务。</p>') +
      '</div>',
  );
}

async function openCompletedTasks() {
  const owner = activeAccount?.id;
  if (!owner) return login();
  try {
    await saveQueue;
    const state = await api('state');
    if (activeAccount?.id !== owner) return;
    tasks = state.tasks;
    evidence = state.evidence;
    taskTrashRecords = state.task_trash || [];
    expiredTaskRecords = state.expired_tasks || [];
    renderCompletedTasks();
  } catch (error) {
    showStudyAlert(error.message, '无法读取已完成任务');
  }
}

async function completedTaskAction(id, destroy) {
  const task = tasks.find((task) => task.id === id),
    owner = activeAccount?.id;
  if (!task || !owner) return;
  if (
    destroy &&
    !(await confirmStudyAction(
      '永久删除「' + task.title + '」及其完成记录、关联证据和回收站副本？删除后无法恢复。',
      '永久删除已完成任务？',
    ))
  )
    return;
  if (activeAccount?.id !== owner) return;
  try {
    await saveQueue;
    if (activeAccount?.id !== owner) return;
    const state = await api(
      'tasks/' + encodeURIComponent(id) + (destroy ? '/completed' : '/reopen'),
      destroy ? undefined : {},
      destroy ? 'DELETE' : 'POST',
    );
    if (activeAccount?.id !== owner) return;
    tasks = state.tasks;
    evidence = state.evidence;
    taskTrashRecords = state.task_trash || [];
    expiredTaskRecords = state.expired_tasks || [];
    const visible = !!document.querySelector('.completed-tasks-list');
    render();
    if (visible) renderCompletedTasks();
    toast(
      destroy
        ? '任务记录已永久删除'
        : expiredTaskRecords.some((r) => r.task.id === id)
          ? '原截止日期已过，已移入过期任务，请重新安排'
          : '已重新列为待办，再次完成后将更新完成时间',
    );
  } catch (error) {
    showStudyAlert(error.message, '操作未完成');
  }
}
