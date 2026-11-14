// Workspace source fragment: assembled in app/assets.mjs order.
// Shared scope is retained to preserve existing inline events and function hoisting.
function editTask(id) {
  let t = tasks.find((x) => x.id === id);
  if (!t) return toast('任务不存在');
  openImport('manual');
  let form = document.querySelector('#modal-root form');
  form.dataset.editId = String(id);
  document.querySelector('#modal-root h2').textContent = '编辑任务';
  let fields = {
    'f-title': t.title,
    'f-type': t.start ? 'fixed' : 'flex',
    'f-date': t.date,
    'f-start': t.start || '09:00',
    'f-end': t.end || '10:00',
    'f-location': t.location || '',
    'f-repeat': t.repeat || '不重复',
    'f-ddl': t.ddl || t.date,
    'f-duration': t.duration || 60,
    'f-suggest': t.suggest || '',
    'f-ability': t.ability ?? 0,
    'f-standard': t.standard || '',
    'f-q': t.q,
  };
  for (let [key, value] of Object.entries(fields)) {
    let field = document.getElementById(key);
    if (!field) continue;
    if (key === 'f-repeat' && ![...field.options].some((o) => o.value === value)) {
      let option = document.createElement('option');
      option.value = value;
      option.textContent = value;
      field.appendChild(option);
    }
    field.value = value;
  }
  document.getElementById('fixed-fields').classList.toggle('hidden', !t.start);
  document.getElementById('flex-fields').classList.toggle('hidden', !!t.start);
  form.querySelector('button[type="submit"]').textContent = '保存修改';
  document.getElementById('f-title').focus();
}

const createTaskSubmit = manualSubmit;

manualSubmit = function (e) {
  let id = Number(e.target?.dataset?.editId);
  if (!id) return createTaskSubmit(e);
  e.preventDefault();
  let index = tasks.findIndex((t) => t.id === id);
  if (index < 0) return toast('任务已不存在，请重新打开');
  let fixed = val('f-type') === 'fixed',
    title = val('f-title').trim(),
    dt = val('f-date');
  if (!title || !dt) return toast('请补全任务名称与日期');
  if (fixed && val('f-start') >= val('f-end')) return toast('结束时间需晚于开始时间');
  if (!fixed && (!Number.isFinite(+val('f-duration')) || +val('f-duration') <= 0))
    return toast('预计时长需大于零');
  let old = tasks[index],
    candidate = {
      id: old.id,
      ...(old.description ? { description: old.description } : {}),
      ...(old.agent_run_id
        ? { agent_run_id: old.agent_run_id, proposal_index: old.proposal_index }
        : {}),
      title,
      date: dt,
      q: +val('f-q'),
      done: old.done,
      ...(old.exampleKey !== undefined ? { exampleKey: old.exampleKey } : {}),
      ...(old.source ? { source: old.source } : {}),
      ...(fixed
        ? {
            start: val('f-start'),
            end: val('f-end'),
            location: val('f-location').trim(),
            repeat: val('f-repeat'),
          }
        : {
            ddl: val('f-ddl') || dt,
            duration: +val('f-duration'),
            suggest: val('f-suggest').trim() || '自行安排',
            ability: +val('f-ability'),
            standard: ''.trim() || '完成任务并检查结果',
          }),
    };
  let collisions = taskConflicts(candidate, id);
  if (collisions.length) {
    let form = e.target,
      note = form.querySelector('.edit-conflict');
    if (!note) {
      note = document.createElement('p');
      note.className = 'notice edit-conflict';
      note.setAttribute('role', 'alert');
      form.prepend(note);
    }
    note.textContent =
      '该时段与「' +
      collisions.map((t) => t.title).join('」「') +
      '」重叠，请调整开始或结束时间后保存。';
    return;
  }
  tasks[index] = candidate;
  if (!save()) {
    tasks[index] = old;
    return;
  }
  date = dt;
  timelineCenter = dt;
  timelineMode = 'day';
  closeModal();
  render();
  toast('任务已更新，时间轴与四象限已同步');
};
