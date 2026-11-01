const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const vm=require('node:vm');
function setup(api){
 const nodes={'review-error':{textContent:'',isConnected:true},'review-confirm':{},'review-select-all':{}};
 const state={Intl,Date,structuredClone,labels:['重要且紧急','重要不紧急','不重要但紧急','不重要不紧急'],esc:value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char])),modal:html=>state.html=html,closeModal(){nodes['review-error'].isConnected=false},showStudyAlert:message=>state.popup=message,document:{getElementById:id=>nodes[id],querySelectorAll:()=>[]},api:api||(async()=>{}),commitParsed(){state.saved=state.parsed},evidence:[],abilities:[],save(){},render(){}};
 vm.createContext(state);vm.runInContext(readFileSync('frontend/public/review.js','utf8'),state);return {state,nodes,run:source=>vm.runInContext(source,state)};
}
test('直接显示唯一的任务核对表单，不展示模型说明或JSON编辑器',()=>{
 const {state}=setup();
 state.handleAgentResult({id:'run1',route:'schedule',notice:'internal-model-notice',items:[{title:'讨论',start:'2026-11-02T18:30:00+08:00',end:null},{title:'准备材料',date:'2026-11-03'}]});
 assert.match(state.html,/核对识别结果/);assert.match(state.html,/选择第1项任务/);assert.match(state.html,/选择第2项任务/);assert.match(state.html,/灵活任务/);assert.match(state.html,/结束时间/);
 assert.doesNotMatch(state.html,/internal-model-notice|textarea|JSON|null/);
});
test('仅保存勾选条目，并将固定任务切换为灵活任务后清除具体时段',async()=>{
 const calls=[];const {state,run}=setup(async(path,body)=>calls.push({path,body}));
 state.handleAgentResult({id:'run1',route:'schedule',items:[{title:'讨论',start:'2026-11-02T18:30:00+08:00',end:null},{title:'未选择的待补充任务'}]});
 run("reviewRows[0].type='flex';reviewRows[1].selected=false");
 await state.confirmTaskReview();
 assert.equal(calls.length,1);assert.equal(calls[0].body.items.length,1);assert.equal(calls[0].body.items[0].start,null);assert.equal(calls[0].body.items[0].end,null);
 assert.equal(state.saved.length,1);assert.equal(state.saved[0].start,'');assert.equal(state.saved[0].date,'2026-11-02');
});
test('固定任务缺少结束时间时不提交，补充后通过',async()=>{
 const calls=[];const {state,nodes,run}=setup(async(path,body)=>calls.push(body));
 state.handleAgentResult({id:'run2',route:'schedule',items:[{title:'讨论',start:'2026-11-02T18:30:00+08:00',end:null}]});
 await state.confirmTaskReview();assert.equal(calls.length,0);assert.match(nodes['review-error'].textContent,/起止时间/);assert.match(state.popup,/起止时间/);
 run("reviewRows[0].end='19:30'");await state.confirmTaskReview();assert.equal(calls.length,1);assert.equal(state.saved[0].end,'19:30');
});
test('取消待确认请求后，迟到的复检响应不会保存任务',async()=>{
 let resolve;const pending=new Promise(done=>resolve=done);const {state}=setup(()=>pending);
 state.handleAgentResult({id:'run3',route:'schedule',items:[{title:'阅读',date:'2026-11-03'}]});
 const saving=state.confirmTaskReview();state.closeTaskReview();resolve({});await saving;assert.equal(state.saved,undefined);
});
test('推荐同样直接进入可勾选表单，不暴露中间说明',()=>{
 const {state}=setup();state.handleAgentResult({id:'run4',route:'recommend',notice:'internal-recommendation-notice',sources:[],items:[{title:'实验验证',date:'2026-11-03',estimated_minutes:60,completion_criteria:'完成对照实验',important:true,urgent:false,rationale:'internal-plan-description'}]});
 assert.match(state.html,/准备方案/);assert.doesNotMatch(state.html,/internal-recommendation-notice|internal-plan-description|textarea|完成标准|完成对照实验/);
});
test('ISO时间按用户时区转换，避免跨时区导致日期错误',()=>{
 const {state}=setup();assert.deepEqual({...state.localMoment('2026-11-02T18:30:00Z')},{date:'2026-11-03',time:'02:30'});
});
test('参考资料提示区分未配置、未调用、空结果与真实来源',()=>{
 const {state}=setup();
 assert.match(state.referenceStatusHTML({sources:[],search_status:{status:'not_configured'}}),/未启用联网检索/);
 assert.match(state.referenceStatusHTML({sources:[],search_status:{status:'not_used'}}),/本次未进行联网检索/);
 assert.match(state.referenceStatusHTML({sources:[],search_status:{status:'empty'}}),/已进行联网检索/);
 assert.match(state.referenceStatusHTML({sources:[],search_status:{status:'failed',message:'联网检索超时'}}),/联网检索超时/);
 const html=state.referenceStatusHTML({sources:[{title:'真实资料',url:'https://example.com/paper',checked_at:'2026-10-29T12:00:00Z'}],search_status:{status:'success'}});
 assert.match(html,/真实资料/);assert.match(html,/检索时间/);assert.doesNotMatch(html,/未取得/);
});
test('继续历史方案时排除已采纳项，保留原始条目索引用于复检',async()=>{
 const calls=[];const {state,nodes}=setup(async(path,body)=>calls.push(body));
 const items=[0,1,2].map(index=>({title:'任务'+index,date:'2026-11-03',estimated_minutes:30,important:true,urgent:false,rationale:'目标需要'}));
 state.handleAgentResult({id:'history-plan',route:'recommend',items,proposal_indices:[0,1,2],adopted_indices:[1],reused:true});
 assert.match(state.html,/已加入计划/);assert.equal(nodes['review-confirm'].textContent,'确认加入 2 项任务');assert.equal(nodes['review-select-all'].checked,true);
 await state.confirmTaskReview();assert.deepEqual(Array.from(calls[0].indices),[0,2]);assert.deepEqual(Array.from(state.saved,item=>item.proposal_index),[0,2]);
});
test('推荐结果在右侧结果区域渲染，不打开核对弹窗',()=>{
 const {state,nodes}=setup();nodes['rec-result']={innerHTML:'',isConnected:true};
 state.handleAgentResult({id:'inline',route:'recommend',items:[{title:'写作',date:'2026-11-03',estimated_minutes:60,important:true,urgent:false,rationale:'目标需要',deadline:'2026-11-04T10:00:00+08:00',suggested_finish:'2026-11-04T10:00:00+08:00'}]});
 assert.equal(state.html,undefined);assert.match(nodes['rec-result'].innerHTML,/准备方案/);assert.match(nodes['rec-result'].innerHTML,/建议完成：2026-11-04 10:00/);
});
