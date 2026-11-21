"""统一方案所有权、记录类型和对话可用性的检查。"""

from fastapi import HTTPException

from ..core.db import Record
from ..services.memory import unpack


PLAN_NOT_FOUND = '准备方案不存在'
CONVERSATION_NOT_FOUND = '对话不存在'


class PlanRepository:
    def __init__(self, db, owner):
        self.db = db
        self.owner = owner

    def get(self, plan_id, *, for_update=False, detail=PLAN_NOT_FOUND):
        record = self.db.get(Record, plan_id, with_for_update=for_update)
        if not record or record.owner != self.owner or record.kind != 'run':
            raise HTTPException(404, detail)
        if record.data.get('route') != 'recommend':
            raise HTTPException(404, detail)
        return record

    def conversation(self, plan_id, *, for_update=False):
        record = self.get(plan_id, for_update=for_update)
        data = unpack(record.data)
        if data.get('conversation_deleted'):
            raise HTTPException(404, '对话记录已删除')
        return record, data
