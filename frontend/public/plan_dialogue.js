async function dialogueRequest(path, body, signal){
 const response=await fetch('/api/'+path,body===undefined?undefined:{
  method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal
 });
 const result=await response.json();
 if(!response.ok){
  const detail=result.detail;
  const message=typeof detail==='string'?detail:[detail?.message,detail?.reason,detail?.action].filter(Boolean).join(' ');
  throw Object.assign(new Error(message||'暂时无法处理，请重试'),{code:detail?.code,requestId:detail?.request_id});
 }
 return result;
}

function dialoguePreviewHTML(change){
 const action={add:'新增',modify:'修改',cancel:'取消'}[change.action];
 const before=change.before, after=change.after;
 const label={title:'任务名称',date:'计划日期',start:'开始时间',end:'结束时间',duration:'时长（分钟）',ddl:'截止日期'};
 const fields=after?Object.keys(label).filter(key=>(before[key]||'')!==(after[key]||'')):[];
 return '<li class="preview-item"><b>'+action+' · '+esc(before.title||after.title)+'</b>'+
  '<small> · '+(change.official?'同步影响正式日程':'准备方案')+'</small>'+
  (fields.length?'<ul>'+fields.map(key=>'<li>'+label[key]+' '+(before.title?esc(before[key]??'未设置')+' → ':'')+esc(after[key]||'未设置')+'</li>').join('')+'</ul>':'')+'</li>';
}

