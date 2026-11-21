const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const {readSource,namedFunction}=require('./frontend-source.cjs');

test('过期筛选按截止日期，不隐藏固定、已完成或无截止任务',()=>{
 const state={Date,Intl};vm.createContext(state);vm.runInContext(readSource('utils/date-time.js'),state);
 assert.equal(state.taskExpired({ddl:'2026-11-20'},'2026-11-21'),true);
 for(const task of [{ddl:'2026-11-21'},{date:'2000-01-01'},{ddl:'2000-01-01',start:'08:00'},{ddl:'2000-01-01',done:true},{ddl:'bad'}]) assert.equal(state.taskExpired(task,'2026-11-21'),false);
});

test('过期页显示保留的任务与恢复入口，任务名称经过转义',()=>{
 const state={expiredTaskRecords:[{trashId:'one',task:{title:'<private>',ddl:'2026-11-20',q:1}}],taskTrash:()=>[],labels:['a','b'],esc:s=>String(s).replaceAll('<','&lt;'),modal:html=>state.html=html,document:{querySelectorAll:()=>[]}};
 vm.createContext(state);vm.runInContext(namedFunction(readSource('features/tasks/task-delete.js'),'renderDeletedTasks'),state);
 state.renderDeletedTasks('expired');assert.match(state.html,/过期任务（1）/);assert.match(state.html,/重设日期、截止日期和预计时长/);assert.match(state.html,/&lt;private>/);assert.doesNotMatch(state.html,/<private>/);
 state.renderDeletedTasks();assert.match(state.html,/没有已删除的任务/);
});

test('恢复过期任务强制重填时长并提交日期，切换账号后不写入当前界面',async()=>{
 const submit={disabled:false};
 const form={reportValidity:()=>true,querySelector:()=>submit,isConnected:true};
 const back={};let payload,rendered=0;
 const state={activeAccount:{id:'one'},taskExpiryDay:()=> '2026-11-21',esc:String,modal:html=>state.html=html,document:{getElementById:id=>id==='expired-restore'?form:back},FormData:class{constructor(){return [['date','2090-01-01'],['deadline','2090-01-02'],['duration','25']]}},saveQueue:Promise.resolve(),api:async(path,body)=>{payload={path,body};state.activeAccount={id:'two'};return {tasks:[{id:1}],evidence:[]}},render(){rendered++},toast(){}};
 vm.createContext(state);vm.runInContext(namedFunction(readSource('features/tasks/task-delete.js'),'showExpiredRestore'),state);
 state.showExpiredRestore({trashId:'one',task:{id:1,title:'精听'}});
 assert.match(state.html,/name="duration"[^>]*required/);
 assert.doesNotMatch(state.html,/name="duration"[^>]*value=/);
 await form.onsubmit({preventDefault(){}});
 assert.equal(payload.path,'tasks/1/restore-expired');assert.equal(payload.body.duration,25);assert.equal(rendered,0);assert.equal(submit.disabled,false);
});
