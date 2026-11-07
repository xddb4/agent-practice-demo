const ticketCompletionCounts = new Map();

function ticketCompletedCount() {
  const known = ticketCompletionCounts.get(dataKey('tasks')) || 0;
  return Math.max(known, new Set(tasks.filter(task => task.done).map(task => String(task.id))).size);
}

async function refreshTicketCompletedCount(session) {
  if (typeof api !== 'function') return;
  try {
    const stats = await api('completion-stats');
    if (session.owner !== dataKey('tasks') || session.cancelled) return;
    ticketCompletionCounts.set(session.owner, Math.max(0, Number(stats.completed_tasks) || 0));
    if (completionTicket === session) {
      const label = document.getElementById('ticket-completion-count');
      if (label) label.textContent = '累计完成 ' + ticketCompletedCount() + ' 项';
    }
  } catch { /* The visible fallback uses actual completed tasks, never a generated serial number. */ }
}

function ticketWait(session, duration) {
  return new Promise(resolve => {
    const finish = () => {
      clearTimeout(session.timer);
      session.timer = 0;
      session.finishAnimation = null;
      resolve();
    };
    session.finishAnimation = finish;
    session.timer = setTimeout(finish, duration);
  });
}

openCompletionTicket = function (id) {
  const task = tasks.find(item => item.id === id);
  if (!task || task.done) return;
  closeModal();
  modal('<button class="ticket-close" onclick="closeModal()" aria-label="取消完成">✕</button><div class="tear-stage"><div class="tear-ticket" id="completion-ticket"><div class="ticket-art" id="ticket-art"><div class="ticket-art-content"><div class="ticket-overline">A LITTLE STEP FORWARD</div><div class="ticket-task-title">' + esc(task.title) + '</div><div class="ticket-task-meta">' + esc(task.date || '') + '<br>' + esc(ticketTaskMeta(task)) + ' · ' + esc(labels[task.q]) + '</div></div><div class="ticket-brand">StudyPilot</div><div class="ticket-success-mark" aria-hidden="true">WELL DONE！</div></div><button class="ticket-stub" id="ticket-stub" aria-label="向右拖动票根完成任务，或按 Enter 撕下"><span class="ticket-curl" aria-hidden="true"></span><span class="stub-top">WELL DONE</span><span class="stub-arrow" aria-hidden="true">PASS</span><span class="stub-no" id="ticket-completion-count">累计完成 ' + ticketCompletedCount() + ' 项</span></button></div></div><p id="tear-instructions" class="tear-instructions" role="status" aria-live="polite">向右拉动，撕下票根</p><div class="tear-progress" aria-hidden="true"><i id="tear-progress-fill"></i></div><div class="ticket-actions"><button class="ticket-action" onclick="closeModal()">再检查一下</button><span class="ticket-action-divider" aria-hidden="true"></span><button class="ticket-action" id="ticket-direct" onclick="tearCompletionTicket(true)">直接完成</button></div>');
  const dialog = document.querySelector('#modal-root .modal');
  dialog.classList.add('ticket-modal');
  dialog.setAttribute('aria-label', '完成任务票据');
  const session = {id, owner: dataKey('tasks'), cancelled: false, tearing: false, drag: null, timer: 0};
  completionTicket = session;
  bindCompletionTicket();
  refreshTicketCompletedCount(session);
  document.getElementById('ticket-stub').focus({preventScroll: true});
};

resetCompletionStub = function () {
  const root = document.getElementById('completion-ticket');
  const stub = document.getElementById('ticket-stub');
  if (!root || !stub) return;
  root.classList.remove('is-dragging', 'is-tearing');
  document.getElementById('ticket-art').classList.remove('is-torn', 'is-stamped');
  stub.style.transform = '';
  stub.style.opacity = '1';
  stub.style.setProperty('--tear-progress', '0');
  stub.disabled = false;
  document.getElementById('ticket-direct').disabled = false;
  document.getElementById('tear-progress-fill').style.width = '0%';
  document.getElementById('tear-instructions').textContent = '向右拉动，撕下票根';
};

