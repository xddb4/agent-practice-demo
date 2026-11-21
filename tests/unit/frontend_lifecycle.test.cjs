const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const {readSource,namedFunction,statementRange}=require('./frontend-source.cjs');

test('已完成列表按上海时间精确到分钟展示，旧时间不伪造',()=>{
 const state={Intl,Date,tasks:[{id:1,title:'精听',done:true,created_at:'2026-11-21T02:03:50Z',completed_at:'2026-11-21T02:45:12Z',elapsed_minutes:42},{id:2,title:'旧任务',done:true}],esc:s=>String(s),modal:html=>state.html=html};
 vm.createContext(state);vm.runInContext(readSource('pages/personal/completed-tasks.js'),state);
 state.renderCompletedTasks();assert.match(state.html,/2026-11-21 10:03/);assert.match(state.html,/2026-11-21 10:45/);assert.match(state.html,/42 分钟/);assert.match(state.html,/未记录/);assert.match(state.html,/重新完成/);
});

test('日历选择日期关闭弹窗并跳到主画廊，不打开当天弹窗',()=>{
 let closed=0,rendered=0,position;
 const state={window:{scrollTo:value=>position=value},clearTimeout(){},galleryHoverTimer:1,closeModal(){closed++},render(){rendered++},requestAnimationFrame:fn=>fn(),document:{querySelector:()=>({dataset:{galleryScroll:'420'}})},openGalleryDayPopup(){throw Error('不应弹出日期窗口')}};
 vm.createContext(state);vm.runInContext(namedFunction(readSource('features/calendar/calendar.js'),'goToCalendarDate'),state);
 state.goToCalendarDate('2026-11-11');assert.equal(state.date,'2026-11-11');assert.equal(state.timelineCenter,'2026-11-11');assert.equal(state.page,'plan');assert.equal(closed,1);assert.equal(rendered,1);assert.equal(position.top,420);
});

test('删除与恢复同时保存任务及回收站，不再丢弃删除记录',()=>{
 const state={tasks:[{id:1,title:'保留时间',created_at:'2026-11-21T02:00:00Z'}],taskTrashRecords:[],persistTasksAndTrash(){},taskTrash(){},structuredClone,save(){state.saved={tasks:structuredClone(state.tasks),trash:structuredClone(state.taskTrashRecords)};return true}};
 vm.createContext(state);vm.runInContext(statementRange(readSource('features/tasks/task-adapters.js'),'baseTrash','baseImportCourses'),state);
 const record={trashId:'one',task:state.tasks[0]};state.persistTasksAndTrash([],[record]);assert.equal(state.saved.trash.length,1);assert.equal(state.taskTrash()[0].task.created_at,'2026-11-21T02:00:00Z');
 state.persistTasksAndTrash([record.task],[]);assert.equal(state.saved.tasks.length,1);assert.equal(state.saved.trash.length,0);
});
