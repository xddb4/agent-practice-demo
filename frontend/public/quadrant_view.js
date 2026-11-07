// 象限只展示已有任务，推荐目标不绑定任何象限。
function quadrantPending(q){return tasks.filter(task=>task.q===q&&!task.done).sort(taskPriority)}
quadHTML=function(){return '<div class="quadrant-sphere-stage" role="group" aria-label="四个任务象限">'+labels.map((label,q)=>{
 const list=quadrantPending(q);
 return '<article class="quadrant-sphere sphere-q'+q+'" data-drop-q="'+q+'" data-sphere-q="'+q+'" data-count="'+list.length+'"><button class="sphere-hit-area" aria-haspopup="dialog" aria-expanded="false" aria-label="'+esc(label)+'，'+list.length+'项待办，点击查看详情" onclick="showQuadrantTasks('+q+')"><span class="sphere-label">'+esc(label)+'</span><span class="sphere-count">'+list.length+'<small>项待办</small></span></button><div class="sphere-preview" inert aria-hidden="true"><ul class="sphere-task-list" tabindex="0" aria-label="'+esc(label)+'待办任务">'+(list.map(task=>'<li><span>'+esc(task.title)+'</span><small>'+esc(task.start?(task.start+' – '+(task.end||'')):(task.ddl?'截止 '+task.ddl:'待安排'))+'</small></li>').join('')||'<li class="sphere-empty">暂无待办<br><small>给重要的事情，留一点空间。</small></li>')+'</ul><button type="button" class="sphere-more" aria-label="向下查看更多任务" hidden>⌄</button></div></article>';
 }).join('')+'</div>'};
function quadrantTaskHTML(task){return '<article class="preview-item quadrant-detail-item"><h3>'+esc(task.title)+'</h3><dl><dt>任务类型</dt><dd>'+(task.start?'固定时间任务':'灵活任务')+'</dd><dt>计划日期</dt><dd>'+esc(task.date||'未设置')+'</dd><dt>时间</dt><dd>'+esc(task.start?(task.start+' – '+task.end):(task.duration?task.duration+' 分钟':'未设置'))+'</dd><dt>截止日期</dt><dd>'+esc(task.ddl||'未设置')+'</dd><dt>地点</dt><dd>'+esc(task.location||'未设置')+'</dd></dl>'+qSelect(task)+'<div class="modal-footer"><button class="secondary" onclick="editTask('+task.id+')">编辑任务</button><button class="primary" onclick="completeQuadrantTask('+task.id+','+task.q+')">标记完成</button></div></article>'}
function showQuadrantTasks(q){
 if(!Number.isInteger(q)||q<0||q>3)return;
 const list=quadrantPending(q);
 modal('<div class="modal-head"><h2>'+esc(labels[q])+' · '+list.length+' 项待办</h2><button onclick="closeModal()" aria-label="关闭任务列表">✕</button></div>'+(list.map(quadrantTaskHTML).join('')||'<p class="empty">这个象限暂无待办任务。</p>'));
 document.querySelector('#modal-root .modal-backdrop')?.classList.add('quadrant-detail-backdrop');
 document.querySelector('#modal-root [aria-label="关闭任务列表"]')?.focus({preventScroll:true});
}
function completeQuadrantTask(id,q){toggle(id);if(tasks.find(task=>task.id===id)?.done)showQuadrantTasks(q)}
matrix=function(){
 selectedQuadrant=null;
 document.getElementById('content').classList?.add('sphere-matrix');
 document.getElementById('content').innerHTML=head('把精力，<br>放在值得的事上。','','<button id="recommendation-toggle" class="recommendation-toggle" aria-haspopup="dialog" onclick="openPersonalizedRecommendations()"><svg width="30" height="30" viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M16 3c0 9-4 13-13 13 9 0 13 4 13 13 0-9 4-13 13-13-9 0-13-4-13-13Z"/><path d="M26 2v7m-3.5-3.5h7"/></svg><span>推荐任务</span></button>')+'<div class="division-workspace"><section class="editorial-quadrants">'+quadHTML()+'</section></div>';
 document.querySelectorAll('[data-drop-q]').forEach(el=>el.addEventListener('click',event=>{if(event.target.closest('button,select,input,a'))return;if(Date.now()<dragClickUntil)return;showQuadrantTasks(Number(el.dataset.dropQ))}));
 if(typeof mountQuadrantSpheres==='function')mountQuadrantSpheres(document.querySelector('.quadrant-sphere-stage'));
};
openPersonalizedRecommendations=function(){if(!activeAccount)return login();openPlanDialogue()};
if(typeof document!=='undefined'){
 const entry=document.getElementById('recommend-entry');
 if(entry)entry.onclick=openPersonalizedRecommendations;
}
