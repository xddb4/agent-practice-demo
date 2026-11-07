"""依据真实周预算、固定安排和任务依赖，给出候选完成时间。"""
import json,math
from datetime import datetime,timedelta,time
from zoneinfo import ZoneInfo

TZ=ZoneInfo('Asia/Shanghai')
def schedule_plan(items,text,tasks,now=None):
    now=now or datetime.now(TZ)
    try:goal=json.loads(text)
    except (ValueError,TypeError):goal={}
    if not isinstance(goal,dict):goal={}
    try:deadline=datetime.fromisoformat(str(goal.get('截止日期',''))).date()
    except ValueError:return items,{'feasible':False,'warnings':['请补充目标截止日期，才能计算建议DDL。']}
    try:weekly=int(float(goal.get('每周小时',0))*60)
    except (ValueError,TypeError):weekly=0
    if weekly<=0:return items,{'feasible':False,'warnings':['请补充每周可投入时间。']}
    end=min(deadline,now.date()+timedelta(days=366))
    keys=[item.get('task_key') or 'task-'+str(i+1) for i,item in enumerate(items)]
    if len(set(keys))!=len(keys):raise ValueError('任务标识重复')
    lookup=dict(zip(keys,items));ordered=[];remaining=list(keys)
    while remaining:
        ready=[key for key in remaining if all(dep in ordered for dep in lookup[key].get('depends_on',[]))]
        if not ready:raise ValueError('任务依赖存在循环或缺失')
        for key in ready:ordered.append(key);remaining.remove(key)
    slots=[];day=now.date()
    while day<=end:
        quota=weekly//7+(1 if (day-now.date()).days%7<weekly%7 else 0)
        start=8*60
        if day==now.date():start=max(start,math.ceil((now.hour*60+now.minute+1)/15)*15)
        busy=[]
        for task in tasks:
            if not task.get('start') or not task.get('end'):continue
            matching=task.get('date')==day.isoformat()
            if task.get('repeat') in ['每周','每周六'] and task.get('date','9999')<=day.isoformat():
                try:matching=matching or datetime.fromisoformat(task['date']).date().weekday()==day.weekday()
                except ValueError:pass
            if matching:
                try:busy.append(tuple(int(value[:2])*60+int(value[3:5]) for value in [task['start'],task['end']]))
                except (ValueError,TypeError):pass
        for minute in range(start,22*60):
            if quota<=0:break
            if not any(a<=minute<b for a,b in busy):slots.append(datetime.combine(day,time(minute//60,minute%60),TZ));quota-=1
        day+=timedelta(days=1)
    capacity=len(slots);cursor=0;finishes={};result=[];warnings=[]
    for key in ordered:
        item={**lookup[key],'task_key':key,'depends_on':lookup[key].get('depends_on',[]),'start':None,'end':None,'date':None,'deadline':None,'suggested_finish':None,'suggested_sessions':[]}
        dependencies=item['depends_on'];earliest=max((finishes.get(dep,datetime.max.replace(tzinfo=TZ)) for dep in dependencies),default=now)
        while cursor<len(slots) and slots[cursor]<earliest:cursor+=1
        duration=item['estimated_minutes']
        if cursor+duration<=len(slots):
            chosen=slots[cursor:cursor+duration];cursor+=duration;finish=chosen[-1]+timedelta(minutes=1);finishes[key]=finish
            sessions=[];a=previous=chosen[0]
            for stamp in chosen[1:]:
                if stamp-previous!=timedelta(minutes=1):sessions.append({'start':a.isoformat(),'end':(previous+timedelta(minutes=1)).isoformat()});a=stamp
                previous=stamp
            sessions.append({'start':a.isoformat(),'end':finish.isoformat()})
            item.update(date=chosen[0].date().isoformat(),deadline=finish.isoformat(),suggested_finish=finish.isoformat(),suggested_sessions=sessions)
        else:
            finishes[key]=datetime.max.replace(tzinfo=TZ);warnings.append('“'+item['title']+'”在当前预算与截止日期内排不下，请调整投入时间或任务范围。')
        result.append(item)
    return result,{'feasible':not warnings,'weekly_minutes':weekly,'minutes_requested':sum(item['estimated_minutes'] for item in items),'minutes_available':capacity,'target_date':deadline.isoformat(),'warnings':warnings}
