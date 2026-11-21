"""Server-recorded task timestamps; elapsed wall time is not active study time."""
from copy import deepcopy
from datetime import datetime, timezone


def valid_stamp(value):
    if not isinstance(value,str):return None
    try:
        parsed=datetime.fromisoformat(value.replace('Z','+00:00'))
        return parsed if parsed.tzinfo else None
    except ValueError:return None


def stamp_tasks(tasks, previous_tasks, now=None):
    now=(now or datetime.now(timezone.utc)).replace(second=0,microsecond=0)
    old={str(task.get('id')):task for task in previous_tasks}
    result=deepcopy(tasks)
    for task in result:
        prior=old.get(str(task.get('id')))
        created=valid_stamp(prior.get('created_at')) if prior else now
        completed=valid_stamp(prior.get('completed_at')) if prior else None
        if task.get('done') and (not prior or not prior.get('done')):completed=now
        if not task.get('done'):completed=None
        task['created_at']=created.isoformat() if created else None
        task['completed_at']=completed.isoformat() if completed else None
        task['elapsed_minutes']=max(0,int((completed-created).total_seconds()//60)) if created and completed else None
    return result


def execution_context(tasks, recent_limit=10, expired_tasks=None):
    completed=[task for task in tasks if task.get('done') and not task.get('start')]
    timed=[task for task in completed if task.get('elapsed_minutes') is not None]
    recent=sorted(completed,key=lambda task:task.get('completed_at') or '',reverse=True)[:recent_limit]
    from .task_expiry import expiry_reference
    return {'completed_flexible_tasks':len(completed),'known_elapsed_tasks':len(timed),'unknown_elapsed_tasks':len(completed)-len(timed),'expired_reference':expiry_reference(expired_tasks or []),
            'recent':[{key:(str(task.get(key,''))[:160] if key=='title' else task.get(key)) for key in ('id','title','ability','created_at','completed_at','elapsed_minutes')} for task in recent],
            'limitations':'历时为任务建立到标记完成的自然经过时间，包含等待与休息，并非实际学习用时；仅参考执行节奏，不能据此判断能力高低。旧任务未记录的时间不推测。'}
