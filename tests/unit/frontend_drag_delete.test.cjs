const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readSource, namedFunction } = require('./frontend-source.cjs');

function node(box) {
  const classes = new Set();
  return {
    attributes: {}, style: { setProperty(key, value) { this[key] = value; } },
    classList: {
      add: (name) => classes.add(name), remove: (name) => classes.delete(name),
      contains: (name) => classes.has(name),
      toggle(name, enabled) { enabled ? classes.add(name) : classes.delete(name); },
    },
    getBoundingClientRect: () => box,
    setAttribute(key, value) { this.attributes[key] = value; },
    querySelector: () => ({}), remove() {},
  };
}

function harness(localBox = { left: 900, right: 1200, top: 600, bottom: 648, width: 300, height: 48 }) {
  const local = node(localBox);
  const dock = node({ left: 400, right: 800, top: 680, bottom: 774, width: 400, height: 94 });
  const elements = { 'shred-drop': local, 'task-delete-dock': dock, 'shred-announcement': {} };
  const handlers = {};
  const state = {
    innerWidth: 1300, innerHeight: 800, page: 'plan', demoPreview: false,
    document: {
      getElementById: (id) => elements[id] || null,
      addEventListener(name, callback) { handlers[name] = callback; },
      elementFromPoint: () => null, querySelectorAll: () => [],
      body: { classList: { remove() {} } },
    },
    window: { addEventListener() {} }, cancelAnimationFrame() {},
    shredTask(...args) { state.deleted = args; },
    toast(message) { state.message = message; },
  };
  vm.createContext(state);
  const source = readSource('features/tasks/task-delete.js');
  for (const name of ['shredTargetAt', 'resetShredDeleteZone', 'updateShredDeleteZone'])
    vm.runInContext(namedFunction(source, name), state);
  vm.runInContext(readSource('features/tasks/task-drag.js'), state);
  state.toast = (message) => { state.message = message; };
  const drag = { id: 1, task: { id: 7 }, active: true, x: 1000, y: 590,
    source: node(), ghost: node(), frame: 0 };
  state.drag = drag;
  vm.runInContext('taskDrag = drag', state);
  return { state, local, dock, elements, drag, handlers };
}

test('整个侧栏删除区域含顶部边缘均可松手，区域外只预热不删除', () => {
  const { state, local } = harness();
  const box = local.getBoundingClientRect();
  for (const y of [600, 601, 620, 648])
    assert.equal(state.shredTargetAt(1000, y, box, null).ready, true);
  for (const [x, y] of [[1000, 599], [1000, 649], [899, 620], [1201, 620]])
    assert.equal(state.shredTargetAt(x, y, box, null).ready, false);
});

test('侧栏可见时不再出现中间重复入口，只有侧栏显示命中反馈', () => {
  const { state, local, dock, drag } = harness();
  drag.y = 601;
  state.updateShredDeleteZone(drag, false);
  assert.equal(drag.drop.shred, true);
  assert.equal(local.classList.contains('is-ready'), true);
  assert.equal(dock.classList.contains('is-visible'), false);
  assert.equal(dock.attributes['aria-hidden'], 'true');
  assert.equal(dock.classList.contains('is-ready'), false);
});

test('侧栏不可见才使用底部备用入口，且底部边界之外不接收删除', () => {
  const { state, local, dock, drag } = harness({ left: 900, right: 1200,
    top: 900, bottom: 948, width: 300, height: 48 });
  drag.x = 600;
  drag.y = 681;
  state.updateShredDeleteZone(drag, false);
  assert.equal(drag.drop.shred, true);
  assert.equal(dock.classList.contains('is-visible'), true);
  assert.equal(dock.attributes['aria-hidden'], 'false');
  assert.equal(local.classList.contains('is-ready'), false);
  assert.equal(state.shredTargetAt(600, 775, null, dock.getBoundingClientRect()).ready, false);
});

test('快速拖动最后在删除区松手，使用松手坐标进入碎纸流程', () => {
  const { state, drag, handlers } = harness();
  handlers.pointerup({ pointerId: 1, clientX: 1000, clientY: 601 });
  assert.equal(state.deleted[0], 7);
  assert.equal(state.deleted[1], drag.source);
  assert.equal(state.deleted[2].top, 600);
});

test('离开删除区后松手会取消，不沿用上一帧删除目标', () => {
  const { state, drag, handlers } = harness();
  drag.y = 620;
  state.updateTaskDrag();
  assert.equal(drag.drop.shred, true);
  handlers.pointerup({ pointerId: 1, clientX: 850, clientY: 500 });
  assert.equal(state.deleted, undefined);
  assert.equal(state.message, '已取消移动，任务保持原状');
});

test('固定任务与演示任务不能拖入删除区，取消拖动会清理反馈', () => {
  for (const mode of ['fixed', 'preview']) {
    const { state, local, dock, drag, handlers } = harness();
    drag.y = 620;
    if (mode === 'fixed') drag.task.start = '08:00';
    else state.demoPreview = true;
    state.updateShredDeleteZone(drag, false);
    assert.equal(drag.drop, undefined);
    assert.equal(dock.classList.contains('is-visible'), false);
    handlers.pointercancel();
    assert.equal(local.classList.contains('is-ready'), false);
    assert.equal(state.deleted, undefined);
  }
});
