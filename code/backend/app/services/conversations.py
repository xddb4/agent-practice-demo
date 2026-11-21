"""对话删除服务：聚合关联任务、校验确认版本并清理生成记录。"""

import hashlib
import json

from fastapi import HTTPException

from ..repositories.plans import CONVERSATION_NOT_FOUND, PlanRepository
from ..repositories.records import rows
from ..repositories.state import StateRepository
from ..repositories.transactions import begin_write
from .memory import unpack


def conversation_all_tasks(state):
    archived = [item['task'] for item in state.get('expired_tasks', [])]
    deleted = [item['task'] for item in state.get('task_trash', [])]
    return [*state.get('tasks', []), *archived, *deleted]


def conversation_task_summary(tasks, plan_id):
    linked = [task for task in tasks if task.get('agent_run_id') == plan_id]
    completed = sum(bool(task.get('done')) for task in linked)
    version = hashlib.sha256(json.dumps(linked, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
    return {'total': len(linked), 'completed': completed, 'pending': len(linked) - completed, 'version': version}


def remove_linked_tasks(state, plan_id, version, summary):
    if not version or version != summary['version']:
        raise HTTPException(409, '关联任务已变化，请重新查看完成情况并确认删除')
    updated = {**state, 'tasks': [task for task in state.get('tasks', []) if task.get('agent_run_id') != plan_id]}
    for field in ('expired_tasks', 'task_trash'):
        updated[field] = [item for item in state.get(field, []) if item['task'].get('agent_run_id') != plan_id]
    return updated


class ConversationService:
    def __init__(self, db, owner, public_job):
        self.db = db
        self.owner = owner
        self.public_job = public_job

    def delete(self, plan_id, *, delete_tasks=False, task_version=''):
        begin_write(self.db)
        record = PlanRepository(self.db, self.owner).get(plan_id, detail=CONVERSATION_NOT_FOUND)
        jobs = [job for job in rows(self.db, self.owner, 'agent-job') if job.data.get('plan_id') == plan_id]
        self._require_idle(jobs)
        snapshot = StateRepository(self.db, self.owner).get(for_update=True)
        state = snapshot.data if snapshot else {'tasks': [], 'evidence': []}
        summary = conversation_task_summary(conversation_all_tasks(state), plan_id)
        if delete_tasks:
            state = remove_linked_tasks(state, plan_id, task_version, summary)
            if snapshot:
                snapshot.data = state
        data = {**unpack(record.data)}
        data.pop('dialogue', None)
        record.data = {**data, 'conversation_deleted': True}
        for job in jobs:
            self.db.delete(job)
        return {'ok': True, 'deleted_tasks': summary['total'] if delete_tasks else 0, **state}

    def _require_idle(self, jobs):
        if any(self.public_job(job.data).get('status') == 'running' for job in jobs):
            raise HTTPException(409, '对话仍在生成，请先停止生成后再删除')
