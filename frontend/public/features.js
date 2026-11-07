// 附件、课表候选与重复系列的扩展实现。
submitEvidence=async function(e){
 e.preventDefault();try{
  const file=document.getElementById('e-file').files[0];let text=val('e-body');
  if(file){const form=new FormData();form.append('file',file);const r=await fetch('/api/files',{method:'POST',body:form});const data=await r.json();if(!r.ok)throw Error(data.detail);text+='\n附件：'+data.name+'\n来源路径：'+data.url+'\n'+data.text}
  askAgent('evidence',val('e-title')+'\n来源：'+val('e-source')+'\n'+text);
 }catch(e){toast(e.message)}
};
recognizeCourseDemo=function(){if(!courseImage)return toast('请先选择课表图片');if(!courseImage.url.startsWith('data:image/'))return toast('图片无效');askAgent('schedule','识别这张课表。按课表填写星期、起止时间、地点和教学周。只有节次或字段不清楚时留空，不要猜测。',courseImage.url)};
const baseMapItem=mapItem;
mapItem=function(x,i){const t=baseMapItem(x,i);if(!x.start&&!x.date&&!x.deadline)t.date='';return t};
const baseCommitParsed=commitParsed;
commitParsed=function(){if(parsed.some(t=>!t.title?.trim()||!/^\d{4}-\d{2}-\d{2}$/.test(t.date)||t.start&&(!t.end||t.start>=t.end)))return toast('请补充每项的计划日期，并检查起止时间');return baseCommitParsed()};
const baseTrash=persistTasksAndTrash;
persistTasksAndTrash=function(nextTasks,nextTrash){tasks=nextTasks;save();return true};
const baseImportCourses=importReviewedCourses;
importReviewedCourses=function(){
 if(courseRows.some(x=>!Number.isInteger(x.day)||x.day<1||x.day>7))return toast('请为每门课程选择已核实的星期');
 return baseImportCourses();
};
// 标题显示当前列表数量；日期切换和任务增删时随列表重新计算。
const originalFlexibleHTML=flexibleHTML;
flexibleHTML=function(){
 const count=tasksOn(date).filter(task=>!task.start).length;
 return originalFlexibleHTML().replace(/(<div class="section-label"><span>)[\s\S]*?(<\/span>)/,(_,open,close)=>open+'灵活代办：'+count+'条'+close).replace(/null 分钟/g,'时长未设置');
};
centerToday=function(){
 clearTimeout(galleryHoverTimer);
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
 const part=type=>parts.find(p=>p.type===type).value;
 const key=part('year')+'-'+part('month')+'-'+part('day');
 date=key;timelineCenter=key;timelineMode='day';galleryTimelineExpanded=true;render();
 // 重绘时鼠标可能恰好位于其他日期卡片上，避免悬停立即覆盖今天。
 const holdUntil=Date.now()+500;
 document.getElementById('task-gallery')?.addEventListener('pointerenter',event=>{if(Date.now()<holdUntil)event.stopPropagation()},true);
};
const renderPlanWithOriginalToolbar=renderPlan;
renderPlan=function(){
 renderPlanWithOriginalToolbar();
 const button=document.querySelector('.time-tools button[onclick="centerToday()"]');
 if(button){button.textContent='回到今天';button.setAttribute('aria-label','回到今天');}
};
// 页面提示仅说明实际运行方式，布局与动效由原型保留。
const contentObserver=new MutationObserver(()=>{
 document.querySelectorAll('.notice').forEach(n=>{if(n.textContent.includes('原型使用规则演示'))n.textContent='识别通过 Agent 生成候选，请核对后确认保存。';});
 const label=document.querySelector('label[for="e-file"]');if(label)label.textContent='作品附件';
});
contentObserver.observe(document.getElementById('content'),{childList:true,subtree:true});
