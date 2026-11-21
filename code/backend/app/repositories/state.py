"""用户状态的持久化访问；事务由调用方统一提交。"""

from ..core.db import Record


class StateRepository:
    KEY_PREFIX = 'state:'

    def __init__(self, db, owner):
        self.db = db
        self.owner = owner
        self.key = self.KEY_PREFIX + owner

    def get(self, *, for_update=False):
        return self.db.get(Record, self.key, with_for_update=for_update)

    def save(self, snapshot):
        return self.db.merge(Record(
            id=self.key, owner=self.owner, kind='state', data=snapshot,
        ))

    def deleted_task_ids(self):
        row = self.db.get(Record, 'permanent-task-deletions:' + self.owner)
        return set(row.data.get('ids', [])) if row else set()

    def recorded_completions(self):
        row = self.db.get(Record, 'completion-stats:' + self.owner)
        return row.data.get('task_ids', []) if row else []

    def save_completions(self, task_ids):
        return self.db.merge(Record(
            id='completion-stats:' + self.owner,
            owner=self.owner, kind='completion-stats', data={'task_ids': task_ids},
        ))
