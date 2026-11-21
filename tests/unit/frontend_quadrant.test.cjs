const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const {readFileSync}=require('node:fs');
function setup(){
 const nodes={content:{innerHTML:''},'recommendation-panel':{hidden:true},'recommendation-toggle':{setAttribute(k,v){this[k]=v}}};
 const state={tasks:[{id:1,title:'待办任务',q:0,date:'2026-11-02'},{id:2,title:'完成任务',q:0,done:true},{id:3,title:'另一象限',q:1}],labels:['重要且紧急','重要不紧急','不重要但紧急','不重要不紧急'],activeAccount:{id:'user'},page:'matrix',selectedPlanId:null,selectedPlanTitle:'',selectedQuadrant:0,esc:s=>String(s),qSelect:()=>'<select></select>',head:(a,b,c)=>a+b+c,updatePlanReference(){},dragClickUntil:0,
 document:{getElementById:id=>nodes[id],querySelector:()=>null,querySelectorAll:()=>[]},modal:html=>state.modalHTML=html,toggle:id=>state.tasks.find(t=>t.id===id).done=true,render(){state.matrix()},login(){},detail(){}};
 vm.createContext(state);
 state.abilities=[];
 vm.runInContext(require('./frontend-source.cjs').namedFunction(readFileSync('code/frontend/src/components/ui/primitives.js','utf8'),'pill'),state);
 vm.runInContext(readFileSync('code/frontend/src/components/tasks/task-description.js','utf8'),state);
 state.taskPriority=(a,b)=>(a.ddl||'9999').localeCompare(b.ddl||'9999');
 vm.runInContext(readFileSync('code/frontend/src/pages/quadrants/quadrant-page.js','utf8'),state);
 return {state,nodes};
}

test('重复课程按相同标题时段地点折叠，只影响展示且可逐次查看',()=>{
 const {state}=setup();
 state.tasks=[1,2,3,4].map(id=>({id,title:'同一课程',date:'2026-11-'+String(2+id*7),start:'08:00',end:'09:35',location:'A101',q:1,course_from_week:1,done:false}));
 const groups=state.quadrantTaskGroups(state.tasks);assert.equal(groups.length,1);assert.equal(groups[0].length,4);
 state.showQuadrantTasks(1);assert.match(state.modalHTML,/×4/);assert.equal((state.modalHTML.match(/同一课程/g)||[]).length,1);
 state.showQuadrantOccurrences([1,2,3,4],1);assert.equal((state.modalHTML.match(/quadrant-detail-item/g)||[]).length,4);assert.equal(state.tasks.length,4);
 assert.equal(state.quadrantTaskGroups([{id:1,title:'同名待办'},{id:2,title:'同名待办'}]).length,2);
});
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
