const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const {readFileSync}=require('node:fs');
test('四象限共享任务在日计划按类型、日期、DDL投影，其他日期不会消失',()=>{
 const state={};vm.createContext(state);vm.runInContext(readFileSync('frontend/public/task_views.js','utf8'),state);
 const list=[{id:1,start:'08:00',date:'2026-11-01',q:1},{id:2,date:'2026-10-30',ddl:'2026-10-31',q:0,duration:60},{id:3,date:'2026-11-01',ddl:'2026-11-03',q:1,duration:30},{id:4,date:'2026-11-05',ddl:'2026-11-06',q:2},{id:5,date:'',q:3}];
 const view=state.flexibleGroups(list,'2026-11-01');assert.equal(view.all.length,4);assert.deepEqual(Array.from(view.current,item=>item.id),[2,3,5]);assert.deepEqual(Array.from(view.other,item=>item.id),[4]);assert.equal(list[0].id,1);
});
test('同一任务多个建议时段仍按任务身份计数一次',()=>{
 const state={};vm.createContext(state);vm.runInContext(readFileSync('frontend/public/task_views.js','utf8'),state);
 const view=state.flexibleGroups([{id:1,date:'2026-11-01',suggested_sessions:[{start:'2026-11-02T08:00'},{start:'2026-11-02T10:00'}]}],'2026-11-02');assert.equal(view.current.length,1);
});

test('无截止日期的未完成任务不受计划日期限制，保持显示并排在有DDL任务之后',()=>{
 const state={};vm.createContext(state);vm.runInContext(readFileSync('frontend/public/task_views.js','utf8'),state);
 const list=[{id:1,date:'2026-12-01',q:0},{id:2,date:'2026-11-02',ddl:'2026-11-08',q:3},{id:3,date:'2026-12-01',done:true}];
 for(const day of ['2026-11-02','2026-11-03']){
  const view=state.flexibleGroups(list,day);
  assert.deepEqual(Array.from(view.current,item=>item.id),[2,1]);
  assert(!view.current.some(item=>item.id===3));
 }
});

test('个性化推荐入口打开现有推荐页',()=>{
 const state={activeAccount:{id:'test'},page:'plan',render(){state.rendered=true}};
 vm.createContext(state);vm.runInContext(readFileSync('frontend/public/task_views.js','utf8'),state);
 state.openPersonalizedRecommendations();assert.equal(state.page,'recommend');assert(state.rendered);
});

test('已完成任务从当前列表、其他日期列表与待办数量中排除，原任务仍保留',()=>{
 const state={};vm.createContext(state);vm.runInContext(readFileSync('frontend/public/task_views.js','utf8'),state);
 const list=[{id:1,date:'2026-11-02',done:true},{id:2,date:'2026-12-01',ddl:'2026-12-02',done:true},{id:3,date:'2026-11-02',done:false}];
 const view=state.flexibleGroups(list,'2026-11-02');
 assert.deepEqual(Array.from(view.all,item=>item.id),[3]);assert.equal(view.current.length,1);assert.equal(view.other.length,0);assert.equal(list.length,3);
 list[0].done=false;
 assert.equal(state.flexibleGroups(list,'2026-11-02').all.length,2);
});
test('画廊日期与侧栏同步显示跨日建议时段，固定任务不被复制',()=>{
 const task={id:1,date:'2026-11-01',suggested_sessions:[{start:'2026-11-02T08:00'}]},fixed={id:2,date:'2026-11-02',start:'14:00',end:'15:00'};
 const state={timelineTasks:()=>[task,fixed],tasksOn:()=>[fixed]};vm.createContext(state);vm.runInContext(readFileSync('frontend/public/task_views.js','utf8'),state);
 assert.deepEqual(Array.from(state.tasksOn('2026-11-02'),item=>item.id),[2,1]);
});
