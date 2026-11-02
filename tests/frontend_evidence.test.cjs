const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const {readFileSync}=require('node:fs');
function setup(){
 const fields={'edit-title':'修改后标题','edit-body':'新内容','edit-desc':'补充说明','edit-dim':'2'};
 const state={structuredClone,Date,evidence:[{id:1,title:'新证据',body:'内容',dim:0,status:'待确认'},{id:2,title:'观察证据',dim:1,status:'待观察'},{id:3,title:'已接受证据',dim:2,status:'已接受'},{id:4,title:'已拒绝证据',dim:3,status:'已拒绝'}],abilities:['一','二','三','四','五','六'],esc:s=>String(s),saveQueue:Promise.resolve(),save(){state.persisted=structuredClone(state.evidence);return true},async report(){state.reportCount=(state.reportCount||0)+1},modal:html=>state.html=html,closeModal(){state.closed=true},toast(){},showStudyAlert(){},async confirmStudyAction(){return true},val:key=>fields[key]};
 vm.createContext(state);vm.runInContext(readFileSync('frontend/public/evidence_inbox.js','utf8'),state);return state;
}
test('收件箱仅显示待确认及单独分组的待观察，已处理证据在弹窗中',()=>{
 const state=setup(),html=state.evidenceInboxHTML();assert.match(html,/新证据|观察证据|待观察（1）|已处理证据（2）/);assert.doesNotMatch(html,/已接受证据|已拒绝证据/);
 state.showProcessedEvidence();assert.match(state.html,/已接受证据/);assert.match(state.html,/已拒绝证据/);assert.doesNotMatch(state.html,/观察证据/);assert.match(state.html,/删除/);
});
test('处理后离开收件箱，已处理项可反复改选接受或拒绝',async()=>{
 const state=setup();await state.evidenceState(1,'已接受');assert.doesNotMatch(state.evidenceInboxHTML(),/>新证据/);
 await state.evidenceState(1,'已拒绝',true);assert.equal(state.evidence[0].status,'已拒绝');
 await state.evidenceState(1,'已接受',true);assert.equal(state.persisted[0].status,'已接受');
});
test('修改替换为新的待确认候选，原已接受记录不再参与报告',async()=>{
 const state=setup();await state.saveEditedEvidence(3);
 assert(!state.evidence.some(e=>e.id===3));const updated=state.evidence.find(e=>e.title==='修改后标题');assert.equal(updated.status,'待确认');assert.equal(updated.dim,2);assert.equal(state.evidence.length,4);assert.equal(state.closed,true);
});
test('删除需确认，取消保留记录，确认后从持久化数据移除',async()=>{
 const state=setup();state.confirmStudyAction=async()=>false;await state.deleteProcessedEvidence(3);assert(state.evidence.some(e=>e.id===3));
 state.confirmStudyAction=async()=>true;await state.deleteProcessedEvidence(3);assert(!state.persisted.some(e=>e.id===3));assert.equal(state.evidence.length,3);
});
test('保存失败会恢复原状态',async()=>{
 const state=setup();state.saveQueue=Promise.reject(Error('offline'));state.saveQueue.catch(()=>{});await state.evidenceState(1,'已拒绝');assert.equal(state.evidence[0].status,'待确认');
});
