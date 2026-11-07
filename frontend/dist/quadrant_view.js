// 象限只展示已有任务，推荐目标不绑定任何象限。
function quadrantPending(q){return tasks.filter(task=>task.q===q&&!task.done).sort(taskPriority)}
quadHTML=function(){return '<div class="quadrants">'+labels.map((label,q)=>{
 const list=quadrantPending(q),ddl=list.map(task=>task.ddl).filter(Boolean).sort()[0];
 return '<div class="quad q'+q+'" data-drop-q="'+q+'"><button class="q-label" onclick="showQuadrantTasks('+q+')"><span class="q-mark"></span>'+esc(label)+'<span class="q-index">0'+(q+1)+'</span></button><div class="q-count">'+list.length+'<small>项待办</small></div><div class="q-task-list">'+(list.map(task=>'<button class="mini-task" data-task-id="'+task.id+'" onclick="detail('+task.id+')"><span class="q-task-dot">↗</span><span>'+esc(task.title)+'</span></button>').join('')||'<p class="q-empty">给重要的事情，留一点空间。</p>')+'</div><div class="q-ddl">最近 DDL · '+(ddl?esc(ddl):'未设置')+'</div></div>';
 }).join('')+'</div>'};
function quadrantTaskHTML(task){return '<article class="preview-item quadrant-detail-item"><h3>'+esc(task.title)+'</h3><dl><dt>任务类型</dt><dd>'+(task.start?'固定时间任务':'灵活任务')+'</dd><dt>计划日期</dt><dd>'+esc(task.date||'未设置')+'</dd><dt>时间</dt><dd>'+esc(task.start?(task.start+' – '+task.end):(task.duration?task.duration+' 分钟':'未设置'))+'</dd><dt>截止日期</dt><dd>'+esc(task.ddl||'未设置')+'</dd><dt>地点</dt><dd>'+esc(task.location||'未设置')+'</dd></dl>'+qSelect(task)+'<div class="modal-footer"><button class="secondary" onclick="editTask('+task.id+')">编辑任务</button><button class="primary" onclick="completeQuadrantTask('+task.id+','+task.q+')">标记完成</button></div></article>'}
function showQuadrantTasks(q){
 if(!Number.isInteger(q)||q<0||q>3)return;
 const list=quadrantPending(q);
 modal('<div class="modal-head"><h2>'+esc(labels[q])+' · '+list.length+' 项待办</h2><button onclick="closeModal()" aria-label="关闭任务列表">✕</button></div>'+(list.map(quadrantTaskHTML).join('')||'<p class="empty">这个象限暂无待办任务。</p>'));
 document.querySelector('#modal-root .modal-backdrop')?.classList.add('quadrant-detail-backdrop');
}
function completeQuadrantTask(id,q){toggle(id);showQuadrantTasks(q)}

matrix=function(){
 selectedQuadrant=null;
 document.getElementById('content').innerHTML=head('把精力，<br>放在值得的事上。','点击象限，查看其中的待办任务。','<button id="recommendation-toggle" class="recommendation-toggle" aria-haspopup="dialog" onclick="openPersonalizedRecommendations()"><span aria-hidden="true">✧</span><span>推荐任务</span></button>')+'<div class="division-workspace"><section class="editorial-quadrants">'+quadHTML()+'</section></div>';
 document.querySelectorAll('[data-drop-q]').forEach(el=>el.addEventListener('click',event=>{if(event.target.closest('button,select,input,a'))return;if(Date.now()<dragClickUntil)return;showQuadrantTasks(Number(el.dataset.dropQ))}));
};
openPersonalizedRecommendations=function(){if(!activeAccount)return login();openPlanDialogue()};
if(typeof document!=='undefined'){
 const entry=document.getElementById('recommend-entry');
 if(entry)entry.onclick=openPersonalizedRecommendations;
}
