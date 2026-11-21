"""生成任务的持久化访问；每次写入使用独立会话。"""

from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy.exc import IntegrityError

from ..core.db import Record, Session


def job_key(owner, request_id):
    return 'agent-job:' + owner + ':' + str(request_id)


class AgentJobRepository:
    def __init__(self, owner, request_id):
        self.owner = owner
        self.key = job_key(owner, request_id)

    def create(self, data):
        with Session() as db:
            db.add(Record(id=self.key, owner=self.owner, kind='agent-job', data=data))
            try:
                db.commit()
            except IntegrityError:
                raise HTTPException(409, '这次生成请求已经存在，请查看原对话') from None

    def update(self, data):
        with Session() as db:
            row = db.get(Record, self.key)
            if row:
                row.data = {**data, 'updated_at': datetime.now(timezone.utc).isoformat()}
                db.commit()
