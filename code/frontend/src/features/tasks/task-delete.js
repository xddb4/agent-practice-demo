// Workspace source fragment: assembled in app/assets.mjs order.
// Shared scope is retained to preserve existing inline events and function hoisting.
let shredJob = null,
  fabDrag = null,
  fabClickSuppressed = false;

function boundedFab(x, y, w = innerWidth, h = innerHeight, size = 60) {
  return {
    x: Math.max(12, Math.min(Math.max(12, w - size - 12), x)),
    y: Math.max(12, Math.min(Math.max(12, h - size - 12), y)),
  };
}

function positionFab(x, y) {
  let button = document.getElementById('task-fab'),
    size = button.offsetWidth || 60,
    pos = boundedFab(x, y, innerWidth, innerHeight, size);
  button.style.left = pos.x + 'px';
  button.style.top = pos.y + 'px';
  button.style.right = 'auto';
  button.style.bottom = 'auto';
  return pos;
}

function rememberFab() {
  let b = document.getElementById('task-fab').getBoundingClientRect();
  try {
    localStorage.setItem(
      LOCAL_PREFIX + 'fab-position',
      JSON.stringify({
        x: b.left / Math.max(1, innerWidth - b.width),
        y: b.top / Math.max(1, innerHeight - b.height),
      }),
    );
  } catch {}
}

function restoreFab() {
  let pos = readJSON(LOCAL_PREFIX + 'fab-position', null),
    button = document.getElementById('task-fab');
  if (pos && Number.isFinite(pos.x) && Number.isFinite(pos.y))
    positionFab(
      pos.x * (innerWidth - (button.offsetWidth || 60)),
      pos.y * (innerHeight - (button.offsetHeight || 60)),
    );
}

function openFlexibleTask() {
  openImport('manual');
  let heading = document.querySelector('#modal-root h2');
  if (heading) heading.textContent = '添加灵活任务';
  document.getElementById('f-title').focus();
}

function bindFloatingTaskButton() {
  let button = document.getElementById('task-fab');
  restoreFab();
  button.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    let box = button.getBoundingClientRect();
    fabDrag = {
      id: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      left: box.left,
      top: box.top,
      moved: false,
    };
    fabClickSuppressed = false;
    button.setPointerCapture(e.pointerId);
  });
  button.addEventListener('pointermove', (e) => {
    let d = fabDrag;
    if (!d || d.id !== e.pointerId) return;
    if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 6) return;
    d.moved = true;
    e.preventDefault();
    button.classList.add('is-moving');
    positionFab(d.left + e.clientX - d.x, d.top + e.clientY - d.y);
  });
  button.addEventListener('pointerup', (e) => {
    let d = fabDrag;
    if (!d || d.id !== e.pointerId) return;
    fabDrag = null;
    button.classList.remove('is-moving');
    if (button.hasPointerCapture(e.pointerId)) button.releasePointerCapture(e.pointerId);
    if (d.moved) {
      fabClickSuppressed = true;
      rememberFab();
      setTimeout(() => (fabClickSuppressed = false), 400);
    }
  });
  function cancel() {
    if (fabDrag) {
      positionFab(fabDrag.left, fabDrag.top);
      fabClickSuppressed = fabDrag.moved;
      fabDrag = null;
      button.classList.remove('is-moving');
      setTimeout(() => (fabClickSuppressed = false), 400);
    }
  }
  button.addEventListener('pointercancel', cancel);
  button.addEventListener('lostpointercapture', cancel);
  window.addEventListener('blur', cancel);
  button.addEventListener('click', (e) => {
    if (fabClickSuppressed) {
      e.preventDefault();
      return;
    }
    page === 'plan' ? openFlexibleTask() : openImport();
  });
  button.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      cancel();
      return;
    }
    let deltas = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] },
      d = deltas[e.key];
    if (d) {
      e.preventDefault();
      let b = button.getBoundingClientRect(),
        step = e.shiftKey ? 30 : 10;
      positionFab(b.left + d[0] * step, b.top + d[1] * step);
      rememberFab();
    }
  });
  window.addEventListener('resize', () => {
    if (['plan', 'matrix', 'recommend'].includes(page)) restoreFab();
  });
}

