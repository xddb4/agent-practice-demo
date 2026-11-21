const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readSource, namedFunction } = require('./frontend-source.cjs');

test('慢速滚动时画廊完全显示后才接管交互，返回首页后恢复过渡', () => {
  const state = {
    frame: 0, window: { scrollY: 0 }, distance: 500,
    clamp: value => Math.max(0, Math.min(1, value)),
    originX: 40, originY: 200, targetY: 100, scale: 0.4, reduced: false,
    root: { isConnected: true, classList: { toggle(name, value) { state.galleryActive = value; } } },
    motto: { style: {} }, dock: { style: {} }, todayCard: { style: {} },
    workspace: { style: {} },
  };
  vm.createContext(state);
  vm.runInContext(namedFunction(readSource('layouts/plan-scene.js'), 'update'), state);
  for (let position = 0; position < 490; position += 5) {
    state.window.scrollY = position;
    state.update();
    assert.equal(state.workspace.inert, true);
    assert.equal(state.galleryActive, false);
  }
  state.window.scrollY = 490;
  state.update();
  assert.equal(state.workspace.style.opacity, '1');
  assert.equal(state.workspace.inert, false);
  assert.equal(state.galleryActive, true);
  state.window.scrollY = 200;
  state.update();
  assert.equal(state.workspace.inert, true);
  assert.equal(state.galleryActive, false);
});

test('固定画廊不再次对齐页面滚动，普通画廊仍可对齐', () => {
  const scrolls = [];
  const state = {
    window: { scrollY: 350, innerHeight: 800, scrollTo: value => scrolls.push(value) },
    document: { documentElement: { scrollHeight: 2000 } },
    header: { offsetHeight: 85 }, behavior: () => 'auto',
  };
  vm.createContext(state);
  vm.runInContext(namedFunction(readSource('layouts/workspace-navigation.js'), 'alignGallery'), state);
  const root = { isConnected: true, closest: () => ({}), getBoundingClientRect: () => ({ top: 160 }) };
  state.alignGallery(root);
  assert.equal(scrolls.length, 0);
  root.closest = () => null;
  state.alignGallery(root);
  assert.equal(scrolls.length, 1);
  assert.equal(scrolls[0].top, 399);
});
