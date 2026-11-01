const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const vm=require('node:vm');
const source=readFileSync('frontend/public/features.js','utf8');
test('回到今天重置日期、画廊中心与时间轴，并抑制重绘时误悬停',()=>{
 const fn=source.slice(source.indexOf('centerToday=function(){'),source.indexOf('const renderPlanWithOriginalToolbar'));
 let cleared,listener;
 class FixedDate extends Date {constructor(){super('2026-11-02T17:00:00Z')}static now(){return 0}}
 const state={Intl,Date:FixedDate,galleryHoverTimer:12,date:'2026-10-01',timelineCenter:'2026-10-01',timelineMode:'week',galleryTimelineExpanded:false,clearTimeout:id=>cleared=id,render(){this.rendered=true},document:{getElementById:()=>({addEventListener:(type,handler,capture)=>{listener=handler;assert.equal(capture,true)}})}};
 vm.createContext(state);vm.runInContext(fn,state);state.centerToday();
 assert.equal(cleared,12);assert.equal(state.date,'2026-11-03');assert.equal(state.timelineCenter,'2026-11-03');assert.equal(state.timelineMode,'day');assert.equal(state.galleryTimelineExpanded,true);
 let stopped=false;listener({stopPropagation(){stopped=true}});assert.equal(stopped,true);
});
test('灵活代办标题使用当前日期的灵活任务数量',()=>{
 const fn=source.slice(source.indexOf('const originalFlexibleHTML'),source.indexOf('centerToday=function(){'));
 const state={date:'2026-10-29',tasksOn:()=>[{start:'08:00'},{title:'a'},{title:'b'}],flexibleHTML:()=>'<div class="section-label"><span>旧标题</span><span>其他内容</span></div>'};
 vm.createContext(state);vm.runInContext(fn,state);
 assert.equal(state.flexibleHTML(),'<div class="section-label"><span>灵活代办：2条</span><span>其他内容</span></div>');
});
