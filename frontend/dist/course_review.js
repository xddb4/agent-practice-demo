courseTerm='';
let bulkCourseRows=null,bulkCourseWeeks={from:'',to:''};

function compareCourses(a,b){return (a.day||8)-(b.day||8)||(a.start||'99:99').localeCompare(b.start||'99:99')}

function validCourseWeeks(from,to){return Number.isInteger(from)&&Number.isInteger(to)&&from>=1&&to<=40&&to>=from}

function courseFieldSelector(index,label){return '[aria-label="课程'+(index+1)+' '+label+'"]'}

function focusCourseField(selector,invalid=false){
 const field=document.querySelector('#modal-root '+selector);
 if(!field)return false;
 field.scrollIntoView({block:'center',inline:'nearest'});
 field.focus({preventScroll:true});
 if(invalid){
  field.setAttribute('aria-invalid','true');
  field.addEventListener('input',()=>field.removeAttribute('aria-invalid'),{once:true});
 }
 return true;
}

function courseFieldAlert(message,selector,title='请核对课表'){
 return showStudyAlert(message,title,()=>selector&&focusCourseField(selector,true));
}

function applyCourseWeeks(){
 const from=Number(val('course-bulk-from')),to=Number(val('course-bulk-to'));
 if(!validCourseWeeks(from,to)){
  const field=validCourseWeeks(from,from)?'to':'from';
  return courseFieldAlert('请输入 1–40 的整数，结束周不能早于起始周。','#course-bulk-'+field,'请核对周次');
 }
 bulkCourseWeeks={from,to};
 courseRows.forEach(course=>Object.assign(course,{from,to}));
 for(const [index] of courseRows.entries()){
  for(const [label,value] of [['起始周',from],['结束周',to]]){
   const field=document.querySelector('#modal-root '+courseFieldSelector(index,label));
   field.value=value;
   field.removeAttribute('aria-invalid');
  }
 }
}

function addMissingCourse(){
 const course={title:'',day:0,start:'',end:'',location:'',from:bulkCourseWeeks.from,to:bulkCourseWeeks.to,pattern:'all',q:1};
 courseRows.push(course);
 reviewCourseImage();
 focusCourseField(courseFieldSelector(courseRows.indexOf(course),'课程名称'));
}

const renderCourseFields=reviewCourseImage;
reviewCourseImage=function(){
 if(bulkCourseRows!==courseRows){bulkCourseRows=courseRows;bulkCourseWeeks={from:'',to:''}}
 courseRows.sort(compareCourses);
 renderCourseFields();
 const term=document.getElementById('course-term');
 term.closest('.form-group').insertAdjacentHTML('afterend',`<section class="preview-item course-bulk-weeks"><b>统一设置课程周次</b>
 <div class="form-grid"><label>统一起始周<input id="course-bulk-from" type="number" min="1" max="40" value="${esc(bulkCourseWeeks.from)}" oninput="bulkCourseWeeks.from=this.value"></label>
 <label>统一结束周<input id="course-bulk-to" type="number" min="1" max="40" value="${esc(bulkCourseWeeks.to)}" oninput="bulkCourseWeeks.to=this.value"></label></div>
 <button type="button" class="secondary" onclick="applyCourseWeeks()">应用到全部课程</button></section>`);
 document.querySelectorAll('.course-review select[aria-label$=" 星期"]').forEach((select,index)=>{
  const placeholder=document.createElement('option');
  placeholder.value='0';placeholder.textContent='请选择星期';placeholder.disabled=true;
  select.prepend(placeholder);select.value=String(courseRows[index].day);
 });
 const preview=document.querySelector('#modal-root button[onclick="importReviewedCourses()"]');
 preview.textContent='预览生成的时间轴';preview.onclick=showCourseTimeline;
 const footer=preview.closest('.modal-footer');
 const note=footer.previousElementSibling;
 const add=note.previousElementSibling;
 add.id='course-add';add.onclick=addMissingCourse;
 const dialog=term.closest('.modal');
 const actions=document.createElement('aside');actions.className='course-review-actions';
 actions.setAttribute('aria-label','课表操作');
 actions.append(add,footer,note);
 const content=document.createElement('div');content.className='course-review-content';
 content.append(...dialog.childNodes);
 dialog.classList.add('course-review-dialog');
 dialog.append(content,actions);
};

function courseValidationError(message,selector){return Object.assign(new Error(message),{selector})}

