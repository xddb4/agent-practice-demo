const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const {readFileSync}=require('node:fs');

function setup(){
 const state={reviewCourseImage(){},esc:String,modal:html=>state.preview=html,commitParsed:()=>state.committed=state.parsed,showStudyAlert:message=>state.alert=message,
  document:{querySelector:()=>null,getElementById:()=>null},
  addDays(day,count){const date=new Date(day+'T00:00:00Z');date.setUTCDate(date.getUTCDate()+count);return date.toISOString().slice(0,10)},
  minutes(time){const [hours,minutes]=time.split(':').map(Number);return hours*60+minutes},
 };
 vm.createContext(state);
 const prototype=readFileSync('code/frontend/StudyPilot.html','utf8');
 vm.runInContext(prototype.slice(prototype.indexOf('function layoutEvents('),prototype.indexOf('function dayFocusHTML(')),state);
 vm.runInContext(readFileSync('frontend/public/task_views.js','utf8'),state);
 vm.runInContext(readFileSync('frontend/public/course_review.js','utf8'),state);
 return state;
}

test('周视图只显示一周，淡化下周单双周课程，确认导入全部实际课程',()=>{
 const state=setup();
 state.courseTerm='2026-11-02';
 const base={from:1,to:2,location:'教室',q:1};
 state.courseRows=[
  {...base,title:'晚课',day:1,start:'18:00',end:'19:00',pattern:'all'},
  {...base,title:'双周课',day:2,start:'09:00',end:'10:00',pattern:'even'},
  {...base,title:'早课',day:1,start:'08:00',end:'09:00',pattern:'odd'},
 ];
 state.showCourseTimeline();
 assert.match(state.preview,/第 1 周 · 2026-11-02 至 2026-11-08/);
 assert.match(state.preview,/本周 2 节课/);
 assert.match(state.preview,/course-ghost[^>]*双周课/);
 assert(state.preview.indexOf('早课')<state.preview.indexOf('晚课'));
 state.showCourseTimeline(2);
 assert.match(state.preview,/第 2 周 · 2026-11-09 至 2026-11-15/);
 assert.doesNotMatch(state.preview,/早课|course-ghost/);
 assert.equal(state.committed,undefined);
 state.importReviewedCourses();
 assert.deepEqual(Array.from(state.committed,item=>[item.date,item.title]),[
  ['2026-11-02','早课'],['2026-11-02','晚课'],['2026-11-09','晚课'],['2026-11-10','双周课'],
 ]);
});

test('淡化课程遵守起始周，并保留原日程数据',()=>{
 const state=setup();
 const task={date:'2026-11-09',title:'双周课',start:'08:00',end:'09:00',repeat:'第 2 周 · 双周'};
 const ghosts=state.nextWeekCourseGhosts([task],'2026-11-02');
 assert.equal(ghosts.length,1);assert.equal(ghosts[0].ghost,true);assert.equal(task.ghost,undefined);
 assert.equal(state.nextWeekCourseGhosts([{...task,course_from_week:2}],'2026-11-02').length,0);
 assert.equal(state.nextWeekCourseGhosts([{...task,repeat:'第 2 周 · 每周'}],'2026-11-02').length,0);
});

test('缺少周次或实际上课时间时不会生成错误日程',()=>{
 const state=setup();
 assert.throws(()=>state.expandCourseTimeline([],'2026-11-03'),/周一/);
 const course={title:'课程',day:1,start:'',end:'09:00',from:1,to:1,pattern:'all'};
 assert.throws(()=>state.expandCourseTimeline([course],'2026-11-02'),/上课时间/);
 assert.throws(()=>state.expandCourseTimeline([{...course,start:'08:00',from:''}],'2026-11-02'),/起始周/);
});

test('确认提示后聚焦出错的学期日期输入框',()=>{
 const state=setup();
 const field={scrollIntoView(){this.scrolled=true},focus(){this.focused=true},setAttribute(){},addEventListener(){}};
 state.document.querySelector=selector=>selector==='#modal-root #course-term'?field:null;
 let acknowledge;
 state.showStudyAlert=(message,_title,onClose)=>{assert.match(message,/第一周的周一/);acknowledge=onClose};
 state.courseRows=[];
 state.showCourseTimeline();
 assert.equal(field.focused,undefined);
 acknowledge();
 assert.equal(field.scrolled,true);
 assert.equal(field.focused,true);
});

test('批量设置更新课程表格，保留批量输入与当前核对窗口',()=>{
 const state=setup();
 const batch={'course-bulk-from':'2','course-bulk-to':'16'};
 const from={removeAttribute(){}},to={removeAttribute(){}};
 state.courseRows=[{from:1,to:18}];
 state.val=id=>batch[id];
 state.document.querySelector=selector=>selector.includes('起始周')?from:to;
 state.reviewCourseImage=()=>assert.fail('批量应用不应重绘核对窗口');
 state.applyCourseWeeks();
 assert.deepEqual(state.courseRows,[{from:2,to:16}]);
 assert.equal(from.value,2);
 assert.equal(to.value,16);
 assert.deepEqual(batch,{'course-bulk-from':'2','course-bulk-to':'16'});
});