function syncFloatingTaskButton() {
  let b = document.getElementById('task-fab'),
    visible = !!activeAccount && ['plan', 'matrix', 'recommend'].includes(page);
  b.hidden = !visible;
  b.setAttribute(
    'aria-label',
    page === 'plan' ? '添加灵活任务；方向键或拖动移动按钮' : '录入日程；方向键或拖动移动按钮',
  );
  b.title = page === 'plan' ? '添加灵活任务 · 拖动移动位置' : '录入日程 · 拖动移动位置';
  if (visible) restoreFab();
  window.studyStarBorder?.wake();
}

function shredTargetAt(x, y, localBox, dockBox) {
  let candidates = [];
  if (localBox && x >= localBox.left && x <= localBox.right) {
    let progress = Math.max(0, Math.min(1, (y - (localBox.top - 80)) / 95));
    if (y >= localBox.top - 80 && y <= localBox.bottom)
      candidates.push({
        progress,
        ready: y >= localBox.top + 15 && y <= localBox.bottom,
        box: localBox,
      });
  }
  if (dockBox && x >= dockBox.left && x <= dockBox.right && y <= innerHeight) {
    let progress = Math.max(0, Math.min(1, (y - (dockBox.top - 85)) / 100));
    if (y >= dockBox.top - 85)
      candidates.push({ progress, ready: y >= dockBox.top + 15, box: dockBox });
  }
  return (
    candidates.sort((a, b) => Number(b.ready) - Number(a.ready) || b.progress - a.progress)[0] || {
      progress: 0,
      ready: false,
      box: null,
    }
  );
}

function resetShredDeleteZone() {
  let local = document.getElementById('shred-drop'),
    dock = document.getElementById('task-delete-dock');
  for (let n of [local, dock])
    if (n) {
      n.style.setProperty('--danger', '0');
      n.classList.remove('is-ready');
    }
  if (dock) {
    dock.classList.remove('is-visible');
    dock.setAttribute('aria-hidden', 'true');
  }
  let prompt = local?.querySelector('.shred-prompt');
  if (prompt) prompt.textContent = '拖到这里，松手删除任务';
}

function updateShredDeleteZone(d, overQuadrant) {
  if (d.task.start || demoPreview || page !== 'plan') {
    resetShredDeleteZone();
    return;
  }
  let local = document.getElementById('shred-drop'),
    dock = document.getElementById('task-delete-dock');
  dock.classList.add('is-visible');
  dock.setAttribute('aria-hidden', 'false');
  let target = shredTargetAt(
    d.x,
    d.y,
    local?.getBoundingClientRect(),
    dock.getBoundingClientRect(),
  );
  if (overQuadrant) target = { progress: 0, ready: false };
  for (let n of [local, dock])
    if (n) {
      n.style.setProperty('--danger', String(target.progress));
      n.classList.toggle('is-ready', target.ready);
    }
  let prompt = local?.querySelector('.shred-prompt');
  if (prompt) prompt.textContent = target.ready ? '松手删除任务' : '拖到这里，松手删除任务';
  if (target.ready) {
    d.drop = { shred: true };
    d.shredBox = target.box;
    d.ghost.querySelector('small').textContent = '松手删除任务';
    if (!d.announcedDelete) {
      document.getElementById('shred-announcement').textContent = '松手删除任务，按 Esc 可取消';
      d.announcedDelete = true;
    }
  } else d.announcedDelete = false;
}

function taskTrash() {
  return readJSON(dataKey('trash'), []);
}

function persistTasksAndTrash(nextTasks, nextTrash) {
  let taskKey = dataKey('tasks'),
    trashKey = dataKey('trash'),
    beforeTasks = localStorage.getItem(taskKey),
    beforeTrash = localStorage.getItem(trashKey);
  try {
    localStorage.setItem(trashKey, JSON.stringify(nextTrash));
    localStorage.setItem(taskKey, JSON.stringify(nextTasks));
    tasks = nextTasks;
    return true;
  } catch {
    try {
      if (beforeTasks === null) localStorage.removeItem(taskKey);
      else localStorage.setItem(taskKey, beforeTasks);
      if (beforeTrash === null) localStorage.removeItem(trashKey);
      else localStorage.setItem(trashKey, beforeTrash);
    } catch {}
    toast('保存失败，任务未删除');
    return false;
  }
}

