const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const {readFileSync}=require('node:fs');

function setup(report=async()=>undefined){
 const grid={};
 const state={report,window:{addEventListener(){},scrollTo:value=>{state.scroll=value}},document:{querySelector:selector=>selector==='#content > .report-grid'?grid:state.existingReport}};
 vm.createContext(state);
 vm.runInContext(readFileSync('frontend/public/report_scroll.js','utf8'),state);
 return {state,grid};
}

test('报告横移在起点和终点钳制，向上滚动可连续退回',()=>{
 const {state}=setup();
 assert.deepEqual([0,100,600,1100,1600,600,100].map(y=>state.abilityScrollProgress(y,100,1000)),[0,0,.5,1,1,.5,0]);
 assert.equal(state.abilityScrollProgress(1000,100,0),0);
});

test('报告请求失败或没有新网格时保留现有滚动控制',()=>{
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
 state.mountAbilityScroll=()=>{};
 await state.report();
 assert.equal(state.scroll.top,0);
 state.scroll=undefined;
 state.existingReport={};
 await state.report();
 assert.equal(state.scroll,undefined);
});
