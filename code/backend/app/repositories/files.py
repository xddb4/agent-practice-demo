"""附件记录的所有权检查及统一键管理。"""

from fastapi import HTTPException

from ..core.db import Record


class FileRepository:
    KEY_PREFIX = 'file:'

    def __init__(self, db, owner):
        self.db = db
        self.owner = owner

    def get(self, key, *, detail='附件不存在'):
        row = self.db.get(Record, self.KEY_PREFIX + str(key))
        if not row or row.owner != self.owner or row.kind != 'file':
            raise HTTPException(404, detail)
        return row

    def add(self, key, name, text, privacy=None):
        self.db.add(Record(
            id=self.KEY_PREFIX + key, owner=self.owner, kind='file',
            data={'name': name, 'text': text, 'privacy': privacy or {}},
        ))
