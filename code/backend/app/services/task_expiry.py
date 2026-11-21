"""Archive overdue flexible tasks; preserve data and require explicit rescheduling."""
from copy import deepcopy
from datetime import datetime,date
from zoneinfo import ZoneInfo

LOCAL=ZoneInfo('Asia/Shanghai')


def expired(task, day=None):
    day=day or datetime.now(LOCAL).date().isoformat()
    deadline=task.get('ddl')
    try:date.fromisoformat(str(deadline)[:10])
    except ValueError:return False
    return bool(not task.get('start') and not task.get('done') and deadline and str(deadline)[:10]<day)


def sweep_expired(state,now=None):
    now=(now or datetime.now(LOCAL)).astimezone(LOCAL)
    result=deepcopy(state)
    archived=result.setdefault('expired_tasks',[])
    known={str(item['task'].get('id')) for item in archived}
    active=[]
    for task in result.get('tasks',[]):
        key=str(task.get('id'))
        if key in known:continue
        if expired(task,now.date().isoformat()):
            task['expiry_count']=(task.get('expiry_count',0) if type(task.get('expiry_count',0)) is int else 0)+1
            task['last_expired_at']=now.isoformat()
            archived.append({'trashId':'expired:'+key+':'+str(task['ddl']),'task':task,'expiredAt':now.isoformat(),'kind':'expired'})
            known.add(key)
        else:active.append(task)
    result['tasks']=active
    return result


def expiry_reference(records,plan_id=None,limit=8):
    records=[item for item in records if plan_id is None or item['task'].get('agent_run_id')==plan_id]
    records=sorted(records,key=lambda item:item.get('expiredAt',''),reverse=True)
    repeated=sum(type(item['task'].get('expiry_count')) is int and item['task']['expiry_count']>1 for item in records[:limit])
    advice=[]
    if records:advice.append('先核对是否实际已完成但尚未标记，再确认材料、前置任务和可用时间。恢复时重新估计时长并设置截止日期。')
    if len(records)>=3:advice.append('过期任务较多，建议先减少本轮恢复数量，优先保留重要且可执行的任务，其余暂缓或取消。')
    if repeated:advice.append(f'近期样本中有 {repeated} 项任务反复过期，可考虑拆小步骤、补足前置条件或取消不再需要的任务。')
    return {'total':len(records),'included':min(limit,len(records)),
            'adjustment_advice':advice,
            'tasks':[{key:(str(item['task'].get(key,''))[:160] if key=='title' else item['task'].get(key)) for key in ('id','title','date','ddl','duration','agent_run_id','proposal_index','expiry_count')} for item in records[:limit]],
            'limitations':'过期仅表示截止前未标记完成，可能与时间预算、排期、材料等有关，不代表能力不足。先询问原因并建议调整，所有恢复、改期或取消均须用户确认。'}
