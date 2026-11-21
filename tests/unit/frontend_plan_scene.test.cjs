const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readSource, namedFunction } = require('./frontend-source.cjs');

test('格言保留原换行，长文降低字号，适配后与占位测量一致',()=>{
 const state={getComputedStyle:()=>({fontSize:'60px',fontWeight:'400',fontFamily:'serif',letterSpacing:'2.4px'}),document:{createElement:()=>({getContext:()=>({measureText:text=>({width:text.length*60})})})}};
 vm.createContext(state);vm.runInContext(namedFunction(readSource('layouts/plan-scene.js'),'fitPlanMotto'),state);
 const sizeFor=text=>{
  const sizer={textContent:text,style:{},getBoundingClientRect(){const size=parseFloat(this.style.fontSize)||60;return {height:text.split('\n').reduce((n,line)=>n+Math.max(1,Math.ceil(line.length*size/400)),0)*size*1.6}}};
  const motto={style:{}};state.fitPlanMotto(sizer,motto,400,220);
  assert.equal(sizer.textContent,text);assert.equal(motto.style.fontSize,sizer.style.fontSize);
  assert.ok(sizer.getBoundingClientRect().height<=220);
  return parseFloat(motto.style.fontSize);
 };
 const short=sizeFor('把今天的一小步，走成明天的底气。');
 const long=sizeFor('认真学习与思考，记录过程并不断反思。'.repeat(5));
 assert.ok(long<short);
 const poem=sizeFor('无冥冥之志者，无昭昭之明；\n无惛惛之事者，无赫赫之功。');
 assert.ok(13*poem*1.04<400,'显式换行应计入末尾字距，留出舍入空间，避免额外折行');
});

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
