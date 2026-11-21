// Workspace source fragment: assembled in app/assets.mjs order.
// Shared scope is retained to preserve existing inline events and function hoisting.
let taskDrag = null,
  lastTaskChange = null,
  dragClickUntil = 0,
  toastTimer;

const fixedRepeat = (t) => t.repeat === '每周' || t.repeat === '每周六';

function schedulesIntersect(a, b) {
  if (!a.start || !b.start || a.start >= b.end || b.start >= a.end) return false;
  if (a.date === b.date) return true;
  let sameDay = new Date(a.date + 'T12:00:00').getDay() === new Date(b.date + 'T12:00:00').getDay();
  return (
    sameDay &&
    ((fixedRepeat(a) && fixedRepeat(b)) ||
      (fixedRepeat(a) && a.date <= b.date) ||
      (fixedRepeat(b) && b.date <= a.date))
  );
}

function taskConflicts(candidate, id) {
  return tasks.filter((t) => t.id !== id && schedulesIntersect(candidate, t));
}

function showTaskUndo(message) {
  clearTimeout(toastTimer);
  document.getElementById('toast-root').innerHTML =
    '<div class="toast" role="status">' +
    esc(message) +
    '<button onclick="undoTaskChange()">撤销</button></div>';
  toastTimer = setTimeout(() => (document.getElementById('toast-root').innerHTML = ''), 8000);
}

toast = function (message) {
  clearTimeout(toastTimer);
  document.getElementById('toast-root').innerHTML =
    '<div class="toast" role="status">' + esc(message) + '</div>';
  toastTimer = setTimeout(() => (document.getElementById('toast-root').innerHTML = ''), 4000);
};

function applyTaskChange(id, patch, message) {
  let i = tasks.findIndex((t) => t.id === id);
  if (i < 0) return false;
  let before = structuredClone(tasks[i]),
    after = { ...before, ...patch };
  if (JSON.stringify(before) === JSON.stringify(after)) return false;
  let scheduleChanged = ['date', 'start', 'end', 'repeat'].some((k) => Object.hasOwn(patch, k));
  if (scheduleChanged) {
    let collisions = taskConflicts(after, id);
    if (collisions.length) {
      toast('未移动：与「' + collisions.map((t) => t.title).join('」「') + '」时间冲突');
      return false;
    }
  }
  tasks[i] = after;
  if (!save()) {
    tasks[i] = before;
    return false;
  }
  lastTaskChange = { before, after, owner: dataKey('tasks') };
  render();
  showTaskUndo(message);
  return true;
}

function undoTaskChange() {
  let h = lastTaskChange;
  if (h?.kind === 'delete') return restoreDeletedTask(h.trashId);
  if (!h || h.owner !== dataKey('tasks')) return toast('当前没有可撤销的操作');
  let i = tasks.findIndex((t) => t.id === h.after.id);
  if (i < 0 || JSON.stringify(tasks[i]) !== JSON.stringify(h.after))
    return toast('任务已有新的修改，请在详情中调整');
  let changingSchedule = ['date', 'start', 'end', 'repeat'].some((k) => h.before[k] !== h.after[k]);
  if (changingSchedule && taskConflicts(h.before, h.before.id).length)
    return toast('原时段已有其他安排，无法撤销');
  tasks[i] = h.before;
  if (!save()) {
    tasks[i] = h.after;
    return;
  }
  lastTaskChange = null;
  render();
  toast('已撤销本次调整');
}

function timeString(minute) {
  return (
    String(Math.floor(minute / 60)).padStart(2, '0') + ':' + String(minute % 60).padStart(2, '0')
  );
}

function proposedStart(task, pointerMinutes, offset) {
  let duration = minutes(task.end) - minutes(task.start);
  return Math.max(
    0,
    Math.min(
      Math.floor((1439 - duration) / 15) * 15,
      Math.round((pointerMinutes - offset) / 15) * 15,
    ),
  );
}

function cleanTaskDrag() {
  if (!taskDrag) return;
  cancelAnimationFrame(taskDrag.frame);
  resetShredDeleteZone();
  taskDrag.source?.classList.remove('drag-source');
  taskDrag.ghost?.remove();
  taskDrag.slot?.remove();
  document.querySelectorAll('.drop-active').forEach((n) => n.classList.remove('drop-active'));
  document.body.classList.remove('dragging-body');
  taskDrag = null;
}