function commitShredDelete(id, owner) {
  if (owner !== dataKey('tasks')) return false;
  let index = tasks.findIndex((t) => t.id === id);
  if (index < 0 || tasks[index].start) return false;
  let record = {
      trashId: String(Date.now()) + '-' + String(id),
      task: structuredClone(tasks[index]),
      index,
      deletedAt: new Date().toISOString(),
    },
    next = tasks.filter((t) => t.id !== id);
  if (!persistTasksAndTrash(next, [record, ...taskTrash()])) return false;
  lastTaskChange = { kind: 'delete', trashId: record.trashId, owner };
  render();
  showTaskUndo('已删除「' + record.task.title + '」');
  return true;
}

function restoreDeletedTask(trashId) {
  let h = lastTaskChange;
  if (h?.trashId === trashId && h.owner !== dataKey('tasks'))
    return toast('请在原账号中恢复该任务');
  let trash = taskTrash(),
    r = trash.find((x) => x.trashId === trashId);
  if (!r) return toast('任务已恢复或不在当前账号');
  if (tasks.some((t) => t.id === r.task.id)) return toast('该任务已经存在');
  let next = tasks.slice();
  next.splice(Math.min(r.index, next.length), 0, r.task);
  if (
    !persistTasksAndTrash(
      next,
      trash.filter((x) => x.trashId !== trashId),
    )
  )
    return;
  if (h?.trashId === trashId) lastTaskChange = null;
  closeModal();
  render();
  toast('任务已恢复');
}

function showDeletedTasks() {
  let trash = taskTrash();
  modal(
    '<div class="modal-head"><h2>最近删除</h2><button onclick="closeModal()" aria-label="关闭">✕</button></div><p class="desc">碎纸删除的任务仍可恢复；恢复后保留原来的日期、分类与完成状态。</p><div class="trash-list">' +
      (trash.length
        ? trash
            .map(
              (r) =>
                '<div class="trash-row"><div><b>' +
                esc(r.task.title) +
                '</b><p>' +
                esc(r.task.date) +
                ' · ' +
                labels[r.task.q] +
                '</p></div><button class="secondary" data-restore-trash="' +
                esc(r.trashId) +
                '">恢复</button></div>',
            )
            .join('')
        : '<div class="empty">没有已删除的任务</div>') +
      '</div>',
  );
  document
    .querySelectorAll('[data-restore-trash]')
    .forEach((b) => (b.onclick = () => restoreDeletedTask(b.dataset.restoreTrash)));
}

function cleanPaperClone(node) {
  let clone = node.cloneNode(true);
  for (let n of [clone, ...clone.querySelectorAll('*')]) {
    n.removeAttribute('id');
    n.removeAttribute('data-task-id');
    n.removeAttribute('tabindex');
    n.removeAttribute('autofocus');
    for (let a of [...n.attributes]) if (a.name.startsWith('on')) n.removeAttribute(a.name);
  }
  clone.classList.remove('drag-source');
  clone.setAttribute('aria-hidden', 'true');
  return clone;
}

