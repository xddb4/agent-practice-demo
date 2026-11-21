const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const {readSource}=require('./frontend-source.cjs');

function mount(reduced=false, withWebGL=false) {
  const frames=new Map(), listeners=new Map(), observers=[];
  let next=1, now=0;
  const rect=(left,width)=>({left,top:0,width,height:40});
  const children=[{getBoundingClientRect:()=>rect(0,100)},{getBoundingClientRect:()=>rect(103,100)}];
  const list={children,addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:name=>listeners.delete(name),contains:()=>true};
  const stage={getBoundingClientRect:()=>rect(0,203)};
  const gpu={counts:[],clears:0};
  const gl=withWebGL?new Proxy({
    getProgramParameter:()=>true,getUniformLocation:(_,name)=>name,
    getAttribLocation:()=>0,uniform1i:(name,value)=>{if(name==='uCount')gpu.counts.push(value)},
    clear:()=>gpu.clears++,
  },{get:(object,key)=>key in object?object[key]:/^[A-Z_]+$/.test(key)?1:()=>({})}):null;
  const canvas={style:{},getContext:()=>gl};
  const overlay={style:{}},fallback={style:{}};
  const document={hidden:false,addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:name=>listeners.delete(name)};
  const state={window:{devicePixelRatio:2,matchMedia:()=>({matches:reduced})},document,performance:{now:()=>now},requestAnimationFrame:fn=>{const id=next++;frames.set(id,fn);return id},cancelAnimationFrame:id=>frames.delete(id),ResizeObserver:class{constructor(fn){this.callback=fn;observers.push(this)}observe(){}disconnect(){this.disconnected=true}}};
  vm.createContext(state);vm.runInContext(readSource('effects/gooey-navigation.js'),state);
  const engine=state.window.mountStudyGooey({stage,canvas,list,overlay,fallback},0);
  function advance(ms=16){now+=ms;const pending=[...frames.values()];frames.clear();pending.forEach(fn=>fn(now));}
  return {engine,frames,overlay,fallback,canvas,listeners,observers,document,advance,gpu};
}

test('快速切换在有限时间内回归唯一胶囊并停止帧循环',()=>{
  const nav=mount();nav.engine.go(1);nav.advance();nav.engine.go(0);nav.advance();nav.engine.go(1);
  for(let i=0;i<80 && nav.frames.size;i++)nav.advance();
  assert.equal(nav.frames.size,0);
  assert.equal(nav.overlay.style.visibility,'visible');
  assert.equal((nav.overlay.style.clipPath.match(/M/g)||[]).length,1);
  assert.match(nav.fallback.style.transform,/translate\(103\.00px/);
});

test('离开主导航页面后无残留，缩放不会恢复最初的选中项',()=>{
  const nav=mount();nav.engine.go(1);nav.advance();nav.engine.go(-1);
  assert.equal(nav.frames.size,0);assert.equal(nav.overlay.style.visibility,'hidden');
  assert.equal(nav.fallback.style.opacity,'0');
  nav.observers[0].callback();
  assert.equal(nav.overlay.style.visibility,'hidden');assert.equal(nav.fallback.style.opacity,'0');
  nav.engine.go(1);assert.equal(nav.overlay.style.visibility,'visible');
});

test('切到后台或销毁会停止动画并清理画布、裁剪及监听器',()=>{
  const nav=mount();nav.engine.go(1);nav.document.hidden=true;nav.listeners.get('visibilitychange')();
  assert.equal(nav.frames.size,0);
  nav.engine.go(0);nav.engine.dispose();
  assert.equal(nav.frames.size,0);assert.equal(nav.overlay.style.visibility,'hidden');
  assert.equal(nav.canvas.style.display,'none');assert.equal(nav.fallback.style.opacity,'0');
  assert.equal(nav.listeners.size,0);assert.equal(nav.observers[0].disconnected,true);
  nav.observers[0].callback();assert.equal(nav.overlay.style.visibility,'hidden');
});

test('减少动态效果偏好直接切换，不启动粒子帧循环',()=>{
  const nav=mount(true);nav.engine.go(1);
  assert.equal(nav.frames.size,0);assert.equal(nav.overlay.style.visibility,'visible');
  assert.match(nav.fallback.style.transform,/translate\(103\.00px/);
});

test('WebGL 保留原九粒子效果，退出时清空粒子及画布',()=>{
  const nav=mount(false,true);nav.engine.go(1);for(let i=0;i<8;i++)nav.advance();
  assert.equal(nav.canvas.style.display,'block');
  assert.equal(nav.canvas.width,(203+72*2)*2);
  assert.ok(nav.gpu.counts.includes(9));
  nav.engine.go(-1);assert.equal(nav.gpu.counts.at(-1),0);
  assert.equal(nav.overlay.style.visibility,'hidden');
  const before=nav.gpu.clears;nav.engine.dispose();assert.ok(nav.gpu.clears>before);
});

test('页面渲染拖慢首帧时仍播放粒子效果，不被墙上时间超时直接跳过',()=>{
  const nav=mount(false,true);nav.engine.go(1);nav.advance(1200);nav.advance(80);
  assert.ok(nav.frames.size>0);assert.ok(nav.gpu.counts.some(count=>count>0));
  for(let i=0;i<100&&nav.frames.size;i++)nav.advance();
  assert.equal(nav.frames.size,0);
});

test('导航在同步页面渲染之前收到切换状态',()=>{
  const calls=[];
  const state={page:'plan',render:()=>calls.push('render'),updateTopNavigation:()=>calls.push('navigation')};
  vm.createContext(state);vm.runInContext(readSource('app/router.js')+'\nthis.router=StudyPilotRouter;',state);
  state.router.navigate('matrix');assert.equal(state.page,'matrix');assert.deepEqual(calls,['navigation','render']);
});

test('批量过期判断复用格式化器，跨上海午夜仍取得新日期',()=>{
  let instances=0;
  class Clock extends Date {constructor(){super(Clock.value)}}
  Clock.value='2026-11-21T15:59:00Z';
  const state={Date:Clock,Intl:{DateTimeFormat:class{constructor(...args){instances++;return new Intl.DateTimeFormat(...args)}}}};
  vm.createContext(state);vm.runInContext(readSource('utils/date-time.js'),state);
  for(let i=0;i<1000;i++)assert.equal(state.taskExpired({ddl:'2026-11-21'}),false);
  assert.equal(instances,1);
  Clock.value='2026-11-21T16:01:00Z';
  assert.equal(state.taskExpired({ddl:'2026-11-21'}),true);assert.equal(instances,1);
});
