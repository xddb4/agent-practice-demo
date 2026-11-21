"""Validation shared by calendar snapshots and confirmed plan changes."""
from fastapi import HTTPException

class TaskValidator:
    """Ordered validation pipeline with duplicate tracking scoped to one batch."""

    def __init__(self):
        self.ids = set()
        self.proposals = set()
        self.rules = (
            self.validate_title,
            self.validate_id,
            self.validate_proposal,
            self.validate_time,
            self.validate_quadrant,
        )

    def validate(self, tasks):
        for task in tasks:
            for rule in self.rules:
                rule(task)

    @staticmethod
    def validate_title(task):
        if not str(task.get('title', '')).strip():
            raise HTTPException(422, '任务名称不能为空')

    def validate_id(self, task):
        identifier = task.get('id')
        if identifier in self.ids:
            raise HTTPException(422, '任务编号重复')
        self.ids.add(identifier)

    def validate_proposal(self, task):
        if not task.get('agent_run_id'):
            return
        if not isinstance(task.get('proposal_index'), int):
            return
        identity = (task['agent_run_id'], task['proposal_index'])
        if identity in self.proposals:
            raise HTTPException(409, '该方案条目已加入计划，请勿重复采纳')
        self.proposals.add(identity)

    @staticmethod
    def validate_time(task):
        if not task.get('start'):
            return
        if not task.get('end') or task['start'] >= task['end']:
            raise HTTPException(422, '结束时间必须晚于开始时间')

    @staticmethod
    def validate_quadrant(task):
        if task.get('q', 0) not in range(4):
            raise HTTPException(422, '象限无效')


def validate_tasks(tasks):
    """Keep the shared entry point and isolate state for each validation call."""
    TaskValidator().validate(tasks)
