// Workspace source fragment: assembled in app/assets.mjs order.
// Shared scope is retained to preserve existing inline events and function hoisting.
let authRequestPending = false,
  circularLoginMotion = null,
  landingMistHandle = null;

function circularAngleDelta(previous, next) {
  let delta = next - previous;
  if (delta > 180) delta -= 360;
  if (delta < -180) delta += 360;
  return delta;
}

function circularGlyphs(text) {
  let letters = Array.from(text);
  return letters
    .map(
      (letter, i) =>
        '<span class="login-circular-letter" style="transform:rotate(' +
        (360 / letters.length) * i +
        'deg)"><span>' +
        esc(letter) +
        '</span></span>',
    )
    .join('');
}

function mountCircularLogin() {
  const root = document.getElementById('login-circular-text'),
    wrap = document.getElementById('login-circular-wrap'),
    ring = document.getElementById('login-circular-ring'),
    tilt = document.getElementById('login-circular-tilt');
  if (!root || !wrap) return null;
  ring.innerHTML = circularGlyphs('STUDYPILOT · MAKE ROOM FOR GROWTH · ');
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const s = { angle: 0, raf: 0, last: 0, hover: false, speed: 1, fling: 0, drag: null, x: 0, y: 0 };
  function paint() {
    ring.style.transform = 'rotate(' + s.angle + 'deg)';
    tilt.style.transform =
      'rotateX(' + s.x + 'deg) rotateY(' + s.y + 'deg) scale(' + (s.drag ? 0.96 : 1) + ')';
  }
  function visible() {
    return (
      !activeAccount &&
      !document.hidden &&
      !document.getElementById('landing-page').hidden &&
      !landingMotionPaused
    );
  }
  function stop() {
    cancelAnimationFrame(s.raf);
    s.raf = 0;
    s.last = 0;
  }
  function step(now) {
    s.raf = 0;
    if (!visible()) return;
    let dt = Math.min(0.05, s.last ? (now - s.last) / 1000 : 1 / 60);
    s.last = now;
    if (!s.drag) {
      s.speed += ((s.hover ? 4 : 1) - s.speed) * (1 - Math.exp(-dt / 0.22));
      s.fling *= Math.exp(-dt / 0.7);
      if (Math.abs(s.fling) < 1) s.fling = 0;
      s.angle = (s.angle + (18 * s.speed + s.fling) * dt) % 360;
    }
    paint();
    if (!reduced) s.raf = requestAnimationFrame(step);
  }
  function wake() {
    if (reduced) {
      paint();
      return;
    }
    if (!s.raf && visible()) s.raf = requestAnimationFrame(step);
  }
  function angleAt(e) {
    let b = root.getBoundingClientRect(),
      x = e.clientX - b.left - b.width / 2,
      y = e.clientY - b.top - b.height / 2;
    return Math.hypot(x, y) < b.width * 0.06 ? null : (Math.atan2(y, x) * 180) / Math.PI;
  }
  wrap.addEventListener('pointerenter', () => {
    s.hover = true;
    wake();
  });
  wrap.addEventListener('pointerleave', () => {
    s.hover = false;
    s.x = 0;
    s.y = 0;
    paint();
  });
  wrap.addEventListener('pointermove', (e) => {
    if (reduced || e.pointerType === 'touch') return;
    let b = wrap.getBoundingClientRect();
    s.y = Math.max(-1, Math.min(1, ((e.clientX - b.left) / b.width) * 2 - 1)) * 10;
    s.x = -Math.max(-1, Math.min(1, ((e.clientY - b.top) / b.height) * 2 - 1)) * 10;
    paint();
  });
  root.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    s.fling = 0;
    s.drag = { id: e.pointerId, previous: angleAt(e), travel: 0, samples: [[e.timeStamp, 0]] };
    root.classList.add('is-dragging');
    root.setPointerCapture(e.pointerId);
    paint();
    wake();
  });
  root.addEventListener('pointermove', (e) => {
    let d = s.drag;
    if (!d || d.id !== e.pointerId) return;
    e.preventDefault();
    let next = angleAt(e);
    if (next === null) return;
    if (d.previous !== null) {
      let delta = circularAngleDelta(d.previous, next);
      d.travel += delta;
      s.angle = (s.angle + delta) % 360;
      d.samples.push([e.timeStamp, d.travel]);
      while (d.samples.length > 2 && e.timeStamp - d.samples[0][0] > 100) d.samples.shift();
    }
    d.previous = next;
    paint();
  });
  function finish(e, cancelled = false) {
    let d = s.drag;
    if (!d || d.id !== e.pointerId) return;
    s.drag = null;
    root.classList.remove('is-dragging');
    let [start, travel] = d.samples[0],
      last = d.samples[d.samples.length - 1][0],
      elapsed = e.timeStamp - start;
    let velocity =
      !cancelled && elapsed > 0 && e.timeStamp - last < 80
        ? ((d.travel - travel) / elapsed) * 1000
        : 0;
    s.fling = reduced || cancelled ? 0 : Math.max(-1440, Math.min(1440, velocity)) - 18 * s.speed;
    if (root.hasPointerCapture(e.pointerId)) root.releasePointerCapture(e.pointerId);
    paint();
    wake();
  }
  root.addEventListener('pointerup', (e) => finish(e));
  root.addEventListener('pointercancel', (e) => finish(e, true));
  root.addEventListener('lostpointercapture', (e) => finish(e, true));
  document.addEventListener('visibilitychange', () => {
    stop();
    wake();
  });
  return { wake, stop, state: s };
}

