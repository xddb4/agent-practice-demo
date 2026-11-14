from sqlalchemy import select
from ..models.record import Record

def rows(db, owner, kind):
    return db.scalars(select(Record).where(Record.owner==owner,Record.kind==kind)).all()
