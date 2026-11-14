"""依据真实周预算、固定安排和任务依赖，给出候选完成时间。"""
import json,math
from bisect import bisect_left
from datetime import datetime,timedelta,time
from zoneinfo import ZoneInfo

TZ=ZoneInfo('Asia/Shanghai')
def planning_slots(text,tasks,now):
    try:goal=json.loads(text)
    except (ValueError,TypeError):goal={}
    if not isinstance(goal,dict):goal={}
    try:deadline=datetime.fromisoformat(str(goal.get('截止日期',''))).date()
    except ValueError:return [],{'feasible':False,'warnings':['请补充目标截止日期，才能计算建议DDL。']}
    try:weekly=int(float(goal.get('每周小时',0))*60)
    except (ValueError,TypeError,OverflowError):weekly=0
    if weekly<=0:return [],{'feasible':False,'warnings':['请补充每周可投入时间。']}
    end=min(deadline,now.date()+timedelta(days=366))
    slots={};longest_by_week={};day=now.date();consecutive=0
    minute_step=timedelta(minutes=1)
    while day<=end:
        week=(day-now.date()).days//7
        week_slots=slots.setdefault(week,[])
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
            if any(a<=minute<b for a,b in busy):continue
            slot=datetime.combine(day,time(minute//60,minute%60),TZ)
            consecutive=consecutive+1 if week_slots and slot-week_slots[-1]==minute_step else 1
            longest_by_week[week]=max(longest_by_week.get(week,0),consecutive)
            week_slots.append(slot)
        day+=timedelta(days=1)
    weeks=[{
        'start':(now.date()+timedelta(days=week*7)).isoformat(),
        'end':min(end,now.date()+timedelta(days=week*7+6)).isoformat(),
        'available_minutes':min(weekly,len(week_slots)),
        'longest_contiguous_minutes':min(weekly,longest_by_week.get(week,0)),
    } for week,week_slots in slots.items()]
    return slots,{
        'weekly_minutes':weekly,
        'minutes_available':sum(week['available_minutes'] for week in weeks),
        'longest_contiguous_minutes':max((week['longest_contiguous_minutes'] for week in weeks),default=0),
        'target_date':deadline.isoformat(),
        'weeks':weeks,
    }

def contiguous_start(slots,start,duration):
    first=start
    for index in range(start,len(slots)):
        if index>first and slots[index]-slots[index-1]!=timedelta(minutes=1):first=index
        if index-first+1==duration:return first
    return len(slots)

def reserve_slots(slots,remaining,earliest,duration,continuous):
    reservations=[]
    for week,week_slots in slots.items():
        start=bisect_left(week_slots,earliest)
        if continuous:
            if remaining[week]<duration:continue
            start=contiguous_start(week_slots,start,duration)
            if start+duration>len(week_slots):continue
        count=min(duration,remaining[week],len(week_slots)-start)
        if not count:continue
        reservations.append((week,start,count))
        duration-=count
        if not duration:break
    if duration:return []
    chosen=[]
    for week,start,count in reservations:
        chosen.extend(slots[week][start:start+count])
        del slots[week][start:start+count]
        remaining[week]-=count
    return chosen


def schedule_plan(items,text,tasks,now=None,availability=None):
    now=now or datetime.now(TZ)
    slots,budget=availability if availability is not None else planning_slots(text,tasks,now)
    if 'warnings' in budget:return items,budget
    slots={week:week_slots.copy() for week,week_slots in slots.items()}
    remaining_minutes={week:budget['weekly_minutes'] for week in slots}
    keys=[item.get('task_key') or 'task-'+str(i+1) for i,item in enumerate(items)]
    if len(set(keys))!=len(keys):raise ValueError('任务标识重复')
    lookup=dict(zip(keys,items));ordered=[];remaining=list(keys)
    while remaining:
        ready=next((key for key in remaining if all(dep in ordered for dep in lookup[key].get('depends_on',[]))),None)
        if ready is None:raise ValueError('任务依赖存在循环或缺失')
        ordered.append(ready)
        remaining.remove(ready)
    finishes={};result=[];warnings=[];unscheduled={}
    for key in ordered:
        item={**lookup[key],'task_key':key,'depends_on':lookup[key].get('depends_on',[]),'start':None,'end':None,'date':None,'deadline':None,'suggested_finish':None,'suggested_sessions':[]}
        dependencies=item['depends_on']
        if any(dep not in finishes for dep in dependencies):
            missing='、'.join('「'+lookup[dep]['title']+'」' for dep in dependencies if dep not in finishes)
            unscheduled[key]='前置任务 '+missing+' 尚未排期。'
            warnings.append('“'+item['title']+'”：'+unscheduled[key])
            result.append(item)
            continue
        earliest=max((finishes[dep] for dep in dependencies),default=now)
        earliest+=timedelta(days=item.get('min_gap_days',0))
        duration=item['estimated_minutes']
        chosen=reserve_slots(slots,remaining_minutes,earliest,duration,item.get('requires_contiguous',False))
        if chosen:
            finish=chosen[-1]+timedelta(minutes=1);finishes[key]=finish
            sessions=[];a=previous=chosen[0]
            for stamp in chosen[1:]:
                if stamp-previous!=timedelta(minutes=1):sessions.append({'start':a.isoformat(),'end':(previous+timedelta(minutes=1)).isoformat()});a=stamp
                previous=stamp
            sessions.append({'start':a.isoformat(),'end':finish.isoformat()})
            item.update(date=chosen[0].date().isoformat(),deadline=finish.isoformat(),suggested_finish=finish.isoformat(),suggested_sessions=sessions)
        else:
            reason='在截止日期前的周预算内找不到 '+str(duration)+' 分钟的连续空档。' if item.get('requires_contiguous') else '在当前预算、依赖间隔与截止日期内排不下。'
            unscheduled[key]=reason
            warnings.append('“'+item['title']+'”：'+reason)
        result.append(item)
    return result,{**budget,'feasible':not warnings,'minutes_requested':sum(item['estimated_minutes'] for item in items),'warnings':warnings,'unscheduled':unscheduled}
