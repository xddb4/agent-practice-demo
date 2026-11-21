from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session
from sqlalchemy.dialects import postgresql
from sqlalchemy import select
from backend.app.models.record import Base, Record
from backend.app.repositories.records import rows


def test_untrusted_ids_and_filters_are_bound_values_not_sql():
    engine=create_engine('sqlite://')
    Base.metadata.create_all(engine)
    calls=[]
    event.listen(engine,'before_cursor_execute',lambda connection,cursor,statement,parameters,context,many:calls.append((statement,parameters)))
    payload="x' OR 1=1; DROP TABLE records; --"
    with Session(engine) as db:
        db.add(Record(id='safe',owner='owner-a',kind='run',data={'title':'保留数据'}))
        db.commit()
        assert rows(db,payload,'run')==[]
        assert rows(db,'owner-a',payload)==[]
        assert db.get(Record,payload) is None
        assert db.get(Record,'safe').data['title']=='保留数据'
        db.add(Record(id=payload,owner=payload,kind=payload,data={'title':payload}))
        db.commit()
        assert rows(db,payload,payload)[0].id==payload
        assert all(payload not in sql for sql,parameters in calls)
        assert any(payload in parameters for sql,parameters in calls)
    compiled=select(Record).where(Record.owner==payload,Record.kind=='run').compile(dialect=postgresql.dialect())
    assert payload not in str(compiled)
    assert payload in compiled.params.values()
    engine.dispose()