function updateTaskDrag() {
  let d = taskDrag;
  if (!d?.active) return;
  let hit = document.elementFromPoint(d.x, d.y),
    zone = hit?.closest('[data-drop-q]');
  document
    .querySelectorAll('.drop-active')
    .forEach((n) => n.classList.toggle('drop-active', n === zone));
  d.drop = zone ? { q: Number(zone.dataset.dropQ) } : null;
  d.ghost.style.left = Math.min(d.x + 15, Math.max(10, innerWidth - 290)) + 'px';
  d.ghost.style.top = Math.max(10, Math.min(d.y + 15, innerHeight - 85)) + 'px';
  let sc = document.getElementById('day-scroll'),
    canvas = sc?.querySelector('.hours-canvas'),
    box = canvas?.getBoundingClientRect(),
    scBox = sc?.getBoundingClientRect();
  let overTime =
    canvas &&
    scBox &&
    d.x >= box.left &&
    d.x <= box.right &&
    d.y >= scBox.top &&
    d.y <= scBox.bottom;
  if (!zone && overTime && d.task.start && !demoPreview) {
    let start = proposedStart(d.task, d.y - box.top, d.offset),
      duration = minutes(d.task.end) - minutes(d.task.start);
    d.drop = { start: timeString(start), end: timeString(start + duration) };
    if (!d.slot) {
      d.slot = document.createElement('div');
      d.slot.className = 'drag-slot';
      canvas.appendChild(d.slot);
    }
    d.slot.style.top = start + 'px';
    d.slot.style.height = Math.max(23, duration) + 'px';
    d.slot.textContent = d.drop.start + ' – ' + d.drop.end;
    d.slot.style.display = 'block';
    d.ghost.querySelector('small').textContent = '松开调整为 ' + d.drop.start + ' – ' + d.drop.end;
  } else {
    if (d.slot) d.slot.style.display = 'none';
    d.ghost.querySelector('small').textContent = zone
      ? '松开移入「' + labels[Number(zone.dataset.dropQ)] + '」'
      : '拖到时间轴或四象限，松开保存';
  }
  updateShredDeleteZone(d, !!zone);
}

function dragAutoScroll() {
  let d = taskDrag;
  if (!d?.active) return;
  let sc = document.getElementById('day-scroll');
  if (sc && d.task.start) {
    let b = sc.getBoundingClientRect();
    if (d.x >= b.left && d.x <= b.right && d.y >= b.top && d.y <= b.bottom) {
      let delta = d.y < b.top + 40 ? -9 : d.y > b.bottom - 40 ? 9 : 0;
      if (delta) {
        sc.scrollTop += delta;
        updateTaskDrag();
      }
    }
  }
  d.frame = requestAnimationFrame(dragAutoScroll);
}

document.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || taskDrag || e.target.closest('select,input,textarea,.quadrant-picker'))
    return;
  let source = e.target.closest('[data-task-id]');
  if (!source) return;
  if (e.target.closest('.check')) return;
  if (e.pointerType === 'touch' && !e.target.closest('.drag-handle,.scheduled-event,.mini-task'))
    return;
  let task = tasks.find((t) => t.id === Number(source.dataset.taskId));
  if (!task) return;
  let box = source.getBoundingClientRect();
  taskDrag = {
    id: e.pointerId,
    task: structuredClone(task),
    source,
    x: e.clientX,
    y: e.clientY,
    originX: e.clientX,
    originY: e.clientY,
    offset: source.classList.contains('scheduled-event')
      ? Math.max(0, Math.min(minutes(task.end) - minutes(task.start), e.clientY - box.top))
      : 0,
    active: false,
    frame: 0,
  };
});

document.addEventListener(
  'pointermove',
  (e) => {
    let d = taskDrag;
    if (!d || d.id !== e.pointerId) return;
    d.x = e.clientX;
    d.y = e.clientY;
    if (!d.active) {
      if (Math.hypot(d.x - d.originX, d.y - d.originY) < 6) return;
      d.active = true;
      d.source.classList.add('drag-source');
      document.body.classList.add('dragging-body');
      d.ghost = document.createElement('div');
      d.ghost.className = 'drag-ghost q-tone-' + d.task.q;
      d.ghost.innerHTML = '<b>' + esc(d.task.title) + '</b><small></small>';
      document.body.appendChild(d.ghost);
      d.frame = requestAnimationFrame(dragAutoScroll);
    }
    e.preventDefault();
    updateTaskDrag();
  },
  { passive: false },
);

document.addEventListener('pointerup', (e) => {
  let d = taskDrag;
  if (!d || d.id !== e.pointerId) return;
  if (!d.active) {
    cleanTaskDrag();
    return;
  }
  d.x = e.clientX;
  d.y = e.clientY;
  updateTaskDrag();
  let target = d.drop,
    id = d.task.id,
    repeating = fixedRepeat(d.task);
  dragClickUntil = Date.now() + 350;
  cleanTaskDrag();
  if (!target) return toast('已取消移动，任务保持原状');
  if (target.shred) return shredTask(id, d.source, d.shredBox);
  if (target.q !== undefined)
    return applyTaskChange(id, { q: target.q }, '已移入「' + labels[target.q] + '」');
  return applyTaskChange(
    id,
    target,
    (repeating ? '已调整每周重复任务时间：' : '已调整时间：') + target.start + ' – ' + target.end,
  );
});

document.addEventListener('pointercancel', cleanTaskDrag);

window.addEventListener('blur', cleanTaskDrag);

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && taskDrag) {
    cleanTaskDrag();
    dragClickUntil = Date.now() + 350;
    toast('已取消移动');
  }
});

document.addEventListener(
  'click',
  (e) => {
    if (Date.now() < dragClickUntil) {
      e.preventDefault();
      e.stopImmediatePropagation();
    } else if (e.target.closest('.drag-handle')) {
      let row = e.target.closest('[data-task-id]');
      if (row) detail(Number(row.dataset.taskId));
    }
  },
  true,
);