function openPlanDialogue(id=null,reference=null){
 const creating=!id;
 const planPath='plans/'+encodeURIComponent(id);
 const path=planPath+'/dialogue';
 const owner=activeAccount?.id;
 modal('<div class="plan-dialogue" id="plan-dialogue"><div class="modal-head"><h2>个性化推荐</h2>'+
  '<button type="button" onclick="closeModal()" aria-label="关闭方案对话">✕</button></div>'+
  '<nav class="dialogue-switch" aria-label="方案对话切换"><label class="tiny">切换对话 <select data-dialogue-switch><option value="">新对话</option></select></label>'+
  '<button type="button" class="secondary" data-dialogue-new>＋ 新对话</button></nav>'+
  '<p class="desc" data-dialogue-title></p><div class="dialogue-workspace">'+
  '<section class="dialogue-chat" aria-label="与 Agent 对话"><div class="dialogue-messages" role="log" aria-label="对话记录"></div>'+
  '<p class="tiny" role="status" data-dialogue-status>正在读取对话…</p>'+
  '<form id="dialogue-form"><label class="dialogue-input"><span>你的消息</span><textarea name="message" rows="3" maxlength="3000" placeholder="输入消息，也可以粘贴截图或文件"></textarea></label>'+
  '<div class="dialogue-attachments" aria-label="待发送附件"></div>'+
  '<div class="dialogue-actions"><input name="attachments" type="file" hidden multiple accept=".png,.jpg,.jpeg,.webp,.pdf,.txt,.md">'+
  '<button type="button" class="secondary dialogue-add" aria-label="添加图片或文件" title="添加图片或文件">＋</button><button type="submit" class="primary">发送</button></div></form></section>'+
  '<aside class="dialogue-sidebar" aria-label="方案和对话设置"><div class="dialogue-sidebar-tools">'+
  '<label class="tiny">辅导方向 <select name="skill" form="dialogue-form"><option value="auto">自动判断</option><option value="time-management">时间管理</option>'+
  '<option value="english-prep">英语备考</option><option value="research-growth">科研成长</option></select></label>'+
  '<label class="tiny">目标截止日期<input name="deadline" type="date" form="dialogue-form" '+(creating?'required':'readonly')+'></label>'+
  '<label class="tiny">每周可投入（小时）<input name="hours" type="number" min="1" max="80" value="'+(creating?'6':'')+'" form="dialogue-form" '+(creating?'required':'readonly')+'></label>'+
  (creating?'':
   '<p class="tiny">这里显示初始计划条件。时间有变化，可以直接告诉 Agent。</p><button type="button" class="secondary" data-dialogue-plan>选择任务／执行安排</button>')+
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
  status.textContent=message;
  input.disabled=skill.disabled=send.disabled=busy||!current||Boolean(current.pending);
  if(creating)deadline.disabled=hours.disabled=busy;
  addButton.disabled=picker.disabled=input.disabled;
  attachmentList.querySelectorAll('button').forEach(button=>{button.disabled=input.disabled});
  root.querySelectorAll('[data-dialogue-switch],[data-dialogue-new],[data-dialogue-plan]').forEach(control=>{control.disabled=busy});
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
 function showMessages(messages){
  visibleMessages=messages;
  const names={user:'你',assistant:'StudyPilot',system:'方案记录'};
  history.innerHTML=messages.length?messages.map((turn,index)=>
   '<article class="dialogue-turn" data-role="'+esc(turn.role)+'"><b>'+esc(names[turn.role])+'</b>'+
   '<p>'+esc(turn.text)+'</p>'+(turn.skills?.length?'<small>辅导方式 · '+esc(turn.skills.join('、'))+'</small>':'')+
   (turn.role!=='system'?'<div class="dialogue-message-actions"><button type="button" class="tiny" data-copy="'+index+'">复制</button>'+
    (turn.waiting?'<button type="button" class="secondary" data-cancel-send>撤回</button>':
     turn.failed?'<button type="button" class="tiny" data-retry>重试</button><button type="button" class="tiny" data-edit-failed>撤回编辑</button>':
     !turn.waiting&&messages===current?.messages&&current.withdraw_token&&index===messages.length-2?
     '<button type="button" class="tiny" data-withdraw>撤回编辑</button>':'')+'</div>':'')+
   (turn.failed?'<small>回复失败'+(turn.failed.requestId?' · 错误编号 '+esc(turn.failed.requestId):'')+'</small>':'')+'</article>'
  ).join(''):'<p class="tiny">'+(creating?'告诉我你想准备什么，以及目前的情况。先在侧栏填好截止日期和每周可投入时间。':'可以询问方案细节、反馈进度，或告诉 Agent 哪些任务需要改期。')+'</p>';
  history.scrollTop=history.scrollHeight;
 }
 function display(result){
  current=result;
  root.querySelector('[data-dialogue-title]').textContent=result.title;
  skill.value=result.skill_profile;
  showMessages(result.messages);
  const pending=result.pending;
  proposal.innerHTML=pending?'<section class="dialogue-proposal"><b>待确认的调整（'+pending.preview.length+'）</b>'+
   '<p class="tiny">新增任务先留在准备方案，可再勾选加入日程。已加入的任务会按确认的变更更新。</p>'+
   '<ul class="dialogue-changes">'+pending.preview.map(dialoguePreviewHTML).join('')+'</ul>'+
   '<div class="dialogue-actions"><button type="button" class="secondary" data-apply="no">放弃建议</button>'+
   '<button type="button" class="primary" data-apply="yes">确认应用</button></div></section>':'';
  proposal.querySelectorAll('[data-apply]').forEach(button=>button.addEventListener('click',()=>decide(button.dataset.apply==='yes')));
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
   {role:'system',text:'StudyPilot 正在回复…'}]);
  if(input.value.trim()===message)input.value='';
  setBusy(true);
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
    const result=await dialogueRequest('agent',{route:'recommend',dialogue_message:message,
     text:JSON.stringify({目标:reference?.title||message,截止日期:deadline.value,每周小时:hours.value,情况备注:reference?message:''}),
     skill_profile:profile,...filesPayload,base_plan_id:reference?.id},request.controller.signal);
    if(active()&&flight===request){
     flight=null;
     handleAgentResult({...result,dialogueReview:{created:true,reply:result.dialogue_reply||
      '准备方案已生成。可以先核对任务和时间，也可以继续告诉我你想怎样调整。'}});
    }
    return;
   }
   const result=await dialogueRequest(path,{text:message,skill_profile:profile,...filesPayload},request.controller.signal);
   if(active()&&flight===request){
    flight=null;attachments.length=0;showAttachments();display(result);setBusy(false);
    try{
     const plan=await dialogueRequest(planPath);
     if(active()&&current===result&&!flight)handleAgentResult({...plan,dialogueReview:{
      reply:result.messages.at(-1)?.text,pending:result.pending}});
    }catch(error){if(active())status.textContent=error.message}
   }
  }catch(error){
   if(!active()||flight!==request)return;
   flight=null;
   failed={message,profile,error};
   showMessages([...current.messages,{role:'user',text:message,failed:error}]);
   setBusy(false,error.message);
   if(error.code==='model_not_configured'){
    const button=document.createElement('button');
    button.type='button';button.className='secondary';button.textContent='打开模型 API 设置';
    button.addEventListener('click',openModelSettings);status.append(' ',button);
   }
  }
 }
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
   try{await navigator.clipboard.writeText(visibleMessages[Number(button.dataset.copy)].text);button.textContent='已复制'}
   catch{if(active())status.textContent='浏览器未允许访问剪贴板，可以选中文字后复制。'}
   return;
  }
  if(button.hasAttribute('data-cancel-send')&&flight){
   const request=flight;
   button.disabled=true;
   try{
    if(request.started)await dialogueRequest('dialogue-requests/'+request.id+'/cancel',{});
    if(active()&&flight===request){
     flight=null;request.controller.abort();input.value=request.message;
     showMessages(current.messages);setBusy(false,'已撤回，可以修改后重发。');input.focus();
    }
   }catch(error){if(active()&&flight===request){button.disabled=false;status.textContent=error.message}}
   return;
  }
  if(busy)return;
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
 root.querySelector('[data-dialogue-plan]')?.addEventListener('click',()=>openSavedPlan(id));
 root.querySelector('[data-dialogue-new]').addEventListener('click',()=>openPlanDialogue());
 const switcher=root.querySelector('[data-dialogue-switch]');
 if(id)switcher.add(new Option('当前对话',id,true,true));
 switcher.addEventListener('change',()=>openPlanDialogue(switcher.value||null));
 dialogueRequest('plans').then(plans=>{
  if(!active())return;
  const currentOption=Array.from(switcher.options).find(option=>option.value===id);
  for(const plan of plans){
   if(plan.id===id){currentOption.textContent=plan.title;continue}
   switcher.add(new Option(plan.title+(plan.created_at?' · '+new Date(plan.created_at).toLocaleString('zh-CN'):''),plan.id));
  }
 }).catch(()=>{if(active())switcher.title='暂时无法读取其他对话，请重新打开个性化推荐'});
 if(creating){
  root.querySelector('.dialogue-plan-summary').hidden=true;
  input.placeholder='例如：准备六级考试。目标 600 分，上次听力丢分较多。';
  if(reference?.hours)hours.value=reference.hours;
  display({title:reference?'参考「'+reference.title+'」开始新对话':'新对话',skill_profile:'auto',messages:[],pending:null});
  setBusy(false);input.focus();
 }else{
  setBusy(true,'正在读取对话…');
  refreshPlanSummary();
  dialogueRequest(path).then(result=>{if(active()){display(result);setBusy(false)}})
   .catch(error=>{if(active())setBusy(false,error.message)});
 }
}
