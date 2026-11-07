const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const vm = require('node:vm');

function simulation(width, counts) {
  const timers = new Map();
  let pending, id = 0, time = 0;
  function node() {
    return {style: {setProperty() {}}, handlers: {}, classList: {toggle() {}},
      addEventListener(name, fn) { this.handlers[name] = fn; }, setAttribute() {}};
  }
  const elements = counts.map(count => {
    const element = node(), button = node(), preview = node(), list = node(), more = node();
    Object.assign(list, {scrollHeight: 500, clientHeight: 100, scrollTop: 0});
    preview.querySelector = selector => selector === '.sphere-task-list' ? list : more;
    element.querySelector = selector => selector === '.sphere-hit-area' ? button : selector === '.sphere-preview' ? preview : null;
    element.dataset = {count};
    element.matches = () => false;
    return element;
  });
  const stage = node();
  stage.isConnected = true;
  stage.querySelectorAll = () => elements;
  stage.getBoundingClientRect = () => ({width, height: 900, left: 0, top: 0});
  const state = {AbortController, matchMedia: () => ({matches: false}),
    document: {querySelector: () => null},
    requestAnimationFrame: fn => {pending = fn; return ++id;}, cancelAnimationFrame() {},
    setTimeout: (fn, delay) => {timers.set(++id, {fn, delay}); return id;}, clearTimeout: key => timers.delete(key),
    ResizeObserver: class {observe() {} disconnect() {}}
  };
  vm.createContext(state);
  vm.runInContext(readFileSync('frontend/public/spheres.js', 'utf8'), state);
  state.mountQuadrantSpheres(stage);
  function checkFrames(number) {
    for (let n = 0; n < number; n++) {
      if (pending) { const fn = pending; pending = null; time += 16.667; fn(time); }
      const dimensions = elements.flatMap(el => {
        const scale = /scale\(([^,]+),([^\)]+)\)/.exec(el.style.transform);
        return [parseFloat(el.style.width) * Number(scale[1]), parseFloat(el.style.height) * Number(scale[2])];
      });
      assert.ok(dimensions.every(value => Number.isFinite(value) && value > 0));
      assert.ok(Math.max(...dimensions) / Math.min(...dimensions) <= 2 + 1e-9, '包括回弹形变的可见直径不得超过两倍');
    }
  }
  return {elements, stage, checkFrames, finishTimers(delay) {
    for (const [key, timer] of [...timers]) if (timer.delay === delay) {timers.delete(key); timer.fn();}
  }};
}

test('极端任务数量下，桌面和窄屏圆球的待机、悬停展开与回弹始终保持两倍以内', () => {
  for (const width of [480, 707, 1280]) {
    const sim = simulation(width, [0, 1, 10000, 0]);
    sim.checkFrames(180);
    sim.elements[2].handlers.pointerenter({pointerType: 'mouse'});
    sim.finishTimers(1000);
    sim.stage.handlers.pointermove({pointerType: 'mouse', clientX: width * .8, clientY: 500});
    sim.checkFrames(180);
    sim.stage.handlers.pointerleave();
    sim.finishTimers(260);
    sim.checkFrames(180);
  }
});
