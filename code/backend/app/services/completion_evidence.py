"""Completion is a self-report candidate, never an automatic ability assessment."""
from copy import deepcopy
from datetime import datetime, timezone


def completion_snapshot(tasks, evidence, previous=None):
    tasks, evidence = deepcopy(tasks), deepcopy(evidence)
    previous = previous or {}
    old_tasks = {str(t.get('id')): t for t in previous.get('tasks', [])}
    next_id = max([int(datetime.now(timezone.utc).timestamp() * 1000)] + [e['id'] for e in evidence + previous.get('evidence', []) if type(e.get('id')) is int]) + 1
    for task in tasks:
        key = str(task.get('id'))
        old = old_tasks.get(key, {})
        marker = task.get('completion_evidence_id') or old.get('completion_evidence_id')
        if not task.get('done'):
            pending = next((e for e in evidence if e.get('source_type') == 'task_completion' and str(e.get('task_id')) == key and e.get('status') in ['待确认', '待观察']), None)
            if pending:
                evidence.remove(pending)
                task.pop('completion_evidence_id', None)
            continue
        if task.get('start'):
            continue
        if marker:
            # A stale queued save may predate candidate creation; preserve the server candidate.
            if not task.get('completion_evidence_id'):
                prior = next((e for e in previous.get('evidence', []) if e.get('source_type') == 'task_completion' and str(e.get('task_id')) == key), None)
                if prior and not any(e.get('source_type') == 'task_completion' and str(e.get('task_id')) == key for e in evidence):
                    evidence.append(deepcopy(prior))
            task['completion_evidence_id'] = marker
            continue
        existing = next((e for e in evidence if e.get('source_type') == 'task_completion' and str(e.get('task_id')) == key), None)
        if existing:
            task['completion_evidence_id'] = existing['id']
            continue
        if len(evidence) >= 5000:
            break
        dim = task.get('ability')
        dim = dim if type(dim) is int and dim in range(6) else -1
        evidence.append({'id': next_id, 'title': task.get('title', '已完成任务'),
                         'body': '用户已将此任务标记完成。' + ('\n计划执行说明（并非实际成果）：' + task['description'] if task.get('description') else ''),
                         'desc': '完成记录仅说明用户标记做过。请修改并补充实际过程、成果或反思，选择关联能力后再接受。',
                         'dim': dim, 'status': '待确认', 'source_type': 'task_completion', 'kind': 'self_report',
                         'task_id': task.get('id'), 'agent_run_id': task.get('agent_run_id'),
                         'completion_details_confirmed': False})
        task['completion_evidence_id'] = next_id
        next_id += 1
    return {'tasks': tasks, 'evidence': evidence}
