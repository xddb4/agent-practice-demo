function dialogueShortTitle(title){return Array.from(String(title||'新对话').trim()).slice(0,10).join('')}
function dialogueReplyHTML(text){
 const blocks=String(text||'').replace(/\r\n?/g,'\n').split(/\n\s*\n/).filter(block=>block.trim());
 return '<div class="dialogue-reply">'+blocks.map(block=>{
  const lines=block.split('\n').filter(line=>line.trim());
  if(lines.length>1&&lines.every(line=>/^\s*(?:[-*•]|\d+[.、)])\s+/.test(line))){
   return '<ul>'+lines.map(line=>'<li>'+esc(line.replace(/^\s*(?:[-*•]|\d+[.、)])\s+/,''))+'</li>').join('')+'</ul>';
  }
  // Older replies may have no paragraph breaks. Group complete sentences without rewriting their meaning.
  const paragraphs=[];let paragraph='';
  for(const sentence of block.split(/(?<=[。！？])/u)){
   if(paragraph&&paragraph.length+sentence.length>130){paragraphs.push(paragraph);paragraph=''}
   paragraph+=sentence;
  }
  if(paragraph)paragraphs.push(paragraph);
  return paragraphs.map(value=>'<p>'+esc(value).replaceAll('\n','<br>')+'</p>').join('');
 }).join('')+'</div>';
}
function dialoguePlanButtonHTML(){
 return '<button type="button" class="dialogue-plan-cta" data-record-plan><span>查看准备方案</span><span aria-hidden="true">→</span></button>';
}

async function dialogueStreamRequest(path,body,signal,onEvent){
 let response;
 try{response=await fetch('/api/'+path+'/stream',{method:'POST',headers:{'Content-Type':'application/json','Accept':'text/event-stream'},body:JSON.stringify(body),signal})}
 catch(error){
  if(error.name==='AbortError')throw error;
  throw Object.assign(new Error('无法连接 StudyPilot，请检查容器状态并重新打开对话核对结果。'),{code:'backend_connection'});
 }
 if(!response.ok){
  const result=await response.json(),detail=result.detail;
  throw Object.assign(new Error(typeof detail==='string'?detail:detail?.reason||detail?.message||'请求未完成'),{code:detail?.code,requestId:detail?.request_id,diagnostic:typeof detail==='object'?detail:null});
 }
 if(!response.body||!response.headers.get('content-type')?.includes('text/event-stream'))throw Error('服务未返回流式回复，请刷新后重试。');
 const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='';
 try{
  while(true){
   const {value,done}=await reader.read();buffer+=decoder.decode(value||new Uint8Array(),{stream:!done});
   buffer=buffer.replaceAll('\r\n','\n');
   let boundary;
   while((boundary=buffer.indexOf('\n\n'))!==-1){
    const frame=buffer.slice(0,boundary);buffer=buffer.slice(boundary+2);
    const data=frame.split('\n').filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trimStart()).join('\n');
    if(!data)continue;
    const event=JSON.parse(data);
    if(event.type==='error'){
     const detail=event.detail;
     throw Object.assign(new Error(detail.reason||detail.message||'回复未完成'),{code:detail.code,requestId:detail.request_id,diagnostic:detail});
    }
    if(event.type==='cancelled')throw Object.assign(new Error('已停止生成'),{name:'AbortError'});
    if(event.type==='complete')return event.result;
    onEvent(event);
   }
   if(done)throw Object.assign(new Error('回复连接中断，请重新打开对话核对是否已保存，再重试。'),{code:'stream_interrupted'});
  }
 }catch(error){
  if(error.name==='AbortError'||error.code||error.diagnostic)throw error;
  throw Object.assign(new Error('回复连接中断，请重新打开对话核对保存状态后重试。'),{code:'stream_interrupted'});
 }finally{await reader.cancel().catch(()=>{});reader.releaseLock()}
}
function dialogueIcon(name){
 const paths={upload:'<path d="M21.4 11.6 12 21a6 6 0 0 1-8.5-8.5L14 2a4 4 0 0 1 5.7 5.7L9.1 18.3a2 2 0 0 1-2.8-2.8L16.2 5.6"/>',mail:'<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',copy:'<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>',check:'<path d="m5 12 4 4L19 6"/>'};
 return '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+paths[name]+'</svg>';
}

