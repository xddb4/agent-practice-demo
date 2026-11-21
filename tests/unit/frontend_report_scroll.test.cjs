const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const {readFileSync}=require('node:fs');

function setup(report=async()=>undefined){
 const grid={};
 const state={report,window:{addEventListener(){},scrollTo:value=>{state.scroll=value}},document:{querySelector:selector=>selector==='#content > .report-grid'?grid:state.existingReport}};
 vm.createContext(state);
 vm.runInContext(readFileSync('code/frontend/src/components/report/report-scroll.js','utf8'),state);
 return {state,grid};
}

test('能力维度只由按钮或键盘切换，普通滚动不驱动，边界和减少动效模式保持可用',()=>{
 const element=()=>({children:[],dataset:{},isConnected:true,handlers:{},style:{setProperty(k,v){this[k]=v}},classList:{add(){},toggle(){}},
  append(...nodes){this.children.push(...nodes)},addEventListener(k,fn){this.handlers[k]=fn},setAttribute(k,v){this[k]=v}});
 const parts=Object.fromEntries(['pin','viewport','steps','count','prev','next'].map(k=>[k,element()]));
 parts.viewport.clientWidth=600;
 const cards=Array.from({length:6},(_,i)=>({...element(),offsetLeft:i*528,childNodes:[],querySelector:s=>s==='h3'?{textContent:'能力'+i}:null}));
 const grid={...element(),scrollWidth:3140,closest:()=>null,querySelectorAll:()=>cards,before(root){this.root=root}};
 const windowEvents={};const motion={matches:false,addEventListener(k,fn){this[k]=fn}};
 const state={report:async()=>{},innerHeight:900,AbortController,uiSymbol:()=>'<svg></svg>',matchMedia:()=>motion,
  ResizeObserver:class{observe(){}disconnect(){}},MutationObserver:class{observe(){}disconnect(){}},
  window:{addEventListener(k,fn){windowEvents[k]=fn}},document:{querySelector:()=>null,getElementById:()=>element(),createElement(){
   const el=element();el.querySelector=s=>parts[s.replace('.ability-scroll-','')];return el;
  }}};
 vm.createContext(state);vm.runInContext(readFileSync('code/frontend/src/components/report/report-scroll.js','utf8'),state);
 state.mountAbilityScroll(grid);
 assert.equal(parts.count.textContent,'1 / 6');assert.equal(parts.prev.disabled,true);
 assert.equal(windowEvents.scroll,undefined,'不绑定页面滚动事件');
 parts.next.handlers.click();assert.equal(parts.count.textContent,'2 / 6');
 const translated=grid.style.transform;state.scrollY=9000;windowEvents.resize();assert.equal(grid.style.transform,translated);
 parts.viewport.handlers.keydown({target:parts.viewport,key:'End',preventDefault(){}});
 assert.equal(parts.count.textContent,'6 / 6');assert.equal(parts.next.disabled,true);
 parts.next.handlers.click();assert.equal(parts.count.textContent,'6 / 6');
 motion.matches=true;motion.change();parts.prev.handlers.click();assert.equal(parts.count.textContent,'5 / 6');
 parts.steps.children[0].handlers.click();assert.equal(parts.count.textContent,'1 / 6');
 assert.equal(cards[0].inert,false);assert.equal(cards[1].inert,true);
});

test('报告请求失败或没有新网格时保留现有控制',()=>{
 const {state}=setup();
 state.cleanups=0;
 vm.runInContext('abilityScrollCleanup=()=>{cleanups++}',state);
 state.mountAbilityScroll(null);
 state.mountAbilityScroll({closest:()=>({})});
 assert.equal(state.cleanups,0);
});

test('等待真实报告内容返回后才挂载，不提前展示伪造能力数据',async()=>{
 let release;
 const pending=new Promise(resolve=>release=resolve);
 const {state,grid}=setup(async()=>{await pending;return 'report-ready'});
 let mounted;
 state.mountAbilityScroll=node=>{mounted=node};
 const result=state.report();
 assert.equal(mounted,undefined);
 release();
 assert.equal(await result,'report-ready');
 assert.equal(mounted,grid);
});

test('首次进入报告回到开头，审核证据后的报告刷新保留阅读位置',async()=>{
 const {state}=setup();
 let selected;state.mountAbilityScroll=(grid,index)=>{selected=index};
 await state.report();
 assert.equal(state.scroll.top,0);
 state.scroll=undefined;
 state.existingReport={dataset:{abilityIndex:'3'}};
 await state.report();
 assert.equal(state.scroll,undefined);
 assert.equal(selected,3,'证据更新后保留已选择维度');
});
