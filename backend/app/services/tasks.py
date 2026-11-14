"""Validation shared by calendar snapshots and confirmed plan changes."""
from fastapi import HTTPException

def validate_tasks(tasks):
    ids=set()
    proposals=set()
    for task in tasks:
        if not str(task.get('title','')).strip(): raise HTTPException(422,'任务名称不能为空')
        if task.get('id') in ids: raise HTTPException(422,'任务编号重复')
        ids.add(task.get('id'))
        if task.get('agent_run_id') and isinstance(task.get('proposal_index'),int):
            identity=(task['agent_run_id'],task['proposal_index'])
            if identity in proposals:raise HTTPException(409,'该方案条目已加入计划，请勿重复采纳')
            proposals.add(identity)
        if task.get('start') and (not task.get('end') or task['start']>=task['end']): raise HTTPException(422,'结束时间必须晚于开始时间')
        if task.get('q',0) not in range(4): raise HTTPException(422,'象限无效')
