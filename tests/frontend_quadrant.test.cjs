const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const {readFileSync}=require('node:fs');
function setup(){
 const nodes={content:{innerHTML:''},'recommendation-panel':{hidden:true},'recommendation-toggle':{setAttribute(k,v){this[k]=v}}};
 const state={tasks:[{id:1,title:'待办任务',q:0,date:'2026-11-02'},{id:2,title:'完成任务',q:0,done:true},{id:3,title:'另一象限',q:1}],labels:['重要且紧急','重要不紧急','不重要但紧急','不重要不紧急'],activeAccount:{id:'user'},page:'matrix',selectedPlanId:null,selectedPlanTitle:'',selectedQuadrant:0,esc:s=>String(s),qSelect:()=>'<select></select>',head:(a,b,c)=>a+b+c,updatePlanReference(){},dragClickUntil:0,
 document:{getElementById:id=>nodes[id],querySelector:()=>null,querySelectorAll:()=>[]},modal:html=>state.modalHTML=html,toggle:id=>state.tasks.find(t=>t.id===id).done=true,render(){state.matrix()},login(){},detail(){}};
 vm.createContext(state);
 state.taskPriority=(a,b)=>(a.ddl||'9999').localeCompare(b.ddl||'9999');
 vm.runInContext(readFileSync('frontend/public/quadrant_view.js','utf8'),state);
 return {state,nodes};
}
test('象限排除完成记录，点击象限弹窗列出实际条目',()=>{
 const {state}=setup();assert.doesNotMatch(state.quadHTML(),/完成任务/);
 state.showQuadrantTasks(0);assert.match(state.modalHTML,/待办任务/);assert.doesNotMatch(state.modalHTML,/另一象限|完成任务|推荐任务/);assert.match(state.modalHTML,/计划日期|截止日期|地点/);
 state.completeQuadrantTask(1,0);assert.match(state.modalHTML,/暂无待办/);assert.equal(state.tasks.length,3);
});
test('完成确认尚未提交时不覆盖确认弹窗',()=>{
 const {state}=setup();state.toggle=()=>state.modalHTML='完成确认';
 state.completeQuadrantTask(1,0);assert.equal(state.modalHTML,'完成确认');assert.equal(state.tasks[0].done,undefined);
});
test('推荐按钮直接打开独立聊天工作台',()=>{
 const {state,nodes}=setup();state.matrix();assert.equal(state.selectedQuadrant,null);
 assert.match(nodes.content.innerHTML,/recommendation-toggle/);assert.doesNotMatch(nodes.content.innerHTML,/加入此象限|根据任务与本地能力记录提供规则建议/);
 let opened=false;state.openPlanDialogue=()=>{opened=true};
 state.openPersonalizedRecommendations();assert.equal(opened,true);
 assert.doesNotMatch(nodes.content.innerHTML,/recommendation-panel/);
});