function expandCourseTimeline(rows,term){
 const base=new Date(term+'T00:00:00Z');
 if(!/^\d{4}-\d{2}-\d{2}$/.test(term)||Number.isNaN(base.getTime())||base.toISOString().slice(0,10)!==term||base.getUTCDay()!==1)throw courseValidationError('请填写学期第一周的周一日期。','#course-term');
 if(!rows.length)throw courseValidationError('请至少保留一门课程。','#course-add');
 const events=[];
 for(const [index,course] of rows.entries()){
  if(!course.title.trim())throw courseValidationError('请填写课程名称。',courseFieldSelector(index,'课程名称'));
  if(!Number.isInteger(course.day)||course.day<1||course.day>7)throw courseValidationError('请选择上课星期。',courseFieldSelector(index,'星期'));
  if(!course.start||!course.end||course.start>=course.end)throw courseValidationError('请补齐上课时间，结束时间需晚于开始时间。',courseFieldSelector(index,course.start?'结束时间':'开始时间'));
  if(!validCourseWeeks(course.from,course.to))throw courseValidationError('请核对每门课程的起始周和结束周，范围为 1–40。',courseFieldSelector(index,validCourseWeeks(course.from,course.from)?'结束周':'起始周'));
  for(let week=course.from;week<=course.to;week++){
   if((course.pattern==='odd'&&week%2===0)||(course.pattern==='even'&&week%2===1))continue;
   const day=new Date(base);
   day.setUTCDate(day.getUTCDate()+(week-1)*7+course.day-1);
   events.push({title:course.title.trim(),date:day.toISOString().slice(0,10),start:course.start,end:course.end,
    location:course.location,repeat:'第 '+week+' 周 · '+({all:'每周',odd:'单周',even:'双周'}[course.pattern]),course_from_week:course.from,q:course.q,done:false,source:'课表图片核对录入'});
  }
 }
 if(!events.length)throw courseValidationError('当前周次范围没有符合单双周规则的课程。',courseFieldSelector(0,'重复规则'));
 return events.sort((a,b)=>a.date.localeCompare(b.date)||a.start.localeCompare(b.start));
}

function showCourseTimeline(requestedWeek){
 let events;
 try{events=expandCourseTimeline(courseRows,courseTerm)}catch(error){return courseFieldAlert(error.message,error.selector)}
 const firstWeek=Math.min(...courseRows.map(course=>course.from));
 const lastWeek=Math.max(...courseRows.map(course=>course.to));
 const week=Number.isInteger(requestedWeek)?Math.max(firstWeek,Math.min(lastWeek,requestedWeek)):firstWeek;
 const monday=addDays(courseTerm,(week-1)*7);
 const days=Array.from({length:7},(_,index)=>addDays(monday,index));
 const entries=days.map(day=>events.filter(event=>event.date===day).concat(nextWeekCourseGhosts(events,day)));
 const count=entries.flat().filter(event=>!event.ghost).length;
 const paritySwitch=parity=>{
  const selected=week%2===parity;
  const target=selected?week:week<lastWeek?week+1:week-1;
  return `<button class="secondary" aria-pressed="${selected}" ${target<firstWeek?'disabled':''} onclick="showCourseTimeline(${target})">${parity?'单周':'双周'}</button>`;
 };
 const headers=days.map((day,index)=>`<b>周${'一二三四五六日'[index]} <small>${esc(day.slice(5))}</small></b>`).join('');
 const columns=entries.map(day=>'<div class="course-week-column">'+timelineBlocksHTML(day)+'</div>').join('');
 modal(`<div class="modal-head"><h2>课表时间轴预览</h2><button onclick="closeModal()" aria-label="关闭预览">✕</button></div>
 <div class="course-week-tools"><b>第 ${week} 周 · ${esc(monday)} 至 ${esc(days[6])}</b>
 <button class="secondary" ${week<=firstWeek?'disabled':''} onclick="showCourseTimeline(${week-1})">上一周</button>
 ${paritySwitch(1)}${paritySwitch(0)}<button class="secondary" ${week>=lastWeek?'disabled':''} onclick="showCourseTimeline(${week+1})">下一周</button></div>
 <p class="desc">本周 ${count} 节课。淡色课程本周不上课，下周上课。确认时导入全部核对过的课程周次。</p>
 <div class="course-week-scroll" id="course-week-scroll" tabindex="0" aria-label="一周课表时间轴"><div class="course-week-board"><div class="course-week-heading">${headers}</div><div class="hours-canvas course-week-grid">${timelineHoursHTML()}${columns}</div></div></div>
 <div class="modal-footer"><button class="secondary" onclick="reviewCourseImage()">返回核对</button><button class="primary" onclick="importReviewedCourses()">确认导入并检查冲突</button></div>`);
 const scroll=document.getElementById('course-week-scroll');
 const starts=entries.flat().map(event=>minutes(event.start));
 if(scroll)scroll.scrollTop=Math.max(0,(starts.length?Math.min(...starts):480)-60);
}

importReviewedCourses=function(){
 let events;
 try{events=expandCourseTimeline(courseRows,courseTerm)}catch(error){return courseFieldAlert(error.message,error.selector)}
 const stamp=Date.now();
 parsed=events.map((event,index)=>({...event,id:stamp+index}));
 commitParsed();
};