function fadeMistOut(target, duration = 750) {
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  let raf = 0,
    ended = false,
    start = null,
    resolveDone;
  const finished = new Promise((resolve) => (resolveDone = resolve));
  function complete() {
    if (ended) return;
    ended = true;
    cancelAnimationFrame(raf);
    target.style.opacity = '';
    target.classList.remove('auth-mist-out');
    resolveDone();
  }
  function step(now) {
    if (ended) return;
    if (!target.isConnected) {
      complete();
      return;
    }
    start ??= now;
    const t = duration ? Math.min(1, (now - start) / duration) : 1;
    target.style.opacity = String((1 - t) ** 3);
    if (t >= 1) complete();
    else raf = requestAnimationFrame(step);
  }
  target.classList.add('auth-mist-out');
  if (reduced || duration === 0) complete();
  else raf = requestAnimationFrame(step);
  return { finished, cancel: complete };
}

async function enterAuthenticatedBoard() {
  let dialog = document.querySelector('#modal-root .modal');
  if (dialog) {
    document.getElementById('auth-submit').textContent = '验证成功，正在进入…';
    let fade = fadeMistOut(dialog, 450);
    try {
      await fade.finished;
    } catch {
      fade.cancel();
    }
  }
  closeModal();
  render();
}

const showLandingBeforeCircular = showLandingPage;

showLandingPage = function () {
  landingMistHandle?.cancel();
  landingMistHandle = null;
  let root = document.getElementById('landing-page');
  root.style.opacity = '';
  root.style.filter = '';
  showLandingBeforeCircular();
  circularLoginMotion?.wake();
};

leaveLandingPage = function () {
  let root = document.getElementById('landing-page');
  if (root.hidden || root.classList.contains('is-leaving')) return;
  document.body.classList.remove('auth-landing');
  root.classList.add('is-leaving');
  let app = document.querySelector('.app');
  app?.classList.add('board-enter');
  stopLandingDistortion();
  circularLoginMotion?.stop();
  let handle = fadeMistOut(root, 750);
  landingMistHandle = handle;
  handle.finished.then(() => {
    if (landingMistHandle !== handle || !activeAccount) return;
    root.hidden = true;
    root.classList.remove('is-leaving', 'auth-opening');
    root.style.opacity = '';
    root.style.filter = '';
    app?.classList.remove('board-enter');
    landingMistHandle = null;
  });
};

const toggleMotionBeforeCircular = toggleLandingMotion;

toggleLandingMotion = function () {
  toggleMotionBeforeCircular();
  if (landingMotionPaused) circularLoginMotion?.stop();
  else circularLoginMotion?.wake();
};

circularLoginMotion = mountCircularLogin();

window.addEventListener('pagehide', () => {
  circularLoginMotion?.stop();
  landingMistHandle?.cancel();
});
