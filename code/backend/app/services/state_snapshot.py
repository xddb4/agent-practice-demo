"""保存状态快照的业务流程：校验、合并生命周期信息，再交给仓储写入。"""

from fastapi import HTTPException

from .completion_evidence import completion_snapshot
from .completion_stats import merge_completion_ids
from .task_expiry import sweep_expired
from .task_lifecycle import stamp_tasks
from .tasks import validate_tasks


def validate_evidence(evidence):
    for item in evidence:
        completion = item.get('source_type') == 'task_completion'
        accepted = item.get('status') == '已接受'
        unknown_dimension = completion and item.get('dim') == -1 and not accepted
        if item.get('dim') not in range(6) and not unknown_dimension:
            raise HTTPException(422, '证据维度或状态无效')
        if item.get('status') not in ['待确认', '已接受', '已拒绝', '待观察']:
            raise HTTPException(422, '证据维度或状态无效')
        if completion and accepted and not item.get('completion_details_confirmed'):
            raise HTTPException(422, '请先补充任务实际成果或过程，再接受为成长证据')


def incoming_tasks(tasks, previous):
    archived = [item['task'] for item in previous.get('expired_tasks', [])]
    expired_ids = {str(task.get('id')) for task in archived}
    incoming = [task for task in tasks if str(task.get('id')) not in expired_ids]
    validate_tasks([*incoming, *archived])
    return incoming, expired_ids


def incoming_trash(body, previous, expired_ids):
    if 'task_trash' in body.model_fields_set:
        trash = body.task_trash
    else:
        trash = previous.get('task_trash', [])
    retained = []
    for item in trash:
        if not isinstance(item.get('task'), dict) or not item.get('trashId'):
            raise HTTPException(422, '回收站记录无效')
        if str(item['task'].get('id')) in expired_ids:
            continue
        validate_tasks([item['task']])
        retained.append(item)
    active_ids = {str(task.get('id')) for task in body.tasks}
    trash_ids = {str(item['task'].get('id')) for item in retained}
    if active_ids & trash_ids:
        raise HTTPException(409, '任务不能同时存在于日程和回收站中')
    if len({item['trashId'] for item in retained}) != len(retained):
        raise HTTPException(422, '回收站记录编号重复')
    return retained


def validate_permanent_deletions(body, trash, destroyed):
    retained_tasks = [*body.tasks, *[item['task'] for item in trash]]
    if any(str(task.get('id')) in destroyed for task in retained_tasks):
        raise HTTPException(409, '已永久删除的任务不能恢复，请刷新页面后重试')
    if any(str(item.get('task_id')) in destroyed for item in body.evidence):
        raise HTTPException(409, '已永久删除的任务证据不能恢复，请刷新页面后重试')


def build_snapshot(body, previous, incoming, trash):
    previous_tasks = [item['task'] for item in previous.get('task_trash', [])]
    previous_tasks.extend(previous.get('tasks', []))
    stamped = stamp_tasks(incoming, previous_tasks)
    stamped_trash = [
        {**item, 'task': stamp_tasks([item['task']], previous_tasks)[0]}
        for item in trash
    ]
    return sweep_expired({
        **completion_snapshot(stamped, body.evidence, previous),
        'task_trash': stamped_trash,
        'expired_tasks': previous.get('expired_tasks', []),
    })


class StateSnapshotService:
    def __init__(self, repository):
        self.repository = repository

    def save(self, body):
        validate_tasks(body.tasks)
        validate_evidence(body.evidence)
        record = self.repository.get()
        previous = sweep_expired(record.data) if record else {}
        incoming, expired_ids = incoming_tasks(body.tasks, previous)
        trash = incoming_trash(body, previous, expired_ids)
        validate_permanent_deletions(body, trash, self.repository.deleted_task_ids())
        completed = merge_completion_ids(
            self.repository.recorded_completions(), previous.get('tasks', []), incoming,
        )
        snapshot = build_snapshot(body, previous, incoming, trash)
        self.repository.save_completions(completed)
        self.repository.save(snapshot)
        return snapshot
