"""数据库写锁适配；不在此处提交，保留调用方的事务边界。"""

from sqlalchemy import text


def begin_write(db, *, enabled=True):
    if enabled and db.bind.dialect.name == 'sqlite':
        db.execute(text('BEGIN IMMEDIATE'))
