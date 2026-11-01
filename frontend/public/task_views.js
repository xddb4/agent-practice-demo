// 日计划、四象限和推荐统一读取tasks，不另存四套任务数组。
const tasksOnWithStoredDates=typeof tasksOn==='function'?tasksOn:()=>[];
tasksOn=function(key){
 const direct=tasksOnWithStoredDates(key),ids=new Set(direct.map(task=>task.id));
 return direct.concat(timelineTasks().filter(task=>!task.start&&!ids.has(task.id)&&(task.suggested_sessions||[]).some(slot=>slot.start?.slice(0,10)===key)));
};
function taskPriority(a,b){return (a.ddl||'9999-12-31').localeCompare(b.ddl||'9999-12-31')||(a.q??3)-(b.q??3)||(a.duration??Infinity)-(b.duration??Infinity)}
function flexibleGroups(list,key){
 const all=list.filter(task=>!task.start).sort(taskPriority);
 const current=all.filter(task=>task.date===key||(task.suggested_sessions||[]).some(slot=>slot.start?.slice(0,10)===key)||(!task.done&&task.ddl&&task.ddl<=key)||(!task.done&&task.date&&task.date<key));
 const ids=new Set(current.map(task=>task.id));return {all,current,other:all.filter(task=>!ids.has(task.id))};
}
function flexibleCard(task){
 if(typeof demoPreview!=='undefined'&&demoPreview)return '<div class="task-row"><span class="pill">案例</span><div class="task-info"><button class="task-name" onclick="inspectTimelineTask('+task.id+')">'+esc(task.title)+'</button><div class="task-meta">DDL：'+esc(task.ddl||'未设置')+'</div></div>'+pill(task.q)+'</div>';
 return '<div class="task-row '+(task.done?'done':'')+'" data-task-id="'+task.id+'"><button class="check" aria-label="切换完成状态" onclick="toggle('+task.id+')">'+(task.done?'✓':'')+'</button><button class="drag-handle" aria-label="拖动任务">⠿</button><div class="task-info"><button class="task-name" onclick="inspectTimelineTask('+task.id+')">'+esc(task.title)+'</button><div class="task-meta">DDL：'+esc(task.ddl||'未设置')+' · '+(task.duration?task.duration+'分钟':'时长未设置')+'</div><div class="task-end">'+esc(task.suggest||'建议时间未设置')+'</div></div>'+qSelect(task)+'</div>';
}
flexibleHTML=function(){
 const groups=flexibleGroups(timelineTasks(),date);
 return '<div class="tasks shredder" id="task-shredder"><div class="section-label"><span>灵活代办：'+groups.all.length+'条</span><span>拖到底部松手删除</span></div><p class="tiny">当天及逾期 '+groups.current.length+'条 · 其他日期／待安排 '+groups.other.length+'条</p><div class="shred-list" id="shred-list">'+groups.current.map(flexibleCard).join('')+(!groups.current.length?'<div class="empty">当天没有灵活任务，可展开其他日期的任务。</div>':'')+(groups.other.length?'<details><summary class="tiny" style="cursor:pointer;padding:12px 0">其他日期／待安排（'+groups.other.length+'条）</summary>'+groups.other.map(flexibleCard).join('')+'</details>':'')+'</div><div class="shred-drop" id="shred-drop"><div class="shred-mouth" aria-hidden="true"></div><p class="shred-prompt">拖到这里，松手删除任务</p></div><div class="shred-footer"><span>⠿ 拖动调整象限 · 点击查看详情</span><button class="tiny" onclick="showDeletedTasks()">最近删除</button></div></div>';
};
