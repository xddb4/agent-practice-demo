// Workspace source fragment: assembled in app/assets.mjs order.
// Shared scope is retained to preserve existing inline events and function hoisting.
function mountTaskStarBorder(root) {
  const canvas = document.createElement('canvas');
  canvas.className = 'star-border-light';
  canvas.setAttribute('aria-hidden', 'true');
  root.prepend(canvas);
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  let raf = 0,
    last = 0,
    phase = 0,
    lap = 0,
    hover = false,
    pulses = [],
    alive = true,
    w = 60,
    h = 60,
    dpr = 1;
  const tau = Math.PI * 2;
  function trail(head, span, alpha, r, cx, cy) {
    let steps = 48;
    for (let i = 0; i < steps; i++) {
      let u = 1 - i / steps,
        a = head - (span * i) / steps,
        b = head - (span * (i + 1)) / steps;
      ctx.beginPath();
      ctx.arc(cx, cy, r, b, a, span < 0);
      ctx.strokeStyle = 'rgba(225,217,247,' + alpha * u * u + ')';
      ctx.lineWidth = 1.4;
      ctx.shadowColor = '#c8b9e5';
      ctx.shadowBlur = 8 * u;
      ctx.stroke();
    }
  }
  function frame(now) {
    raf = 0;
    if (!alive || root.hidden || document.hidden) {
      last = 0;
      return;
    }
    const dt = last ? Math.min(0.05, (now - last) / 1000) : 1 / 60;
    last = now;
    const extra = lap > 0 ? (tau * dt) / 0.9 : 0;
    lap = Math.max(0, lap - dt);
    if (!reduce) phase = (phase + (tau * dt) / 4 + extra) % tau;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w + 96, h + 96);
    let r = (Math.min(w, h) - 1.4) / 2,
      cx = 48 + w / 2,
      cy = 48 + h / 2;
    for (let i = 0; i < 2; i++)
      trail(
        phase + i * Math.PI,
        reduce ? 0.28 : tau * (hover ? 0.4 : 0.3),
        hover ? 1 : 0.85,
        r,
        cx,
        cy,
      );
    pulses = pulses.filter((p) => {
      p.age += dt;
      let t = p.age / 0.65;
      if (t >= 1) return false;
      for (let sign of [-1, 1])
        trail(
          p.angle + sign * Math.PI * (1 - (1 - t) ** 2),
          sign * tau * 0.16,
          (1 - t) ** 2,
          r,
          cx,
          cy,
        );
      return true;
    });
    ctx.shadowBlur = 0;
    if (!reduce || pulses.length) raf = requestAnimationFrame(frame);
  }
  function wake() {
    if (!raf && alive && !root.hidden && !document.hidden) {
      last = 0;
      raf = requestAnimationFrame(frame);
    }
  }
  function measure() {
    w = root.offsetWidth || 60;
    h = root.offsetHeight || 60;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.ceil((w + 96) * dpr);
    canvas.height = Math.ceil((h + 96) * dpr);
    wake();
  }
  const enter = () => {
      hover = true;
      if (!reduce) lap = 0.9;
      wake();
    },
    leave = () => {
      hover = false;
      wake();
    };
  const down = (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (reduce) return;
    let b = root.getBoundingClientRect();
    pulses.push({
      angle: Math.atan2(e.clientY - b.top - b.height / 2, e.clientX - b.left - b.width / 2),
      age: 0,
    });
    pulses = pulses.slice(-4);
    wake();
  };
  root.addEventListener('pointerenter', enter);
  root.addEventListener('pointerleave', leave);
  root.addEventListener('focus', enter);
  root.addEventListener('blur', leave);
  root.addEventListener('pointerdown', down);
  const visibility = () => {
    cancelAnimationFrame(raf);
    raf = 0;
    wake();
  };
  document.addEventListener('visibilitychange', visibility);
  const observer = new ResizeObserver(measure);
  observer.observe(root);
  measure();
  return {
    wake,
    dispose() {
      alive = false;
      cancelAnimationFrame(raf);
      observer.disconnect();
      document.removeEventListener('visibilitychange', visibility);
      for (const [name, fn] of [
        ['pointerenter', enter],
        ['pointerleave', leave],
        ['focus', enter],
        ['blur', leave],
        ['pointerdown', down],
      ])
        root.removeEventListener(name, fn);
      canvas.remove();
    },
  };
}

window.studyStarBorder = mountTaskStarBorder(document.getElementById('task-fab'));

window.addEventListener('pagehide', () => window.studyStarBorder?.dispose());