bindCompletionTicket = function () {
  const root = document.getElementById('completion-ticket');
  const stub = document.getElementById('ticket-stub');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  stub.addEventListener('pointerdown', event => {
    const session = completionTicket;
    if (!session || session.tearing || event.button !== 0) return;
    event.preventDefault();
    session.drag = {pointerId: event.pointerId, x: event.clientX, y: event.clientY, progress: 0, dx: 0, dy: 0};
    root.classList.add('is-dragging');
    stub.setPointerCapture(event.pointerId);
  });
  stub.addEventListener('pointermove', event => {
    const session = completionTicket, drag = session?.drag;
    if (!drag || drag.pointerId !== event.pointerId || session.tearing) return;
    event.preventDefault();
    drag.dx = event.clientX - drag.x;
    drag.dy = event.clientY - drag.y;
    drag.progress = Math.max(0, drag.dx) * .55;
    const progress = Math.min(1, drag.progress / 60);
    stub.style.setProperty('--tear-progress', String(reduced ? 0 : progress));
    stub.style.transform = reduced ? 'translateX(' + Math.max(0, drag.dx * .4) + 'px)' : 'perspective(800px) translate3d(' + Math.max(-8, drag.dx * .55) + 'px,' + (drag.dy * .3) + 'px,0) rotateY(' + (-progress * 58) + 'deg) rotateZ(' + (Math.sign(drag.dy || 1) * progress * 12) + 'deg)';
    document.getElementById('tear-progress-fill').style.width = (progress * 100) + '%';
    document.getElementById('tear-instructions').textContent = progress >= 1 ? '松开，完成撕票' : '向右拉动，撕下票根';
  });
  stub.addEventListener('pointerup', event => {
    const drag = completionTicket?.drag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    completionTicket.drag = null;
    if (stub.hasPointerCapture(event.pointerId)) stub.releasePointerCapture(event.pointerId);
    if (drag.progress >= 60) tearCompletionTicket(false, drag);
    else resetCompletionStub();
  });
  const cancel = () => { if (completionTicket?.drag) { completionTicket.drag = null; resetCompletionStub(); } };
  stub.addEventListener('pointercancel', cancel);
  stub.addEventListener('lostpointercapture', cancel);
  stub.addEventListener('click', event => { if (event.detail === 0) tearCompletionTicket(true); });
};

tearCompletionTicket = async function (immediate = false, drag = {dx: 120, dy: 20}) {
  const session = completionTicket;
  if (!session || session.cancelled || session.tearing) return;
  const task = tasks.find(item => item.id === session.id);
  if (!task || task.done || session.owner !== dataKey('tasks')) return closeModal();
  session.tearing = true;
  session.drag = null;
  const root = document.getElementById('completion-ticket'), stub = document.getElementById('ticket-stub');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  root.classList.remove('is-dragging');
  root.classList.add('is-tearing');
  stub.disabled = true;
  document.getElementById('ticket-direct').disabled = true;
  document.getElementById('tear-progress-fill').style.width = '100%';
  stub.style.setProperty('--tear-progress', reduced ? '0' : '1');
  stub.style.transform = reduced ? 'translateX(100px)' : 'perspective(800px) translate3d(' + Math.max(170, drag.dx * .8) + 'px,' + (Math.sign(drag.dy || 1) * 55) + 'px,30px) rotateY(-85deg) rotateZ(18deg)';
  stub.style.opacity = '0';
  document.getElementById('ticket-art').classList.add('is-torn');
  document.getElementById('tear-instructions').textContent = '正在保存完成记录…';
  await ticketWait(session, reduced ? 0 : immediate ? 320 : 500);
  if (completionTicket !== session || session.cancelled || session.owner !== dataKey('tasks')) return;
  const current = tasks.find(item => item.id === session.id);
  if (!current || current.done) return closeModal();
  const before = structuredClone(current);
  if (!applyTaskChange(session.id, {done: true}, '任务已完成')) {
    session.tearing = false;
    resetCompletionStub();
    return;
  }
  try {
    if (typeof saveQueue !== 'undefined') await saveQueue;
  } catch {
    if (session.owner === dataKey('tasks')) {
      const item = tasks.find(entry => entry.id === session.id);
      if (item?.done) item.done = before.done;
      render();
    }
    if (completionTicket === session && !session.cancelled) {
      session.tearing = false;
      resetCompletionStub();
      document.getElementById('tear-instructions').textContent = '保存未成功，请重试';
    }
    return;
  }
  if (completionTicket !== session || session.cancelled || session.owner !== dataKey('tasks')) return;
  if (!tasks.find(item => item.id === session.id)?.done) return closeModal();
  await refreshTicketCompletedCount(session);
  if (completionTicket !== session || session.cancelled) return;
  if (!tasks.find(item => item.id === session.id)?.done) return closeModal();
  document.getElementById('ticket-art').classList.add('is-stamped');
  document.getElementById('tear-instructions').textContent = 'WELL DONE！';
  await ticketWait(session, reduced ? 500 : 1200);
  if (completionTicket === session && !session.cancelled) closeModal();
};

(() => {
  const closeTicket = closeModal;
  closeModal = function () {
    if (completionTicket) {
      completionTicket.cancelled = true;
      completionTicket.finishAnimation?.();
    }
    return closeTicket();
  };
})();
