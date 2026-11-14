// Workspace source fragment: assembled in app/assets.mjs order.
// Shared scope is retained to preserve existing inline events and function hoisting.
let completionTicket = null;

const originalCloseCompletionModal = closeModal;

closeModal = function () {
  if (completionTicket) {
    clearTimeout(completionTicket.timer);
    completionTicket.cancelled = true;
    completionTicket = null;
  }
  originalCloseCompletionModal();
};

const plainTaskToggle = toggle;

toggle = function (id) {
  let task = tasks.find((t) => t.id === id);
  if (!task) return;
  if (task.done) return plainTaskToggle(id);
  openCompletionTicket(id);
};

function completeFromDetail(id) {
  closeModal();
  toggle(id);
}

function ticketTaskMeta(task) {
  return task.start
    ? task.start + ' – ' + task.end
    : task.duration
      ? task.duration + ' 分钟'
      : '灵活安排';
}

function completionDragProgress(dx, dy) {
  return Math.max(0, dx * Math.cos(Math.PI / 6) + Math.abs(dy) * 0.5) * 0.55;
}

function openCompletionTicket(id) {
  let task = tasks.find((t) => t.id === id);
  if (!task || task.done) return;
  closeModal();
  let number = String(Math.abs(Number(task.id)))
    .slice(-6)
    .padStart(6, '0');
  modal(
    '<div class="modal-head"><h2>为这份努力，留一个完成的瞬间。</h2><button onclick="closeModal()" aria-label="取消完成">✕</button></div><p class="ticket-intro">握住右侧票根，向右拖动，完成今天的一小步。</p><div class="tear-stage"><div class="tear-ticket" id="completion-ticket"><div class="ticket-art" id="ticket-art"><div class="ticket-spectrum" aria-hidden="true"></div><div class="ticket-art-content"><div class="ticket-overline">A LITTLE STEP FORWARD</div><div class="ticket-task-title">' +
      esc(task.title) +
      '</div><div class="ticket-task-meta">' +
      esc(task.date) +
      '<br>' +
      esc(ticketTaskMeta(task)) +
      ' · ' +
      labels[task.q] +
      '</div></div><div class="ticket-brand">◷ StudyPilot</div><div class="ticket-success-mark" aria-hidden="true">✓</div></div><button class="ticket-stub" id="ticket-stub" aria-label="拖动票根完成任务，或按 Enter 直接撕下"><span class="ticket-perforation" aria-hidden="true">' +
      Array.from({ length: 12 }, () => '<i></i>').join('') +
      '</span><span class="ticket-notch top" aria-hidden="true"></span><span class="ticket-notch bottom" aria-hidden="true"></span><span class="ticket-tear-edge" aria-hidden="true"></span><div><span class="stub-top">WELL DONE</span><h3>已努力<br>待盖章</h3><p>把完成，交给自己。</p><span class="stub-arrow" aria-hidden="true">↗</span></div><span class="stub-no">No. ' +
      number +
      '</span></button></div></div><p id="tear-instructions" class="tear-instructions" role="status" aria-live="polite">向右拉动票根，松开即可撕下</p><div class="tear-progress" aria-hidden="true"><i id="tear-progress-fill"></i></div><div class="ticket-actions"><button class="secondary" onclick="closeModal()">再检查一下</button><button class="ticket-direct" id="ticket-direct" onclick="tearCompletionTicket(true)">直接完成</button></div><p class="ticket-shortcut">也可聚焦票根后按 Enter 完成 · Esc 取消</p>',
  );
  let dialog = document.querySelector('#modal-root .modal');
  dialog.classList.add('ticket-modal');
  completionTicket = {
    id,
    owner: dataKey('tasks'),
    cancelled: false,
    tearing: false,
    drag: null,
    timer: 0,
  };
  bindCompletionTicket();
  document.getElementById('ticket-stub').focus();
}

function resetCompletionStub() {
  let root = document.getElementById('completion-ticket'),
    stub = document.getElementById('ticket-stub');
  if (!root || !stub) return;
  root.classList.remove('is-dragging', 'is-tearing');
  stub.style.transform = '';
  stub.style.opacity = '1';
  stub.disabled = false;
  let direct = document.getElementById('ticket-direct');
  if (direct) direct.disabled = false;
  document.getElementById('tear-progress-fill').style.width = '0%';
  document.getElementById('tear-instructions').textContent = '再向右拉一点，就能撕下票根';
}

