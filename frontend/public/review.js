// 只显示面向用户的候选表单，不显示模型说明、执行过程或JSON编辑器。
let reviewContext=null,reviewRows=[],reviewBusy=false,reviewGeneration=0;
function closeTaskReview(){reviewGeneration++;reviewBusy=false;const inline=reviewContext?.route==='recommend'&&document.getElementById('rec-result');if(inline)inline.innerHTML='<p class="subtitle">方案已保留，可从历史方案重新打开。</p>';closeModal()}
function localMoment(iso){
 if(!iso)return {date:'',time:''};
 const value=new Date(iso);if(Number.isNaN(value.getTime()))return {date:'',time:''};
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(value);
 const get=type=>parts.find(x=>x.type===type).value;
 return {date:get('year')+'-'+get('month')+'-'+get('day'),time:get('hour')+':'+get('minute')};
}
function candidateRow(raw,index){
 const start=localMoment(raw.start),end=localMoment(raw.end),ddl=localMoment(raw.deadline);
 return {id:Date.now()+index,raw,selected:true,title:raw.title,date:raw.date||start.date||ddl.date||'',type:raw.start?'fixed':'flex',start:start.time,end:end.time,location:raw.location||'',ddl:ddl.date,duration:raw.estimated_minutes??'',standard:raw.completion_criteria||'',q:raw.important?(raw.urgent?0:1):(raw.urgent?2:3)};
}
function handleAgentResult(result){
 if(result.route==='evidence'){
  evidence.unshift(...result.items.map((item,index)=>({id:Date.now()+index,title:item.title,body:item.source,desc:item.rationale,dim:abilities.indexOf(item.dimension),status:'待确认'})));
  save();closeModal();page='report';render();return;
 }
 if(result.items.some(item=>Object.hasOwn(item,'from_week'))){
  courseRows=result.items.map(item=>({title:item.title,day:item.day??0,start:item.start||'',end:item.end||'',location:item.location||'',from:item.from_week??'',to:item.to_week??'',pattern:item.pattern||'all',q:item.q??1}));reviewCourseImage();return;
 }
 reviewGeneration++;reviewContext=result;reviewRows=result.items.map((item,index)=>{const row=candidateRow(item,index);row.proposalIndex=result.proposal_indices?.[index]??index;row.adopted=(result.adopted_indices||[]).includes(row.proposalIndex);row.selected=!row.adopted;return row});reviewBusy=false;renderTaskReview();
 if(result.route==='recommend'&&typeof refreshPlanHistory==='function')refreshPlanHistory();
}
previewParsed=function(){
 reviewGeneration++;reviewContext=null;reviewBusy=false;
 reviewRows=parsed.map((task,index)=>({...task,raw:{title:task.title},id:task.id||Date.now()+index,selected:true,type:task.start?'fixed':'flex',date:task.date||'',ddl:task.ddl||'',start:task.start||'',end:task.end||'',location:task.location||'',duration:task.duration??'',standard:task.standard||''}));
 renderTaskReview();
};
function reviewField(index,key,value){
 const row=reviewRows[index];
 row[key]=value;
 if(reviewContext?.route==='recommend'){
  if(key==='selected'||key==='type')refreshRecommendationDetails();
  if(key==='title'){
   const title=document.getElementById('review-task-title-'+index);
   if(title)title.textContent=value;
  }
 }else if(key==='type')renderTaskReview();
 if(key==='selected')updateReviewCount();
}
function updateReviewCount(){
 const count=reviewRows.filter(row=>row.selected).length;
 const eligible=reviewRows.filter(row=>!row.adopted).length;
 const button=document.getElementById('review-confirm');
 if(button){
  button.textContent=reviewContext?.route==='recommend'?'加入日程（'+count+'）':'确认加入 '+count+' 项任务';
  button.disabled=!count||reviewBusy;
 }
 const all=document.getElementById('review-select-all');if(all){all.checked=eligible>0&&count===eligible;all.indeterminate=count>0&&count<eligible;all.disabled=!eligible||reviewBusy}
}
function reviewInput(row,index,key,label,type='text'){
 const value=row[key]??'';
 return '<div class="form-group"><label>'+label+'<input aria-label="第'+(index+1)+'项'+label+'" type="'+type+'" '+(type==='number'?'min="1" max="10080"':'')+' value="'+esc(value)+'" oninput="reviewField('+index+',\''+key+'\',this.value)"></label></div>';
}
function reviewCheckbox(row,index){
 return '<input style="width:auto" type="checkbox" aria-label="选择第'+(index+1)+'项任务" '+(row.selected?'checked':'')+' '+(row.adopted?'disabled data-plan-adopted="true"':'')+' onchange="reviewField('+index+',\'selected\',this.checked)">';
}
function recommendationSessions(row){
 const sessions=(row.raw.suggested_sessions||[]).map(slot=>{
  const start=localMoment(slot.start),end=localMoment(slot.end);
  const minutes=Math.round((Date.parse(slot.end)-Date.parse(slot.start))/60000);
  return start.date&&end.date&&minutes>0?{start,end,minutes}:null;
 }).filter(Boolean);
 return sessions;
}
function recommendedTimesHTML(row){
 const sessions=recommendationSessions(row);
 if(!sessions.length)return '<p class="tiny">建议执行时间尚未安排。</p>';
 return '<div class="review-suggested-times"><b>建议执行时段</b><ol>'+sessions.map(({start,end,minutes})=>
  '<li>'+esc(start.date+' '+start.time+'–'+(start.date===end.date?'':end.date+' ')+end.time)+' · '+minutes+' 分钟</li>'
 ).join('')+'</ol></div>';
}
function reviewTaskDetails(row,index,isRecommendation=false){
 return '<section class="preview-item">'+
 (isRecommendation?'':'<label class="review-task-choice">'+reviewCheckbox(row,index)+(row.adopted?'已加入计划':'加入这项任务')+'</label>')+
 reviewInput(row,index,'title','任务名称')+
 '<div class="form-grid"><div class="form-group"><label>任务类型<select aria-label="第'+(index+1)+'项任务类型" onchange="reviewField('+index+',\'type\',this.value)"><option value="fixed" '+(row.type==='fixed'?'selected':'')+'>固定时间任务</option><option value="flex" '+(row.type==='flex'?'selected':'')+'>灵活任务</option></select></label></div>'+
 reviewInput(row,index,'date','计划日期','date')+'</div>'+
 (isRecommendation?recommendedTimesHTML(row):'')+
 (row.raw.suggested_finish?'<p class="tiny">建议完成：'+esc(localMoment(row.raw.suggested_finish).date+' '+localMoment(row.raw.suggested_finish).time)+'</p>':'')+
 (row.type==='fixed'?'<div class="form-grid">'+reviewInput(row,index,'start','开始时间','time')+reviewInput(row,index,'end','结束时间','time')+'</div>'+reviewInput(row,index,'location','地点')+(isRecommendation?reviewInput(row,index,'duration','预计总时长（分钟）','number'):''):
 '<div class="form-grid">'+reviewInput(row,index,'ddl','截止日期（可不填）','date')+reviewInput(row,index,'duration',isRecommendation?'预计总时长（分钟）':'预计时长（分钟，可不填）','number')+'</div>')+
 '<div class="form-group"><label>四象限分类<select aria-label="第'+(index+1)+'项四象限分类" onchange="reviewField('+index+',\'q\',Number(this.value))">'+labels.map((label,q)=>'<option value="'+q+'" '+(row.q===q?'selected':'')+'>'+label+'</option>').join('')+'</select></label></div>'+
 (!row.date?'<p class="tiny">请补充计划日期。</p>':row.type==='fixed'&&(!row.start||!row.end)?'<p class="tiny">固定任务需补齐开始和结束时间，也可改为灵活任务。</p>':'')+'</section>';
}
function recommendationDetailsHTML(){
 return reviewRows.map((row,index)=>row.selected?reviewTaskDetails(row,index,true):'').join('')||'<p class="tiny">请在任务列表中勾选需要安排的任务。</p>';
}
function refreshRecommendationDetails(){
 const details=document.getElementById('review-plan-details');
 if(details)details.innerHTML=recommendationDetailsHTML();
}
function selectAllReviewTasks(checked){
 reviewRows.forEach(row=>row.selected=!row.adopted&&checked);
 renderTaskReview();
 document.getElementById('review-select-all')?.focus?.();
}
function renderTaskReview(){
 const isRecommendation=reviewContext?.route==='recommend';
 const selectAll='<label class="review-task-choice"><input style="width:auto" id="review-select-all" type="checkbox" onchange="selectAllReviewTasks(this.checked)">全选未加入的任务</label>';
 const tasks=isRecommendation?
  '<div class="review-plan-layout"><section class="review-plan-list"><h3>选择任务</h3>'+selectAll+
   reviewRows.map((row,index)=>{
    const count=recommendationSessions(row).length;
    return '<label class="review-task-choice review-plan-option">'+reviewCheckbox(row,index)+'<span><b id="review-task-title-'+index+'">'+esc(row.title)+'</b><small>建议执行 '+(count||1)+' 次'+(count?'':' · 时段待定')+(row.adopted?' · 已加入计划':'')+'</small></span></label>';
   }).join('')+
  '</section><section class="review-plan-editor"><h3>执行安排</h3><div id="review-plan-details">'+recommendationDetailsHTML()+'</div></section></div>':
  selectAll+reviewRows.map((row,index)=>reviewTaskDetails(row,index)).join('');
 const confirm='<button id="review-confirm" class="primary" onclick="confirmTaskReview()"></button>';
 const close='<button onclick="closeTaskReview()" aria-label="关闭核对窗口">✕</button>';
 const heading='<div class="modal-head"><h2>'+(isRecommendation?'准备方案':'核对识别结果')+'</h2>'+
  (isRecommendation?'<div class="review-plan-actions">'+confirm+close+'</div>':close)+'</div>';
 const description='<p class="desc">'+(isRecommendation?'勾选要采纳的任务，再核对执行安排。每个建议时段计为一次执行。':'勾选需要加入的任务，可以修改内容并选择固定时间或灵活安排。')+'</p>';
 const historyNote=reviewContext?.reused?'<p class="tiny">历史方案可继续采纳；来源保留原检索时间，复用前请核对最新要求。</p>':'';
 const notes=(isRecommendation?referenceStatusHTML(reviewContext):'')+
 (reviewContext?.planning?.warnings?.length?'<p class="notice">'+reviewContext.planning.warnings.map(esc).join('<br>')+'</p>':'')+
 (reviewContext?.planning?.weekly_minutes?'<p class="tiny">每周投入 '+reviewContext.planning.weekly_minutes+' 分钟 · 本方案 '+reviewContext.planning.minutes_requested+' 分钟。建议时段按每日均分预算，并避开现有固定安排，可自行修改。</p>':'');
 const error='<p id="review-error" hidden></p>';
 if(isRecommendation){
  modal('<div class="review-plan-main">'+heading+description+historyNote+tasks+error+'</div><div class="review-plan-notes">'+notes+'</div>');
 }else{
  modal(heading+description+historyNote+tasks+notes+error+'<div class="modal-footer"><button class="secondary" onclick="closeTaskReview()">取消</button>'+confirm+'</div>');
 }
 updateReviewCount();
}
function reviewedTask(row){
 const duration=row.duration===''?null:Number(row.duration);
 const keepSuggestion=row.type==='flex'&&row.date===row.raw.date&&row.ddl===localMoment(row.raw.deadline).date;
 return {id:row.id,title:row.title.trim(),date:row.date,start:row.type==='fixed'?row.start:'',end:row.type==='fixed'?row.end:'',location:row.location,ddl:row.ddl,duration,standard:'',q:row.q,done:false,repeat:'不重复',suggest:keepSuggestion&&row.raw.suggested_finish?'建议完成 '+localMoment(row.raw.suggested_finish).date+' '+localMoment(row.raw.suggested_finish).time:'未设置',suggested_sessions:keepSuggestion?(row.raw.suggested_sessions||[]):[],ability:0,source:row.raw.source||'',agent_run_id:reviewContext?.id,proposal_index:row.proposalIndex};
}
function reviewedCandidate(row,route){
 const fixed=row.type==='fixed';const stamp=time=>row.date+'T'+time+':00+08:00';
 const item={...row.raw,title:row.title.trim(),date:row.date,start:fixed?stamp(row.start):null,end:fixed?stamp(row.end):null,important:row.q===0||row.q===1,urgent:row.q===0||row.q===2,estimated_minutes:row.duration===''?null:Number(row.duration)};
 delete item.completion_criteria;
 if(route==='recommend'&&(fixed||row.date!==row.raw.date||row.ddl!==localMoment(row.raw.deadline).date)){item.suggested_finish=null;item.suggested_sessions=[]}
 item.deadline=row.ddl?(row.ddl===localMoment(row.raw.deadline).date?row.raw.deadline:row.ddl+'T23:59:00+08:00'):null;
 if(route==='schedule')item.location=row.location||null;
 return item;
}
async function confirmTaskReview(){
 if(reviewBusy)return;
 const generation=reviewGeneration,context=reviewContext;
 const chosen=reviewRows.filter(row=>row.selected).map(row=>structuredClone(row)),error=document.getElementById('review-error');
 if(!chosen.length){reviewValidationError(error,'请至少勾选一项任务');return}
 for(const row of chosen){
  if(row.adopted){reviewValidationError(error,'该条目已加入计划，请取消勾选；新一轮准备可复制为新方案');return}
  if(!row.title.trim()||!/^\d{4}-\d{2}-\d{2}$/.test(row.date)){reviewValidationError(error,'请为勾选的任务填写名称和计划日期');return}
  if(row.type==='fixed'&&(!row.start||!row.end||row.start>=row.end)){reviewValidationError(error,'请补齐固定任务的起止时间，结束时间需晚于开始时间');return}
  if(row.duration!==''&&(!Number.isInteger(Number(row.duration))||Number(row.duration)<1||Number(row.duration)>10080)){reviewValidationError(error,'预计时长需为1至10080分钟的整数，或留空');return}
  if(context?.route==='recommend'&&row.duration===''){reviewValidationError(error,'请为准备方案补充预计时长');return}
 }
 reviewBusy=true;updateReviewCount();error.textContent='';
 document.querySelectorAll('#modal-root input,#modal-root select,#rec-result input,#rec-result select').forEach(input=>input.disabled=true);
 try{
  if(context)await api('agent/'+context.id+'/review',{items:chosen.map(row=>reviewedCandidate(row,context.route)),indices:chosen.map(row=>row.proposalIndex)});
  if(generation!==reviewGeneration||!error.isConnected)return;
  parsed=chosen.map(reviewedTask);commitParsed();
 }catch(failure){if(error.isConnected)reviewValidationError(error,failure.message)}
 finally{if(generation===reviewGeneration){reviewBusy=false;document.querySelectorAll('#modal-root input,#modal-root select,#rec-result input,#rec-result select').forEach(input=>input.disabled=input.dataset.planAdopted==='true');updateReviewCount()}}
}
function reviewValidationError(node,message){node.textContent=message;showStudyAlert(message)}
function referenceStatusHTML(context){
 const sources=(context?.sources||[]).filter(source=>/^https?:\/\//.test(source.url));
 const status=context?.search_status;
 if(sources.length){
  const checked=localMoment(status?.checked_at||sources[0].checked_at);
  return '<section class="preview-item"><b>参考资料（'+sources.length+'条）</b>'+sources.map(source=>'<p><a href="'+esc(source.url)+'" target="_blank" rel="noreferrer">'+esc(source.title)+'</a></p>').join('')+(checked.date?'<p class="tiny">检索时间：'+checked.date+' '+checked.time+'</p>':'')+'</section>';
 }
 const messages={not_configured:'未启用联网检索，本方案仅依据你提供的信息。',not_used:'本次未进行联网检索，方案仅依据你提供的信息。',empty:'已进行联网检索，但没有找到可用资料。',failed:status?.message||'联网检索失败，本次方案未使用外部资料。'};
 return '<p class="tiny">'+esc(messages[status?.status]||'当前结果未附可核验的参考来源。')+'</p>';
}