function shredTask(id, source, selectedBox = null) {
  if (shredJob) return toast('碎纸机正在处理，请稍候');
  let task = tasks.find((t) => t.id === id);
  if (!task || task.start) return false;
  let owner = dataKey('tasks'),
    local = document.getElementById('shred-drop'),
    dock = document.getElementById('task-delete-dock');
  let box = selectedBox || local?.getBoundingClientRect();
  if (!box || box.top < 0 || box.top > innerHeight - 20)
    box = {
      left: Math.max(16, innerWidth / 2 - 210),
      right: Math.min(innerWidth - 16, innerWidth / 2 + 210),
      top: innerHeight - 105,
      width: Math.min(420, innerWidth - 32),
    };
  let width = Math.max(150, box.width || box.right - box.left),
    row = document.querySelector('#shred-list [data-task-id="' + id + '"]') || source,
    height = Math.max(70, Math.min(130, row?.getBoundingClientRect().height || 90));
  let reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  if (reduced || !row) return commitShredDelete(id, owner);
  let feed = document.createElement('div'),
    fall = document.createElement('div'),
    paper = document.createElement('div');
  feed.className = 'shred-feed-layer';
  fall.className = 'shred-fall-layer';
  paper.className = 'shred-feed-paper';
  let slitY = Math.min(innerHeight - 50, box.top + 5),
    left = box.left + 8,
    widthPx = width - 16;
  Object.assign(feed.style, {
    left: left + 'px',
    top: slitY - height + 'px',
    width: widthPx + 'px',
    height: height + 'px',
  });
  Object.assign(fall.style, {
    left: left - 30 + 'px',
    top: slitY + 'px',
    width: widthPx + 60 + 'px',
    height: Math.min(160, innerHeight - slitY) + 'px',
  });
  let feedMS = Math.max(300, Math.min(650, (height / 180) * 1000));
  for (let layer of [feed, fall]) {
    layer.style.setProperty('--paper-width', widthPx + 'px');
    layer.style.setProperty('--paper-height', height + 'px');
    layer.style.setProperty('--feed-ms', feedMS + 'ms');
    layer.setAttribute('aria-hidden', 'true');
  }
  paper.appendChild(cleanPaperClone(row));
  feed.appendChild(paper);
  let n = Math.max(8, Math.round(widthPx / 10));
  for (let i = 0; i < n; i++) {
    let strip = document.createElement('div'),
      inner = document.createElement('div');
    strip.className = 'shred-strip';
    inner.className = 'shred-strip-inner';
    let sw = widthPx / n;
    strip.style.left = 30 + i * sw + 'px';
    strip.style.setProperty('--strip-width', sw - 1 + 'px');
    strip.style.setProperty('--strip-x', i * sw + 'px');
    strip.style.setProperty('--strip-drift', (i / (n - 1) - 0.5) * 60 + 'px');
    strip.style.setProperty('--strip-rotate', (i % 2 ? 1 : -1) * (7 + (i % 5) * 3) + 'deg');
    strip.style.setProperty('--strip-ms', feedMS + 450 + (i % 4) * 35 + 'ms');
    strip.style.setProperty('--strip-delay', 80 + (i % 5) * 12 + 'ms');
    inner.appendChild(cleanPaperClone(row));
    strip.appendChild(inner);
    fall.appendChild(strip);
  }
  let lip = document.createElement('div');
  Object.assign(lip.style, {
    position: 'fixed',
    zIndex: '211',
    left: left - 5 + 'px',
    top: slitY - 2 + 'px',
    width: widthPx + 10 + 'px',
    height: '5px',
    borderRadius: '99px',
    background: '#b44a43',
    boxShadow: '0 0 12px #c44b4433',
    pointerEvents: 'none',
  });
  lip.setAttribute('aria-hidden', 'true');
  document.body.append(feed, fall, lip);
  row.style.opacity = '.12';
  row.style.pointerEvents = 'none';
  local?.closest('.shredder')?.classList.add('shred-busy');
  let job = { owner, id, timer: 0, feed, fall, row, lip, snapshot: JSON.stringify(task) };
  shredJob = job;
  job.timer = setTimeout(() => {
    feed.remove();
    fall.remove();
    lip.remove();
    row.style.opacity = '';
    row.style.pointerEvents = '';
    document.querySelector('.shred-busy')?.classList.remove('shred-busy');
    if (shredJob === job) shredJob = null;
    if (JSON.stringify(tasks.find((t) => t.id === id)) !== job.snapshot)
      return toast('任务已变化，本次删除已取消');
    commitShredDelete(id, owner);
  }, feedMS + 700);
}

function cancelShredAnimation() {
  let job = shredJob;
  if (!job) return;
  clearTimeout(job.timer);
  job.feed.remove();
  job.fall.remove();
  job.lip.remove();
  job.row.style.opacity = '';
  job.row.style.pointerEvents = '';
  document.querySelector('.shred-busy')?.classList.remove('shred-busy');
  shredJob = null;
}

window.addEventListener('pagehide', cancelShredAnimation);

const renderWithFloatingTaskButton = render;

render = function () {
  renderWithFloatingTaskButton();
  syncFloatingTaskButton();
};

bindFloatingTaskButton();

const removeOriginalTask = removeTask;

removeTask = function (id) {
  let task = tasks.find((t) => t.id === id);
  if (!task) return;
  if (task.start) return removeOriginalTask(id);
  closeModal();
  return shredTask(id, document.querySelector('#shred-list [data-task-id="' + id + '"]'));
};

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Delete' && e.key !== 'Backspace') return;
  if (e.repeat || e.target.closest('input,textarea,select,[contenteditable="true"]')) return;
  let row = e.target.closest('#shred-list [data-task-id]');
  if (!row) return;
  e.preventDefault();
  shredTask(Number(row.dataset.taskId), row);
});
