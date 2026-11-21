"""Completion is a self-report candidate, never an automatic ability assessment."""
from copy import deepcopy
from datetime import datetime, timezone


MAX_EVIDENCE = 5000
COMPLETION_SOURCE = 'task_completion'
PENDING_STATUSES = ('待确认', '待观察')


def completion_for(evidence, task_id, statuses=None):
    """Return the first matching candidate, preserving snapshot ordering."""
    return next((entry for entry in evidence
                 if entry.get('source_type') == COMPLETION_SOURCE
                 and str(entry.get('task_id')) == str(task_id)
                 and (statuses is None or entry.get('status') in statuses)), None)


class CompletionEvidenceFactory:
    """Allocate unique IDs and create unconfirmed self-report candidates."""

    def __init__(self, evidence):
        identifiers = [entry['id'] for entry in evidence if type(entry.get('id')) is int]
        clock_id = int(datetime.now(timezone.utc).timestamp() * 1000)
        self.next_id = max([clock_id, *identifiers]) + 1

    def create(self, task):
        dimension = task.get('ability')
        if type(dimension) is not int or dimension not in range(6):
            dimension = -1
        body = '用户已将此任务标记完成。'
        if task.get('description'):
            body += '\n计划执行说明（并非实际成果）：' + task['description']
        candidate = {
            'id': self.next_id, 'title': task.get('title', '已完成任务'),
            'body': body,
            'desc': '完成记录仅说明用户标记做过。请修改并补充实际过程、成果或反思，选择关联能力后再接受。',
            'dim': dimension, 'status': '待确认', 'source_type': COMPLETION_SOURCE,
            'kind': 'self_report', 'task_id': task.get('id'),
            'agent_run_id': task.get('agent_run_id'),
            'completion_details_confirmed': False,
            **{key: task.get(key) for key in ('created_at', 'completed_at', 'elapsed_minutes')},
        }
        self.next_id += 1
        return candidate


class CompletionSnapshot:
    """Coordinate candidate withdrawal, recovery, reuse and creation."""

    def __init__(self, tasks, evidence, previous):
        self.tasks = deepcopy(tasks)
        self.evidence = deepcopy(evidence)
        self.previous_evidence = previous.get('evidence', [])
        self.old_tasks = {str(task.get('id')): task for task in previous.get('tasks', [])}
        self.factory = CompletionEvidenceFactory([*self.evidence, *self.previous_evidence])

    def build(self):
        for task in self.tasks:
            if not self.process_task(task):
                break
        return {'tasks': self.tasks, 'evidence': self.evidence}

    def process_task(self, task):
        """False stops the batch when a new candidate would exceed capacity."""
        if not task.get('done'):
            self.withdraw_pending(task)
            return True
        if task.get('start'):
            return True
        old = self.old_tasks.get(str(task.get('id')), {})
        marker = task.get('completion_evidence_id') or old.get('completion_evidence_id')
        if marker:
            self.recover_marker(task, marker)
            return True
        existing = completion_for(self.evidence, task.get('id'))
        if existing:
            task['completion_evidence_id'] = existing['id']
            return True
        if len(self.evidence) >= MAX_EVIDENCE:
            return False
        candidate = self.factory.create(task)
        self.evidence.append(candidate)
        task['completion_evidence_id'] = candidate['id']
        return True

    def withdraw_pending(self, task):
        pending = completion_for(self.evidence, task.get('id'), PENDING_STATUSES)
        if pending:
            self.evidence.remove(pending)
            task.pop('completion_evidence_id', None)

    def recover_marker(self, task, marker):
        # Only stale saves without a marker recover server evidence. A marked
        # task with no candidate may reflect an intentional candidate deletion.
        if not task.get('completion_evidence_id'):
            self.recover_previous(task.get('id'))
        task['completion_evidence_id'] = marker

    def recover_previous(self, task_id):
        prior = completion_for(self.previous_evidence, task_id)
        if prior and not completion_for(self.evidence, task_id):
            self.evidence.append(deepcopy(prior))


def completion_snapshot(tasks, evidence, previous=None):
    """Public facade; inputs stay untouched and callers retain the same contract."""
    return CompletionSnapshot(tasks, evidence, previous or {}).build()