async function dialogueRequest(path, body, signal){
 let response;
 try{
  response=await fetch('/api/'+path,body===undefined?undefined:{
   method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal
  });
 }catch(error){
  if(error.name==='AbortError')throw error;
  throw Object.assign(new Error('浏览器无法连接 StudyPilot 后端。'),{code:'backend_connection',diagnostic:{title:'无法连接 StudyPilot',reason:'浏览器未收到后端响应，暂时无法确认这次请求的处理结果。',action:'请检查 Docker 容器是否运行；恢复连接后重新打开对话，核对结果后再重试。'}});
 }
 let result;
 try{result=await response.json()}catch{
  throw Object.assign(new Error('后端响应格式异常'),{code:'backend_response',diagnostic:{title:'后端响应异常',reason:'后端未返回有效的接口结果（HTTP '+response.status+'）。',action:'请检查容器运行状态和服务器日志，重新打开对话后核对结果。'}});
 }
 if(!response.ok){
  const detail=result.detail;
  const message=typeof detail==='string'?detail:[detail?.title||detail?.message,detail?.reason,...(detail?.problems||[]),detail?.action].filter(Boolean).join(' ');
  throw Object.assign(new Error(message||'暂时无法处理，请重试'),{code:detail?.code,requestId:detail?.request_id,diagnostic:typeof detail==='object'&&!Array.isArray(detail)?detail:null});
 }
 return result;
}

function dialogueErrorHTML(error){
 const detail=error.diagnostic;
 return '<section class="dialogue-error notice" role="alert"><b>'+esc(detail?.title||'回复失败')+'</b>'+
  '<p>原因：'+esc(detail?.reason||error.message||'暂时无法确定失败原因。')+'</p>'+
  (detail?.problems?.length?'<ul>'+detail.problems.map(problem=>'<li>'+esc(problem)+'</li>').join('')+'</ul>':'')+
  (detail?.action?'<p>建议：'+esc(detail.action)+'</p>':'')+
  '<small>'+(['backend_connection','backend_response'].includes(error.code)?'请求结果待核对。':'本次未保存回复或应用任务调整。')+(error.requestId?' 错误编号：'+esc(error.requestId):'')+'</small></section>';
}

function dialoguePreviewHTML(change){
 const action={add:'新增',modify:'修改',cancel:'取消'}[change.action];
 const before=change.before, after=change.after;
 const label={title:'任务名称',description:'执行说明',date:'计划日期',start:'开始时间',end:'结束时间',duration:'时长（分钟）',ddl:'截止日期'};
 const fields=after?Object.keys(label).filter(key=>(before[key]||'')!==(after[key]||'')):[];
 return '<li class="preview-item"><b>'+action+' · '+esc(before.title||after.title)+'</b>'+
  '<small> · '+(change.official?'同步影响正式日程':'准备方案')+'</small>'+
  (fields.length?'<ul>'+fields.map(key=>'<li>'+label[key]+' '+(before.title?esc(before[key]??'未设置')+' → ':'')+esc(after[key]||'未设置')+'</li>').join('')+'</ul>':'')+'</li>';
}

