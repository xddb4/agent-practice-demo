// 日计划、四象限和推荐统一读取tasks，不另存四套任务数组。
const tasksOnWithStoredDates=typeof tasksOn==='function'?tasksOn:()=>[];
tasksOn=function(key){
 const direct=tasksOnWithStoredDates(key),ids=new Set(direct.map(task=>task.id));
 return direct.concat(timelineTasks().filter(task=>!task.start&&!ids.has(task.id)&&(task.suggested_sessions||[]).some(slot=>slot.start?.slice(0,10)===key)));
};
function nextWeekCourseGhosts(list,key){
 const nextDate=addDays(key,7);
 return list.filter(task=>{
  if(task.date!==nextDate||!task.start||!task.end)return false;
  const repeat=/^第 (\d+) 周 · (单周|双周)$/.exec(task.repeat||'');
  return repeat&&Number(repeat[1])-1>=(task.course_from_week??1);
 }).map(task=>({...task,ghost:true}));
}
function timelineHoursHTML(){
 return Array.from({length:24},(_,hour)=>'<div class="hour-line" style="top:'+hour*60+'px"><span>'+String(hour).padStart(2,'0')+':00</span></div>').join('');
}
function timelineBlocksHTML(events,interactive=false){
 return layoutEvents(events).map(task=>{
  const clickable=interactive&&!task.ghost;
  const tag=clickable?'button':'div';
  const name=task.title+' '+task.start+'至'+task.end+(task.ghost?' · 本周不上课，下周上课':'');
  const style='top:'+minutes(task.start)+'px;height:'+Math.max(23,minutes(task.end)-minutes(task.start))+'px;left:calc('+(task.lane/task.columns*100)+'% + 3px);width:calc('+(100/task.columns)+'% - 7px)';
  return '<'+tag+' class="scheduled-event q-tone-'+task.q+(task.done&&!task.ghost?' is-done':'')+(task.ghost?' course-ghost':'')+'" title="'+esc(name)+'" '+
   (clickable?(!demoPreview?'data-task-id="'+task.id+'" ':'')+'onclick="inspectTimelineTask('+task.id+')" aria-label="'+esc(name)+'" ':'')+
   'style="'+style+'"><b>'+esc(task.title)+'</b><small>'+esc(task.start+' – '+task.end)+'</small><small>'+esc(task.ghost?'本周不上课 · 下周上课':task.location||'')+'</small></'+tag+'>';
 }).join('');
}
if(typeof dayFocusHTML==='function')dayFocusHTML=function(){
 const actual=tasksOn(date).filter(task=>task.start);
 const ghosts=demoPreview?[]:nextWeekCourseGhosts(tasks,date);
 const blocks=timelineBlocksHTML(actual.concat(ghosts),true);
 return '<div class="day-focus"><div class="day-focus-head"><b id="day-focus-title" tabindex="-1">'+esc(date.replaceAll('-',' / '))+' · 当日安排</b></div><div class="day-scroll" id="day-scroll" data-date="'+esc(date)+'" tabindex="0" aria-label="当天24小时时间轴，上下滚动查看"><div class="hours-canvas">'+timelineHoursHTML()+blocks+(!blocks?'<div class="day-empty">这一天还没有固定安排。点击圆形加号即可添加日程。</div>':'')+'</div></div></div>';
};
function taskPriority(a,b){return (a.ddl||'9999-12-31').localeCompare(b.ddl||'9999-12-31')||(a.q??3)-(b.q??3)||(a.duration??Infinity)-(b.duration??Infinity)}
function flexibleGroups(list,key){
 const all=list.filter(task=>!task.start&&!task.done).sort(taskPriority);
 const current=all.filter(task=>(!task.done&&!task.ddl)||task.date===key||(task.suggested_sessions||[]).some(slot=>slot.start?.slice(0,10)===key)||(!task.done&&task.ddl&&task.ddl<=key)||(!task.done&&task.date&&task.date<key));
 const ids=new Set(current.map(task=>task.id));return {all,current,other:all.filter(task=>!ids.has(task.id))};
}
function flexibleCard(task){
 if(typeof demoPreview!=='undefined'&&demoPreview)return '<div class="task-row"><span class="pill">案例</span><div class="task-info"><button class="task-name" onclick="inspectTimelineTask('+task.id+')">'+esc(task.title)+'</button><div class="task-meta">DDL：'+esc(task.ddl||'未设置')+'</div></div>'+pill(task.q)+'</div>';
 return '<div class="task-row '+(task.done?'done':'')+'" data-task-id="'+task.id+'"><button class="check" aria-label="切换完成状态" onclick="toggle('+task.id+')">'+(task.done?'✓':'')+'</button><button class="drag-handle" aria-label="拖动任务">⠿</button><div class="task-info"><button class="task-name" onclick="inspectTimelineTask('+task.id+')">'+esc(task.title)+'</button><div class="task-meta">DDL：'+esc(task.ddl||'未设置')+' · '+(task.duration?task.duration+'分钟':'时长未设置')+'</div><div class="task-end">'+esc(task.suggest||'建议时间未设置')+'</div></div>'+qSelect(task)+'</div>';
}
flexibleHTML=function(){
 const groups=flexibleGroups(timelineTasks(),date);
 return '<div class="tasks shredder" id="task-shredder"><div class="section-label"><span>灵活代办：'+groups.all.length+'条</span><span>拖到底部松手删除</span></div><p class="tiny">当天／逾期／无截止日期 '+groups.current.length+'条 · 其他日期／待安排 '+groups.other.length+'条</p><div class="shred-list" id="shred-list">'+groups.current.map(flexibleCard).join('')+(!groups.current.length?'<div class="empty">没有当前待办，可展开其他日期的任务。</div>':'')+(groups.other.length?'<details><summary class="tiny" style="cursor:pointer;padding:12px 0">其他日期／待安排（'+groups.other.length+'条）</summary>'+groups.other.map(flexibleCard).join('')+'</details>':'')+'</div><div class="shred-drop" id="shred-drop"><div class="shred-mouth" aria-hidden="true"></div><p class="shred-prompt">拖到这里，松手删除任务</p></div><div class="shred-footer"><span>⠿ 拖动调整象限 · 点击查看详情</span><button class="tiny" onclick="showDeletedTasks()">最近删除</button></div></div>';
};

// 独立入口，避免象限页布局变化后丢失推荐页面。
function openPersonalizedRecommendations(){if(!activeAccount)return login();page='recommend';render()}
if(typeof document!=='undefined'){
 const help=document.querySelector('.header-help');
 if(help&&!document.getElementById('recommend-entry')){
  const entry=document.createElement('button');entry.id='recommend-entry';entry.className='secondary';entry.textContent='个性化推荐';entry.onclick=openPersonalizedRecommendations;help.before(entry);
 }
}
