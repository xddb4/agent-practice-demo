const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const {readFileSync}=require('node:fs');
function setup(){
 const nodes={},timers=new Map();let timer=0;
 function node(){const classes=new Set();return{classes,handlers:{},style:{setProperty(k,v){this[k]=v}},classList:{add(...values){values.forEach(v=>classes.add(v))},remove(...values){values.forEach(v=>classes.delete(v))}},setAttribute(){},addEventListener(k,fn){this.handlers[k]=fn},focus(){},setPointerCapture(){},hasPointerCapture(){return false}}}
 for(const id of ['completion-ticket','ticket-stub','ticket-art','ticket-direct','tear-progress-fill','tear-instructions','ticket-completion-count'])nodes[id]=node();
 const dialog=node();
 const state={Map,Set,Promise,structuredClone,owner:'a',tasks:[{id:1,title:'待完成任务',q:1,date:'2026-11-07',done:false},{id:2,title:'历史完成',done:true}],labels:['紧急','重要','其他','低优先'],completionTicket:null,saveQueue:Promise.resolve(),applied:0,closed:0,
 dataKey:()=>state.owner,esc:s=>String(s),ticketTaskMeta:()=>'',modal:html=>state.html=html,closeModal(){state.closed++;state.completionTicket=null},render(){},applyTaskChange(id,patch){Object.assign(state.tasks.find(t=>t.id===id),patch);state.applied++;return true},api:async()=>({completed_tasks:state.tasks.filter(t=>t.done).length}),matchMedia:()=>({matches:false}),document:{getElementById:id=>nodes[id],querySelector:()=>dialog},setTimeout(fn){const id=++timer;timers.set(id,fn);return id},clearTimeout:id=>timers.delete(id)};
 vm.createContext(state);vm.runInContext(readFileSync('frontend/public/completion_ticket.js','utf8'),state);
 async function advance(){const batch=[...timers.values()];timers.clear();batch.forEach(fn=>fn());await new Promise(resolve=>setImmediate(resolve))}
 state.openCompletionTicket(1);state.closed=0;
 return{state,nodes,advance};
}
test('票根显示真实完成数和PASS，删除旧标题、序号和多余提示',()=>{
 const {state}=setup();assert.match(state.html,/累计完成 1 项|PASS/);assert.doesNotMatch(state.html,/No\.|待盖章|握住右侧|ticket-intro|ticket-shortcut|为这份努力/);
});
test('拖动越远卷曲越深，未达到阈值及纯纵向拖动不提交',()=>{
 const {state,nodes}=setup(),stub=nodes['ticket-stub'];
 const event=(x,y)=>({button:0,pointerId:1,clientX:x,clientY:y,preventDefault(){}});
 stub.handlers.pointerdown(event(0,0));stub.handlers.pointermove(event(30,0));const first=Number(stub.style['--tear-progress']);
 stub.handlers.pointermove(event(70,0));assert(Number(stub.style['--tear-progress'])>first);assert.match(stub.style.transform,/rotateY/);
 stub.handlers.pointerup(event(70,0));assert.equal(state.applied,0);assert.equal(stub.style['--tear-progress'],'0');
 stub.handlers.pointerdown(event(0,0));stub.handlers.pointermove(event(0,300));stub.handlers.pointerup(event(0,300));assert.equal(state.applied,0);
});
test('取消撕票不修改任务',async()=>{
 const {state,advance}=setup();const operation=state.tearCompletionTicket();state.closeModal();await advance();await operation;assert.equal(state.applied,0);assert.equal(state.tasks[0].done,false);
});
test('只有保存成功才盖章，重复触发不重复完成',async()=>{
 const {state,nodes,advance}=setup();const operation=state.tearCompletionTicket(true);state.tearCompletionTicket(true);
 await advance();assert.equal(state.applied,1);assert(nodes['ticket-art'].classes.has('is-stamped'));assert.equal(state.closed,0);assert.equal(nodes['tear-instructions'].textContent,'WELL DONE！');
 await advance();await operation;assert.equal(state.closed,1);
});
test('保存失败恢复待完成状态，不展示盖章',async()=>{
 const {state,nodes,advance}=setup();state.saveQueue=Promise.reject(Error('offline'));state.saveQueue.catch(()=>{});
 const operation=state.tearCompletionTicket();await advance();await operation;
 assert.equal(state.tasks[0].done,false);assert(!nodes['ticket-art'].classes.has('is-stamped'));assert.match(nodes['tear-instructions'].textContent,/保存未成功/);
});
test('切换账号后旧票据不提交',async()=>{
 const {state,advance}=setup();const operation=state.tearCompletionTicket();state.owner='b';await advance();await operation;assert.equal(state.applied,0);
});