function openPlanDialogue(id=null,reference=null,view={}){
 const creating=!id;
 const planPath='plans/'+encodeURIComponent(id);
 const path=planPath+'/dialogue';
 const owner=activeAccount?.id;
 modal('<div class="plan-dialogue" id="plan-dialogue"><div class="modal-head"><h2 class="dialogue-heading">Talk to <span class="brand-wordmark">Study<em>Pilot</em></span></h2>'+
  '<button type="button" onclick="closeModal()" aria-label="关闭方案对话">✕</button></div>'+
  '<nav class="dialogue-switch" aria-label="方案对话切换"><label class="tiny">切换对话 <select data-dialogue-switch><option value="">新对话</option></select></label>'+
  '<button type="button" class="dialogue-new" data-dialogue-new aria-label="新对话" title="新对话">＋</button></nav>'+
  '<p class="desc" data-dialogue-title></p><div class="dialogue-workspace">'+
  '<section class="dialogue-chat" aria-label="与 Agent 对话"><div class="dialogue-messages" role="log" aria-label="对话记录"></div>'+
  '<p class="tiny" role="status" data-dialogue-status>正在读取对话…</p>'+
  '<form id="dialogue-form"><label class="dialogue-input"><textarea name="message" rows="3" maxlength="3000" placeholder=" " aria-label="简述你的目标以及基本概况"></textarea><span>简述你的目标以及基本概况·······</span></label>'+
  '<div class="dialogue-attachments" aria-label="待发送附件"></div>'+
  '<div class="dialogue-actions"><input name="attachments" type="file" hidden multiple accept=".png,.jpg,.jpeg,.webp,.pdf,.txt,.md">'+
  '<button type="button" class="secondary dialogue-add" aria-label="添加图片或文件" title="添加图片或文件">'+dialogueIcon('upload')+'</button><button type="button" class="secondary" data-stop-stream hidden>停止生成</button><button type="submit" class="primary dialogue-send" aria-label="发送" title="发送">'+dialogueIcon('mail')+'</button></div></form></section>'+
  '<aside class="dialogue-sidebar" aria-label="方案和对话设置"><div class="dialogue-sidebar-tools">'+
  '<label class="tiny">辅导方向 <select name="skill" form="dialogue-form"><option value="auto">自动判断</option><option value="time-management">时间管理</option>'+
  '<option value="english-prep">英语备考</option><option value="research-growth">科研成长</option></select></label>'+
  '<label class="tiny">目标截止日期<input name="deadline" type="date" form="dialogue-form" '+(creating?'required':'readonly')+'></label>'+
  '<label class="tiny">每周可投入（小时）<input name="hours" type="number" min="1" max="80" value="'+(creating?'6':'')+'" form="dialogue-form" '+(creating?'required':'readonly')+'></label>'+
  (creating?'':
   '<button type="button" class="secondary" data-dialogue-plan>选择任务／执行安排</button>')+
  '</div>'+
  '<div data-dialogue-proposal></div><details class="dialogue-plan-summary"><summary>当前任务 <span data-dialogue-count></span></summary>'+
  '<div data-dialogue-tasks>正在读取方案…</div></details></aside></div></div>');
 const root=document.getElementById('plan-dialogue');
 const form=root.querySelector('form');
 const input=form.elements.message;
 const skill=form.elements.skill;
 const deadline=form.elements.deadline;
 const hours=form.elements.hours;
 const status=root.querySelector('[data-dialogue-status]');
 const history=root.querySelector('.dialogue-messages');
 const proposal=root.querySelector('[data-dialogue-proposal]');
 const taskList=root.querySelector('[data-dialogue-tasks]');
 const send=form.querySelector('[type=submit]');
 const picker=form.elements.attachments;
 const addButton=form.querySelector('.dialogue-add');
 const attachmentList=form.querySelector('.dialogue-attachments');
 const attachments=[];
 let current=null,busy=true,failed=null,visibleMessages=[],flight=null;
 const active=()=>root.isConnected&&activeAccount?.id===owner;
 function setBusy(value,message=''){
  busy=value;
  const stop=root.querySelector('[data-stop-stream]');stop.hidden=!busy||!flight;stop.disabled=Boolean(flight?.stopping);
  status.textContent=message;
  input.disabled=skill.disabled=send.disabled=busy||!current||Boolean(current.pending);
  if(creating)deadline.disabled=hours.disabled=busy;
  addButton.disabled=picker.disabled=input.disabled;
  attachmentList.querySelectorAll('button').forEach(button=>{button.disabled=input.disabled});
  root.querySelectorAll('[data-dialogue-switch],[data-dialogue-new],[data-dialogue-plan]').forEach(control=>{control.disabled=busy});
  history.querySelectorAll('[data-record-plan]').forEach(button=>{button.disabled=busy});
  history.querySelectorAll('[data-record-more]').forEach(button=>{button.disabled=input.disabled});
  proposal.querySelectorAll('button').forEach(button=>{button.disabled=busy});
 }
 function showAttachments(){
  attachmentList.innerHTML=attachments.map((file,index)=>'<span class="dialogue-attachment">'+
   '<span>'+esc(file.name)+'</span><button type="button" data-remove-file="'+index+'" aria-label="移除附件 '+esc(file.name)+'">×</button></span>').join('');
 }
 const isImage=file=>['image/png','image/jpeg','image/webp'].includes(file.type);
 function addAttachments(files){
  if(input.disabled||!files.length)return;
  const issues=[];
  for(const file of files){
   if(!isImage(file)&&!/\.(pdf|txt|md)$/i.test(file.name)){issues.push('支持 PNG、JPEG、WebP、PDF、TXT 和 Markdown。');continue}
   if(!file.size||file.size>10*1024*1024){issues.push('附件须有内容且每个不超过 10 MB。');continue}
   if(attachments.length>=3){issues.push('每条消息最多添加 3 个附件。');break}
   attachments.push(file);
  }
  showAttachments();
  status.textContent=[...new Set(issues)].join(' ');
 }
 addButton.addEventListener('click',()=>picker.click());
 picker.addEventListener('change',()=>{addAttachments(Array.from(picker.files));picker.value='';input.focus()});
 attachmentList.addEventListener('click',event=>{
  const button=event.target.closest('[data-remove-file]');
  if(button&&!input.disabled){attachments.splice(Number(button.dataset.removeFile),1);showAttachments()}
 });
 root.addEventListener('paste',event=>{
  const clipboard=event.clipboardData;
  if(!clipboard||input.disabled)return;
  const files=Array.from(clipboard.files);
  if(!files.length)files.push(...Array.from(clipboard.items||[]).filter(item=>item.kind==='file').map(item=>item.getAsFile()).filter(Boolean));
  if(files.length){event.preventDefault();event.stopPropagation();addAttachments(files)}
 });
 function showMessages(messages,follow=true){
  const previousScroll=history.scrollTop;
  visibleMessages=messages;
  const names={user:'你',assistant:'StudyPilot',system:'方案记录'};
  history.innerHTML=messages.length?messages.map((turn,index)=>
   '<article class="dialogue-turn" data-role="'+esc(turn.role)+'"'+(turn.streaming?' data-streaming="true"':'')+'><b>'+esc(names[turn.role])+'</b>'+
   (turn.role==='assistant'?dialogueReplyHTML(turn.text):'<p>'+esc(turn.text)+'</p>')+(turn.skills?.length?'<small>辅导方式 · '+esc(turn.skills.join('、'))+'</small>':'')+
   (turn.role!=='system'?'<div class="dialogue-message-actions"><button type="button" class="tiny" data-copy="'+index+'" aria-label="复制消息" title="复制消息">'+dialogueIcon('copy')+'</button>'+
    (turn.waiting?'<button type="button" class="secondary" data-cancel-send>停止生成</button>':
     turn.failed?'<button type="button" class="tiny" data-retry>重试</button><button type="button" class="tiny" data-edit-failed>撤回编辑</button>':
     !turn.waiting&&messages===current?.messages&&current.withdraw_token&&index===messages.length-2?
     '<button type="button" class="tiny" data-withdraw>撤回编辑</button>':'')+'</div>':'')+
   (turn.role==='system'&&turn.text==='准备方案已保存，可以继续对话。'&&!creating?'<div class="dialogue-record-actions">'+dialoguePlanButtonHTML()+'<button type="button" data-record-more>继续补充信息</button></div>':'')+
   (turn.role==='assistant'&&!turn.streaming&&!turn.interrupted&&index===messages.length-1?'<div class="dialogue-record-actions">'+dialoguePlanButtonHTML()+'</div>':'')+
   (turn.streaming?'<small>正在生成，内容尚未保存…</small>':turn.interrupted?'<small>本段回复未完成，请重新打开对话核对保存状态。</small>':'')+
   (turn.evidence_candidates?.length?'<section class="dialogue-evidence-candidates"><b>可归档的学习记录</b><p class="tiny">仅为候选，核对后可保存到证据收件箱；接受前不计入能力报告。</p>'+turn.evidence_candidates.map(item=>'<div class="preview-item"><b>'+esc(item.title)+'</b><p>'+esc(item.quote)+'</p><small>'+esc(item.kind==='self_report'?'用户自述，尚未独立验证':'用户报告的过程或成果，尚待核对')+'</small>'+(item.status==='submitted'?'<p class="tiny">已保存到证据收件箱</p>':'<button type="button" class="secondary" data-review-evidence="'+esc(item.id)+'">核对并保存</button>')+'</div>').join('')+'</section>':'')+
   (turn.failed?dialogueErrorHTML(turn.failed):'')+'</article>'
  ).join(''):'<div class="dialogue-start" aria-hidden="true">START</div>';
  history.scrollTop=follow?history.scrollHeight:previousScroll;
 }
 async function reviewDialogueEvidence(candidateId){
  if(busy)return;
  const candidate=current.messages.flatMap(turn=>turn.evidence_candidates||[]).find(item=>item.id===candidateId);
  if(!candidate||candidate.status==='submitted')return;
  const dialog=document.createElement('dialog');dialog.className='study-alert dialogue-evidence-review';
  dialog.innerHTML='<form><h3>核对学习记录</h3><p class="tiny">保存后进入待确认收件箱，不直接更新能力结论。</p>'+
   '<label>标题<input name="title" required maxlength="150" value="'+esc(candidate.title)+'"></label>'+
   '<label>内容<textarea name="body" required maxlength="3000">'+esc(candidate.quote)+'</textarea></label>'+
   '<label>说明<textarea name="desc" maxlength="1500">'+esc(candidate.rationale)+'</textarea></label>'+
   '<label>关联能力<select name="dim">'+abilities.map((name,index)=>'<option value="'+index+'" '+(name===candidate.dimension?'selected':'')+'>'+esc(name)+'</option>').join('')+'</select></label>'+
   '<p role="alert" data-error></p><div class="modal-footer"><button type="button" data-cancel>取消</button><button type="submit" class="primary">保存到证据收件箱</button></div></form>';
  document.body.append(dialog);dialog.showModal();let saving=false;
  dialog.addEventListener('close',()=>dialog.remove());
  dialog.addEventListener('cancel',event=>{if(saving)event.preventDefault()});
  dialog.querySelector('[data-cancel]').onclick=()=>{if(!saving)dialog.close()};
  dialog.querySelector('form').onsubmit=async event=>{
   event.preventDefault();if(saving||!active())return;saving=true;
   const form=event.target,submit=form.querySelector('[type=submit]');submit.disabled=true;
   try{
    await saveQueue;
    const result=await dialogueRequest(path+'/evidence/'+encodeURIComponent(candidateId),{title:form.elements.title.value,body:form.elements.body.value,desc:form.elements.desc.value,dim:Number(form.elements.dim.value)});
    if(activeAccount?.id===owner)evidence=result.evidence;
    if(active()){display(result);status.textContent='已保存为待确认证据，可在能力报告的证据收件箱中核对。'}
    dialog.close();
   }catch(error){dialog.querySelector('[data-error]').textContent=error.message}
   finally{saving=false;submit.disabled=false}
  };
 }
 function display(result,follow=true){
  current=result;
  root.querySelector('[data-dialogue-title]').textContent=dialogueShortTitle(result.dialogue_title||result.title);
  root.querySelector('[data-dialogue-title]').title=result.title;
  skill.value=result.skill_profile;
  showMessages(result.messages,follow);
  const pending=result.pending;
  proposal.innerHTML=pending?'<section class="dialogue-proposal"><b>待确认的调整（'+pending.preview.length+'）</b><p class="tiny">请从回答末尾查看任务与调整，确认后才会更新。</p><button type="button" class="secondary" data-apply="no">放弃建议，继续聊</button></section>':'';
  proposal.querySelectorAll('[data-apply]').forEach(button=>button.addEventListener('click',()=>decide(button.dataset.apply==='yes')));
 }
 async function viewCurrentPlan(){
  if(busy)return;
  try{
   const plan=await dialogueRequest(planPath);
   if(active())handleAgentResult({...plan,dialogueReview:{reply:current.messages.at(-1)?.text,pending:current.pending}});
  }catch(error){if(active())status.textContent=error.message}
 }
 async function refreshPlanSummary(){
  try{
   const plan=await dialogueRequest(planPath);
   if(!active())return;
   let constraints={};
   try{constraints=JSON.parse(plan.input_source)||{}}catch{}
   deadline.value=constraints['截止日期']||'';
   hours.value=constraints['每周小时']||'';
   const adopted=new Set(plan.adopted_indices);
   root.querySelector('[data-dialogue-count]').textContent='（'+plan.items.length+'）';
   taskList.innerHTML=plan.items.length?'<ul>'+plan.items.map((item,index)=>{
    const key=plan.proposal_indices[index],calendar=plan.calendar_items?.[key];
    const time=(calendar?[calendar.date,calendar.start,calendar.end]:[item.date,localMoment(item.start).time,localMoment(item.end).time]).filter(Boolean).join(' ');
    return '<li><b>'+esc(calendar?.title||item.title)+'</b><small>'+esc(time||'日期待定')+
     (adopted.has(key)?' · 已加入日程'+(calendar?.done?' · 已完成':' · 待完成'):'')+'</small></li>';
   }).join('')+'</ul>':'暂无任务';
  }catch(error){if(active())taskList.textContent=error.message}
 }
 async function decide(apply){
  if(busy||!current?.pending)return;
  setBusy(true,'正在保存…');
  try{
   await saveQueue;
   const result=await dialogueRequest(path+'/decision',{proposal_id:current.pending.id,apply});
   if(activeAccount?.id===owner&&result.tasks){tasks=result.tasks;render()}
   if(active()){display(result);setBusy(false);if(apply)refreshPlanSummary()}
  }catch(error){if(active())setBusy(false,error.message)}
 }
 async function sendMessage(message, profile=skill.value){
  if(!message||busy||current?.pending)return;
  if(creating&&!form.reportValidity())return;
  failed=null;
  const request={id:crypto.randomUUID(),controller:new AbortController(),message,started:false};
  flight=request;
  showMessages([...current.messages,{role:'user',text:message,waiting:true},
   {role:'assistant',text:'',streaming:true}]);
  if(input.value.trim()===message)input.value='';
  setBusy(true);
  const onStreamEvent=event=>{
   if(!active()||flight!==request||request.stopping)return;
   if(event.type==='status'){status.textContent=event.message;return}
   if(event.type!=='reply')return;
   const follow=history.scrollHeight-history.scrollTop-history.clientHeight<60;
   request.partialText=event.text;visibleMessages[visibleMessages.length-1].text=event.text;
   const reply=history.querySelector('[data-streaming] .dialogue-reply');
   if(reply)reply.innerHTML=dialogueReplyHTML(event.text).replace(/^<div class="dialogue-reply">|<\/div>$/g,'');
   status.textContent='正在回复…';
   if(follow)history.scrollTop=history.scrollHeight;
  };
  try{
   await saveQueue;
   const materialIds=await uploadPlanMaterials(attachments.filter(file=>!isImage(file)),owner);
   const images=await Promise.all(attachments.filter(isImage).map(file=>new Promise((resolve,reject)=>{
    const reader=new FileReader();
    reader.onload=()=>resolve(reader.result);
    reader.onerror=()=>reject(Error('读取图片失败，请重新添加。'));
    reader.readAsDataURL(file);
   })));
   if(!active()||flight!==request)return;
   request.started=true;
   const filesPayload={material_ids:materialIds,attachment_images:images,request_id:request.id};
   if(creating){
    const result=await dialogueStreamRequest('agent',{route:'recommend',dialogue_message:message,
     text:JSON.stringify({目标:reference?.title||message,截止日期:deadline.value,每周小时:hours.value,情况备注:reference?message:''}),
     skill_profile:profile,...filesPayload,base_plan_id:reference?.id},request.controller.signal,onStreamEvent);
    if(active()&&flight===request){
     flight=null;
     openPlanDialogue(result.id,null,{follow:history.scrollHeight-history.scrollTop-history.clientHeight<60,scrollTop:history.scrollTop});
    }
    return;
   }
   const result=await dialogueStreamRequest(path,{text:message,skill_profile:profile,...filesPayload},request.controller.signal,onStreamEvent);
   if(active()&&flight===request){
    const follow=history.scrollHeight-history.scrollTop-history.clientHeight<60;
    flight=null;attachments.length=0;showAttachments();display(result,follow);setBusy(false);
    refreshPlanSummary();
   }
  }catch(error){
   if(!active()||flight!==request)return;
   if(request.stopping){request.streamEnded=true;return}
   flight=null;
   failed={message,profile,error};
   showMessages([...current.messages,{role:'user',text:message,failed:error},...(request.partialText?[{role:'assistant',text:request.partialText,interrupted:true}]:[])],history.scrollHeight-history.scrollTop-history.clientHeight<60);
   setBusy(false,'回复未完成，请查看消息下方的原因与建议。');
   if(error.code==='model_not_configured'){
    const button=document.createElement('button');
    button.type='button';button.className='secondary';button.textContent='打开模型 API 设置';
    button.addEventListener('click',openModelSettings);status.append(' ',button);
   }
  }
 }
 async function stopGeneration(button){
  const request=flight;if(!request||request.stopping)return;
  request.stopping=true;button.disabled=true;
  try{
   if(request.started)await dialogueRequest('dialogue-requests/'+request.id+'/cancel',{});
   if(active()&&flight===request){
    flight=null;request.controller.abort();input.value=request.message;
    showMessages([...current.messages,...(request.partialText?[{role:'user',text:request.message},{role:'assistant',text:request.partialText,interrupted:true}]:[])],history.scrollHeight-history.scrollTop-history.clientHeight<60);
    setBusy(false,'已停止生成，可以修改后重发。');input.focus();
   }
  }catch(error){
   request.stopping=false;
   if(active()&&flight===request){
    if(request.streamEnded){flight=null;request.controller.abort();input.value=request.message;setBusy(false,error.message)}
    else{button.disabled=false;status.textContent=error.message}
   }
  }
 }
 root.querySelector('[data-stop-stream]').addEventListener('click',event=>stopGeneration(event.currentTarget));
 form.addEventListener('submit',event=>{
  event.preventDefault();
  sendMessage(input.value.trim()||(attachments.length?(creating?'请根据附件帮我制定准备方案。':'请结合当前方案分析这些附件。'):''));
 });
 input.addEventListener('keydown',event=>{
  if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing&&event.keyCode!==229){
   event.preventDefault();
   form.requestSubmit();
  }
 });
 history.addEventListener('click',async event=>{
  const button=event.target.closest('button');
  if(!button)return;
  if(button.hasAttribute('data-copy')){
   try{await navigator.clipboard.writeText(visibleMessages[Number(button.dataset.copy)].text);button.innerHTML=dialogueIcon('check');button.setAttribute('aria-label','已复制');button.title='已复制'}
   catch{if(active())status.textContent='浏览器未允许访问剪贴板，可以选中文字后复制。'}
   return;
  }
  if(button.hasAttribute('data-cancel-send')&&flight){
   return stopGeneration(button);
  }
  if(busy)return;
   if(button.hasAttribute('data-review-evidence'))return reviewDialogueEvidence(button.dataset.reviewEvidence);
   if(button.hasAttribute('data-record-plan'))return viewCurrentPlan();
  if(button.hasAttribute('data-record-more')){if(!input.disabled)input.focus();return}
  if(button.hasAttribute('data-retry')&&failed)return sendMessage(failed.message,failed.profile);
  if(button.hasAttribute('data-edit-failed')&&failed){
   input.value=failed.message;failed=null;showMessages(current.messages);setBusy(false);input.focus();
  }
  if(button.hasAttribute('data-withdraw')&&current?.withdraw_token){
   setBusy(true,'正在撤回…');
   try{
    const result=await dialogueRequest(path+'/withdraw',{token:current.withdraw_token});
    if(active()){display(result);input.value=result.restored;setBusy(false);input.focus()}
   }catch(error){if(active())setBusy(false,error.message)}
  }
 });
  root.querySelector('[data-dialogue-plan]')?.addEventListener('click',viewCurrentPlan);
 root.querySelector('[data-dialogue-new]').addEventListener('click',()=>openPlanDialogue());
 const switcher=root.querySelector('[data-dialogue-switch]');
 if(id)switcher.add(new Option('当前对话',id,true,true));
 switcher.addEventListener('change',()=>openPlanDialogue(switcher.value||null));
 dialogueRequest('plans').then(plans=>{
  if(!active())return;
  const currentOption=Array.from(switcher.options).find(option=>option.value===id);
  for(const plan of plans){
   if(plan.id===id){currentOption.textContent=dialogueShortTitle(plan.dialogue_title||plan.title);currentOption.title=plan.title;continue}
   const option=new Option(dialogueShortTitle(plan.dialogue_title||plan.title),plan.id);option.title=plan.title;switcher.add(option);
  }
 }).catch(()=>{if(active())switcher.title='暂时无法读取其他对话，请重新打开个性化推荐'});
 if(creating){
  root.querySelector('.dialogue-plan-summary').hidden=true;

  if(reference?.hours)hours.value=reference.hours;
  display({title:reference?'参考「'+reference.title+'」开始新对话':'新对话',skill_profile:'auto',messages:[],pending:null});
  setBusy(false);input.focus();
 }else{
  setBusy(true,'正在读取对话…');
  refreshPlanSummary();
  dialogueRequest(path).then(result=>{if(active()){display(result,view.follow!==false);if(view.follow===false)history.scrollTop=view.scrollTop||0;setBusy(false)}})
   .catch(error=>{if(active())setBusy(false,error.message)});
 }
}
