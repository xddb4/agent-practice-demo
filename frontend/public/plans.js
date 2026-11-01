let selectedPlanId=null,selectedPlanTitle='',selectedPlanOwner=null,showArchivedPlans=false;
const recommendWithoutHistory=recommend;
recommend=function(){
 if(selectedPlanOwner!==activeAccount?.id){selectedPlanId=null;selectedPlanTitle='';selectedPlanOwner=activeAccount?.id}
 recommendWithoutHistory();
 document.querySelector('#content .rec-form form')?.insertAdjacentHTML('beforeend','<div id="plan-reference" class="tiny" style="margin-top:12px"></div>');
 document.getElementById('content').insertAdjacentHTML('beforeend','<section class="panel" style="padding:22px;margin-top:22px"><div class="panel-title">我的准备方案 <button class="tiny" onclick="showPlanMemoryInfo()">如何保留与复用？</button></div><label class="tiny"><input style="width:auto" type="checkbox" '+(showArchivedPlans?'checked':'')+' onchange="showArchivedPlans=this.checked;refreshPlanHistory()">显示归档方案</label><div id="plan-history"></div><hr><div id="memory-stats" class="tiny"></div><div style="display:flex;gap:12px;flex-wrap:wrap;margin-top:12px"><button class="secondary" onclick="compactPlanMemory()">无损压缩历史记录</button><select id="memory-age" aria-label="清理记录范围"><option value="30">30天以前</option><option value="90">90天以前</option><option value="0">所有过往记录</option></select><button class="secondary" onclick="cleanupPlanMemory()">清理未使用的旧记录</button></div><p class="tiny">清理仅涉及未被任务引用的识别记录和已归档方案，保留最近5条；正式任务、能力证据与附件不会删除。</p></section>');
 updatePlanReference();refreshPlanHistory();refreshMemoryStats();
};
function showPlanMemoryInfo(){showStudyAlert('每次生成只读取有限数量的近期任务和已接受证据，上下文限制为12000字符；历史方案仅在明确选作参考时读取。\n\n历史记录可无损压缩，使用时自动恢复。归档不删除，清理前会显示范围并再次确认。任务和能力证据不受影响。','记忆如何管理？')}
async function refreshPlanHistory(){
 const root=document.getElementById('plan-history');if(!root)return;
 try{
  const plans=await api('plans?include_archived='+showArchivedPlans);if(!root.isConnected)return;
  root.innerHTML=plans.length?plans.map(plan=>'<div class="preview-item"><b>'+esc(plan.title)+(plan.archived?'（已归档）':'')+'</b><p class="tiny">'+(plan.created_at?esc(new Date(plan.created_at).toLocaleString('zh-CN')):'较早生成，时间未记录')+' · '+plan.count+'项任务 · 已加入'+plan.adopted_count+'项</p><div style="display:flex;gap:12px;flex-wrap:wrap"><button class="secondary" onclick="openSavedPlan(\''+esc(plan.id)+'\')">查看／继续采纳</button><button class="secondary" onclick="copySavedPlan(\''+esc(plan.id)+'\')">复用为新方案</button><button class="tiny" onclick="usePlanAsReference(\''+esc(plan.id)+'\')">作为生成参考</button><button class="tiny" onclick="archiveSavedPlan(\''+esc(plan.id)+'\','+!plan.archived+')">'+(plan.archived?'取消归档':'归档')+'</button><button class="tiny" onclick="deleteSavedPlan(\''+esc(plan.id)+'\')">删除记录</button></div></div>').join(''):'<p class="tiny">生成的准备方案会保留在这里，之后可继续使用。</p>';
 }catch(error){if(root.isConnected)root.textContent=error.message}
}
async function refreshMemoryStats(){const root=document.getElementById('memory-stats');if(!root)return;try{const stats=await api('memory');if(root.isConnected)root.textContent='生成记录 '+stats.records+' 条 · 已压缩 '+stats.compressed+' 条 · 占用 '+(stats.bytes/1024).toFixed(1)+' KB · 每次上下文上限12000字符'}catch(error){if(root.isConnected)root.textContent=error.message}}
async function compactPlanMemory(){try{const result=await api('memory/compact',{});showStudyAlert('已无损压缩'+result.compressed+'条记录，节省'+(result.bytes_saved/1024).toFixed(1)+' KB；方案内容和来源完整保留。','压缩完成');refreshMemoryStats()}catch(error){showStudyAlert(error.message)}}
async function cleanupPlanMemory(){
 try{
  const options={older_than_days:Number(document.getElementById('memory-age').value),keep_recent:5};
  const preview=await api('memory/cleanup-preview',options);
  if(!preview.count)return showStudyAlert('所选范围没有可清理记录。正在使用的方案和最近5条记录会保留。','没有可清理记录');
  if(!await confirmStudyAction('将永久删除'+preview.count+'条未使用的识别记录或归档方案。正式任务、证据和附件保留。'))return;
  const result=await api('memory/cleanup',options);if(result.deleted){selectedPlanId=null;selectedPlanTitle='';updatePlanReference()}showStudyAlert('已清理'+result.deleted+'条历史记录。','清理完成');refreshPlanHistory();refreshMemoryStats();
 }catch(error){showStudyAlert(error.message)}
}
async function archiveSavedPlan(id,archived){try{await api('plans/'+encodeURIComponent(id)+'/archive',{archived});refreshPlanHistory();refreshMemoryStats()}catch(error){showStudyAlert(error.message)}}
async function deleteSavedPlan(id){try{if(!await confirmStudyAction('将永久删除这份历史方案记录。已采纳的正式任务不会被删除；正在使用的方案请改用归档。','删除方案记录？'))return;await api('plans/'+encodeURIComponent(id),undefined,'DELETE');if(selectedPlanId===id){selectedPlanId=null;selectedPlanTitle='';updatePlanReference()}refreshPlanHistory();refreshMemoryStats()}catch(error){showStudyAlert(error.message)}}
async function openSavedPlan(id){try{await saveQueue;const plan=await api('plans/'+encodeURIComponent(id));handleAgentResult(plan)}catch(error){showStudyAlert(error.message,'无法打开方案')}}
async function copySavedPlan(id){try{const plan=await api('plans/'+encodeURIComponent(id)+'/copy',{});handleAgentResult(plan)}catch(error){showStudyAlert(error.message,'无法复制方案')}}
async function usePlanAsReference(id){
 try{
  const plan=await api('plans/'+encodeURIComponent(id));selectedPlanId=plan.id;selectedPlanTitle=plan.title;selectedPlanOwner=activeAccount?.id;
  let inputs={};try{inputs=JSON.parse(plan.input_source)}catch{}
  const title=document.getElementById('r-title');if(title)title.value=inputs['目标']||plan.title;
  const hours=document.getElementById('r-hours');if(hours&&inputs['每周小时'])hours.value=inputs['每周小时'];
  const focus=document.getElementById('r-focus');if(focus&&inputs['基础与约束'])focus.value=inputs['基础与约束'];
  updatePlanReference();document.getElementById('r-ddl')?.focus();
 }catch(error){showStudyAlert(error.message,'无法选用方案')}
}
function updatePlanReference(){const root=document.getElementById('plan-reference');if(root)root.innerHTML=selectedPlanId?'参考方案：'+esc(selectedPlanTitle)+'。请核对本次截止日期。 <button class="tiny" onclick="selectedPlanId=null;selectedPlanTitle=\'\';updatePlanReference()">取消参考</button>':''}
generateRec=function(event){
 event.preventDefault();if(!activeAccount)return login();
 const output=document.getElementById('rec-result');if(output)output.innerHTML='<p class="subtitle" role="status">正在根据可投入时间生成准备方案…</p>';
 parent.postMessage({type:'agent',payload:{route:'recommend',text:JSON.stringify({目标:val('r-title'),截止日期:val('r-ddl'),每周小时:val('r-hours'),基础与约束:val('r-focus')}),base_plan_id:selectedPlanId}},location.origin);
};
window.addEventListener('message',event=>{
 if(event.source!==parent||event.origin!==location.origin||event.data.type!=='agent-cancelled'||event.data.route!=='recommend')return;
 const output=document.getElementById('rec-result');if(output)output.innerHTML='<p class="subtitle">生成已取消，输入已保留，可修改后重试。</p>';
});