function bindCompletionTicket() {
  const root = document.getElementById('completion-ticket'),
    stub = document.getElementById('ticket-stub');
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  root.addEventListener('pointermove', (e) => {
    if (!completionTicket || completionTicket.tearing || completionTicket.drag || reduced) return;
    let b = root.getBoundingClientRect(),
      x = (e.clientX - b.left) / b.width - 0.5,
      y = (e.clientY - b.top) / b.height - 0.5;
    root.style.setProperty('--ticket-rx', -y * 9 + 'deg');
    root.style.setProperty('--ticket-ry', x * 9 + 'deg');
    root.style.setProperty('--ticket-px', x * 6 + 'px');
  });
  root.addEventListener('pointerleave', () => {
    root.style.setProperty('--ticket-rx', '0deg');
    root.style.setProperty('--ticket-ry', '0deg');
    root.style.setProperty('--ticket-px', '0px');
  });
  stub.addEventListener('pointerdown', (e) => {
    let session = completionTicket;
    if (!session || session.tearing || e.button !== 0) return;
    e.preventDefault();
    session.drag = {
      pointerId: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      progress: 0,
      dx: 0,
      dy: 0,
    };
    root.classList.add('is-dragging');
    root.style.setProperty('--ticket-rx', '0deg');
    root.style.setProperty('--ticket-ry', '0deg');
    stub.setPointerCapture(e.pointerId);
  });
  stub.addEventListener('pointermove', (e) => {
    let session = completionTicket,
      d = session?.drag;
    if (!d || d.pointerId !== e.pointerId || session.tearing) return;
    e.preventDefault();
    let dx = e.clientX - d.x,
      dy = e.clientY - d.y;
    d.dx = dx;
    d.dy = dy;
    d.progress = completionDragProgress(dx, dy);
    let percent = Math.min(1, d.progress / 60);
    stub.style.transform =
      'translate(' +
      Math.max(-8, dx * 0.55) +
      'px,' +
      dy * 0.45 +
      'px) rotate(' +
      Math.sign(dy || 1) * percent * 30 +
      'deg)';
    document.getElementById('tear-progress-fill').style.width = percent * 100 + '%';
    document.getElementById('tear-instructions').textContent =
      percent >= 1 ? '松开票根，确认完成这项任务' : '继续向右拉动票根…';
  });
  stub.addEventListener('pointerup', (e) => {
    let session = completionTicket,
      d = session?.drag;
    if (!d || d.pointerId !== e.pointerId) return;
    session.drag = null;
    if (stub.hasPointerCapture(e.pointerId)) stub.releasePointerCapture(e.pointerId);
    if (d.progress >= 60) tearCompletionTicket(false, d);
    else resetCompletionStub();
  });
  function cancel() {
    let session = completionTicket;
    if (session?.drag) {
      session.drag = null;
      resetCompletionStub();
    }
  }
  stub.addEventListener('pointercancel', cancel);
  stub.addEventListener('lostpointercapture', cancel);
  stub.addEventListener('click', (e) => {
    if (e.detail === 0) tearCompletionTicket(false);
  });
}

function tearCompletionTicket(immediate = false, drag = { dx: 100, dy: 35 }) {
  let session = completionTicket;
  if (!session || session.cancelled || session.tearing) return;
  let task = tasks.find((t) => t.id === session.id);
  if (!task || task.done || session.owner !== dataKey('tasks')) {
    closeModal();
    return toast('任务状态已变化，请重新查看');
  }
  session.tearing = true;
  session.drag = null;
  const root = document.getElementById('completion-ticket'),
    stub = document.getElementById('ticket-stub');
  root.classList.remove('is-dragging');
  root.classList.add('is-tearing');
  stub.disabled = true;
  document.getElementById('ticket-direct').disabled = true;
  document.getElementById('tear-progress-fill').style.width = '100%';
  document.getElementById('tear-instructions').textContent = '票根已撕下，正在记录这份完成';
  let reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  requestAnimationFrame(() => {
    if (completionTicket !== session || session.cancelled) return;
    stub.style.transform =
      'translate(' +
      Math.max(150, drag.dx * 0.7) +
      'px,' +
      Math.sign(drag.dy || 1) * 80 +
      'px) rotate(' +
      Math.sign(drag.dy || 1) * 30 +
      'deg)';
    stub.style.opacity = '0';
    document.getElementById('ticket-art').classList.add('is-torn');
  });
  function onTear() {
    if (completionTicket !== session || session.cancelled) return;
    if (session.owner !== dataKey('tasks')) return closeModal();
    let current = tasks.find((t) => t.id === session.id);
    if (!current || current.done) return closeModal();
    let ok = applyTaskChange(session.id, { done: true }, '票根已撕下，任务已完成');
    if (ok) {
      closeModal();
    } else {
      session.tearing = false;
      resetCompletionStub();
      document.getElementById('tear-instructions').textContent = '保存未成功，任务尚未完成，请重试';
    }
  }
  session.timer = setTimeout(onTear, immediate || reduced ? 0 : 520);
}
