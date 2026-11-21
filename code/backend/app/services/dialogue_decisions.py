"""应用已确认的对话建议；预览校验和任务更新共享同一事务。"""

from datetime import datetime, timezone

from fastapi import HTTPException

from .plan_dialogue import apply_changes, prepare_changes
from .plans import linked_tasks, plan_items
from .task_expiry import sweep_expired
from .task_lifecycle import stamp_tasks
from .tasks import validate_tasks


def restored_tasks(tasks, previous, hidden, touched):
    retained = [task for task in tasks if task['id'] not in hidden]
    restored_at = datetime.now(timezone.utc).isoformat()
    updated = [{**task, 'restored_at': restored_at} if task['id'] in touched else task for task in retained]
    return stamp_tasks(updated, previous)


class DialogueDecisionService:
    def __init__(self, repository):
        self.repository = repository

    def decide(self, data, plan_id, body):
        chat = data.get('dialogue', {})
        pending = chat.get('pending')
        if not pending or pending['id'] != body.proposal_id:
            raise HTTPException(409, '这份调整建议已处理，请重新打开对话')
        updated_tasks, archived = None, None
        if body.apply:
            data, updated_tasks, archived = self._apply(data, plan_id, pending)
        note = '已应用本轮调整。' if body.apply else '已放弃本轮调整。'
        data = {**data, 'dialogue': {
            **chat, 'pending': None,
            'messages': [*chat['messages'], {'role': 'system', 'text': note}],
        }}
        return data, updated_tasks, archived

    def _apply(self, data, plan_id, pending):
        snapshot = self.repository.get(for_update=True)
        state = sweep_expired(snapshot.data) if snapshot else {'tasks': [], 'evidence': []}
        archived = state.get('expired_tasks', [])
        own_expired = [item['task'] for item in archived if item['task'].get('agent_run_id') == plan_id]
        combined = [*state['tasks'], *own_expired]
        preview = prepare_changes(data, combined, plan_id, pending['changes'])
        if preview != pending['preview']:
            raise HTTPException(409, '涉及的任务已更新，请放弃旧建议并重新生成')
        linked = linked_tasks(combined, plan_id, plan_items(data))
        touched = {linked[change['index']]['id'] for change in preview if change.get('expired') and change['index'] in linked}
        data, changed = apply_changes(data, combined, plan_id, preview)
        hidden = {task['id'] for task in own_expired} - touched
        updated = restored_tasks(changed, combined, hidden, touched)
        if snapshot is None:
            return data, updated, None
        validate_tasks(updated)
        snapshot.data = sweep_expired({
            **state, 'tasks': updated,
            'expired_tasks': [item for item in archived if item['task']['id'] not in touched],
        })
        return data, snapshot.data['tasks'], snapshot.data.get('expired_tasks', [])
